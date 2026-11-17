# Hard fork plan

**Status: proposed, not adopted.** Written 2026-11-16, at upstream `537b0408b` (the last commit merged
into `new-ui`, [sync 2026-11-16](sync-reports/2026-11-16.md)). Until it's adopted, the rules in
[CLAUDE.md](../CLAUDE.md) and [FORK.md](../FORK.md) still apply.

The proposal: stop syncing with upstream `paperclipai/paperclip`, treat this repo as our own
codebase, cut it down to what a single-person, Claude-only setup needs, and then change the server
freely. Today the fork pays the cost of syncing and also lives under upstream's limits. A hard fork
removes both.

## Contents

- [Why](#why)
- [What we'd own](#what-wed-own)
- [The frustrations this addresses](#the-frustrations-this-addresses)
- [The Paperclip Runner](#the-paperclip-runner)
- [The plan](#the-plan)
- [The build plan after the hard fork](#the-build-plan-after-the-hard-fork)
- [Deployment](#deployment)
- [Risks](#risks)
- [Decisions to make](#decisions-to-make)
- [Docs to change when this is adopted](#docs-to-change-when-this-is-adopted)

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
and fixing them ourselves. That's why the plan [cuts first](#3-cut-to-claude-only): code we delete
is code we never have to understand, debug or test.

## The frustrations this addresses

None of these say Paperclip's core model of tasks, agents and runs is wrong. They're about how runs
are put together, how Claude is integrated, and chat. Those are the parts plugins can't reach, and
the parts upstream won't make Claude-specific.

### Known bugs wait on upstream review

Many bugs we hit already have an upstream pull request waiting for review, and 33 more are listed
in [upstream-fixes.md](upstream-fixes.md), most as candidates. After the freeze, we take the fixes
ourselves ([step 2](#2-take-the-fixes-already-written)).

### CLAUDE.md, repo skills and repo MCP servers aren't used

The Claude adapter starts each run as `claude --print` with flags that shut out what a normal
Claude Code session loads (`packages/adapters/claude-local/src/server/execute.ts`, around lines
880–907):

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

With `enableNativeRunner` on (the default), an ordinary `claude_local` hire runs on the Runner, as
found during the status-card work
([decisions](../ui-new/docs/decisions.md)).

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

## The plan

Each step lands on its own branch and leaves the typecheck and the remaining tests passing.

### 0. Check before freezing

Nothing here changes code, and all of it can be undone.

1. In a few recent runs' details, check which path each agent uses: `claude_local` directly, the
   Paperclip Runner, or Claude Managed. The command and adapter are logged.
2. Turn `enableNativeRunner` off on server1, or set the agents to `runner: "legacy"`, and use it
   that way for one to two weeks. It's a setting on the real instance, so the user makes the change.
3. Note anything that breaks or gets worse. It either becomes a fix in step 4 or a reason to keep
   part of the Runner.
4. List the open upstream pull requests worth taking (step 2).

### 1. Freeze and reset the rules

- **Freeze point:** the last upstream commit merged into `new-ui` (`537b0408b` today, or a later
  one if we sync again before adopting this). Tag it, for example `upstream-freeze`.
- **Branches:** `new-ui` becomes the main branch (optionally renamed to `main` and made the default
  on GitHub). `master` stays as the frozen upstream mirror, kept only for reference and
  cherry-picks. `sync/*`, `fix/*` and `docs/*` branches stop.
- **Remote:** keep `upstream` as fetch-only, so a specific upstream fix can still be fetched and
  cherry-picked. That gets harder the further the code moves, and in practice stops working after
  a few months.
- **Rules:** retire, in one commit, everything that only exists to stay mergeable:
  - CLAUDE.md's ground rules: no upstream code changes, `FORK:` markers, no migrations in the
    numbered sequence, never edit `ui/`;
  - [FORK-PATCHES.md](../FORK-PATCHES.md): its entries become ordinary code;
  - the `upstream-sync` and `upstream-fix` skills, `git sync-master` and `git sync-ui`;
  - FORK.md's sync, plugin-only and contribution sections.

  Rewrite CLAUDE.md for "this is our codebase": where things live, how to test, how to deploy.
- **Migrations:** new migrations continue upstream's numbered sequence from the freeze point.
- **Package names:** keep `@paperclipai/*` for now. Renaming touches thousands of files for no
  benefit.

### 2. Take the fixes already written

- Fetch and merge the upstream pull requests from step 0
  (`git fetch upstream pull/<n>/head:upstream-pr-<n>`), including our own submitted ones (#17828,
  #17905 and the one for upstream-fixes entry 28).
- Replace the image patches in `deploy/patches/` with the same changes in source.
- Turn [upstream-fixes.md](upstream-fixes.md) into the fork's own bug list. Many entries become
  plain fixes, and the ones about the Runner, other harnesses or Windows go away with step 3.

### 3. Cut to Claude only

Remove, one subsystem per branch, in roughly this order:

1. **The other 11 adapters**, with their UI parsers, adapter selection and model lists. Hard-code
   the Claude path.
2. **The Paperclip Runner and Claude Managed**, once step 0 shows nothing needs them. This reaches
   into heartbeat, tool authority (`paperclip-runner-tool-authority.ts`) and recovery, so it's real
   work, but it's the biggest cut available.
3. **Experimental flags, on the server too.** `ui-new` already settled most of them. Keep the
   chosen branch of each and delete the switch and the other branch.
4. **Remote and cloud execution:** environments, sandbox providers, AI connection pools and managed
   connections, and whatever else only serves them.
5. **Packages and plugins we don't run.** Check each before removing: `google-sheets-mcp-server`,
   `kv-demo-mcp-server`, `paperclip-eval-kernel`, `tailscale-https-broker`, `skills-catalog`,
   `teams-catalog`, and the example and sandbox plugins.
6. **The old `ui/`**, once `ui-new` covers everything M7 lists. Git history keeps it as a reference.

Delete tests together with the features they cover, and keep the rest of upstream's test suite
running. It's the safety net for every later step.

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
| Run MCP servers | `claude_local` runs, partly | "Paperclip projects" (`/api/mcp/project-tools`), plus connection tools when assigned. Core task actions still go through curl. |
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

Starting points: the project-tools route (`server/src/routes/project-tools.ts`) shows the server
hosting an MCP endpoint in-process, `packages/mcp-server/src/tools.ts` has a tool list to borrow
from, and the Runner has the finish and block schemas. None of it needs the Runner's tool gateway.

Open question: where agent personas live. Either stay with Paperclip's per-agent `AGENTS.md`, or
read roles from a folder in the repo (for example `.claude/agents/<role>.md`), so the same roles
work in an interactive Claude Code session.

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
run (2b-15) and project docs in the prompt
([3.4](../ui-new/docs/build-plan.md#34-project-knowledge-base)).

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
in whatever order matters most (next section).

## The build plan after the hard fork

| Change | Ideas |
| --- | --- |
| Becomes a real core feature, not a workaround | Custom statuses ([3.1](../ui-new/docs/build-plan.md#31-custom-statuses-and-status-rules): real statuses instead of display names mapped onto the seven), custom fields with server filtering ([3.2](../ui-new/docs/build-plan.md#32-custom-fields)), project documents ([3.4](../ui-new/docs/build-plan.md#34-project-knowledge-base), 2b-8), ticket prefix per project (2b-9), relation types (2b-13) |
| Unblocked | Lists and sprints ([3.3](../ui-new/docs/build-plan.md#33-lists-and-sprints-on-hold): on hold only for want of its own table), runner visibility ([3.11](../ui-new/docs/build-plan.md#311-runner-visibility-beyond-the-api)), chat outside tasks ([3.12](../ui-new/docs/build-plan.md#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea), step 6) |
| Becomes a prompt-builder setting | COMPANY.md ([3.14](../ui-new/docs/build-plan.md#314-company-instructions-companymd)), project context in runs (2b-15), the fork skill ([3.10](../ui-new/docs/build-plan.md#310-core-skill-add-on): edit the `paperclip` skill itself) |
| Much simpler, Claude only | Memory ([3.5](../ui-new/docs/build-plan.md#35-memory-service): one Claude memory model instead of three that don't coordinate), fast mode for Claude (2b-11) |
| Becomes straightforward | Assigned comments that drive review stages ([3.8](../ui-new/docs/build-plan.md#38-assigned-comments-and-review-assignments)), routines triggered by events ([3.13](../ui-new/docs/build-plan.md#313-briefings-and-reports) step 3), permission roles (the hard-coded CEO checks can change) |
| Unchanged | Briefings ([3.13](../ui-new/docs/build-plan.md#313-briefings-and-reports)), meetings ([3.9](../ui-new/docs/build-plan.md#39-meetings)), announcements ([3.7](../ui-new/docs/build-plan.md#37-announcement-channels)), the in-app guide ([3.15](../ui-new/docs/build-plan.md#315-an-in-app-guide-to-paperclip)) |

Stage 2 (small upstream contributions) ends. Stage 1 (`ui-new`) continues, and gains the freedom to
ask the server for what it needs instead of designing around gaps. Many entries in
[decisions.md](../ui-new/docs/decisions.md) are API gaps that become server changes.

## Deployment

Today `deploy/Dockerfile` starts from upstream's published image and swaps in `ui-new`, and
`deploy/patches/` edits the compiled server. After the freeze:

- **Build from source.** Start from upstream's `Dockerfile` with our layer on top. It's slower at
  first because of the Rust runner and the agent CLIs, and faster once the Runner and the other
  harnesses are removed (step 3).
- **Image patches become source changes** (step 2).
- **Optionally, a GitHub Actions workflow** builds the image on pushes to the main branch and
  publishes it to `ghcr.io/br1an-c0des/paperclip`, so server1 only pulls.
- **Back up the database before every deploy that adds a migration.** Migrations don't run
  backwards, so restoring the backup is the only way back.
- server1 stays the real instance throughout. Every step is tried on the local instance first, as
  today.

## Risks

- **We own the bugs.** Today's bugs are ours to fix, and upstream fixes stop arriving.
  Cherry-picking gets harder as the code moves.
- **Security fixes stop arriving.** server1 is only reachable over Tailscale, so the exposure is
  low. Skim upstream's security-related commits now and then.
- **The `claude_local` path has had less attention** since upstream started calling it "legacy". It
  may have rough edges, which become ours to fix. Step 0 finds them early.
- **Cutting tangled code is real work.** The Runner and conversation mode reach into heartbeat,
  recovery and `issues.ts`. One subsystem per branch, with tests passing after each, keeps it
  manageable.
- **Scope creep.** A hard fork makes everything possible. The build plan stays the list, and
  anything not on it needs a reason to be added.

## Decisions to make

1. **Adopt this plan?** And when: right away, or after step 0's trial period.
2. **Which run paths stay:** `claude_local` only (recommended), or also the Runner or Claude
   Managed for something they alone provide.
3. **The freeze point:** `537b0408b`, or one more sync first.
4. **Branch names:** keep `new-ui`, or rename it to `main`.
5. **Where agent personas live:** Paperclip's per-agent `AGENTS.md`, or role files in the repo
   (step 4).
6. **Which open upstream pull requests to take** (step 2).
7. **The order of steps 4 to 7**, if something else matters more day to day.

## Docs to change when this is adopted

| Doc | Change |
| --- | --- |
| [CLAUDE.md](../CLAUDE.md) | Rewrite the purpose, intentions and ground rules for a hard fork; drop the sync commands and gotchas |
| [FORK.md](../FORK.md) | Becomes a short "where this came from" page: the freeze point, the `upstream` remote for cherry-picks, deployment |
| [FORK-PATCHES.md](../FORK-PATCHES.md) | Retired once its entries are ordinary code |
| [upstream-fixes.md](upstream-fixes.md) | Becomes the fork's bug list |
| `.claude/skills/upstream-sync`, `.claude/skills/upstream-fix` | Retired |
| [ui-new/docs/build-plan.md](../ui-new/docs/build-plan.md) | Replace the four stages: stage 1 continues, stage 2 ends, stages 3 and 4 become one list of features built in core |
| [deploy/README.md](../deploy/README.md), `deploy/Dockerfile` | Build from source |
| Memory notes | Upstream-sync and upstream-fix notes become obsolete |
