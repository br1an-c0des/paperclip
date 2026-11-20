# Step 4b: sealed runs on the CLI engine

**Status: approved 2026-11-18; updated 2026-11-19 for 4a and 3a, both merged into `main`
([what changed](#updated-2026-11-19-after-4a-and-3a)).** The second half of
[hard-fork plan step 4](hard-fork-plan.md#4-make-runs-claude-native), following
[decision 8](hard-fork-plan.md#decisions) (sealed runs). This document designs **part 1**: the
switch to the CLI engine together with a sealed launch. Part 2 and later are listed at the end, not
designed here. The run is traced in [claude-local-run.md](claude-local-run.md); its "Tested
2026-11-18" section has the CLI tests this design relies on.

## Why

Nobody can tell what a `claude_local` run gets. Whether it loads the server's Claude login or
Paperclip's, the repo's `CLAUDE.md`, skills and MCP servers, or the server user's `~/.claude`
depends on the engine, the workspace and whether a managed AI connection is in use, and nothing
shows it. The user rarely wants repo, user and Paperclip settings combined. What bothered them was
not knowing which applied.

The intent: **a run gets exactly what Paperclip gives it, and Paperclip shows what that is.** The
repo's root `CLAUDE.md` is the one thing a run may take from the repo, behind a switch per project.

The CLI engine (`claude --print`) comes first because its flags control exactly what loads
(decision 7), and [step 5](hard-fork-plan.md#5-one-prompt-builder) builds on it.

## Where things stand (2026-11-18)

- **server1:** all five agents (Ada, Grace, Jim, Ken, Morgan) are `claude_local` with no `engine`
  set, so they run on **ACP**. All use one managed AI connection with the **subscription** method,
  which gives each run `CLAUDE_CODE_OAUTH_TOKEN` (`packages/shared/src/ai-connections.ts:94-97`).
  The container has no Claude login of its own.
- **What a CLI run would do today with a managed connection** (`execute.ts`):
  - **The config folder is temporary.** `prepareManagedAiRuntime` gives the run a temporary `HOME`
    and `CLAUDE_CONFIG_DIR`, deleted after the run (`server/src/services/ai-connection-runtime.ts:311-326`,
    `packages/adapter-utils/src/managed-ai-runtime-env.ts`). The session transcript goes with it,
    so `--resume` can't work and every run starts fresh.
  - **`--setting-sources user`** (`execute.ts:882`). This is good for sealing, but it also stops
    Paperclip's own skills from loading, since they come in through `--add-dir` (tested).
  - **The whole server environment is inherited** (`{...process.env, ...env}`, `execute.ts:783`),
    including `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET` and `DATABASE_URL` (upstream
    #20040).
  - **`--strict-mcp-config` is added only when the run has a Paperclip MCP server** (`execute.ts:904-906`).
    Since 4a, every run with a token gets the `paperclip` server, so in practice the flag is on
    for every run except one with no token (see the update below).

  So simply changing the default would make server1's agents worse: no company skills (including
  `paperclip`), no resumed sessions, and the server's secrets in their environment.

### Updated 2026-11-19, after 4a and 3a

4a (`549e76036`) and 3a are on `main`. What that changes here:

- **Nothing waits on 4a.** The `CLAUDE.md` switch's migration is `0492` (section 5), and tests
  follow the tiers 3a built (Testing).
- **One Paperclip MCP server per run.** `paperclipRunMcpServers`
  (`server/src/services/heartbeat/paperclip-run-mcp.ts`) gives every run that has a token and a
  `PAPERCLIP_API_URL` the `paperclip` server at `/api/mcp/paperclip`, task-bound or not. Connector
  tool servers are still added beside it. A run with no token gets no server and can't finish or
  block, so section 7 refuses to start it.
- **The completion rule is live.** A run that stops without `paperclip_finish`, `paperclip_block`
  or `paperclip_report_progress` with `continue: true`, and without leaving its task done, in review
  or blocked, is woken again to record one, then sent to the board as needing attention.
- **The CLI's prompt doesn't mention the tools.** 4a gave ACP's prompt a short note pointing the
  run at the `paperclip_*` tools (`renderApiAccessNote`, `acpx-engine/execute.ts:3158-3166`). The
  CLI's prompt (`claude-local/src/server/execute.ts:943-951`) got none, and leaves it to the
  `paperclip` skill, which Claude reads only when it chooses to. Switching the default as it stands
  would drop the note, and runs that miss the completion rule would end up as board work. Section 3
  carries the note over.
- **4a's real-run check was ACP only** (server1's dev instance, 2026-11-18). The CLI has had no real
  run with the MCP server and the completion rule, so rollout step 2 is also that check.
- **Access levels** (4a) are part of what a run gets. The manifest shows the agent's level
  (section 8).
- **Permission requests** (4a: a refused action becomes an Inbox request, and approving it carries
  the action out) give part 4's permission prompts a pattern to follow.

## Goals

- `cli` is the default engine for `claude_local`. `engine` unset or `"auto"` means CLI.
- A CLI run is sealed. Nothing loads from the server user's `~/.claude`, the user's MCP servers, or
  the repo's `.claude/` settings, skills, agents or `.mcp.json`.
- Each agent has one lasting Claude config folder, owned by Paperclip. Sessions resume across runs.
- Claude Code's auto memory is off for every run (section 6).
- Skills, MCP servers, instructions, the credential and the environment all come from Paperclip.
- The repo's root `CLAUDE.md` loads only when its project's switch is on.
- Each run records what it got (the **run manifest**), and the run's details show it.

## Non-goals (part 1)

- An agent-level page saying what this agent's runs get (part 2).
- Where runs work: running in the project's repo or a per-task worktree by default (part 3).
- The recovery handoff's content and server-side structured live events (later in 4b).
- Importing a repo's skills, agents or settings, and project skills added to runs
  ([build plan 3.18](../ui-new/docs/build-plan.md#318-importing-from-a-repo-and-project-skills)).
- Consolidating the memory systems ([build plan 3.5](../ui-new/docs/build-plan.md#35-memory-service)).
- Paperclip over MCP and the completion rule (4a, merged).
- The prompt itself (step 5), apart from carrying ACP's MCP note over to the CLI (section 3).
- ACP, the Runner, remote (SSH) and sandbox execution targets: dormant, left as they are.

## Anti-goals (a failure even if it works)

- A run that loads something from the machine or the repo that its manifest doesn't list.
- A silent fallback: to the server's Claude login, to ACP, or to an unsealed launch.
- Server1's agents losing their skills or their sessions at the deploy that brings this in.
- Server secrets reaching an agent's environment.
- A second launch mode to keep in your head ("sealed CLI" next to "plain CLI"). The CLI engine *is*
  the sealed launch.

## Approaches considered

| Approach | Trade-off | Chosen? |
| --- | --- | --- |
| **A. Change the default, patch today's CLI path:** write skills into the temporary folder, copy session files between runs, add the environment allowlist | Smallest, but all of it patches the temporary per-run folder that sealed runs replace | No |
| **B. Switch the engine and seal the launch together** | Delivers the core of 4b at once; sessions reset once; step 5 gets a fixed base | **Yes** (2026-11-18) |
| **C. Seal ACP instead** | Possible, but through patches we'd maintain rather than flags (see below) | No |

**On ACP, corrected 2026-11-18.** ACP *could* be sealed. The bridge patch Paperclip carries
(`patches/@agentclientprotocol__claude-agent-acp@0.73.0.patch`) already has
`PAPERCLIP_ACPX_ISOLATED_CONTEXT=1`, which the Runner uses to load only the user setting source.
With a config folder Paperclip owns, that would also keep out the repo's and user's MCP servers.
Its other gaps can be fixed with work: rewriting `.claude/settings.local.json` in the repo each run
(`acpx-engine/execute.ts:1663-1674`), skills passed as text, and instructions in the first message.
So the reason for the CLI is maintenance, not capability:
- the CLI is Claude Code itself, sealed with its documented flags, and it gets new features first;
- ACP goes through a pinned, patched third-party bridge and a 6,000-line engine shared with other
  adapters, so every sealing behaviour would be a patch to keep up to date;
- `bwrap` confinement and picking up runs after a hot restart work only on the CLI;
- only the CLI was tested.

The isolated-context switch also makes a later Runner hybrid more plausible (decision 9).

## Design

### 1. The engine default

- `normalizeEngine` (`packages/adapters/claude-local/src/server/acp.ts:91-96`): unset, `"auto"` and
  unknown values mean `cli`. Only an explicit `"acp"` selects ACP.
- The adapter's configuration doc (`packages/adapters/claude-local/src/index.ts:64`) says CLI is the
  default.
- Code that tests `config.engine === "cli"` literally must use the resolver, so that unset counts as
  CLI. Known: `server/src/services/connector-runtime.ts:251`. `agent-runner-selection.ts` and
  `runner-goals.ts` serve the dormant Runner and stay as they are.
- No data migration. All five server1 agents have `engine` unset, so they move at the deploy.
  - Their saved sessions are ACP ones (`acpSessionId`, no `sessionId`), so the CLI starts each of
    them fresh once, with the fresh-session handoff (`hydrateFreshSessionHandoff`).

### 2. The agent's Claude config folder

- **Location:** `<instanceRoot>/companies/<companyId>/agents/<agentId>/claude-config`, beside the
  existing `claude-runtime` folder (`resolveManagedClaudeRuntimeStateDir`, `claude-config.ts:156-166`).
  It's created on first use and kept for the agent's lifetime. Every run of that agent sets
  `CLAUDE_CONFIG_DIR` to it.
- **Contents:** Claude Code's own files (sessions under `projects/<cwd>/`, `.claude.json`).
  Paperclip writes nothing there: no `settings.json`, no plugins, no `CLAUDE.md`, and since
  2026-11-19 no `skills/` either (section 4).
- **Managed connections:** for `claude_local`, the run's `CLAUDE_CONFIG_DIR` is this folder instead
  of the temporary `provider` folder. The credential still arrives as `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY`. The temporary `HOME` and the `XDG_*` folders stay as they are (git, `gh` and
  other tools use them, and they aren't Claude settings).
- **`HOME` is always Paperclip's** (my call, from the builder check). Runs whose credential is in
  the agent's own `env`, with no managed connection, get the same temporary `HOME` and `XDG_*`
  folders (`managedAiHomeEnvironment`), so the server user's home, shell profile, `~/.gitconfig`,
  `~/.ssh` and `gh` sign-in never reach a run. Git and `gh` credentials come from Paperclip (the
  GitHub connection's `GH_TOKEN`), as they already do for server1's managed-connection runs. A dev
  instance that relied on the machine's git setup needs it given through Paperclip.
- An explicit `CLAUDE_CONFIG_DIR` or `HOME` in the agent's `config.env` is overridden. The manifest
  lists it under `overriddenEnv`.
- **Things Paperclip didn't put there** (my call, from the builder check). Runs skip permission
  prompts, so an agent, or Claude Code itself, can write files into its own folder that would load
  on later runs: `settings.json` or `settings.local.json` (hooks, env, enabled plugins), a
  `CLAUDE.md`, `agents/`, `commands/`, `output-styles/`, or a skill in `skills/`. Before each run,
  Paperclip checks the folder against what Claude Code keeps there itself (`.claude.json`,
  `projects/`, `sessions/`, `backups/`, its `plugins/` data, caches). Anything else that would load as configuration is **moved aside, not deleted**, to
  `<agent>/claude-config-set-aside/<runId>/`. The run log says so, and the manifest lists it
  (`setAside`). The builder confirms the list of what Claude Code keeps there, and that a plugin
  under `plugins/` doesn't load unless a settings file enables it.
- **Concurrent runs** of one agent share the folder, as two Claude Code terminals share
  `~/.claude`.
- **Reset:** the existing "reset session" action (`POST /agents/:id/runtime-state/reset-session`)
  keeps working as today, by dropping the saved session id. Clearing the whole folder is not part of
  part 1.

### 3. The launch

Every CLI run, on a local target:

```text
claude --print --output-format stream-json --verbose
  --setting-sources user              # always, not only with managed connections
  --strict-mcp-config                 # always
  --mcp-config <file>                 # the paperclip server, plus any connector tool servers
  [--resume <id>] --model … [--effort …] [--max-turns …]
  [--append-system-prompt-file <bundle>/agent-instructions.md]   # fresh sessions, as today
  [--add-dir <workspace root>]        # only when the CLAUDE.md switch is on (section 5)
  --dangerously-skip-permissions [extraArgs…]
```

- The user setting source is the agent's own config folder, so `--setting-sources user` loads
  nothing from the server user.
- The prompt bundle stops being passed with `--add-dir`: its skills don't load that way under the
  user source (tested), and section 4 replaces it. The instructions file is still read through
  `--append-system-prompt-file`.
- `extraArgs` stays, since it's the agent's own configuration. The manifest lists it.
- There's always at least the `paperclip` server, since a run without a token doesn't start
  (section 7). The `mcp-config.json` holding the run's token stays where it is today, under the
  agent's runtime state folder (`<stateDir>/runs/<runId>/mcp`, `claude-config.ts:169-176`), outside
  the config folder.
- **The MCP note in the prompt** (added 2026-11-19): fresh CLI sessions get the same short note as
  ACP's, telling the run to work through the `paperclip_*` tools, start with
  `paperclip_task_context`, and end with `paperclip_finish`, `paperclip_block`, or
  `paperclip_report_progress` with `continue: true`. Like ACP, it's left out on resumed sessions and
  external chat turns. It's a small exception to leaving the prompt to step 5, which then merges the
  two builders.

### 4. Skills

**Changed 2026-11-19, while planning** ([the plan](step-4b-plan.md#one-decision-this-plan-makes-changes-design-section-4)).
This section first put the run's skills into `<config>/skills/`. Runs of one agent can carry
different skill sets (a skill test, skills named in the task) and run up to 20 at once by default,
so a shared folder would have them rewrite each other's skills.

- The run's skill set comes, as today, from `resolveLegacyPaperclipDesiredSkillNames`
  (`server-utils.ts:4431-4450`, which always adds `paperclip`, `complain` and `suggestion-box`) and
  goes into the prompt bundle (`prompt-cache.ts:134-174`), one immutable folder per skill set.
- The bundle becomes a plugin (`.claude-plugin/plugin.json`, named `paperclip`, with a `skills/`
  folder), and the launch passes `--plugin-dir <bundle>` (tested to load under the user source).
  Skill names are namespaced: `paperclip:<skill>`.
- Concurrent runs with different sets each get their own bundle, so nothing they share changes
  under them. The config folder holds only Claude Code's own files; a `skills/` folder there is set
  aside like any other configuration (section 2).
- Claude Code's built-in skills and plugins still load. The manifest says "plus Claude Code's
  built-in skills" rather than listing them.

### 5. The repo's `CLAUDE.md`, per project

- **The switch:** a new project setting, "Agents read the repo's `CLAUDE.md`", stored as a boolean
  column on `projects` (migration `0492`, the next after 4a's `0491`). It's shown in
  `ui-new`'s project settings, in the Code section (`ui-new/src/projects/settings/CodeSection.tsx`),
  with its help text behind an info tip (CLAUDE.md, "UI text").
- **Default: on.** On ACP today, server1's agents read the repo's `CLAUDE.md` whenever the run
  starts in the repo, so switching it off by default would quietly change their behaviour.
- **When it's on** and the run's working folder is inside a git checkout of the project's repo:
  the launch adds `--add-dir <workspace root>` and sets `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.
  This loads that folder's `CLAUDE.md` and nothing else from it (tested). Only the root file
  counts: subfolder `CLAUDE.md` files don't load in a sealed run, and the user is fine with that.
- **When it's off, or the run isn't in the repo** (a task without a project, an isolated task
  folder, the agent home), no `CLAUDE.md` loads, and the manifest says why.

### 6. The environment

- Inherit only an allowlist from the server, modelled on ACP's `ACPX_INHERITED_HOST_ENV_KEYS`
  (`packages/adapter-utils/src/acpx-engine/execute.ts:590-697`: `PATH`, locale, certificate and
  proxy settings, and the like). Then add Paperclip's run variables (`PAPERCLIP_*`, `AGENT_HOME`,
  workspace variables), the agent's `config.env` with resolved secrets, and the managed
  connection's variables.
- Never inherited: `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `DATABASE_URL`, and anything
  else not on the list. This ports #20040 for `claude_local`.
- **Auto memory is off for every run** (decided 2026-11-18). Paperclip sets
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in every CLI run's environment itself, rather than relying on
  the server's environment. Agents remember between runs through `para-memory-files` where it's
  assigned, as today, which keeps one memory system per agent. On server1 nothing changes in
  practice: on ACP auto memory lived in the temporary folder and was lost after each run. The line
  in `deploy/docker-compose.yml:80` no longer reaches runs (the allowlist drops it). It stays,
  with a comment pointing here. This settles [decision 5](../ui-new/docs/decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other)'s
  interim fix and [bug 39](upstream-fixes.md#39-turn-off-claude-codes-auto-memory-when-an-agent-has-para-memory-files)
  for `claude_local`. The long-term answer stays with
  [build plan 3.5](../ui-new/docs/build-plan.md#35-memory-service).
- The managed connection's credential is the only credential. An `ANTHROPIC_API_KEY` set on the
  server isn't inherited.

### 7. No credential, no run

- A sealed run needs a credential from Paperclip (my call on the list, from the builder check):
  - a managed AI connection with any method it supports, including routed ones;
  - or, in the agent's own `env` (as secrets): `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`,
    `ANTHROPIC_AUTH_TOKEN` (a gateway, with `ANTHROPIC_BASE_URL`), or a provider switch
    (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`) with that
    provider's own variables.

  These all come from Paperclip's configuration, so they fit sealing. Only the subscription
  connection is in use on server1 (checked 2026-11-18). The main method is the subscription, with an
  API key sometimes.
- Without one, the run fails before starting Claude with a clear error (a new code such as
  `claude_credential_missing`), naming where to set one. There's no fallback to the server's login.
- This affects dev instances whose agents rely on the machine's `claude` login: they need a managed
  connection.
- **No Paperclip token, no run either** (added 2026-11-19, my call). A run gets the `paperclip`
  server only with a run token and `PAPERCLIP_API_URL`. Without them it can't finish or block, so
  the completion rule would always send it to the board. The run fails before starting Claude with
  its own error code (such as `paperclip_mcp_unavailable`), naming the missing piece: the JWT secret
  (`PAPERCLIP_AGENT_JWT_SECRET` or `BETTER_AUTH_SECRET`) or `PAPERCLIP_API_URL`.

### 8. The run manifest

- The CLI adapter adds a `runManifest` object to the `onMeta` call that becomes the run's
  `adapter.invoke` event (`execute.ts:981-993`). It's stored and published like the rest of that
  event.

  | Field | Contents |
  | --- | --- |
  | `engine` | `"cli"` |
  | `configDir` | The agent's config folder |
  | `settingSources` | `["user"]`, the agent's own folder |
  | `credential` | Its kind (`managed_connection` or `agent_env`), method (`subscription`, `api_key`, `auth_token`, `bedrock`, `vertex`, `foundry` or `routed`), and the connection's id and name; never the secret |
  | `setAside` | Files moved out of the config folder before the run (section 2), if any |
  | `overriddenEnv` | Variable names from the agent's `env` that the launch overrode (section 2) |
  | `skills` | Name and origin of each (agent assignment, always-on, connector, skill test), plus `builtIns: true` |
  | `mcpServers` | Name and URL of each (`paperclip`, plus any connector tool servers), `strict: true`; never the token |
  | `access` | The agent's access level (`read_only`, `worker`, `manager` or `admin`) and its per-action overrides, as resolved when the run started (4a) |
  | `instructions` | The entry file, and whether it was sent (fresh sessions only) |
  | `claudeMd` | `{ enabled, path }` when loaded, or `{ enabled: false, reason }`, the reason being `project_switch_off`, `not_in_repo` or `no_project` |
  | `autoMemory` | `false` |
  | `envKeys` | The variable names passed (no values) |
  | `extraArgs` | As configured |
  | `session` | `fresh` or `resumed`, and why when fresh |

- **`ui-new`:** the run's details (the run modal's Input tab, `ui-new/src/runs/invocation.ts`) show
  the manifest as a short "What this run got" list above the raw command. The agent-level view is
  part 2.

### 9. Rollout

1. Build on a branch. Until the default changes, the sealed launch is what `engine: "cli"` does.
   No agent on server1 sets it.
2. Try it on the desktop's dev instance with an "M7 test" agent set to `engine: "cli"`, given a
   managed subscription connection. This means real runs, with the user's go-ahead, never on Bob.
   Check: it resumes its session on a second wake, loads its skills, sees the repo's `CLAUDE.md` only
   with the switch on, has no server secrets in its environment, and its manifest matches. It's
   also the CLI's first real run with 4a in place, so check 4a's two runs again on the CLI:
   - it works only through the `paperclip_*` tools, and its finish is recorded `via: tool`;
   - with the agent at `worker`, a refused action (such as deleting a task) becomes a pending
     permission request in the Inbox, and the run still finishes.
3. Change the default to CLI in the same branch, then merge into `main`.
4. server1 moves at its next deploy, when the user asks. Back up the database first, since the
   `CLAUDE.md` switch adds a migration (`deploy.sh` now backs up and rehearses migrations itself).
   4a was deployed on its own on 2026-11-19, so this deploy changes only the engine and the
   sealing.

## Testing

The repo's test tiers (step 3a, [CLAUDE.md](../CLAUDE.md#tests)): `corepack pnpm test:quick`
before pushing, and the branch's latest push green in CI before merging into `main`. The adapters'
remote and sandbox paths are opt-in; run `test:optin` on the files concerned if shared changes reach
them.

- **Unit tests in `packages/adapters/claude-local`:**
  - the arguments: `--setting-sources user` and `--strict-mcp-config` always, no `--add-dir` for the
    bundle, `--add-dir` plus the variable only with the switch on and the run in the repo;
  - the environment: none of the three secrets, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` set by
    Paperclip, the credential present, the server's `HOME` absent;
  - set-aside files: a `settings.json` or stray skill in the folder is moved aside and listed;
  - the skills folder matches the set exactly, including removing a skill that was unassigned;
  - the missing-credential error, and the missing-token error (section 7);
  - the MCP note in a fresh CLI prompt, and its absence on a resumed session (section 3);
  - the manifest's fields, including `access`.
- **Existing tests to keep passing:** `packages/adapters/claude-local/src/server/*.test.ts`, and
  `server/src/__tests__/claude-local-execute.test.ts`, `claude-local-skill-sync.test.ts`,
  `claude-local-adapter-environment.test.ts`, `claude-local-adapter.test.ts`. Tests of the remote and
  sandbox paths that break because of shared changes get skipped with a note (CLAUDE.md, dormant
  areas). Tests that assumed ACP as the default change to say so explicitly.
- **The dev-instance check** in rollout step 2.

## Relation to 4a and step 5

- **4a (merged 2026-11-19):** builds on it, with no ordering left to manage. The launch passes the
  servers the run is given (the `paperclip` server, plus connector tool servers). The run needs 4a's
  token to start (section 7), its prompt carries ACP's MCP note (section 3), and its manifest shows
  4a's access level (section 8). The `CLAUDE.md` switch's migration is `0492`.
- **Step 5:** builds its prompt on this launch. The manifest and step 5's prompt preview belong
  together in the run's details.

## Keep the launch portable

Added 2026-11-18. The user wants to keep running agents elsewhere open for later: a container that
manages the agents' runs, a CLI driver inside the Paperclip Runner, or remote and sandbox targets
([hard-fork plan, decision 9](hard-fork-plan.md#decisions)). Part 1 builds none of those, but it
keeps the seam:

- **The launch is built as data, then started.** The server produces a launch description: the
  arguments, the environment, the files to put in place (the skill bundle, the MCP
  config, the `CLAUDE.md` folder) and the manifest. A local starter then spawns it. Whatever starts
  runs elsewhere later takes the same description.
- **The config folder can be copied.** Nothing in it points at paths that only exist on the server.
  For example, skills are copies, or symlinks that a copy step can resolve. Copying a folder to a
  target is how remote runs already move Claude's files (`prepareAdapterExecutionTargetRuntime`).

## Later parts of 4b (not designed here)

- **Part 2, what an agent's runs get:** the same list as the manifest, shown on the agent's page
  before any run, from the agent's configuration.
- **Part 3, where runs work:** the project's repo or a per-task worktree by default, never the
  agent's private folder when a project has a repo
  ([claude-local-run.md §10](claude-local-run.md#10-change-points-for-steps-4-and-5), "Run in the
  project's repo"). Sessions are keyed by working folder, so this decides how much they
  carry over between tasks.
- **The recovery handoff's content** and **server-side structured live events**
  ([claude-local-run.md §10](claude-local-run.md#10-change-points-for-steps-4-and-5)).
- **Part 4, live sessions on the CLI** (planned 2026-11-18, decision 9). This is what ACP offers,
  built on the CLI. None of it is tested in this repo yet:
  - follow-up messages into a running session (`--input-format stream-json`), which step 6's chat
    needs;
  - permission prompts answered through Paperclip instead of skipped (`--permission-prompt-tool` or
    `--permission-prompts host`), each one becoming an Inbox request. 4a's permission requests
    (`server/src/services/permission-requests.ts`) are the pattern to follow. They differ in one way:
    a 4a request ends the tool call and carries the action out after approval, while a Claude
    permission prompt holds the run until it's answered;
  - text streamed as it's written (`--include-partial-messages`), for example the status card's live
    summary.
- **Later, where runs execute** (after parts 1 to 4 have been used for a while): the CLI's dormant
  remote targets (SSH and sandbox, `packages/adapter-utils/src/execution-target.ts`), the agents
  container from [step 4's idea](hard-fork-plan.md#4-make-runs-claude-native), or a CLI driver in
  the Runner.

## Left to the builder

- The exact allowlist, starting from ACP's.
- The error code's name and wording.
- How the confinement paths (`filesystemScope`, `execute.ts:590-606`) point at the new folder.
- How the agent's resolved access level reaches the adapter for the manifest (the server loads it,
  `loadAgentAccess` in `server/src/services/agent-access.ts`, and passes it in the run's context),
  and the MCP note's exact wording, starting from ACP's.
