# Environment variables

Written Nov 16, 2026, from a code trace of how runs are prepared (`run-preparation.ts`), the
`claude_local` adapter and the Paperclip Runner. This guide hasn't been tested with live runs.

## What it is

Every program starts with a small list of named values, its *environment*: `HOME=/home/you`,
`PATH=…`, and so on. A program passes a copy of the list to every program it starts. Programs read
these values to configure themselves:

- `git` reads `GIT_AUTHOR_NAME`
- the GitHub CLI reads `GH_TOKEN`
- Node reads `NODE_ENV`
- your app reads `DATABASE_URL`, `STRIPE_SECRET_KEY` and so on

When an agent picks up a task, Paperclip starts the agent's program, such as the `claude` CLI, in the
task's workspace folder, with an environment Paperclip puts together for that run. Every command the
agent runs gets the same values: `npm test`, `git push`, `curl`, and the code under test. Setting a
variable in Paperclip is like typing `export NAME=value` in a terminal before the agent starts
working, except Paperclip does it again for every run. Values exist only inside that run's processes.
Nothing is written to a `.env` file, and your own shell isn't affected.

## The four layers

Variables can be set in four places. A run gets all of them merged. When the same name is set in
more than one place, the later layer wins:

| Order | Layer | Where in ui-new | Applies to |
| --- | --- | --- | --- |
| 1 | **Agent** | Agent → Settings → Environment variables | Every run of that agent, on any task |
| 2 | **Environment** | Settings → Environments → edit an environment | Every run that executes in that environment (a sandbox, an SSH host, the local machine) |
| 3 | **Project** | Project → Settings → Environment variables | Every run on that project's tasks, by any agent |
| 4 | **Recurring task** | A recurring task's details → Environment variables | The runs on the tasks it creates |

Which environment a run uses is decided in this order: a lease it already holds, the agent's default
environment, then the instance default. For low-trust review runs, the task's own environment comes
first.

A simple way to choose a layer is to ask what the value belongs to:

- **The agent** (the same whatever it works on): settings for its tools, Claude Code settings, the
  agent's own identity.
- **The machine or sandbox**: proxy settings, certificate paths, a region, a registry mirror.
- **The codebase or service**: API keys, database URLs, deploy target IDs, test settings.
- **One scheduled job**: a value just for that job, or a change to a project default for that one job.

## Kinds of value

Each variable is one of three kinds:

- **Text.** A plain value. It's visible in settings and can appear in run logs. Use it only for
  values that aren't secret: a region, a URL, a log level.
- **Secret.** Points to one of the company's secrets (Settings → Secrets). The value is never shown
  in settings, and a new secret can be created right from the editor. Edit the secret once, and every
  variable that points to it gets the new value on its next run.
- **Personal secret.** Each person stores their own value, and a run uses the value of the person
  responsible for it. That person is the one who started the run or wrote the comment that woke the
  agent, otherwise the person responsible for the task or recurring task, then the company default.
  If the variable is marked **Required** and that person hasn't set a value, the run doesn't start.
  The task gets a "configuration incomplete" blocker naming what's missing. If it isn't required, the
  variable is simply left out.

## Examples

### Credentials for one service

A project for your billing service gets `STRIPE_SECRET_KEY` (a secret holding a *test* key) and
`DATABASE_URL` (the dev database). Any agent working on that project's tasks can run the integration
tests. Agents working on other projects never get these values.

### Keep agents off production

Give the project `API_BASE_URL=https://staging.example.com`, `AWS_PROFILE=sandbox` and
`AWS_REGION=eu-west-1`. Every agent working there talks to staging, even if its own settings point
somewhere else. The project wins over the agent.

### Settings for CLI tools

`SENTRY_ORG`, `SENTRY_PROJECT`, `VERCEL_PROJECT_ID`, `SUPABASE_PROJECT_REF`, `KUBECONFIG`. Command-line
tools read these, so an agent can deploy, read logs or run migrations without being told the IDs in
every task.

### Make scripts run without prompts

`CI=true` and `NO_COLOR=1` make most test runners and build tools skip interactive prompts and
colour codes, which fits an agent that isn't at a terminal.

### Reuse one agent across projects

One "Engineer" agent works on a Node project and a Go project. Each project sets what its build
needs, such as `NODE_ENV=test`, a private registry's URL and token, or `GOFLAGS=-mod=mod`. The agent's
own settings don't change.

### A recurring task that changes a project default

The project sets `REPORT_DEPTH=summary`. A nightly recurring task on that project sets
`REPORT_DEPTH=full`. The nightly runs get `full` and everything else gets `summary`.

### Personal credentials for shared work

A personal secret `JIRA_TOKEN`, marked Required, set on a project. When you ask an agent to work
there, it uses your Jira token, and when a colleague asks, it uses theirs. Each action in Jira is
then attributed to the person who asked. If someone hasn't stored a token yet, their run stops with
a clear blocker instead of failing halfway through.

### Change how Claude Code behaves for one agent

Claude Code reads its own settings variables, so an agent can be tuned without changing anything
else. Some examples:

- `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS`: longer timeouts for an agent that runs slow test suites.
- `MAX_THINKING_TOKENS`: give one agent more room to think.
- `MCP_TIMEOUT`: for an agent whose MCP servers are slow to start.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`: the agent relies only on its own memory folder (see
  the agent's Memory settings).

Check names against Claude Code's settings documentation. Paperclip sets some values itself (see
below).

## What doesn't get through

Paperclip removes or replaces some names, so setting them has no effect.

**On every run:**

- `PAPERCLIP_API_KEY`: Paperclip gives each run its own key. Other names starting with
  `PAPERCLIP_` are passed on, unless Paperclip already set that name for the run.
- `BASH_ENV`, `ZDOTDIR`, `GH_CONFIG_DIR`: removed so they can't change how shells start.
- GitHub token names (`GH_TOKEN`, `GITHUB_TOKEN` and the like) when the agent uses a connected
  GitHub account. The connection supplies the credentials instead.
- The git author and committer names when the agent uses a connected GitHub account. Each git command
  gets your GitHub login and `…@users.noreply.github.com` address, so `GIT_AUTHOR_NAME` can't set a
  different commit name per agent. Use `git commit --author="…"` in the agent's instructions, or a
  `Co-authored-by:` line, instead. Neither has been tested yet.

**With the `claude_local` runner,** the adapter sets these values itself, overriding yours:
`PAPERCLIP_API_KEY`, `CLAUDE_CODE_SHELL_PREFIX`, `IS_SANDBOX`, and, in a sandbox or on a remote
machine, `CLAUDE_CONFIG_DIR` and `HOME`. Sign-in and model come from the agent's settings. Leave
`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_MODEL` alone: setting an API key can move
the agent from your subscription to billing by the API.

**With the Paperclip Runner** (`paperclip_runner`), more names are dropped before Claude starts:

- `PATH`, `HOME`, `SHELL`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `PYTHONHOME`, `RUBYOPT`,
  `RUBYLIB`, `PERL5OPT`, `PERL5LIB`, and names starting with `LD_`, `DYLD_` or `GIT_CONFIG_`.
- AI provider and GitHub credentials (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GH_TOKEN`,
  `GITHUB_TOKEN` and others). These come from the agent's connections instead. **A GitHub token set
  as a variable never reaches a Runner agent.** Connect a GitHub account instead.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS` and `CLAUDE_CODE_DISABLE_CRON` are always set to `1`.

`NODE_ENV`, your own names and Claude Code's other settings variables are passed on.

## Things to know

- **Use secrets for anything sensitive.** Low-trust (review) runs refuse sensitive values typed in as
  plain text, and Text values can show up in logs.
- **A secret is still visible to the agent.** Secrets are hidden in settings, but the agent's process
  can read the value. If the agent prints it, for example with `echo $STRIPE_SECRET_KEY`, it lands in
  the run transcript. The trace found no masking of secret values in run output, apart from the
  OpenCode runner.
- **A missing secret stops the run before it starts.** If a variable points to a secret that has
  been deleted, or to a personal secret someone hasn't set, the run doesn't start. The task gets a
  "configuration incomplete" blocker for a person to fix.
- **One editor everywhere.** All four layers use the same editor in ui-new, and changes are saved
  with Save variables. Saving replaces all of a layer's variables at once.

## Where ui-new stands

- All four layers can be edited, with the same editor and the same three kinds of value (Nov 16).
- Before Nov 16, the agent section was called "Secrets and variables" and the recurring task one
  "Secrets". The recurring task section could only add company secrets, which dropped plain values
  the old UI allowed. Both are fixed.
- The agent and project sections still have their own copies of the editor's rows rather than
  using the shared `EnvVarsEditor`. Same behaviour; a cleanup for later.
- Nothing yet shows a run's *merged* variables, meaning which layer each value came from. A "what
  will this run get" view on the task or run page would help with debugging.

## Sources

- Merge order and checks: `server/src/services/heartbeat/run-preparation.ts` (~240–280 removed
  names, ~330–610 layering and the missing-binding check);
  `server/src/__tests__/heartbeat-project-env.test.ts` ("overlays environment, project, and routine
  env on top of agent env").
- Environment choice: `server/src/services/environment-selection.ts:235–336`.
- Personal secrets: `server/src/services/secrets.ts` (~4312–4378 resolution, ~5402–5540 the
  pre-run check); the responsible user, `run-preparation.ts` ~3192–3275.
- `claude_local`: `packages/adapters/claude-local/src/server/execute.ts:227–314` (merge), 316–782
  (values the adapter sets).
- Paperclip Runner: `packages/paperclip-runner/src/configured-environment.ts:40–62` (dropped names);
  `drivers/acpx/environment.ts:10–30, 119–193` (what's added back, forced values).
- Connected GitHub accounts: `packages/adapter-utils/src/github-launcher.ts:178–200`,
  `server/src/services/git-credentials.ts:116–160`.
- Masking: `server/src/services/heartbeat/run-output.ts:269–314`.
