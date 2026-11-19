# Step 4b: sealed runs on the CLI engine

**Status: draft, 2026-11-18; builder-checked, waiting for approval.** The second half of
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

  So simply changing the default would make server1's agents worse: no company skills (including
  `paperclip`), no resumed sessions, and the server's secrets in their environment.

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
- Paperclip over MCP and the completion rule (4a).
- The prompt itself (step 5).
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
| **C. Seal ACP instead** | ACP has no strict MCP mode, writes `.claude/settings.local.json` into the repo, and decision 7 chose the CLI | No |

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
- **Contents:** Claude Code's own files (sessions under `projects/<cwd>/`, `.claude.json`) plus
  `skills/`, which Paperclip writes (section 4).
  Paperclip writes nothing else there: no `settings.json`, no plugins, no `CLAUDE.md`.
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
  `projects/`, `sessions/`, `backups/`, its `plugins/` data, caches) and against its own
  `skills/`. Anything else that would load as configuration is **moved aside, not deleted**, to
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
  --strict-mcp-config                 # always, even with no Paperclip MCP server
  --mcp-config <file>                 # Paperclip's servers; an empty server list when there are none
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

### 4. Skills

- Before each run, Paperclip makes `<config>/skills/` match the run's skill set exactly: one entry
  (a symlink or copy) per skill, named after the skill, and nothing else. Today's set comes from
  `resolveLegacyPaperclipDesiredSkillNames` (`server-utils.ts:4401-4420`, which always adds
  `paperclip`, `complain` and `suggestion-box`) and the prompt bundle (`prompt-cache.ts:134-174`).
  Skills in this folder load under their own names (tested).
- Claude Code's built-in skills and plugins still load. The manifest says "plus Claude Code's
  built-in skills" rather than listing them.
- **Per-run additions** (connector skills from `connector-runtime.ts`, a skill test's skill): the
  builder decides between writing them into `skills/` for that run and a per-run `--plugin-dir`.
  `--plugin-dir` is tested to work but namespaces the names (`<plugin>:<skill>`). Concurrent runs of
  one agent must not see each other's per-run skills.

### 5. The repo's `CLAUDE.md`, per project

- **The switch:** a new project setting, "Agents read the repo's `CLAUDE.md`", stored as a boolean
  column on `projects` (a migration in the numbered sequence, after 4a's `0491`). It's shown in
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
  | `mcpServers` | Name and URL of each, `strict: true` |
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
   with the switch on, has no server secrets in its environment, and its manifest matches.
3. Change the default to CLI in the same branch, then merge into `main`.
4. server1 moves at its next deploy, which stays on hold until the user asks. Back up the database
   first, since the `CLAUDE.md` switch adds a migration.

## Testing

Until step 3a's faster runner and CI land, the agents' rule from 4a applies: typecheck, the named
test files, no broad suites.

- **Unit tests in `packages/adapters/claude-local`:**
  - the arguments: `--setting-sources user` and `--strict-mcp-config` always, no `--add-dir` for the
    bundle, `--add-dir` plus the variable only with the switch on and the run in the repo;
  - the environment: none of the three secrets, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` set by
    Paperclip, the credential present, the server's `HOME` absent;
  - set-aside files: a `settings.json` or stray skill in the folder is moved aside and listed;
  - the skills folder matches the set exactly, including removing a skill that was unassigned;
  - the missing-credential error;
  - the manifest's fields.
- **Existing tests to keep passing:** `packages/adapters/claude-local/src/server/*.test.ts`, and
  `server/src/__tests__/claude-local-execute.test.ts`, `claude-local-skill-sync.test.ts`,
  `claude-local-adapter-environment.test.ts`, `claude-local-adapter.test.ts`. Tests of the remote and
  sandbox paths that break because of shared changes get skipped with a note (CLAUDE.md, dormant
  areas). Tests that assumed ACP as the default change to say so explicitly.
- **The dev-instance check** in rollout step 2.

## Relation to 4a and step 5

- **4a:** no code dependency. The launch passes whatever MCP servers the run is given: today's
  three, or 4a's single `paperclip` server once `PAPERCLIP_UNIFIED_RUN_MCP` is on. The migration
  for the `CLAUDE.md` switch takes the next number after 4a's `0491`, so this branch merges after
  `feat/step-4a`, or renumbers if it goes first. Both touch
  `server/src/services/heartbeat/runtime-execution.ts` lightly.
- **Step 5:** builds its prompt on this launch. The manifest and step 5's prompt preview belong
  together in the run's details.

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

## Left to the builder

- Whether `skills/` entries are symlinks or copies, and how they're swapped without disturbing a
  run of the same agent that's already going.
- Per-run skills: written into `skills/`, or a per-run `--plugin-dir` (section 4).
- The exact allowlist, starting from ACP's.
- The error code's name and wording.
- How the confinement paths (`filesystemScope`, `execute.ts:590-606`) point at the new folder.
