# Step 4b Part 1 Implementation Plan: sealed runs on the CLI engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief names.

**Goal:** A `claude_local` CLI run gets exactly what Paperclip gives it (credential, skills, MCP
servers, instructions, environment, and the repo's root `CLAUDE.md` and `.claude/skills` when its
project allows them),
records that in a run manifest the run's details show, and CLI becomes the default engine.

**Architecture:** The CLI adapter (`packages/adapters/claude-local`) gains small pure modules
(sealed environment, the agent's config folder, `CLAUDE.md` and repo-skill resolution, the
manifest) and
`execute.ts` wires them into the local launch. `runChildProcess` learns not to inherit the server's
environment. The server adds two project columns (migration `0492`) and four context fields;
`ui-new` adds the two project switches and a "What this run got" list. The engine default flips last,
after a real-run check.

**Tech Stack:** TypeScript, Node child processes, Drizzle/Postgres, Zod, vitest, SolidJS
(`ui-new`), Claude Code 2.1.325 CLI flags.

**Spec:** [fork/step-4b-sealed-runs.md](step-4b-sealed-runs.md). Read it first; this plan argues
from it and doesn't repeat its reasoning. The run is traced in
[claude-local-run.md](claude-local-run.md); its "Tested 2026-11-18" section has the flag tests.

## One decision this plan makes (changes design section 4)

**Skills load through `--plugin-dir`, not `<config>/skills/`.** Section 4 put the run's skill set
into the agent's config folder. Per-run skill sets are real (`pinnedSkillTest` and
`runScopedMentionedSkillKeys` in `heartbeat.ts`), and an agent runs up to 20 runs at once by default
(`AGENT_DEFAULT_MAX_CONCURRENT_RUNS`), so a shared `skills/` folder would have concurrent runs
rewrite each other's skills. The prompt bundle is already one immutable folder per skill set
(`prepareClaudePromptBundle`, keyed by `bundleKey`); Task 4 makes it a plugin and the launch passes
`--plugin-dir <bundle>/plugins`. Concurrent runs never share mutable skill state, the bundle copies as-is
(portable launch), and the config folder holds only Claude Code's own files: any `skills/` entry
there is set aside. Cost: skill names are namespaced, `<plugin>:<skill>` (tested 2026-11-18).
The design doc's section 4 is updated to match.

**Two plugins, named by where the skills come from** (decided 2026-11-20). One plugin named
`paperclip` would label every skill a run gets, say `paperclip:frontend-design`, as being about
Paperclip, and "paperclip" already names the platform, the MCP server and the main skill. So the
bundle holds two plugins: `paperclip` for Paperclip's own skills (keys starting
`paperclipai/paperclip/`: `paperclip`, `complain`, `suggestion-box`, `paperclip-create-agent`,
`para-memory-files`…) and `company` for everything from the company library. `--plugin-dir` is
repeatable and "a folder of plugins loads each child" (CLI 2.1.325 help), so the launch still
passes one path, the bundle root. A plugin with no skills is left out. The prefix is how Claude
Code loads them, not their name: the manifest and `ui-new` use the plain names the Skills page
shows.

**The repo's own skills, as a third plugin, `project`** (decided 2026-11-20; this was a non-goal
in the design). Skills a repo keeps for work in that repo (`<root>/.claude/skills/<name>/SKILL.md`)
should change with the repo: a run in a worktree on a feature branch gets that branch's skills.
So, like the root `CLAUDE.md`, they're read from the run's own checkout at launch, behind a second
project switch ("Agents use the repo's skills", default on, like the `CLAUDE.md` one), and listed
in the manifest. The launch builds a small plugin for that run only, named `project`, of symlinks
to the repo's skill folders, in `<agent folder>/claude-run-plugins/<runId>/project/`, and passes it
as a second `--plugin-dir <agent folder>/claude-run-plugins/<runId>`; it's removed after the run.
One folder per run means concurrent runs on different branches never share it. Nothing else
from the repo's `.claude/` loads (settings, hooks, agents, commands): importing those stays in
[build plan 3.18](../ui-new/docs/build-plan.md#318-importing-from-a-repo-and-project-skills). The
`--add-dir <root>` that loads `CLAUDE.md` doesn't load the repo's skills (tested 2026-11-18,
[claude-local-run.md](claude-local-run.md)), so nothing loads twice. A repo skill whose name
matches an assigned one loads under both prefixes; the manifest lists both and `ui-new` marks the
clash. The repo skills don't count towards a fresh session: a changed set resumes, as a terminal
session would after `git checkout`.

## Global Constraints

- Sealing applies to **local** targets. Remote (SSH, sandbox) paths keep today's behaviour: they're
  dormant (CLAUDE.md, "Dormant areas"). Don't extend them; skip a broken remote test with a note.
- Every local CLI run passes `--setting-sources user`, `--strict-mcp-config` and `--mcp-config <file>`.
- No run starts without a Claude credential from Paperclip (`claude_credential_missing`) or without
  the `paperclip` MCP server and a run token (`paperclip_mcp_unavailable`). No fallback to the
  server's login, to ACP, or to an unsealed launch.
- Never inherited from the server: `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`,
  `DATABASE_URL`, `ANTHROPIC_API_KEY`, `HOME`, and anything not on the allowlist.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` is set by the adapter on every local CLI run, last, so
  nothing overrides it.
- Files in the config folder are moved aside, never deleted.
- Migration `0492` continues the sequence and starts with the
  `-- paperclip:migration-compat online_compatible: …` header that `check:migrations` expects.
- `ui-new` help text goes behind an info tip (CLAUDE.md, "UI text"); imports from
  `@paperclipai/shared` use `import type`.
- Tests: the named files while building; `corepack pnpm test:quick` before each push; CI green on
  the branch before merging into `main`. Single files: `corepack pnpm exec vitest run <path>`.
- Never test against server1's real instance. The real-run check (Task 12) needs the user's
  go-ahead, uses an "M7 test" agent, never Bob, and the user supplies the credential (no agent runs
  an OAuth or setup-token flow).

## Review Focus

1. **A desktop dev agent that relied on the machine's `claude` login** (no managed connection, no
   credential in its env) must fail with `claude_credential_missing` naming where to set one, not
   with Claude's own "Not logged in". Test in Task 7.
2. **A run in a per-task worktree** (`<repo>/.paperclip/worktrees/<branch>`, whose `.git` is a
   file) must load the worktree's own root `CLAUDE.md`, not the main checkout's: the walk up stops
   at the first `.git` of either kind. Test in Task 5.
3. **Two concurrent runs of one agent** both setting aside the same stray file: the loser's rename
   hits `ENOENT` and must carry on, not fail the run. Test in Task 3.
4. **The server's own environment** carries `ANTHROPIC_API_KEY=""` (docker-compose) and
   `CLAUDE_CODE_DISABLE_AUTO_MEMORY`: neither reaches the run, and an empty string never counts as
   a credential. Tests in Tasks 2 and 7.
5. **A resumed session after the skill set changed** starts fresh and the manifest says why
   (`prompt_bundle_changed`), rather than resuming with a different `--plugin-dir`. Test in Task 8.
6. **Repo skills from the run's own checkout:** a run in a per-task worktree whose branch adds a
   skill gets it, and a run in the main checkout doesn't; two concurrent runs of one agent each get
   their own `project` plugin folder, and one finishing doesn't remove the other's. Tests in
   Tasks 5 and 8.

## How the work is split

| Wave | Agent | Tasks | Branch |
| --- | --- | --- | --- |
| 0 | Contracts (manager) | 0 | `feat/step-4b` |
| 1 | Adapter modules | 1–6 | `step4b/adapter` |
| 1 | Server and UI | 9–11 | `step4b/server-ui` |
| 2 | Launch | 7–8 | `step4b/launch` |
| 3 | Check, then flip (manager, with the user) | 12–14 | `feat/step-4b` |

Integration branch `feat/step-4b`, cut from `main`. Agent branches are cut from it after Task 0
merges, and merged back with `--no-ff` after review. Wave 2 starts after `step4b/adapter` merges.
Worktrees may start from `master`: reset onto `feat/step-4b` first (CLAUDE.md, "Gotchas").

---

### Task 0: Contracts

**Files:**
- Create: `packages/shared/src/claude-run-manifest.ts` (export it from the package index like
  `agent-access.ts`)
- Modify: `packages/adapter-utils/src/types.ts:183-193` (`AdapterInvocationMeta`)
- Test: `packages/shared/src/claude-run-manifest.test.ts`

**Interfaces:**
- Produces, in `@paperclipai/shared`:
  ```ts
  export type ClaudeCredentialMethod = "subscription" | "api_key" | "auth_token" | "bedrock" | "vertex" | "foundry" | "routed";
  export interface ClaudeRunCredential {
    kind: "managed_connection" | "agent_env";
    method: ClaudeCredentialMethod;
    connectionId: string | null;
    connectionName: string | null;
  }
  export type ClaudeMdSkipReason = "project_switch_off" | "not_in_repo" | "no_project" | "no_file";
  export type ClaudeMdLoad = { enabled: true; path: string } | { enabled: false; reason: ClaudeMdSkipReason };
  export type ClaudeRepoSkillsSkipReason = "project_switch_off" | "not_in_repo" | "no_project" | "no_skills";
  export type ClaudeRepoSkillsLoad =
    | { enabled: true; dir: string; count: number }   // dir: <root>/.claude/skills
    | { enabled: false; reason: ClaudeRepoSkillsSkipReason };
  export type ClaudeFreshSessionReason =
    | "no_saved_session" | "invalid_session_id" | "cwd_changed" | "prompt_bundle_changed"
    | "target_changed" | "session_unavailable";
  export interface ClaudeRunManifest {
    version: 1;
    engine: "cli";
    configDir: string;
    settingSources: ["user"];
    credential: ClaudeRunCredential;
    setAside: { dir: string; entries: string[] } | null;
    overriddenEnv: string[];
    /** name: the plain name the Skills page shows; plugin: which plugin loaded it (Claude sees `<plugin>:<name>`) */
    /** key: the library key, or `repo:.claude/skills/<name>` for a repo skill */
    skills: Array<{ name: string; key: string; origin: "always_on" | "assigned" | "repo"; plugin: "paperclip" | "company" | "project" }>;
    /** plain names that more than one plugin supplied */
    skillNameClashes: string[];
    builtInSkills: true;
    mcpServers: Array<{ name: string; url: string }>;
    strictMcpConfig: true;
    access: { level: AgentAccessLevel; overrides: AgentAccessOverrides } | null;
    instructions: { entryFile: string | null; sent: boolean };
    claudeMd: ClaudeMdLoad;
    repoSkills: ClaudeRepoSkillsLoad;
    autoMemory: false;
    envKeys: string[];
    extraArgs: string[];
    session: { mode: "fresh"; reason: ClaudeFreshSessionReason } | { mode: "resumed"; sessionId: string };
  }
  export function isClaudeRunManifest(value: unknown): value is ClaudeRunManifest; // version === 1 && engine === "cli"
  ```
- Produces, in `@paperclipai/adapter-utils`: `AdapterInvocationMeta.runManifest?: Record<string, unknown>`.
- Produces, the context the server adds (Task 10) and the adapter reads (Task 7):
  - `context.paperclipWorkspace.agentsReadClaudeMd: boolean | null` (null: no project);
  - `context.paperclipWorkspace.agentsUseRepoSkills: boolean | null` (null: no project);
  - `context.paperclipAgentAccess: { level: AgentAccessLevel; overrides: AgentAccessOverrides } | null`;
  - `context.paperclipAiConnectionName: string | null`.

- [ ] **Step 1:** Write `isClaudeRunManifest` tests: a minimal valid manifest is accepted;
  `{ version: 2 }`, `null` and an ACP-shaped object are rejected.
- [ ] **Step 2:** Run `corepack pnpm exec vitest run packages/shared/src/claude-run-manifest.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Write the module and the meta field.
- [ ] **Step 4:** Run the test again; expect PASS. Run `corepack pnpm --filter @paperclipai/shared typecheck`.
- [ ] **Step 5:** Commit: `Step 4b: run manifest contract`.

### Task 1: `runChildProcess` without the server's environment

**Files:**
- Modify: `packages/adapter-utils/src/server-utils.ts:4835-4863` (`runChildProcess`)
- Modify: `packages/adapter-utils/src/execution-target.ts:291-330, 980-991` (options and the local call)
- Test: `packages/adapter-utils/src/server-utils-env.test.ts`

**Interfaces:**
- Produces: `runChildProcess(..., opts: { ...; inheritHostEnv?: boolean })`, default `true`
  (today's merge). With `false`, the child's environment is `opts.env` only, still with the nesting
  and service-manager variables stripped and `ensurePathInEnv` applied.
- Produces: `AdapterExecutionTargetProcessOptions.inheritHostEnv?: boolean`, passed through to the
  local `runChildProcess` call only.

- [ ] **Step 1:** Tests, spawning `node -e "process.stdout.write(JSON.stringify(process.env))"` with
  `process.env.SEALED_TEST_HOST_ONLY = "x"` set in the test (not a `PAPERCLIP_*` name, which
  `sanitizeInheritedPaperclipEnv` strips anyway):
  - `inherits the host environment by default`: the child sees `SEALED_TEST_HOST_ONLY`;
  - `inheritHostEnv false passes only opts.env`: `SEALED_TEST_HOST_ONLY` absent, `opts.env.FOO` present;
  - `inheritHostEnv false still strips CLAUDECODE`: `opts.env.CLAUDECODE = "1"` doesn't reach the child.
- [ ] **Step 2:** Run the file; expect the two new cases to FAIL.
- [ ] **Step 3:** Implement the option in both files.
- [ ] **Step 4:** Run the file; expect PASS.
- [ ] **Step 5:** Commit: `adapter-utils: runChildProcess can leave out the server's environment`.

### Task 2: The sealed environment and the credential

**Files:**
- Create: `packages/adapters/claude-local/src/server/sealed-env.ts`
- Test: `packages/adapters/claude-local/src/server/sealed-env.test.ts`

**Interfaces:**
- Consumes: `ClaudeRunCredential` (Task 0).
- Produces:
  ```ts
  export const CLAUDE_CREDENTIAL_MISSING = "claude_credential_missing";
  export const PAPERCLIP_MCP_UNAVAILABLE = "paperclip_mcp_unavailable";
  /** ACP's ACPX_INHERITED_HOST_ENV_KEYS (acpx-engine/execute.ts:595-625) without HOME, USERPROFILE,
   *  HOMEDRIVE, HOMEPATH and the XDG_* keys, which Paperclip sets; plus LC_* by pattern. */
  export const SEALED_HOST_ENV_KEYS: ReadonlySet<string>;
  export function projectSealedHostEnvironment(hostEnv: NodeJS.ProcessEnv): Record<string, string>;
  export function resolveClaudeRunCredential(input: {
    env: Record<string, string>;            // the run's env built from config.env (secrets resolved)
    managedAiConnection: unknown;           // config.managedAiConnection
    managedAiRouting: unknown;              // config.managedAiRouting
    connectionName: string | null;          // context.paperclipAiConnectionName
  }): ClaudeRunCredential | null;
  ```
- `resolveClaudeRunCredential` rules, first match wins:
  - `managedAiConnection` set: `managed_connection`, method `routed` when `managedAiRouting` is
    set, else its `method` (`subscription` or `api_key`), `connectionId` from it.
  - Otherwise `agent_env`, from non-empty values only: `CLAUDE_CODE_OAUTH_TOKEN` → `subscription`;
    `ANTHROPIC_API_KEY` → `api_key`; `ANTHROPIC_AUTH_TOKEN` → `auth_token`; `CLAUDE_CODE_USE_BEDROCK`
    (`1`/`true`) → `bedrock`; `CLAUDE_CODE_USE_VERTEX` → `vertex`; `CLAUDE_CODE_USE_FOUNDRY` →
    `foundry`.
  - Else `null`.

- [ ] **Step 1:** Tests:
  - `projectSealedHostEnvironment` keeps `PATH`, `LANG`, `LC_ALL`, `TZ`, `HTTPS_PROXY`,
    `NODE_EXTRA_CA_CERTS`; drops `HOME`, `XDG_CONFIG_HOME`, `BETTER_AUTH_SECRET`,
    `PAPERCLIP_AGENT_JWT_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`,
    `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `GITHUB_TOKEN`;
  - each credential rule above, including `managedAiRouting` → `routed`;
  - `ANTHROPIC_API_KEY: ""` and `CLAUDE_CODE_OAUTH_TOKEN: "  "` → `null`.
- [ ] **Step 2:** Run the file; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `claude_local: the sealed environment and the run's credential`.

### Task 3: The agent's config folder and setting files aside

**Files:**
- Create: `packages/adapters/claude-local/src/server/agent-config-dir.ts`
- Test: `packages/adapters/claude-local/src/server/agent-config-dir.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** <instanceRoot>/companies/<companyId>/agents/<agentId>/claude-config, instance root as in
   *  resolveManagedClaudeRuntimeStateDir (claude-config.ts:156-166). */
  export function resolveAgentClaudeConfigDir(env: NodeJS.ProcessEnv, companyId: string, agentId: string): string;
  /** <same agent folder>/claude-config-set-aside/<runId> */
  export function resolveAgentClaudeSetAsideDir(env: NodeJS.ProcessEnv, companyId: string, agentId: string, runId: string): string;
  /** Entries that would load as configuration. Everything else is Claude Code's own data. */
  export const SET_ASIDE_CONFIG_ENTRIES: readonly string[] =
    ["settings.json", "settings.local.json", "CLAUDE.md", "CLAUDE.local.md", "agents", "commands",
     "output-styles", "skills", "rules", "hooks"];
  /** Creates configDir (0o700) if missing; moves each present SET_ASIDE_CONFIG_ENTRIES entry into
   *  setAsideDir (created only when something moves); ENOENT on a rename is skipped. */
  export function prepareAgentClaudeConfigDir(input: { configDir: string; setAsideDir: string }): Promise<{ setAside: string[] }>;
  /** A temporary HOME with XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME under it, for runs
   *  without a managed connection (which brings its own). */
  export function createSealedRunHome(agentId: string): Promise<{ env: Record<string, string>; cleanup(): Promise<void> }>;
  ```

- [ ] **Step 1:** Tests:
  - the two paths under a `PAPERCLIP_HOME` set in the test;
  - a folder with `settings.json`, `skills/x/SKILL.md`, `projects/p/s.jsonl` and `.claude.json`:
    `setAside` is `["settings.json", "skills"]` (sorted), both now under the set-aside folder,
    `projects/` and `.claude.json` untouched;
  - a clean folder: `setAside` is `[]` and no set-aside folder is created;
  - **Review Focus 3:** two `prepareAgentClaudeConfigDir` calls in `Promise.all` on one folder with a
    `settings.json`: both resolve, the file is moved exactly once;
  - `createSealedRunHome`: `HOME` exists, `cleanup()` removes it.
- [ ] **Step 2:** Run the file; expect FAIL.
- [ ] **Step 3:** Implement with `fs.rename` (same filesystem: both folders are under the agent's).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `claude_local: the agent's Claude config folder, with stray settings set aside`.

### Task 4: The prompt bundle as a plugin

**Files:**
- Modify: `packages/adapters/claude-local/src/server/prompt-cache.ts:134-174` and its bundle-key builder
- Test: `packages/adapters/claude-local/src/server/prompt-cache.test.ts` (create)

**Interfaces:**
- Produces: `ClaudePromptBundle.pluginDir: string`, a folder of plugins inside the bundle
  (`<bundle>/plugins`), beside today's `.claude/skills/` (kept for the dormant remote path) and
  `agent-instructions.md`. It holds up to two plugins, each only when it has skills:
  - `plugins/paperclip/`: `.claude-plugin/plugin.json` =
    `{"name":"paperclip","description":"Paperclip's own skills: working in Paperclip, feedback, hiring, memory"}`
    and `skills/<runtimeName>` symlinks for skills whose key starts `paperclipai/paperclip/`;
  - `plugins/company/`: `plugin.json` =
    `{"name":"company","description":"Skills from this company's skill library"}` and symlinks for
    every other skill.
- Produces: `export function claudeSkillPlugin(key: string): "paperclip" | "company"`, the rule
  above, for the bundle and the manifest (Task 8).
- Produces: `export const CLAUDE_PROMPT_BUNDLE_LAYOUT = 2`; `buildClaudePromptBundleKey` takes an
  optional `layout` (default that constant) and hashes it, so cached bundles from before (layout 1,
  no plugins) aren't reused.

- [ ] **Step 1:** Tests with three temporary skill folders, keys `paperclipai/paperclip/paperclip`,
  `paperclipai/paperclip/complain` and a company-library key:
  - `plugins/paperclip/.claude-plugin/plugin.json` has `name: "paperclip"` and its `skills/` lists
    the two Paperclip skills; `plugins/company/` has `name: "company"` and the third;
  - with only Paperclip skills, `plugins/company/` doesn't exist;
  - `.claude/skills/` still lists all three runtime names;
  - `claudeSkillPlugin` on each key;
  - `buildClaudePromptBundleKey` gives different keys for `layout: 1` and `layout: 2` with the same
    skills and instructions.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS, and `server/src/__tests__/claude-local-skill-sync.test.ts` still passes.
- [ ] **Step 4a (manager, when reviewing):** check the layout with the real CLI, once: a
  `claude --print --output-format stream-json --verbose --setting-sources user --strict-mcp-config
  --plugin-dir <bundle>/plugins` run with a one-line prompt lists both plugins' skills in its
  `init` event, as namespaced names (one small call on the user's own login, as the 2026-11-18
  test was). If a folder of plugins doesn't load, the launch passes one `--plugin-dir` per plugin
  instead; send that back to the agent.
- [ ] **Step 5:** Commit: `claude_local: the prompt bundle doubles as a plugin`.

### Task 5: What a run takes from the repo: `CLAUDE.md` and its skills

**Files:**
- Create: `packages/adapters/claude-local/src/server/claude-md.ts`
- Create: `packages/adapters/claude-local/src/server/repo-skills.ts`
- Test: `packages/adapters/claude-local/src/server/claude-md.test.ts`,
  `packages/adapters/claude-local/src/server/repo-skills.test.ts`

**Interfaces:**
- Consumes: `ClaudeMdLoad`, `ClaudeRepoSkillsLoad` (Task 0).
- Produces, in `claude-md.ts`:
  ```ts
  /** The first folder at cwd or above holding a `.git` file or folder, else null. */
  export function findRepoRoot(cwd: string): Promise<string | null>;
  export function resolveClaudeMdLoad(input: {
    projectId: string | null;
    agentsReadClaudeMd: boolean | null;  // null with a project: an older server, counts as on
    repoRoot: string | null;             // findRepoRoot(cwd)
  }): Promise<{ load: ClaudeMdLoad; addDir: string | null }>;
  ```
- `resolveClaudeMdLoad` order: no `projectId` → `no_project`; switch `false` →
  `project_switch_off`; no `repoRoot` → `not_in_repo`; no `<root>/CLAUDE.md` → `no_file`; else
  `{ enabled: true, path: <root>/CLAUDE.md }` and `addDir: <root>`.
- Produces, in `repo-skills.ts`:
  ```ts
  export interface RepoSkill { name: string; dir: string }  // dir: <root>/.claude/skills/<name>
  export function resolveRepoSkills(input: {
    projectId: string | null;
    agentsUseRepoSkills: boolean | null; // null with a project: an older server, counts as on
    repoRoot: string | null;
  }): Promise<{ load: ClaudeRepoSkillsLoad; skills: RepoSkill[] }>;
  /** <instanceRoot>/companies/<companyId>/agents/<agentId>/claude-run-plugins/<runId> */
  export function resolveRunPluginsDir(env: NodeJS.ProcessEnv, companyId: string, agentId: string, runId: string): string;
  /** Writes <runPluginsDir>/project/.claude-plugin/plugin.json
   *  ({"name":"project","description":"Skills from this project's repository (<root>/.claude/skills)"})
   *  and skills/<name> symlinks to each skill's dir. Returns runPluginsDir, the folder the launch passes. */
  export function prepareRepoSkillsPlugin(input: { runPluginsDir: string; repoRoot: string; skills: RepoSkill[] }): Promise<string>;
  export function removeRunPluginsDir(runPluginsDir: string): Promise<void>; // missing folder is fine
  ```
- `resolveRepoSkills` order: no `projectId` → `no_project`; switch `false` →
  `project_switch_off`; no `repoRoot` → `not_in_repo`; no `<root>/.claude/skills/*/SKILL.md` →
  `no_skills`; else `{ enabled: true, dir: <root>/.claude/skills, count }`, skills sorted by name.
  A subfolder without `SKILL.md` is skipped; a symlinked skill folder counts, as in Claude Code.

- [ ] **Step 1:** Tests for each reason and the loaded case of both resolvers, plus **Review
  Focus 2** and **6**: a repo with `CLAUDE.md` and `.claude/skills/a/SKILL.md` at its root, and a
  nested worktree folder `.paperclip/worktrees/b` containing a `.git` *file*, its own `CLAUDE.md`
  and `.claude/skills/{a,b}/SKILL.md`. From `cwd` = a subfolder of the worktree, `findRepoRoot` is
  the worktree root, `addDir` is it, and the repo skills are `a` and `b` from the worktree; from
  the main checkout, only `a`. `prepareRepoSkillsPlugin` twice with different `runId`s gives two
  folders; removing one leaves the other.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `claude_local: resolve the repo CLAUDE.md and skills a run may load`.

### Task 6: One MCP note for both engines

**Files:**
- Modify: `packages/adapter-utils/src/server-utils.ts` (export the note)
- Modify: `packages/adapter-utils/src/acpx-engine/execute.ts:3152-3166, 3231` (use it)
- Test: `packages/adapter-utils/src/server-utils.test.ts`; existing `acpx-engine/execute.test.ts`

**Interfaces:**
- Produces, moved unchanged from ACP's `hasPaperclipMcpServer` and `renderApiAccessNote`:
  ```ts
  export function hasPaperclipMcpServer(servers: readonly AdapterRuntimeMcpServer[]): boolean; // connectionId === "paperclip"
  export function renderPaperclipMcpNote(env: Record<string, string>, paperclipMcp: boolean): string;
  ```
  Text identical to today's ACP note, so ACP's prompts don't change.

- [ ] **Step 1:** Tests: the note contains `paperclip_task_context` and `paperclip_finish` with a
  server, an API URL and a key; it's `""` without the server.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Move the two functions; ACP calls the exports.
- [ ] **Step 4:** Run the new test and `packages/adapter-utils/src/acpx-engine/execute.test.ts`; expect PASS.
- [ ] **Step 5:** Commit: `adapter-utils: share the Paperclip MCP note between engines`.

### Task 7: The sealed launch, part 1: gates, environment, config folder

**Files:**
- Modify: `packages/adapters/claude-local/src/server/execute.ts` (local path: after
  `buildClaudeRuntimeConfig` at :470, the env at :506-513, the spawn at :1003-1020, the poisoned
  session path at :1435, the sandbox paths at :587-613)
- Create: `server/src/__tests__/claude-local-sealed-run.test.ts` (fake `claude` as in
  `claude-local-execute.test.ts:52-91`, extended to capture `process.env`)
- Modify: `server/src/__tests__/claude-local-execute.test.ts` and the other CLI test files named in
  the design's Testing section: a shared helper gives each `execute` call a credential and the
  `paperclip` server

**Interfaces:**
- Consumes: Tasks 1, 2, 3; `ctx.runtimeMcp`, `ctx.authToken`.
- Produces, for Task 8 inside `execute.ts`: `credential: ClaudeRunCredential`,
  `agentConfigDir: string`, `setAside`, `overriddenEnv: string[]`, and the sealed `env`.
- Behaviour on a local target:
  1. No `paperclip` server (`hasPaperclipMcpServer`) or no `authToken` → return before any Claude
     process with `errorCode: PAPERCLIP_MCP_UNAVAILABLE`, `executionRecovery: { kind: "bootstrap",
     providerWorkStarted: false }`, and a message naming the missing piece (no token: set
     `PAPERCLIP_AGENT_JWT_SECRET` or `BETTER_AUTH_SECRET`; no server: `PAPERCLIP_API_URL`).
  2. `resolveClaudeRunCredential` null → same shape with `CLAUDE_CREDENTIAL_MISSING`, the message
     naming a managed AI connection or the agent's env secrets.
  3. No managed connection → `createSealedRunHome`, merged into `env`, cleaned up in the outer `finally`.
  4. `env.CLAUDE_CONFIG_DIR = agentConfigDir` after `prepareAgentClaudeConfigDir`. Without a
     managed connection, `overriddenEnv` lists the `config.env` keys among `HOME`,
     `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` whose value was
     replaced; with one, `[]` (the managed runtime already replaced them). A set-aside logs one
     `[paperclip]` stdout line naming the entries and the folder.
  5. `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1"`, set last.
  6. The spawn passes `inheritHostEnv: false` and `env: { ...projectSealedHostEnvironment(process.env), ...env }`;
     `effectiveEnv` (model, billing) is that same object, not `{ ...process.env, ...env }`.
  7. The poisoned-session cleanup and `localProcessSandbox.managedPaths` use `agentConfigDir`
     (its `.claude.json` is inside it).

- [ ] **Step 1:** Add the shared test helper (`sealedRunInputs()` returning `authToken`,
  `runtimeMcp: { getServers: () => [{ name: "paperclip", url, token, connectionId: "paperclip" }] }`
  and `env: { CLAUDE_CODE_OAUTH_TOKEN: "test-token" }`) and pass it in the existing files' calls.
  Run them; they still pass (nothing reads the new inputs yet).
- [ ] **Step 2:** In `claude-local-sealed-run.test.ts`, with `process.env` given
  `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY=""`
  and `HOME=<root>` for the test:
  - `refuses to start without a credential`: `errorCode === "claude_credential_missing"`, the fake
    `claude` never ran (no capture file) (**Review Focus 1**);
  - `refuses to start without the paperclip server`, and `… without a run token`:
    `"paperclip_mcp_unavailable"`, messages contain `PAPERCLIP_API_URL` and `PAPERCLIP_AGENT_JWT_SECRET`;
  - `passes no server secrets` (**Review Focus 4**): none of the four keys in the captured env;
    `CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1"` even when `config.env` sets it to `"0"`; `PATH` present;
  - `uses Paperclip's HOME`: captured `HOME` isn't `<root>` and no longer exists after the run;
  - `uses the agent's config folder`: `CLAUDE_CONFIG_DIR` ends with
    `companies/<companyId>/agents/<agentId>/claude-config`, also when `config.env.CLAUDE_CONFIG_DIR`
    is set;
  - `sets stray settings aside`: a `settings.json` placed in the folder before the run is under
    `claude-config-set-aside/<runId>/` afterwards.
- [ ] **Step 3:** Run it; expect FAIL.
- [ ] **Step 4:** Implement behaviours 1–7.
- [ ] **Step 5:** Run the new file and every file from Step 1; expect PASS. Tests that assumed the
  inherited environment or the shared `~/.claude` change to the sealed expectation; remote-path tests
  that break get `it.skip` with a one-line reason (dormant).
- [ ] **Step 6:** Commit: `claude_local: sealed environment, credential and config folder for CLI runs`.

### Task 8: The sealed launch, part 2: arguments, prompt, manifest

**Files:**
- Create: `packages/adapters/claude-local/src/server/run-manifest.ts`
- Modify: `packages/adapters/claude-local/src/server/execute.ts:877-910` (`buildClaudeArgs`),
  `:928-993` (prompt and `onMeta`), `:796-862` (fresh-session reasons)
- Test: `packages/adapters/claude-local/src/server/run-manifest.test.ts`;
  `server/src/__tests__/claude-local-sealed-run.test.ts`

**Interfaces:**
- Consumes: Tasks 0, 4, 5, 6, 7; `context.paperclipAgentAccess`,
  `context.paperclipWorkspace.agentsReadClaudeMd`, `.agentsUseRepoSkills`, `.projectId`.
- Repo skills: `findRepoRoot(cwd)` once, then `resolveRepoSkills`; when enabled,
  `prepareRepoSkillsPlugin` before the spawn and `removeRunPluginsDir` in the outer `finally`
  (also on a failed or cancelled run). The run plugins folder joins the confinement's readable
  paths (`localProcessSandbox`) beside the bundle.
- Produces: `buildClaudeRunManifest(input: { … every field's source … }): ClaudeRunManifest`, pure.
  Skill `origin` is `always_on` for `PAPERCLIP_OPERATIONAL_SKILL_KEY` and
  `PAPERCLIP_FEEDBACK_SKILL_KEYS` (`server-utils.ts:4370-4376`), else `assigned`; `name` is
  the plain `<runtimeName>`, and `plugin` is `claudeSkillPlugin(key)` (Task 4). Repo skills follow,
  as `{ name, key: "repo:.claude/skills/<name>", origin: "repo", plugin: "project" }`.
  `skillNameClashes` lists, sorted, each plain name more than one plugin supplied. `envKeys` is sorted. `mcpServers` never includes the token.
- Arguments on a local target, in order: `--print --output-format stream-json --verbose
  --setting-sources user [--resume <id>] <permission args> [--chrome] [--model …] [--effort …]
  [--max-turns …] [--append-system-prompt-file …] --mcp-config <file> --strict-mcp-config
  --plugin-dir <bundle>/plugins [--plugin-dir <run plugins dir>] [--add-dir <repo root>] [extraArgs…]`. No `--add-dir <bundle>`. With
  `addDir`, `env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = "1"`. Remote targets keep today's
  arguments.
- Prompt: `renderPaperclipMcpNote(env, true)` joins the sections after `taskContextNote` on fresh
  sessions that aren't external chat turns (`isPaperclipExternalChatTurn(context.paperclipWake)`,
  as ACP does at `acpx-engine/execute.ts:3222`).
- **The launch as data** (design, "Keep the launch portable"): `run-manifest.ts` also exports
  `interface SealedClaudeLaunch { command: string; args: string[]; env: Record<string, string>;
  cwd: string; files: { configDir: string; pluginDir: string; runPluginsDir: string | null;
  mcpConfigPath: string; claudeMdRoot: string | null }; manifest: ClaudeRunManifest }`. `runAttempt` builds one, then
  passes its parts to `runAdapterExecutionTargetProcess`; nothing between the two changes them.
- `onMeta` gains `runManifest`; a `commandNotes` line summarises it ("Sealed run: N skills, M MCP
  servers, CLAUDE.md <loaded|skipped: reason>, repo skills <N|skipped: reason>").

- [ ] **Step 1:** `run-manifest.test.ts`: a full input maps to the expected manifest; origins;
  skill names are plain (no `paperclip:` prefix) and `plugin` is `paperclip` or `company` by key;
  repo skills come last with `plugin: "project"`; a repo skill named like an assigned one appears
  twice and in `skillNameClashes`; the token is absent from `mcpServers`; `claudeMd` and
  `repoSkills` pass through.
- [ ] **Step 2:** Sealed-run tests:
  - `passes the sealed flags`: `--setting-sources user`, `--strict-mcp-config`, `--mcp-config`,
    `--plugin-dir` present, no `--add-dir` (no project);
  - `adds the repo root when the project allows it`: a git repo with `CLAUDE.md`,
    `paperclipWorkspace: { cwd, projectId, agentsReadClaudeMd: true }` → `--add-dir <root>` and the
    variable is `"1"`; with `false` → neither, manifest reason `project_switch_off`;
  - `adds the repo's skills when the project allows it`: the same repo with
    `.claude/skills/m7/SKILL.md` and `agentsUseRepoSkills: true` → a second `--plugin-dir` whose
    `project/skills/m7` the fake `claude` saw; the folder is gone after the run; with `false` → one
    `--plugin-dir`, manifest `repoSkills` reason `project_switch_off`;
  - **Review Focus 6:** two concurrent `execute` calls of one agent in two worktrees with different
    `.claude/skills` each see only their own worktree's skills;
  - a changed repo skill set alone doesn't start a fresh session;
  - `points fresh runs at the MCP tools`: the prompt contains `paperclip_task_context`; a resumed run's
    prompt doesn't;
  - `records the manifest`: `onMeta`'s `runManifest` passes `isClaudeRunManifest`, has
    `autoMemory: false`, the access from context, the credential `agent_env`/`subscription`;
  - **Review Focus 5:** a saved session with a different `promptBundleKey` → no `--resume`, manifest
    `session: { mode: "fresh", reason: "prompt_bundle_changed" }`; a matching one →
    `{ mode: "resumed", sessionId }`.
- [ ] **Step 3:** Run; expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the two files and the design's existing CLI test files; expect PASS. Update
  assertions that expected `--add-dir <bundle>` or `.claude/skills` under it (the fake `claude`'s
  `skillEntries` reads `<plugin-dir>/*/skills` instead).
- [ ] **Step 6:** Commit: `claude_local: sealed arguments, repo skills, the MCP note and the run manifest`.

### Task 9: The project switches: columns, API

**Files:**
- Modify: `packages/db/src/schema/projects.ts` (`agentsReadClaudeMd: boolean("agents_read_claude_md").notNull().default(true)`,
  `agentsUseRepoSkills: boolean("agents_use_repo_skills").notNull().default(true)`)
- Create: `packages/db/src/migrations/0492_project_repo_instructions.sql` and its meta entry
  (`corepack pnpm db:generate`, then rename the file and the journal tag to `0492_project_repo_instructions`)
- Modify: `packages/shared/src/validators/project.ts:109-126` (both, `z.boolean().optional()`),
  `packages/shared/src/types/project.ts:128` (both, `boolean`)
- Test: `server/src/__tests__/project-claude-md-switch.test.ts` (model on an existing projects route test)

**Interfaces:**
- Produces: `Project.agentsReadClaudeMd: boolean` and `Project.agentsUseRepoSkills: boolean`;
  `PATCH /projects/:id` accepts each; the projects
  service spreads the row (`server/src/services/projects.ts:210`), so reads carry it.

- [ ] **Step 1:** Tests: a new project reads `true` for both; `PATCH { agentsReadClaudeMd: false }`
  and `PATCH { agentsUseRepoSkills: false }` each persist and read back without touching the other;
  a non-boolean is a 400.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Schema, migration (header: `-- paperclip:migration-compat online_compatible: adds a
  two defaulted booleans to projects; the previous release ignores them.`), validator, type.
- [ ] **Step 4:** Run the test and `corepack pnpm --filter @paperclipai/db check:migrations`; expect PASS.
- [ ] **Step 5:** Commit: `Projects: switches for the repo CLAUDE.md and the repo's skills (migration 0492)`.

### Task 10: The run's context: switch, access, connection name

**Files:**
- Modify: `server/src/services/heartbeat.ts:3351-3368` (where `context.paperclipWorkspace` is built)
- Test: `server/src/__tests__/heartbeat-claude-run-context.test.ts` (model on `heartbeat-project-env.test.ts`)

**Interfaces:**
- Consumes: Task 0's context fields; Task 9's columns; `agentAccessSchema`
  (`packages/shared/src/agent-access.ts:85`); `managedAiRuntime.accountName` (acquired at :2920).
- Produces: `paperclipWorkspace.agentsReadClaudeMd` and `.agentsUseRepoSkills` (the project row's
  values, `null` without a project); `context.paperclipAgentAccess` (the agent's stored `permissions.access` parsed with
  `agentAccessSchema`, overrides defaulted to `{}`; `null` when it doesn't parse);
  `context.paperclipAiConnectionName` (`managedAiRuntime?.accountName ?? null`).

- [ ] **Step 1:** Tests: a run on a project task with the `CLAUDE.md` switch off gets
  `agentsReadClaudeMd: false` and `agentsUseRepoSkills: true`; with the skills switch off, the
  reverse; a task-less run gets `null` for both; an agent at `worker` with an `agents:create` override gets
  `{ level: "worker", overrides: { "agents:create": true } }`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement (one project read by id where the workspace context is assembled).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `Heartbeat: give claude_local runs the repo switches, access level and connection name`.

### Task 11: `ui-new`: the switches and "What this run got"

**Files:**
- Modify: `ui-new/src/projects/settings/CodeSection.tsx` (a card after `CheckoutsCard`)
- Modify: `ui-new/src/runs/invocation.ts` (read the manifest), `ui-new/src/runs/RunInput.tsx` (show it)
- Test: `ui-new/src/runs/invocation.test.ts`

**Interfaces:**
- Consumes: `Project.agentsReadClaudeMd`, `Project.agentsUseRepoSkills` (Task 9) and `ClaudeRunManifest` (Task 0, with
  `import type`). `ui-new` takes only types from `@paperclipai/shared`, so `readRunManifest` repeats
  the guard's two checks (`version === 1`, `engine === "cli"`) itself.
- Produces: `readRunManifest(payload): ClaudeRunManifest | null` in `invocation.ts`, and
  `RunInvocation.manifest`.
- The card: title "Repository instructions", two `SettingsRow`s with the existing `Toggle`, each
  saved through `useProjectSaver` on its own:
  - "Agents read the repo's `CLAUDE.md`" (`{ agentsReadClaudeMd }`); info tip: "When on, agent runs
    in this project's repository load the `CLAUDE.md` at the repository's root. Subfolder
    `CLAUDE.md` files don't load.";
  - "Agents use the repo's skills" (`{ agentsUseRepoSkills }`); info tip: "When on, agent runs in
    this project's repository also get the skills in its `.claude/skills` folder, from the branch
    the run works on, alongside the agent's own. Nothing else in the repository's `.claude` folder
    loads: settings, hooks, agents and commands stay out."
- The list, above the raw command in the Input tab, one line each: credential (method and
  connection name), skills (plain names, as on the Skills page, grouped Paperclip / company /
  repository; the prefix Claude sees in the info tip; a name in `skillNameClashes` marked as
  loaded twice), repo skills when skipped (the reason in words), MCP servers (names), access level, `CLAUDE.md` (path or the
  reason in words), instructions (sent or not), session (resumed, or fresh and why), auto memory off;
  set-aside entries and overridden variables only when there are any. Old runs without a manifest
  show nothing new.

- [ ] **Step 1:** `invocation.test.ts`: a payload with a manifest yields it; without, `null`; a
  malformed one, `null`.
- [ ] **Step 2:** Run `corepack pnpm --filter @paperclipai/ui-new test`; expect FAIL.
- [ ] **Step 3:** Implement the reader, the list and the card (load the `solidjs` skill first).
- [ ] **Step 4:** Run the ui-new tests and `corepack pnpm --filter @paperclipai/ui-new typecheck`;
  expect PASS. Check both screens in the browser against the dev instance with every write stubbed
  (`page.route`), at desktop and phone widths.
- [ ] **Step 5:** Commit: `ui-new: the CLAUDE.md switch and what a run got`.

### Task 12: The real-run check (manager, with the user)

Design rollout step 2. Nothing merges into `main` before it passes.

- [ ] **Step 1:** Ask the user for the go-ahead and the credential: a managed subscription
  connection they set up, or a `CLAUDE_CODE_OAUTH_TOKEN` secret they add to the agent.
- [ ] **Step 2:** On the desktop dev instance (`:3100`, `PAPERCLIP_AGENT_JWT_SECRET` set), an
  "M7 test" agent in TES, `engine: "cli"`, at `worker`, on a project whose repo has a `CLAUDE.md`
  and a `.claude/skills/m7-test-repo-skill/SKILL.md`.
- [ ] **Step 3:** Run 1, a small task. Check: the manifest matches (credential, skills, `paperclip`
  server, access, `CLAUDE.md` loaded, repo skills 1); the `init` event lists
  `project:m7-test-repo-skill`; the run plugins folder is gone afterwards; the run used `paperclip_*` tools; the disposition is
  `via: tool`; no server secrets in the logged env.
- [ ] **Step 4:** Run 2, waking the same agent again: the session resumes.
- [ ] **Step 5:** Turn the project's two switches off; run 3: `CLAUDE.md` and repo skills skipped,
  both `project_switch_off`, and no `project:` skills in the `init` event. Turn them back on.
- [ ] **Step 6:** Run 4, a task asking it to delete another task: the refusal becomes a pending
  permission request in the Inbox, and the run still finishes. Don't approve it.
- [ ] **Step 6a:** Skills by plain name. The agent has one company-library skill assigned as well
  as Paperclip's own. Run 5, a task asking it to describe how it would hire a new agent, without
  hiring (the `paperclip` skill points to "the `paperclip-create-agent` skill" by its plain name):
  the run's `init` event lists `paperclip:paperclip-create-agent` and `company:<that skill>`, and
  the transcript shows it loading `paperclip:paperclip-create-agent`. If it doesn't find the skill,
  the skills' cross-references change to the namespaced names (a follow-up, on this branch).
- [ ] **Step 7:** Record the results in the design doc's rollout section, and anything that failed
  in `fork/upstream-fixes.md`.

### Task 13: CLI becomes the default

**Files:**
- Modify: `packages/adapters/claude-local/src/server/acp.ts:91-96` (`normalizeEngine`: only
  `"acp"` selects ACP; unset, `"auto"` and unknown → `{ engine: "cli", explicit: false }`)
- Modify: `packages/adapters/claude-local/src/index.ts:64` (the `engine` doc line: CLI is the
  default; set `"acp"` for ACP)
- Modify: `packages/adapters/claude-local/src/server/execute.ts:1367-1368` ("restore the default
  ACP lane" → "set engine to acp")
- Modify: `server/src/services/connector-runtime.ts:251` (`claude_local` uses
  `resolveClaudeExecutionEngine(config).engine === "cli"`; Codex and Kimi keep the literal check)
- Test: `packages/adapters/claude-local/src/server/acp.test.ts`, `engine-availability.test.ts`,
  `execute.acp-fallback.test.ts`; `server/src/__tests__/connector-runtime*.test.ts`

- [ ] **Step 1:** Change the tests that assert ACP for unset or `"auto"` to assert CLI, and add
  `connector skills for an unset-engine claude_local agent are staged as files`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the files; expect PASS. Then `corepack pnpm test:quick --changed main`.
- [ ] **Step 5:** Commit: `claude_local: CLI is the default engine`.

### Added after the real-run check (2026-11-20)

The check's five findings ([design, "Real-run check"](step-4b-sealed-runs.md#real-run-check-2026-11-20-rollout-step-2))
and the user's decisions on them, built by two agents before Task 14:

- **Agent E** (with Task 13):
  - New agents default to the classic runner (code `legacy`), Claude on the CLI engine: a
    `claude_local` hire is no longer turned into `paperclip_runner` (`agent-runner-selection.ts`).
    No migration; existing agents keep their stored runner.
  - `ui-new` calls the legacy runner **"Classic runner"**; code and API keep `legacy`.
  - `claudeSkillPlugin`: every `paperclipai/` key loads under `paperclip:` (bundled status-card
    skills included).
  - Plain skill names: inside each plugin a skill's folder is its plain name, with the suffixed
    runtime name only when two skills in that plugin share it; the manifest uses the plain name.
  - The sealed launch drops empty-valued variables (the managed connection's ~90 blanked provider
    keys), so `envKeys` lists only what's set.
- **Agent F:**
  - **GitHub only through a Paperclip connection.** A sealed run never gets the server's own
    GitHub setup (`GH_*`, `GIT_*`, `SSH_*`, the default `GH_CONFIG_DIR`,
    `PAPERCLIP_GITHUB_HOST_HOME`) unless the agent opts in. Without a connection, `git`/`gh` run
    without credentials.
  - **Opt-in per agent:** "Use this server's GitHub login", off by default, in the agent's GitHub
    identity card. When on, the run gets today's server-login mode, plus the server's git committer
    identity, since the sealed `HOME` hides its `~/.gitconfig`.
  - **The manifest records GitHub:** `github: { mode: "connection", identitySource, login } |
    { mode: "server_login" } | { mode: "none" }` (an added, optional field: version stays 1), and
    the run's "What this run got" list shows it.
  - **Commit author per agent:** author = the agent's name and title ("Builder (Senior engineer)",
    name alone without a title) with a stable per-agent `.invalid` email, so GitHub shows "authored
    by Builder, committed by <account>". Committer: the connection's account, the server's git
    identity when opted in, else the agent too.

### Task 14: Docs, then merge

**Files:** `deploy/docker-compose.yml:78-83` (the comment: runs no longer inherit this; the
adapter sets it; see the 4b design), `fork/claude-local-run.md` (the "what loads" table and §10's
rows), `fork/upstream-fixes.md` (bug 39 fixed), `ui-new/docs/decisions.md` (decision 5's update),
`fork/step-4b-sealed-runs.md` (status: built; sections 4 and 5 as built),
`ui-new/docs/build-plan.md` (3.18: repo skills done), `fork/hard-fork-plan.md`
(progress), `ui-new/docs/inventory/capabilities.md` if it lists run details.

- [ ] **Step 1:** Update them.
- [ ] **Step 2:** Push `feat/step-4b`; wait for CI green.
- [ ] **Step 3:** With the user's approval, merge into `main` with `--no-ff`. server1 moves at its
  next deploy, when the user asks (`deploy.sh` backs up and rehearses migration `0492`).
