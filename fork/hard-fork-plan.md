# Hard fork plan

**Status: adopted 2026-11-17.** Frozen at upstream `79c8cf8b6` (tag `upstream-freeze`, the last
commit merged, [sync 2026-11-17](sync-reports/2026-11-17.md)). `new-ui` was renamed `main`. Step 1
is done; [Progress](#progress) tracks the rest. The current step is
[3a, renovating the test suite](#3a-renovate-the-test-suite). Written 2026-11-16 as a proposal; the decisions
taken on adoption are under [Decisions](#decisions).

The plan: stop syncing with upstream `paperclipai/paperclip`, treat this repo as our own codebase,
and change the server freely, starting with how Claude runs. Code this setup doesn't use (the other
adapters, the Paperclip Runner, cloud execution) stays in the tree, dormant, until it gets in the
way of a change we want ([step 3](#3-leave-unused-code-until-it-gets-in-the-way)). Before, the fork
paid the cost of syncing and also lived under upstream's limits. The hard fork removes both.

## Contents

- [Why](#why)
- [What we'd own](#what-wed-own)
- [The frustrations this addresses](#the-frustrations-this-addresses)
- [The Paperclip Runner](#the-paperclip-runner)
- [The plan](#the-plan)
- [Progress](#progress)
- [Watching upstream](#watching-upstream)
- [The build plan after the hard fork](#the-build-plan-after-the-hard-fork)
- [Deployment](#deployment)
- [Risks](#risks)
- [Decisions](#decisions)
- [Docs changed on adoption](#docs-changed-on-adoption)

## Why

- **The middle path is the hardest one.** Every sync costs a report, a FORK-PATCHES review and
  upstream-change lines in the build plan. The no-upstream-code rule also pushes every real
  feature into a plugin or into "stage 4, later".
- **Upstream is heading somewhere else.** It supports 12 agent harnesses, remote and cloud
  execution, and appears to be building toward a hosted service. Most of its new work serves goals
  this fork doesn't have, and much of what bothers us comes from that generality.
- **What Paperclip does well stays.** Tasks, projects, documents, approvals, runs and the MCP
  server work today. The server is deployed on server1 with real data, and `ui-new` is built
  against it. A hard fork keeps all of that and starts improving it at once. Rebuilding a small
  backend from scratch would mean months before it matches.
- **It doesn't rule out a rebuild later.** Once the fork is cut down to its core, it's either a
  codebase we understand, or it's clear which parts deserve a clean rewrite.

## What we'd own

Measured 2026-11-16, with raw line counts (non-test TypeScript unless noted):

| Part | Size |
| --- | --- |
| Upstream activity, last 30 days | ~2,800 commits (~94 a day); ~2,000 touched the server or database |
| `server/src` | ~720,000 lines; ~1,360 files in `services/`; single files of 15–21k lines (`routes/issues.ts`, `services/issues.ts`, `native-runtime/native-session-executor.ts`) |
| Server tests | ~2,180 test files |
| Database migrations | 489 |
| Agent adapters | 12 (`claude-local`, `codex-local`, `cursor-cloud`, `cursor-local`, `gemini-local`, `grok-local`, `hermes`, `hermes-gateway`, `kimi-local`, `openclaw-gateway`, `opencode-local`, `pi-local`) |
| Paperclip Runner | ~250,000 lines of TypeScript and ~140,000 lines of Rust in `packages/paperclip-runner`, plus ~88,000 in `server/src/services/native-runtime` |
| `ui-new`, for scale | ~195,000 lines in ~960 files |
| License | MIT, so a personal hard fork is fine |

Upstream's pace means a young codebase, not a finished one. Freezing means inheriting today's bugs
and fixing them ourselves. The proposal was to cut first, since code we delete is code we never have
to debug. On adoption we chose the opposite ([step 3](#3-leave-unused-code-until-it-gets-in-the-way)):
cutting tangled code and its tests is real work up front, while dormant code mostly costs nothing
until a change runs into it.

## The frustrations this addresses

None of these say Paperclip's core model of tasks, agents and runs is wrong. They're about how runs
are put together, how Claude is integrated, and chat. Those are the parts plugins can't reach, and
the parts upstream won't make Claude-specific.

### Known bugs wait on upstream review

Many bugs we hit already have an upstream pull request waiting for review, and more are listed in
[upstream-fixes.md](upstream-fixes.md) (39 entries at adoption), most as candidates. After the freeze, we take the fixes
ourselves ([step 2](#2-take-the-fixes-already-written)).

### CLAUDE.md, repo skills and repo MCP servers aren't used

The `claude_local` adapter has two engines: the CLI (`claude --print`, `engine: "cli"`) and ACP
(`claude-agent-acp`), which is the **default** when an agent's config doesn't set `engine`. The full
trace of a run, on both engines, with corrections to this section, is
[claude-local-run.md](claude-local-run.md) (2026-11-17). On the CLI engine, the flags shut out what a normal Claude Code
session loads (`packages/adapters/claude-local/src/server/execute.ts`, around lines 880–907):

- `--strict-mcp-config` loads only Paperclip's MCP servers, so the repo's `.mcp.json` and the user's
  own servers are ignored.
- `--setting-sources user`, used with managed AI connections, probably also skips the repo's
  project settings and its `.claude/` folder (skills, agents), and possibly its CLAUDE.md.
- Skills come from Paperclip's company skill library. They're copied into a prompt bundle and added
  with `--add-dir`, not read from the repo's `.claude/skills`.
- The run's working folder is Paperclip's execution workspace. Without a project workspace that's
  the agent's own folder, where there's no CLAUDE.md to find.
- On the Paperclip Runner, Claude goes through ACP with a new, empty Claude config folder per
  session ([decision 5](../ui-new/docs/decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other)).

Each run logs its exact command, arguments and working folder in its details, which shows which of
these applies to a given agent.

### The run prompt is hard to control

It's assembled from five places:

| Part | Where it comes from |
| --- | --- |
| Agent instructions (`AGENTS.md` and siblings) | System prompt, via `--append-system-prompt-file`, fresh sessions only |
| Task brief (full and compact versions) | Markdown rendered by the server |
| The "wake" section | `packages/adapter-utils/src/server-utils.ts`, built from a payload with about 25 kinds of context (comments, plan reviews, blockers, watchdogs, recovery, connector skills…) |
| Bootstrap and heartbeat templates | Agent config, with defaults in code |
| Communication guidance and session handoff notes | Server context fields |

The adapter joins about seven sections in a fixed order (`execute.ts`, around line 942). The
Paperclip Runner and the ACP engine (`packages/adapter-utils/src/acpx-engine/execute.ts`) each have
their own version.

### Chat is a hidden task

Agent chat is built on hidden tasks
([decision 8](../ui-new/docs/decisions.md#8-agent-chats-are-tasks-underneath)), and that runs
through the busiest server code: conversation mode, external chat turns, the wake renderer,
`issues.ts`, heartbeat and recovery. The build plan already wants chat as its own concept
([3.12](../ui-new/docs/build-plan.md#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea)), but
kept it as a long-term idea because it needed a large server change.

### The build plan is held back by plugin limits

A plugin can't add to the run prompt, read runs, filter tasks on its own fields or change core
tables. Most of stage 3's workarounds and all of stage 4 exist because of that
([after the hard fork](#the-build-plan-after-the-hard-fork)).

## The Paperclip Runner

### What it is

Paperclip has two ways to run an agent:

- **The original adapters** (`claude_local` and the rest) start the harness's CLI directly as a
  child process of the server.
- **The native Runner** (`packages/paperclip-runner`) puts a separate supervising process in
  between. A daemon written in Rust starts the harness (Claude through ACP, Codex, OpenCode, Cursor,
  Claude Managed, AWS AgentCore…), talks to the server over its own protocol ("PRP") on a WebSocket,
  and streams back normalized events. Upstream's docs call the original adapters "legacy". The
  Runner is where upstream's effort goes.

A Claude hire runs on the Runner whenever the platform supports it: hiring with the runner on
"auto" saves the agent as `paperclip_runner`, and runs go by that saved type. `enableNativeRunner`
doesn't change this for Claude: hiring ignores it, and Claude runs on the Runner are exempt from it
at run time ([claude-local-run.md](claude-local-run.md), "Where legacy vs Runner is decided").

### What it gives

- Runs that survive interruptions: connections that drop and recover, runs picked up again after a
  server restart, checkpoints, and a handoff summary of up to 24 KB when a session can't be resumed.
- Running elsewhere: over SSH, in sandboxes (Daytona, cloud images) and in Paperclip's hosted cloud.
  Much of its complexity (provider packs, image checks, libc checks) serves this.
- Scoped tools instead of a raw API key: agents get Paperclip "semantic" tools, and the server
  checks each call against what that run may do.
- Enforced completion: a turn isn't finished until the agent calls `paperclip_finish` or
  `paperclip_block`.
- One event stream for every harness, rendered as a live transcript.

### Why it works against us

- Most of it serves goals this fork doesn't have: many harnesses, remote and cloud execution, a
  hosted product.
- It moves Claude further from a normal Claude Code setup. By default each session gets a new,
  empty Claude config folder, so user settings, memory and plugins don't come along, auto memory
  only lasts for the session, and only an allowlist of environment variables gets through.
- Its semantic tools only cover what upstream added to them. They had no status-card operations,
  for example.
- It's close to half a million lines, including a Rust codebase with its own protocol, release
  pinning and qualification rules. It also makes a build from source slower.
- Claude Managed agents depend on it.

### What to keep from it

These are small to add to the direct `claude --print` path, in [step 4](#4-make-runs-claude-native):

1. **Finish-or-block completion.** A run must end with an explicit outcome tool call, or the server
   marks it as stalled.
2. **A recovery handoff.** When a session can't be resumed, the new one starts with a short summary
   of the task, recent comments and agent replies.
3. **Structured live events.** Claude's `stream-json` output already provides them.

Simple restart handling is enough on one server with a process manager. Its recovery protocol isn't
needed.

### Keeping the option open

The Runner is turned off early (step 0) but removed late, so we don't lose it before we're sure.

**Why not keep syncing just the Runner?** Git can take upstream's changes to one folder
(`git checkout upstream/master -- <path>`, a path-limited `git diff | git apply -3`, or
cherry-picking the commits `git log -- <path>` finds), but the Runner isn't self-contained. Of the
upstream commits in the 30 days to 2026-11-16 that touched `packages/paperclip-runner` or
`server/src/services/native-runtime`:

| Upstream Runner commits, 30 days | Count |
| --- | --- |
| Total | 997 (~33 a day; upstream's busiest area) |
| Only inside `packages/paperclip-runner` | 142 (~14%) |
| Also changed the server outside `native-runtime` | 499 (about half) |
| Also changed the database | 53 |

Once the fork changes the server, most of those stop applying, and syncing the Runner alone would
mean resolving conflicts in upstream's busiest area every week, for code we don't use.

**Instead:**

1. **Remove it late.** After step 0 turns it off, leave the code frozen and unsynced. Take it out
   only when it gets in the way of a server change we want
   ([step 3](#3-leave-unused-code-until-it-gets-in-the-way)).
2. **Tag before deleting it** (for example `runner-last`), so a working Runner stays in git history.
   Bringing it back later means adapting it to a server that has moved on, which gets harder over
   time, but it's never lost.
3. **Watch it instead of syncing it.** The [upstream watch](#watching-upstream) covers Runner
   commits too. If upstream builds something we want, we decide then whether to port the idea or
   restore the Runner.

Some of the reasons to want it later are already covered elsewhere: `claude_local` can already
confine local runs to the workspace's files and limit network access (`bwrap`), and Claude Code
itself keeps adding sandboxing and remote execution. The main benefit left is running agents on
other machines, which this setup doesn't need.

## The plan

Each step lands on its own branch and leaves the typecheck and the remaining tests passing.

### 0. Check before freezing

Nothing here changes code, and all of it can be undone.

1. In a few recent runs' details, check which path each agent uses: `claude_local` directly, the
   Paperclip Runner, or Claude Managed. The command and adapter are logged.
2. Move server1's agents to the legacy runner (each agent's Runtime settings in `ui-new`), and
   choose Legacy runner when hiring. The App settings → Features "Paperclip Runner" switch doesn't
   do this for Claude agents (see [What it is](#what-it-is)). It's the real instance, so the user
   makes the change. Then use it that way.
3. Note anything that breaks or gets worse. It either becomes a fix in step 4 or a reason to keep
   part of the Runner.
4. List the open upstream pull requests worth taking (step 2).

### 1. Freeze and reset the rules

- **Freeze point:** `79c8cf8b6`, the last upstream commit merged (sync 2026-11-17), tagged
  `upstream-freeze`.
- **Branches:** `new-ui` is renamed `main` and is GitHub's default branch. `origin/new-ui` stays as
  a frozen pointer at the branch point. `master` keeps mirroring upstream (fast-forward only,
  `git sync-master`) so the [upstream watch](#watching-upstream) can compare against it, but it's
  never merged into `main` again. `sync/*` branches stop. The three upstream pull requests already
  open (#17828, #17905, #20710) stay open on their `fix/*` branches; no new ones are planned.
- **Remote:** keep `upstream` as fetch-only. Chosen upstream fixes come in by cherry-pick
  ([Watching upstream](#watching-upstream)). That gets harder the further the code moves, so
  over time more of them become ideas to port by hand.
- **Rules:** retire everything that only exists to stay mergeable:
  - CLAUDE.md's ground rules: no upstream code changes, `FORK:` markers, no migrations in the
    numbered sequence, never edit `ui/`;
  - [FORK-PATCHES.md](../FORK-PATCHES.md): the code entries become ordinary code; only the two
    image patches stay listed until step 2 replaces them;
  - the `upstream-fix` skill and `git sync-ui`; the `upstream-sync` skill is replaced by
    `upstream-watch`;
  - FORK.md's sync, plugin-only and contribution sections.

  Rewrite CLAUDE.md for "this is our codebase": where things live, how to test, how to deploy.
- **Migrations:** new migrations continue upstream's numbered sequence from the freeze point.
- **Package names:** keep `@paperclipai/*` for now. Renaming touches thousands of files for no
  benefit.

### 2. Take the fixes already written

- Fetch and merge the upstream pull requests from step 0
  (`git fetch upstream pull/<n>/head:upstream-pr-<n>`), including our own submitted ones (#17828,
  #17905 and the one for upstream-fixes entry 28). **Ours: done 2026-11-17** (#17905 was already in
  `main`; #17828 and #20710 cherry-picked). Upstream's others: surveyed in
  [upstream-open-prs.md](upstream-open-prs.md), to take through the `upstream-watch` take stage.
- Replace the image patches in `deploy/patches/` with the same changes in source, and build the image
  from source (see [Deployment](#deployment)).
- Turn [upstream-fixes.md](upstream-fixes.md) into the fork's own bug list. Many entries become
  plain fixes, and the ones about the Runner, other harnesses or Windows go away with step 3.

### 3. Leave unused code until it gets in the way

Decided on adoption (2026-11-17), replacing the proposal's "cut to Claude only". Nothing is removed
up front: the other 11 adapters, the Paperclip Runner and Claude Managed, remote and cloud execution,
the experimental flags on the server, unused packages and plugins all stay in the tree, dormant.
The old `ui/` was the first to go (removed 2026-11-17 at the user's request; readable with
`git show upstream-freeze:ui/...`). The work goes into `claude_local`, the path this setup uses (steps 4 to 7).

- **Remove when it gets in the way.** When dormant code blocks or complicates a change we want,
  decide then: work around it, or remove that subsystem on its own branch. Tag before removing
  anything large (for example `runner-last` for the Runner).
- **Tests in dormant areas.** A change to shared code can break tests for features we don't use.
  Don't fix dormant features to keep them green: skip the test with a note saying why, or remove the
  subsystem if that's simpler. Tests for code we use keep passing.
- **Builds.** Once the server is built from source ([Deployment](#deployment)), the image builds the
  Rust Runner and every agent CLI. If build time gets in the way, that's a candidate for removal too.
- **A map of the repo** says which areas are ours, which are shared core to change carefully, and
  which are dormant: [Progress](#progress), after step 1.

The proposal's list of what could go, in rough order of payoff, kept for when something does get in
the way: the other 11 adapters; experimental flags on the server; remote and cloud execution
(environments, sandbox providers, AI connection pools, managed connections); packages and plugins we
don't run (`google-sheets-mcp-server`, `kv-demo-mcp-server`, `paperclip-eval-kernel`,
`tailscale-https-broker`, `skills-catalog`, `teams-catalog`, the example and sandbox plugins); the
old `ui/` (done 2026-11-17); and the Paperclip Runner with Claude Managed, which reach into heartbeat, tool authority
and recovery.

### 3a. Renovate the test suite

Added 2026-11-17, and the current step. The full suite takes about 7 hours on this machine, so
nobody runs it. The goals:

- **Two tiers with a clear workflow.** A quick local set to run before pushing: typecheck plus the
  tests for the area changed, in minutes. Then **CI** runs the thorough set on every push. The
  thorough set aims for **10–20 minutes, 30 at most**.
- **Keep what's valuable.** Long, in-depth tests aren't cut for being long. Each area is reviewed,
  and an in-depth suite worth keeping goes in the thorough set (or a slower, opt-in set) rather than
  being removed.
- **A gate before `main`.** A feature branch merges once the thorough set is green on it.

What a first profile found ([test-suite-audit.md](test-suite-audit.md)):

- **It was built for upstream's CI.** `pnpm test` (`scripts/run-vitest-stable.mjs`) runs ~2,000
  server files one at a time (`--maxWorkers=1`) in 27 separate Vitest runs. Upstream
  spreads the same work across many CI machines.
- **About a quarter tests dormant code**: the Runner and native runtime, chat channels (one
  86,000-line file run as 6 shards, ~34 minutes), other adapters, cloud, managed and remote
  execution.
- **Every file reloads the server.** With `isolate: true` each file imports the module graph again,
  and every Vitest process compiles the TypeScript from cold (`fsModuleCache` is off).
- **Embedded Postgres isn't the main cost.** A suite's cluster starts in ~0.5 s from a cached
  template. Durability settings (fsync on) slow the tests' own writes by about 20%.
- **Unmanaged growth.** 27,000 server tests, test files up to 86,000 lines, and about half the
  server test files start a real database. Much of it was added by agents, a test per change.

The work, each part measured before and after:

1. **Profile the whole suite** per file (import, setup and test time) and label each file ours,
   shared core or dormant, using [repo-map.md](repo-map.md).
2. **Review each area with the user** and sort its tests: quick local set, thorough CI set, opt-in
   (slow or dormant, run on demand), or removal. Dormant tests leave the default run. Removing
   tests follows step 3's rule: ask before removing anything large.
3. **Run files in parallel** locally, with a worker count that suits this machine, and fix or
   quarantine the files that can't share a machine.
4. **Cut per-file overhead:** the module cache, isolation only where a file needs it, Postgres
   tuned for throwaway test databases.
5. **Prune and split** the oversized and duplicated suites in the code we keep.
6. **Set up CI**: a GitHub Actions workflow that runs the thorough set on every push to a branch and
   to `main`, sharded across jobs if that keeps it under the budget. Upstream's workflows in
   `.github/workflows/` (38 files) are reviewed and replaced, not inherited. Actions is enabled on
   the fork; they last ran on 2026-10-25 (scheduled, on `master`) and have never run on `main`.
7. **Write down the workflow and keep it fast:** one command per tier (quick local, thorough,
   opt-in), when to run each (before pushing, in CI, before merging into `main`), in CLAUDE.md and
   the `/pm` agent briefs, and a time budget checked when tests are added.

### 4. Make runs Claude-native

A run should behave like a Claude Code session in the project's repo:

- Run in the project's repo, or a per-task git worktree of it, never the agent's private folder
  when a project has a repo.
- Load all setting sources (user, project, local), so the repo's CLAUDE.md, `.claude/skills`,
  `.claude/agents` and settings apply.
- Use the repo's `.mcp.json` and the user's MCP servers, plus Paperclip's own MCP server, instead of
  `--strict-mcp-config`.
- Make the company skill library optional and additive: repo skills first.
- Keep the agent's own Claude memory between runs.
- Add the three things kept from the Runner: finish-or-block completion, a recovery handoff and
  structured live events.
- Agents use Paperclip through MCP, not curl ([below](#agents-use-paperclip-through-mcp)).

#### Agents use Paperclip through MCP

How agents reach Paperclip today:

| Path | Who gets it | Notes |
| --- | --- | --- |
| REST through curl | `claude_local` runs (the main path) | A run token in `PAPERCLIP_API_KEY`, taught by the `paperclip` skill (809 lines, ~4,000 with references). Reaches the whole API, but fragile: the skill has to warn that a piped `curl` can hide a failed write. Costs context every run. |
| Semantic tools | Paperclip Runner runs only | Typed tools (`paperclip_finish`, `paperclip_block`, `paperclip_report_progress`, dedicated task operations) plus `search_api`/`call_api` over the OpenAPI catalog. The server checks each call's authority. Covers only what upstream wrote (no status-card operations), behind a 14,000-line tool gateway (`server/src/services/tool-gateway.ts`). |
| Run MCP servers | `claude_local` runs, partly | At the freeze: "Paperclip projects" (`/api/mcp/project-tools`), plus connection tools when assigned; core task actions went through curl. **Since step 4a:** one `paperclip` server (`/api/mcp/paperclip`) with the whole task tool set, and project-tools is retired. |
| `packages/mcp-server` | Standalone | A stdio MCP server, ~40 tools in ~700 lines, wrapping the REST API. |
| Public MCP (`/mcp/paperclip`) | Outside assistants acting as a person | [doc/public-mcp.md](../doc/public-mcp.md) |

The plan: every run gets one Paperclip MCP connection, and agents work through it.

- **One MCP endpoint on the server,** added to each run with `--mcp-config` and the run's token.
  Without `--strict-mcp-config`, it sits alongside the repo's own MCP servers. Permissions are the
  checks the REST routes already make.
- **A small set of task tools, around 15–20:** task context, comment, update task, create a subtask
  or hand off, read and write documents, ask the board (an inbox request), request approval, search
  tasks, list agents, send a chat message, and finish, block and report progress.
- **`search_api` and `call_api` for everything else,** as on the Runner, so the whole API stays
  reachable without one tool per route.
- **Completion enforced:** a run isn't done until it calls `finish` or `block`; otherwise the
  server marks it as stalled.
- **The same tools for people:** an interactive Claude Code session connected as the user gets the
  same tools with the user's identity, so working on a task by hand and an agent run look alike.
- **The `paperclip` skill shrinks** from a curl manual to a short workflow guide: when to block, how
  to hand off, when to ask the board. `PAPERCLIP_API_KEY` can stay in the environment for scripts,
  but the skill stops teaching curl.
- **Keep the tool set small,** since each definition costs context. Claude Code loads MCP tool
  definitions lazily when there are many, which keeps the cost low.

**Built in 4a** (on `feat/step-4a`): the endpoint, the catalog, finish-or-block, the short skill,
the same tools for people (the public MCP serves the catalog), and per-agent access levels. Still
for 4b: dropping `--strict-mcp-config`, so repo MCP servers load alongside. See
[step-4a-plan.md](step-4a-plan.md) and [claude-local-run.md](claude-local-run.md).

Starting points (as written before 4a): the project-tools route (`server/src/routes/project-tools.ts`, since retired) showed the server
hosting an MCP endpoint in-process, `packages/mcp-server/src/tools.ts` has a tool list to borrow
from, and the Runner has the finish and block schemas. None of it needs the Runner's tool gateway.

Open question: where agent personas live. Either stay with Paperclip's per-agent `AGENTS.md`, or
read roles from a folder in the repo (for example `.claude/agents/<role>.md`), so the same roles
work in an interactive Claude Code session.

Idea, not decided (2026-11-17): **run agents in their own container.** A second Compose service
(`agents`) holds a small, long-lived supervisor that starts `claude --print` when the server asks,
writes each run's output to a log file on a shared folder and records its exit code. The server's
`claude_local` adapter asks it to start or cancel a run, reads the log for live output, and picks
up running runs again after a restart. Two gains: runs survive server restarts and deploys (only
`server` is recreated), and agents no longer share the server's container, user, environment and
data folder (the secrets key, #20040). Limits: agents still call the API mid-run, so a restart
briefly fails those calls; restarting `agents` or the host still ends runs. Building blocks: the CLI
engine already runs on SSH execution targets (`adapter-utils/src/execution-target.ts`) and the
server adopts detached CLI runs after a hot restart. Cheapest to design in while step 4 reworks how
`claude_local` launches Claude.

### 5. One prompt builder

Replace the five sources with one builder the fork owns:

- **Sections as template files** we can read and edit, in a fixed, documented order:
  - system prompt: the agent's instructions, then `COMPANY.md`, then the project brief (description,
    goals, document index);
  - first message: the task brief, then what just happened (the wake event).
- **One wake renderer**, keeping only the kinds of context we use.
- **A prompt preview in `ui-new`:** what the agent's next run would receive, and what a past run did
  receive.

This also delivers COMPANY.md
([3.14](../ui-new/docs/build-plan.md#314-company-instructions-companymd)), project context in every
run ([F6](../ui-new/docs/build-plan.md#317-smaller-feature-ideas)) and project docs in the prompt
([3.4](../ui-new/docs/build-plan.md#34-project-knowledge-base)).

Also in this step, left over from removing the old `ui/` (2026-11-17):

- **Board links in agent guidance.** The server's API catalog and chat directives give agents links
  to board pages that were checked against the old UI's routes. Point them at `ui-new`'s routes
  and turn the 5 skipped tests (marked "ui/ removed 2026-11-17") back on against those routes.
- **The `paperclip-board` skill** (`skills/paperclip-board/SKILL.md`) describes the old UI's search
  palette and sidebar. Rewrite it for `ui-new`.

### 6. First-class chat

Build chat next to the hidden-task chat, then move over and delete the old path:

- Its own tables: conversations and messages, with read state.
- Each message resumes the agent's Claude session for that conversation, or starts one. A
  conversation can be reset without losing its history.
- Tasks started from a chat link back to it, and report back when they're done, as today.
- Briefings and other messages agents start (`send_chat_message`) post into it.
- Prompt suggestions after each turn, as in Claude Code, once the run path passes them through
  ([3.12](../ui-new/docs/build-plan.md#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea)).
- Several conversations per agent become possible, which meetings
  ([3.9](../ui-new/docs/build-plan.md#39-meetings)) wanted.
- Migrate existing chats, then remove conversation mode from the task code. The plugin SDK's
  task-less agent sessions (`ctx.agents.sessions`) show the server already has some of the parts.

### 7. The build plan, in core

Work through the [build plan](../ui-new/docs/build-plan.md) without the stage 3 and stage 4 limits,
in whatever order matters most ([The build plan after the hard fork](#the-build-plan-after-the-hard-fork)).

## Progress

| Step | Status |
| --- | --- |
| 0. Check before freezing | Freeze taken first, on 2026-11-17. The legacy-runner switch on server1 is the user's to make (step 0, item 2); the run-path check and the list of upstream pull requests to take are open. |
| 1. Freeze and reset the rules | Done 2026-11-17: tag `upstream-freeze`, `main`, the rules in CLAUDE.md, FORK.md and FORK-PATCHES.md, the `upstream-watch` skill replacing `upstream-sync` and `upstream-fix`. |
| Repo map and `claude_local` trace | Done 2026-11-17: [repo-map.md](repo-map.md) (ours, shared core, dormant, the seams, tests) and [claude-local-run.md](claude-local-run.md) (one run from wake to finish, both engines, with the change points for steps 4 and 5). |
| 2. Take the fixes already written | In progress. Our three pull requests are in `main`; the image builds from source (no patches) on `deploy/build-from-source`, not yet deployed; upstream's open pull requests surveyed in [upstream-open-prs.md](upstream-open-prs.md), picks pending. |
| 3. Leave unused code | Ongoing, as decided. |
| **3a. Renovate the test suite** | **Current step**, added 2026-11-17. The full suite takes ~7 hours; the goal is 10–20 minutes (30 at most). First profile and audit: [test-suite-audit.md](test-suite-audit.md). Round 1 planned (4 agents: runner, per-file overhead, Postgres, classification): [step-3a-plan.md](step-3a-plan.md). |
| 4. Make runs Claude-native | Split in two. 4a (Paperclip over MCP, agent permissions): designed and planned 2026-11-17 ([design](step-4a-mcp-and-permissions.md), [plan](step-4a-plan.md)); building on `feat/step-4a`: wave 1 merged there; regression runs wait for 3a, building continues; handed off to a manager session on server1 on 2026-11-18 ([handoff](step-4a-handoff.md)). 4b (Claude-native runs): after 4a. |
| 5–7 | Not started. |

## Watching upstream

We stop merging upstream, but keep reviewing it: a weekly check picks out the upstream changes
worth having, and only those come in, by cherry-pick. It replaces the `upstream-sync` skill as a new
`upstream-watch` skill, reusing that skill's outline steps.

Upstream squash-merges each pull request into one commit with a typed, scoped subject, for example
`fix(tasks): confirm Stop after preparation settles (#21906)` or
`fix(acpx): only treat an error result as a Claude sign-in failure (#21921)`. So each commit is a
complete pull request, the right size to cherry-pick, and its type and scope make a first filter
easy.

### How it works

1. **Fetch and list** the upstream commits since the last review. A ledger,
   `fork/upstream-watch.md`, records the last reviewed upstream commit and the decision on each
   candidate (taken, skipped, idea to port), so nothing is reviewed twice.
2. **Filter automatically.** At about 650 commits a week, most can be dropped by path and scope:
   commits that only touch code we've removed or don't use (other adapters, the Runner, `ui/`,
   releases, CI).
3. **Triage the rest,** sorted into:
   - bug fixes in code we still run;
   - security fixes, always flagged;
   - features worth having;
   - good ideas whose code no longer fits: ports to do by hand.

   The output is a short report, each candidate with its pull request and why it matters.
4. **The user chooses.** The skill then cherry-picks the chosen commits on a branch, resolves
   conflicts, runs the typecheck and the related tests, and stops for approval before merging, as
   the sync skill did. Ports become tasks. A server fix only reaches server1 once the deployment
   builds from source ([Deployment](#deployment)).

The skill is [.claude/skills/upstream-watch/SKILL.md](../.claude/skills/upstream-watch/SKILL.md),
and its ledger is [upstream-watch.md](upstream-watch.md).

Expect cherry-picks to apply cleanly for the first months and less often as the code moves. The
triage is what keeps the watch useful as that happens: it says which changes are worth porting by
hand.

### Where it runs

Weekly is enough. In order:

1. **By hand, `/upstream-watch` once a week,** until the triage is reliable.
2. **Scheduled:** a local scheduled `claude -p "/upstream-watch"` on server1 or WSL, or a cloud
   routine through `/schedule`. A scheduled run stops after the report; it never cherry-picks
   without the user.
3. **A recurring task in our own Paperclip instance:** an agent does the weekly review and the
   report arrives in the Inbox as a request to approve. This uses the tool itself, and tests the
   Inbox and requests flow on real work.

## The build plan after the hard fork

| Change | Ideas |
| --- | --- |
| Becomes a real core feature, not a workaround | Custom statuses ([3.1](../ui-new/docs/build-plan.md#31-custom-statuses-and-status-rules): real statuses instead of display names mapped onto the seven), custom fields with server filtering ([3.2](../ui-new/docs/build-plan.md#32-custom-fields)), project documents ([3.4](../ui-new/docs/build-plan.md#34-project-knowledge-base)), the smaller feature ideas ([F1–F12](../ui-new/docs/build-plan.md#317-smaller-feature-ideas): ticket prefix per project, relation types, API filters and fields) |
| Unblocked | Lists and sprints ([3.3](../ui-new/docs/build-plan.md#33-lists-and-sprints-on-hold): on hold only for want of its own table), runner visibility ([3.11](../ui-new/docs/build-plan.md#311-runner-visibility-beyond-the-api)), chat outside tasks ([3.12](../ui-new/docs/build-plan.md#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea), step 6) |
| Becomes a prompt-builder setting | COMPANY.md ([3.14](../ui-new/docs/build-plan.md#314-company-instructions-companymd)), project context in runs ([F6](../ui-new/docs/build-plan.md#317-smaller-feature-ideas)), the fork skill ([3.10](../ui-new/docs/build-plan.md#310-core-skill-add-on): edit the `paperclip` skill itself) |
| Much simpler, Claude only | Memory ([3.5](../ui-new/docs/build-plan.md#35-memory-service): one Claude memory model instead of three that don't coordinate), fast mode for Claude ([F3](../ui-new/docs/build-plan.md#317-smaller-feature-ideas)) |
| Becomes straightforward | Assigned comments that drive review stages ([3.8](../ui-new/docs/build-plan.md#38-assigned-comments-and-review-assignments)), routines triggered by events ([3.13](../ui-new/docs/build-plan.md#313-briefings-and-reports) step 3), permission roles (the hard-coded CEO checks can change) |
| Unchanged | Briefings ([3.13](../ui-new/docs/build-plan.md#313-briefings-and-reports)), meetings ([3.9](../ui-new/docs/build-plan.md#39-meetings)), announcements ([3.7](../ui-new/docs/build-plan.md#37-announcement-channels)), the in-app guide ([3.15](../ui-new/docs/build-plan.md#315-an-in-app-guide-to-paperclip)) |

Stage 2 (upstream bug fixes) ends: its list becomes the fork's own bug list. Stage 1 (`ui-new`) continues, and gains the freedom to
ask the server for what it needs instead of designing around gaps. Many entries in
[decisions.md](../ui-new/docs/decisions.md) are API gaps that become server changes.

## Deployment

Until step 2, `deploy/Dockerfile` started from upstream's published image and swapped in `ui-new`,
and `deploy/patches/` edited the compiled server. Since step 2:

- **Built from source:** `deploy/deploy.sh` builds the root `Dockerfile` (`--target production`) as
  `paperclip-core:<commit>`, then `deploy/Dockerfile` swaps in `ui-new`. A cold build takes about
  9 minutes on the desktop (Rust runner, agent CLIs), a warm one about 2. The remote provider pack
  isn't built, so the image is about 6 GB smaller than upstream's. See
  [deploy/README.md](../deploy/README.md).
- **Image patches became source changes** (step 2); `FORK-PATCHES.md` is retired.
- **Optionally, a GitHub Actions workflow** builds the image on pushes to the main branch and
  publishes it to `ghcr.io/br1an-c0des/paperclip`, so server1 only pulls.
- **Back up the database before every deploy that adds a migration.** Migrations don't run
  backwards, so restoring the backup is the only way back.
- server1 stays the real instance throughout. Every step is tried on the local instance first, as
  today.

## Risks

- **We own the bugs.** Today's bugs are ours to fix, and upstream fixes arrive only when the
  [upstream watch](#watching-upstream) picks them. Cherry-picking gets harder as the code moves.
- **Security fixes no longer arrive automatically.** The watch always flags them. server1 is only
  reachable over Tailscale, so the exposure is low.
- **Removing the Runner could turn out to be a mistake.** It's removed late, if at all, tagged first,
  and watched upstream ([Keeping the option open](#keeping-the-option-open)).
- **Dormant code still costs something:** tests in dormant areas that break on shared changes, a
  slower source build, and a larger repo to find your way around. Step 3's rules and the repo map
  keep that small.
- **The `claude_local` path has had less attention** since upstream started calling it "legacy". It
  may have rough edges, which become ours to fix. Step 0 finds them early.
- **Changing tangled code is real work.** Conversation mode (step 6), and the Runner if it's ever
  removed, reach into heartbeat, recovery and `issues.ts`. One subsystem per branch, with tests
  passing after each, keeps it manageable.
- **Scope creep.** A hard fork makes everything possible. The build plan stays the list, and
  anything not on it needs a reason to be added.

## Decisions

Taken on adoption, 2026-11-17:

1. **Adopt:** yes, now. The freeze came first; step 0's checks continue after it.
2. **Run paths:** `claude_local` is what we use and improve. Nothing is removed: the Runner, Claude
   Managed and the other adapters stay in the tree until they get in the way (step 3).
3. **Freeze point:** `79c8cf8b6` (tag `upstream-freeze`).
4. **Branch:** `new-ui` renamed `main`, GitHub's default; `origin/new-ui` kept as a frozen pointer.
5. **The upstream watch:** written in step 1, run by hand weekly to start.
6. **Open upstream pull requests** (#17828, #17905, #20710): left open.
7. **Engine, decided 2026-11-17: the CLI** (`claude --print`). Steps 4 and 5 build on
   `packages/adapters/claude-local/src/server/execute.ts`; `cli` becomes the default engine and
   server1's agents switch to it (sessions start fresh once). Why: it *is* Claude Code (native
   skills, instructions in the system prompt, the latest CLI weekly, no bridge or patch to keep),
   it's ~1,500 lines of Claude-only code instead of the 6,000-line engine shared with four other
   adapters, and ACP's advantages are small changes on the CLI side (an env allowlist as in #20040,
   dropping `--strict-mcp-config` with MCP trust settings). CLI runs are also the ones a hot restart
   can adopt. Still to check in step 6: multi-turn chat through `--input-format stream-json`, where
   ACP is naturally stronger. ACP stays in the tree, dormant.

Still open:

1. **Where agent personas live:** Paperclip's per-agent `AGENTS.md`, or role files in the repo
   (step 4).
2. **Which open upstream pull requests to take** (step 2): surveyed 2026-11-17 in
   [upstream-open-prs.md](upstream-open-prs.md) (25 to take now, 7 to port by hand); the picks are
   the user's.
3. **The order of steps 4 to 7**, if something else matters more day to day.
4. **Where the upstream watch runs** once it's past the by-hand stage: a scheduled Claude Code run,
   or a recurring task in our own Paperclip instance.

## Docs changed on adoption

| Doc | Change |
| --- | --- |
| [CLAUDE.md](../CLAUDE.md) | Purpose, intentions and ground rules for a hard fork; sync commands and gotchas dropped |
| [FORK.md](../FORK.md) | A short "where this came from" page: the freeze point, the `master` mirror and `upstream` remote, the upstream watch, deployment |
| [FORK-PATCHES.md](../FORK-PATCHES.md) | Code entries retired; the two image patches stayed until step 2, then it was retired |
| [upstream-fixes.md](upstream-fixes.md) | The fork's bug list |
| [upstream-watch.md](upstream-watch.md) | New: the watch's ledger |
| `.claude/skills/upstream-sync`, `.claude/skills/upstream-fix` | Replaced by `.claude/skills/upstream-watch` |
| `fork/sync-reports/` | Kept as history |
| [ui-new/docs/build-plan.md](../ui-new/docs/build-plan.md) | Stage 1 continues, stage 2 ends, stages 3 and 4 become features built in core |
| [deploy/README.md](../deploy/README.md), [fork/setup-clone.sh](setup-clone.sh), [ui-new/README.md](../ui-new/README.md), the `pm` skill | `main` instead of `new-ui` |
| Memory notes | Upstream-sync and upstream-fix notes retired |

Still to change, in step 2: `deploy/Dockerfile` and `deploy/README.md` to build from source.
