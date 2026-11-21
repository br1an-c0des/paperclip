# Step 4b parts 2 and 3: what an agent's runs get, and worktrees by default

**Status: design, 2026-11-21; part 3's cleanup revised the same day.** Hard-fork step 4b, after part 1 (sealed runs,
[step-4b-sealed-runs.md](step-4b-sealed-runs.md), merged into `main` 2026-11-21). Part 2 shows
on an agent's page what its runs will get, before any run. Part 3 makes per-task git worktrees the
default. Part 4 (live sessions on the CLI) gets its own design later.

## Why

- **Part 2.** Decision 8 ([hard-fork plan](hard-fork-plan.md#decisions)) says a run gets exactly
  what Paperclip gives it, and Paperclip shows what that is. Part 1 shows it per run, after the run
  ("What this run got" in the run modal). Before a run, or after changing an agent's settings,
  there's nowhere to see what the agent will get.
- **Part 3.** Where runs work is mostly settled already (found 2026-11-21): a task in a project
  with a repo runs in that project's checkout, never in the agent's private folder, and per-task
  worktrees exist behind two instance switches that are off by default. With worktrees on, agents
  working at once on one repo don't collide. What's missing is the default, and a way to turn on
  the cleanup upstream built for them, which only environment variables reach today.

## Goals

1. An agent's Runtime section has a **"What runs get"** card: the same facts as a run's manifest,
   worked out from the agent's current settings, for tasks in a chosen project or in none.
2. The card comes from the **server**, through the same manifest builder the real run uses, so the
   preview and the run can't disagree. Nothing is started, written or minted to answer it.
3. **Worktrees are the default** for every project with a repo. A project opts out with its own
   setting.
4. A worktree's folder **never shows as untracked** in the repo it sits in.
5. Upstream's **cleanup sweep** for finished worktrees can be switched on in the UI, in either of
   its two modes, and is **off by default**. With it on, a task whose worktree was kept says why.

## Non-goals

- Part 4 (follow-up messages, permission prompts, streamed text).
- The recovery handoff's content and server-side live events: fresh sessions already get the
  handoff packet, and nothing would use server-side events yet. They return when step 5 or 6 needs
  them.
- Step 5's prompt preview. Part 2's server read is built so step 5 can add the prompt to it.
- Worktrees for tasks without a project: they have no repo to branch from and keep their private
  folder.
- Agents other than `claude_local` on the CLI engine (dormant adapters, the ACP engine, the
  Runner): the card says it isn't available for them.

## Anti-goals (a failure even if it works)

- A preview that differs from what the next run actually gets, because it was computed by
  different code.
- A preview read that writes files, mints run tokens, creates config folders or changes the
  database.
- A worktree removed while it holds work that isn't pushed, unless restore points saved it first.
- Merge or pull-request policy written into Paperclip's code: that's prompting.
- Existing tasks moved out of the checkout they're working in (their sessions would reset).

## Approaches considered (part 2)

| | Approach | Trade-off |
| --- | --- | --- |
| **A (chosen)** | The server previews the next launch: a read that resolves the same inputs as a run and builds the manifest with `buildClaudeRunManifest`, starting nothing | Launch preparation has side effects today, so it has to split into a planning half and an acting half. In return the preview can't drift, and step 5's prompt preview reuses the read. |
| B | `ui-new` works it out from the agent's settings | No server change, but it repeats the server's rules (always-on skills, credential choice, the GitHub opt-in, plugin name clashes) and drifts. |
| C | Show the last run's manifest | Almost free, but it's the past, empty for a new agent and stale after a settings change. |

Part 3 had one sensible way (below): the default mechanism already exists
(`applyDefaultIsolatedExecutionWorkspacePolicy`), and so does a cleanup sweep. A close of our own
when a task ends was drafted first and dropped on 2026-11-21 in favour of upstream's sweep.

## Part 2: what an agent's runs get

### The read

`GET /api/agents/:id/run-preview?projectId=<id>` (`projectId` optional), board access, the same
company check as reading the agent.

```ts
// packages/shared/src/claude-run-manifest.ts (beside ClaudeRunManifest)
export type ClaudeRunPreview =
  | {
      supported: true;
      project: { id: string; name: string } | null;
      /** As the next fresh run on a task in `project` would get it. */
      manifest: Omit<ClaudeRunManifest, "session" | "setAside" | "overriddenEnv"> & {
        overriddenEnv: string[];
      };
      /** Why a run would fail before it started, e.g. no credential (part 1, section 7). */
      blockers: Array<{ code: string; message: string }>;
    }
  | { supported: false; reason: "not_claude_local" | "not_cli_engine" | "runner" };
```

The exact shape is the builder's, within these rules:

- **Same builder.** The real launch's preparation splits into a pure planning step (inputs to
  `SealedClaudeLaunch` minus the files, plus the manifest) and a step that materialises it
  (config folder, prompt bundle, plugin folders, MCP config, tokens). The run calls both; the
  preview calls only the first. The server's half splits the same way: the run-input resolvers
  that `executeRun` calls today (skills in `heartbeat/workspaces.ts`, the managed AI credential in
  `ai-connection-runtime.ts`, MCP servers in `runtime-execution.ts`, access via
  `readRunAgentAccess`, GitHub in `heartbeat/execution-configuration.ts`) get a read-only path the
  preview uses.
- **No side effects.** No files under the instance folder, no run token or MCP bearer minted, no
  database writes, no credential decrypted beyond what's needed to name the method and connection.
  MCP servers are listed by name and URL only, as in the manifest.
- **The project.** With `projectId`, the `CLAUDE.md` and repo-skills rows follow that project's
  switches and its primary workspace's checkout (reading the repo's root `CLAUDE.md` and
  `.claude/skills` from that checkout, without creating a worktree or clone). Without it, they read
  `no_project`. A project with a repo URL but no local checkout yet says so rather than cloning.
- **Session** is left out: it depends on the task. The card says "Each new task starts a fresh
  session; later wakes on the same task resume it".
- **Not available:** an agent that isn't `claude_local`, is on the ACP engine, or is on the Runner
  gets `supported: false`, and the card says why in one line.
- **Blockers** are what part 1 refuses at launch (no credential, for one), so the card can warn
  before a run fails.

### The card

In the agent's Runtime section (`ui-new/src/agents/settings/RuntimeSection.tsx`), below the
runtime settings:

```
What runs get                         For tasks in: [No project ▾]
  Engine        CLI, sealed · config folder …/agents/<id>/claude
  Credential    Subscription · "Claude Max" connection
  Skills        paperclip:paperclip, paperclip:complain, company:… (6)
  MCP servers   paperclip
  Access        Worker
  GitHub        Through a connection: @br1an-c0des
  CLAUDE.md     No project selected
  Repo skills   No project selected
  Session       Each new task starts fresh
```

- Rows and wording match the run modal's "What this run got" (`ui-new/src/runs/RunManifest.tsx`);
  share its row rendering rather than copying it.
- "For tasks in" lists the company's projects, plus "No project". The choice is remembered per
  agent on the device.
- It refetches after the agent's settings save, and when the chosen project's switches change.
- A blocker shows as a warning line at the top of the card.
- Help text goes behind the "i" icon (CLAUDE.md, UI text); the card's rows are state and stay
  visible. Works at phone width.

## Part 3: worktrees by default

### The default

- **The two instance switches go.** `enableIsolatedWorkspaces` and
  `enableIsolatedWorkspacesByDefault` (App settings → Features, `ui-new/src/settings/app/features-model.ts`)
  are treated as always on, and the Features page drops them. The stored settings keys can stay,
  ignored. *Builder check, PM's call:* force them on centrally (where the experimental settings are
  read), so every reader agrees: `heartbeat.ts` (~:2490), `execution-workspaces.ts` (~:1619),
  `issues.ts` (~:10658, :11340, :11814, which strip workspace fields from task create and update
  when it's off) and `heartbeat/queue.ts` (~:3330). Two readers gate low-trust agents on it
  (`email-channels.ts` ~:649, `chat-github-management.ts` ~:558): keep their safety behaviour as it
  is today, by their own rule if it rested on the switch being off, and report what each did. The
  Runner's reads are dormant; leave them.
- **A project with a repo defaults to worktrees** through the existing
  `applyDefaultIsolatedExecutionWorkspacePolicy` (`execution-workspace-policy.ts`). Its
  `hasProjectWorkspace` guard keeps projects without a configured checkout, and tasks without a
  project, on their current path.
- **Only an explicit choice opts out.** Today a stored policy always wins, "including one that is
  explicitly disabled" and a blob that never opted in. A project whose person turned "New tasks get
  their own checkout" off keeps shared; a stored blob nobody chose (written as a side effect of
  saving another code setting, for instance) gets the default. How to tell the two apart in the
  stored data is the builder's call; if they can't be told apart, say so in the report rather than
  guessing.
- **Only new tasks move.** A task already bound to the shared checkout or a worktree keeps it, so
  no running session resets. The per-task workspace picker still works.
- **A checkout that isn't a git repo** stays shared, as today.
- The project's Code section (`ui-new/src/projects/settings/CodeSection.tsx`) drops its "Isolated
  workspaces is off on this instance" text, and its "New tasks get their own checkout" switch shows
  on for a project on the default.

### Keeping the folder out of git

When Paperclip creates a worktree under a parent folder inside the repo (default
`<repo>/.paperclip/worktrees`, `workspace-runtime.ts` around :3537), it adds that parent's path
(e.g. `/.paperclip/`) to the repo's `.git/info/exclude` if it isn't covered already. Never to the
repo's `.gitignore`, and never a commit. A parent folder outside the repo needs nothing.

### Cleaning up finished worktrees: upstream's sweep, behind a switch

**Decided 2026-11-21.** Upstream already built a background sweep that removes finished tasks'
worktrees ([doc/recoverable-disk-cleanup.md](../doc/recoverable-disk-cleanup.md#git-workspace-restore-points);
`git-workspace-expiration.ts`, driven from `execution-workspaces.ts` around :3850). It's off by
default, controlled only by environment variables our deployment doesn't set. Part 3 uses it
rather than building a close of its own, keeps **both** of its modes usable, puts it behind a
switch in the UI, and leaves it **off by default**. Merging and pull requests stay out of
Paperclip's code: how an agent gets its branch merged is prompting (the agent's instructions, or
later `COMPANY.md`), sorted out later.

- **The sweep's two modes,** as upstream built them:
  - **Only when everything is pushed** (strict, `PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED`):
    removes a closed task's worktree at least a day after its task tree closes, and only when the
    remote can rebuild it exactly. Unpushed or uncommitted work keeps it.
  - **Save a restore point, then remove** (`PAPERCLIP_GIT_RESTORE_POINTS_ENABLED` as well):
    also removes worktrees with unpushed, uncommitted or untracked work, 3 days after the tree
    closes, and an open task's worktree after 7 idle days, saving an encrypted restore point to
    file storage first (kept 90 days). A later run or a comment on the task restores it.
  - Either way it never touches a worktree with a live run, finalization, lease, recovery action
    or runtime service, which covers an agent marking its own task done mid-run.
- **The switch:** an instance setting with three values, `off` (default), `strict` and
  `restore_points`, in App settings → Features, "Tasks and workspaces", where the two retired
  worktree switches were (`ui-new/src/settings/app/features-model.ts`). Labels along the lines of
  "Clean up finished worktrees: Off / Only when everything is pushed / Save a restore point, then
  remove", with what each does behind the "i" icon, including the day counts in force.
- **The sweep reads the setting each pass,** not once at startup: today the env values are read
  in `server/src/config.ts` and passed to `executionWorkspaceService` in `server/src/index.ts`
  (~:1672). A chosen mode means the sweep really removes (not upstream's dry run). The env
  variables stay as the fallback when the setting has never been saved, so an operator who set
  them keeps their behaviour (*PM's call*). The day counts and retention stay environment
  variables.
- **Restore points need their prerequisites:** upstream refuses them with `s3` storage and no
  `PAPERCLIP_SECRETS_MASTER_KEY`. When they can't work on this instance, the option shows as
  unavailable with the reason, rather than saving a mode that silently does nothing.
- **Why a worktree was kept:** with the sweep on, when it skips a finished task's worktree (the
  skip reasons it already logs, such as unpushed work in strict mode), the reason is recorded on
  the workspace and the task's branch area (`ui-new/src/tasks/TaskBranch.tsx`) shows a quiet line,
  e.g. "Worktree kept: branch not pushed". With the sweep off, nothing shows.
- **By hand:** the Workspaces page's Close stays as it is.
- **Not in scope:** the sweep's other cleanups (isolated task directories, nested clone
  migration, base expiration) keep their own environment variables, unchanged.

## Testing

- **Part 2:**
  - the preview's manifest equals a real launch's manifest for the same agent and inputs (minus
    session), for no project, a project with both switches on, and one with them off;
  - the preview leaves no files under the instance folder, mints no tokens and writes nothing to the
    database;
  - `supported: false` for the ACP engine, a Runner agent and another adapter; a blocker for no
    credential;
  - `ui-new`: the card's model (rows from a preview, the project choice, the not-available line)
    and an e2e smoke with the read mocked.
- **Part 3:**
  - a project with a repo and no policy gives a new task a worktree; an explicit off keeps shared; a
    task without a project, a non-git checkout and an already-bound task are unchanged;
  - the exclude line is added once, only for a parent inside the repo;
  - the setting: `off` runs no expiration; `strict` and `restore_points` run upstream's sweep for
    real (not dry run); an unsaved setting falls back to the env variables; the sweep picks up a
    change without a restart; `restore_points` reads unavailable without its prerequisites;
  - a skipped worktree's reason is recorded and shown on the task, and nothing shows with the
    sweep off;
  - upstream's own expiration and restore-point tests still pass;
  - the existing worktree, policy and close-readiness tests still pass, or are updated where they
    assert the old switches.
- **Real-run check** (with the user's go-ahead, on the desktop's dev instance, never Bob): an
  "M7 test" agent on a project with a repo works one task in its own worktree; the task is marked
  done; with the sweep off its worktree stays; the agent's card matches that run's "What this run
  got". The sweep's day-long delay is too slow for a live check, so its removal is covered by tests.

## Left to the builder

- The exact preview response shape, within the rules above.
- Where the planning/acting split falls in `execute.ts`, and how the server's resolvers get their
  read-only path.
- How to tell an explicit opt-out from a stored blob nobody chose (report if impossible).
- Where the kept-worktree reason is stored (workspace metadata is a natural place), and which of
  the sweep's skip reasons are worth showing.
- Where the setting lives in the instance settings, and how the sweep reads it each pass.
- Wording, within the run modal's existing wording.
