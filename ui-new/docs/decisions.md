# Discoveries and decisions

Things the redesign turns up that `ui-new` needs a decision on: gaps in the API, behavior a design
assumed but the server doesn't have, and constraints that rule out an approach. Each entry records what
was found, the options, and the decision once it's made.

How this fits with the other redesign docs:

- [inventory/capabilities.md](inventory/capabilities.md) lists what the old UI does and where each
  capability lands. This log covers what the *new* design needs that isn't there yet.
- [proposals/](proposals/) holds larger designs. When an entry here grows into one, link it and keep
  the entry as the summary.
- Server or package changes are out of scope for the fork ([FORK.md](../../FORK.md)). An entry can
  propose one upstream, but the fork never carries it as a patch.

## Adding an entry

Give it the next number and add it to the index. Use the fields below, and keep the history: when a
decision changes, mark the old one superseded and link the new entry rather than rewriting it.

- **Status:** Open, Decided, or Superseded by another entry.
- **Area:** the capability IDs it touches, from the [checklist](inventory/capabilities.md).
- **Found in:** the design, page or code where it came up.
- Then **What we found**, **Why it matters**, **Options** and **Decision**.

## Index

| # | Entry | Area | Status | Opened |
| --- | --- | --- | --- | --- |
| 1 | [Projects can't hold documents or files](#1-projects-cant-hold-documents-or-files) | `projects/*`, `documents-artifacts/library` | Decided | Oct 20, 2026 |
| 2 | [Agent chat is off unless the instance turns it on](#2-agent-chat-is-off-unless-the-instance-turns-it-on) | `agent-chat/*`, shell navigation | Open | Oct 20, 2026 |
| 3 | [Agents can work on several things at once](#3-agents-can-work-on-several-things-at-once) | `agent-chat/*`, runs | Decided | Oct 20, 2026 |
| 4 | [A run's full model input only exists when provider tracing is on](#4-a-runs-full-model-input-only-exists-when-provider-tracing-is-on) | `runs-adapters/runs`, `agents/runtime` | Open | Oct 20, 2026 |
| 5 | [Agents can have three memory systems that don't know about each other](#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other) | `agents/runtime`, `agents/skills`, `agents/instructions`, Connectors | Open | Oct 22, 2026 |
| 6 | [Tasks have no due date](#6-tasks-have-no-due-date) | `tasks/create`, `tasks/properties` | Decided | Oct 24, 2026 |
| 7 | [Model and effort overrides depend on the agent's adapter](#7-model-and-effort-overrides-depend-on-the-agents-adapter) | `tasks/create`, `agents/runtime` | Decided | Oct 24, 2026 |
| 8 | [Agent chats are tasks underneath](#8-agent-chats-are-tasks-underneath) | `agent-chat/*`, `inbox-search/search`, `tasks/views` | Decided | Oct 24, 2026 |
| 9 | [Agent avatars need a runtime import from the shared package](#9-agent-avatars-need-a-runtime-import-from-the-shared-package) | `agents/*`, design system | Decided | Oct 25, 2026 |
| 10 | [Some response types aren't exported from the shared package](#10-some-response-types-arent-exported-from-the-shared-package) | shell, session | Decided | Oct 25, 2026 |
| 11 | [Menus inside dialogs need to sit above the overlay](#11-menus-inside-dialogs-need-to-sit-above-the-overlay) | design system | Decided | Oct 25, 2026 |
| 12 | [What happens to each experimental flag](#12-what-happens-to-each-experimental-flag) | every flagged area | Open | Oct 25, 2026 |

## Entries

### 1. Projects can't hold documents or files

- **Status:** Decided
- **Area:** `projects/*`, `documents-artifacts/library`
- **Found in:** the project Docs tab in the tasks and projects design canvas (screen 9,
  [private link](https://claude.ai/artifact/Rfim4J3VCm6qkSvcpeLsi7)).

**What we found.** Documents (keyed markdown with revisions, locks and annotations) exist on tasks,
cases and pipelines (`/api/issues/:id/documents/:key`, `/api/cases/:id/documents/:key`,
`/api/pipelines/:pipelineId/documents/:key`). Attachments exist on tasks and cases. Projects have
neither. The only project-level text is the project's markdown `description`, which can embed images
uploaded with `POST /api/companies/:companyId/assets/images`.

Part of the design already works on the existing API: `GET /api/companies/:companyId/artifacts`
accepts `projectId` and `groupBy=task`. That covers the Docs tab's "From tasks" section, which lists
every task's documents, attachments and outputs, grouped by task.

**Why it matters.** The design's Docs tab opens with a "Project docs and files" section for material
that belongs to the whole project rather than one task: a project brief, architecture notes, trading
rules, reference files. There is nowhere to store it. Agents would need a way to find these docs as
well as people.

**Options.**

1. **A project docs task.** `ui-new` keeps one task per project to hold its documents and
   attachments, and hides it from lists, boards and counts. It works on the existing API and gets
   revisions, locks and annotations for free. But the server doesn't know about the convention, the
   old UI and agents see an ordinary task, and the UI needs a reliable way to find it (a label, or a
   field it can set). The task must also never be picked up as work.
2. **The project description only.** Treat the description as the single project doc. Nothing new is
   needed, but it's one document, with no revisions and no files other than embedded images.
3. **Propose project documents upstream.** Ask Paperclip to support documents and attachments on
   projects, as it already does for cases and pipelines. This is the cleanest result, but it depends on
   upstream accepting it and on when it lands.
4. **Drop the section.** The Docs tab shows task docs only.

Options 1 and 3 can be combined: start with a project docs task and move its contents over if upstream
adds project documents.

**Decision.** Option 3, without the option 1 stopgap (Oct 24, 2026). `ui-new` builds the
"From tasks" part, and project documents are proposed upstream
([build plan 2b-8](build-plan.md#2b-small-features-ask-upstream-first)). The project section waits
for them. If upstream declines, the fork plugin provides them instead
([build plan 3.4](build-plan.md#34-project-knowledge-base)).

### 2. Agent chat is off unless the instance turns it on

- **Status:** Open
- **Area:** `agent-chat/history`, `agent-chat/handoff`, sidebar navigation
- **Found in:** the agent chat view in the design canvas (screens 12 and 13).

**What we found.** The design makes chat an agent's home: clicking an agent in the sidebar opens one
ongoing conversation with it, and its settings move behind a "Manage agent" button. The API already
works this way. Each person has one standing conversation per agent, stored as a task
(`GET|POST /api/companies/:companyId/chats/:agentRef`), and `/new` starts a fresh session while
keeping the history visible.

But the server only serves chat when the instance's experimental setting `enableAgentChat` is on.
It's off by default, and with it off the chat routes return 404. Instance admins change it with
`PATCH /api/instance/settings/experimental`.

**Why it matters.** `ui-new` drops the old UI's feature switches, but this one is enforced by the
server, so the new UI can't simply treat chat as always on. With the setting off, clicking an agent
would land on an error.

**Options.**

1. **Require it.** Treat `enableAgentChat` as part of setting up an instance for `ui-new`: set it in
   the deployment and document it.
2. **Check and offer.** On startup `ui-new` reads the experimental settings. If chat is off, an
   instance admin sees a prompt to turn it on, and everyone else falls back to the agent's details
   page.
3. **Fall back silently.** With chat off, the sidebar opens agent details as the old UI does.

**Decision.** Not made yet.

### 3. Agents can work on several things at once

- **Status:** Decided
- **Area:** `agent-chat/history`, runs and live status
- **Found in:** the agent chat view's "busy" state (screen 12).

**What we found.** The first draft showed an agent working on a task as busy, with your chat
message queued until that run finished. That's not how Paperclip works by default. An agent can run
up to 20 runs at once (`AGENT_DEFAULT_MAX_CONCURRENT_RUNS`, set per agent as "Max concurrent runs").
So a chat reply runs alongside the agent's task work. A message waits only behind a reply already
running in the same chat, or when the agent is at its limit or paused.

**Decision.** Chat shows what the agent is working on but doesn't call it busy. When the agent is
working on a task, the chat says "Working on TRA-41. Replies here run alongside it." The send button
only becomes "Queue" while the agent is replying in this chat. Still to design: what the chat shows
when the agent is at its run limit or paused.

### 4. A run's full model input only exists when provider tracing is on

- **Status:** Open
- **Area:** `runs-adapters/runs`, `agents/runtime`
- **Found in:** the task run modal in the design canvas (screens 16 to 18).

**What we found.** By default a run keeps:

- the prompt Paperclip renders for the agent, with the wake context, command and environment (the
  `adapter.invoke` event in `GET /api/heartbeat-runs/:runId/events`);
- the harness's stdout and stderr, which the UI parses into a transcript of messages, thinking and
  tool calls (`GET /api/heartbeat-runs/:runId/log`);
- token usage and cost.

None of these is what the model received. The harness (Claude Code, Codex and others) wraps
Paperclip's prompt in its own system prompt, tool definitions and session history before calling the
provider. Only a provider trace records those exact requests and responses, and capture is off by
default. There are two ways to turn it on:

- **For an agent:** the "Capture raw provider traces" setting under Debugging in the agent's
  configuration. It records every future run until someone turns it off.
- **For one run:** "Run with provider trace", which wakes the agent with
  `debug: { providerTrace: "raw" }`.

Traces have tight limits. Only instance admins can view them (`GET /api/heartbeat-runs/:runId/provider-trace`).
Message bodies stay redacted until an admin reveals a frame, and both viewing and revealing are logged
as activity. Each run keeps at most 64 MiB, and anything over that marks the trace `truncated`. Every
trace is deleted after 24 hours.

**Why it matters.** The run modal is meant to show a run's full input and output. For most runs it
can show Paperclip's prompt and the parsed transcript, but not everything the model saw. People who
aren't instance admins never see the full input, and admins only see it within a day of the run.

**Options.**

1. **Show what exists and label it.** The Input tab shows Paperclip's prompt and says the harness
   adds more. The Provider trace tab shows the trace when there is one. Otherwise it offers "Rerun
   with trace" and the agent setting, and it's hidden from anyone who isn't an instance admin.
2. **Turn tracing on for every agent.** Every run gets its full input and output. But traces hold
   sensitive prompts and tool arguments, last only 24 hours and are admin-only, so this mostly adds
   storage and risk.
3. **Propose a request summary upstream.** Ask Paperclip to keep a small record of each model call
   without the bodies: system prompt and tool definition sizes, message count, and token usage per
   call. That explains a run's context size and cost without storing sensitive content.

Options 1 and 3 can be combined.

**Decision.** Not made yet. Screens 16 to 18 follow option 1.

### 5. Agents can have three memory systems that don't know about each other

- **Status:** Open. An interim fix is decided; the long-term fix isn't.
- **Area:** `agents/runtime`, `agents/skills`, `agents/instructions`, Connectors, and the
  `enableMemoryConnectors` flag
- **Found in:** a review of how Claude agents remember things between runs.

**What we found.** Three things can give an agent memory, and nothing coordinates them:

1. **Paperclip's `para-memory-files` skill.** It's one of the core skills every lead agent gets
   (`PAPERCLIP_CORE_SKILL_KEYS`), and the CEO's heartbeat checklist uses it. It tells the agent to keep
   notes in `$AGENT_HOME/MEMORY.md`, `$AGENT_HOME/memory/<date>.md` and `$AGENT_HOME/life/`.
   `AGENT_HOME` is the agent's instructions bundle folder. Paperclip restores it before a run and saves
   changes afterwards, so these notes belong to the agent and the API can read them
   (`GET /api/agents/:id/instructions-bundle`).
2. **Claude Code's auto memory.** It's built into Claude Code and on by default. `claude_local` runs
   the normal `claude` CLI and doesn't turn it off. Claude therefore also saves notes to
   `<Claude config dir>/projects/<project>/memory/` and loads that `MEMORY.md` at the start of every
   session. The folder is named after the run's git repository or working directory, not the agent.
   One agent's notes end up split between project workspaces and its fallback folder
   (`workspaces/<agentId>`), and every agent working in the same project shares a single folder. In
   the [deployment](../../deploy/README.md) the notes live on the host under
   `$PAPERCLIP_DATA_ROOT/home/.claude/projects/`. Neither the API nor the UI can see them.
3. **Memory connectors** (experimental, behind `enableMemoryConnectors`, off by default). Mem0, Zep,
   Supermemory, Cognee and Honcho connect as ordinary company tool connections. Each comes with a short
   instruction, on by default and editable on the connection, that's added to the prompt of every
   agent assigned the connection: search memory before relying on remembered context, and save durable
   facts after useful work. The memories stay with the provider and are scoped by the provider's key or
   sign-in, not by Paperclip agent. Tools are classed as read, write or destructive, and all are
   Allowed by default. See upstream's
   [doc/connections/MEMORY.md](../../doc/connections/MEMORY.md).

An agent with a memory connector can get all three sets of "save what you learn" instructions at
once. Upstream's connector docs and plans don't mention the other two. Upstream's March plan for a
memory service with company and agent memory bindings
([doc/plans/2026-03-17-memory-service-surface-api.md](../../doc/plans/2026-03-17-memory-service-surface-api.md))
was never built.

The Paperclip Runner changes this for Claude agents that use it. By default only new Codex agents
get the Runner.

- **Claude through ACP, in the default isolated mode.** Each session gets a new Claude config folder
  (`runtime/paperclip-runner/acpx/<session>/claude-home`). Auto memory stays on but lasts only as long
  as that session. In preconfigured-home mode Claude uses the real home folder, as `claude_local`
  does.
- **Environment variables.** The Runner passes Claude only an allowlist of the server's variables,
  plus the agent's own `env`. A variable set on the server container doesn't reach it.
- **Claude Managed** (Anthropic's Managed Agents). There's no agent folder, so `para-memory-files`
  can't keep anything, and Paperclip attaches no Managed Agents memory stores. Each session starts
  with no memory unless the agent is assigned a memory connector.
- **Copilot.** The Runner explicitly turns memory off for Copilot (`memory: false`) but not for
  Claude.

Paperclip saves the agent's folder (`AGENT_HOME`) on both runners.

Upstream has two open issues about this: [#2671](https://github.com/paperclipai/paperclip/issues/2671)
(auto memory duplicates `para-memory-files`; its fix,
[#2700](https://github.com/paperclipai/paperclip/pull/2700), was closed unmerged) and
[#6325](https://github.com/paperclipai/paperclip/issues/6325) (auto memory splits by working
directory).

**Why it matters.** An agent says a lesson is "saved to memory", then a later run reads a different
store and repeats the mistake. #6325 has a worked example. Duplicated facts also cost tokens on every
run and drift apart over time. For the redesign, people should be able to see and correct what an
agent remembers. Only the `para-memory-files` notes are reachable through the API. Connector memories
live in each provider's console, and auto memory isn't in the API at all. `enableMemoryConnectors`
also needs a decision, like the other flags.

**Options.**

1. **Turn off Claude Code's auto memory.** Set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Set on the server
   container in `deploy/docker-compose.yml`, it reaches every local `claude_local` run. Runner agents
   and remote or sandbox targets need it in the agent's adapter `env`. A project
   `.claude/settings.json` isn't enough: with a managed AI connection, Paperclip passes
   `--setting-sources user` and project settings are ignored. Existing notes stay on disk; they just
   stop loading.
2. **Keep auto memory, but give each agent its own folder.** For `claude_local` agents, pin the folder
   with `extraArgs: ["--settings", "{\"autoMemoryDirectory\": \"/paperclip/agent-memory/<agentId>\"}"]`
   and remove `para-memory-files`. This fixes #6325, but the notes stay outside the API.
3. **Fix it upstream.** Send a focused PR so that `claude_local`, and the Runner's isolated Claude
   settings, disable auto memory whenever `para-memory-files` is among the agent's skills. That's
   #2700 again, but setting the environment variable instead of writing settings files into
   workspaces, because the variable also works with `--setting-sources user`. A larger alternative
   lets each agent choose its memory system.
4. **Show memory in the new UI.** An agent "Memory" view that reads `MEMORY.md`, `memory/` and `life/`
   from the agent's files and lists the agent's memory connections. With option 1 or 3 in place, this
   covers everything the agent remembers, and it works on the existing API.

**Decision.** For now, option 1: set the environment variable. Long term, option 3 is the candidate
upstream PR, and option 4 goes into the agent page design. The `enableMemoryConnectors` flag isn't
decided yet.

Harnesses in use (Oct 24, 2026): `claude_local`, the Paperclip Runner and Claude Managed. So:

- Option 1 also needs the variable in the adapter `env` of each Runner agent, since the Runner
  doesn't pass on the server's variables.
- Claude Managed agents remember nothing between sessions without a memory connector. That makes the
  `enableMemoryConnectors` decision, and a memory service that works for every harness
  ([build plan 3.5](build-plan.md#35-memory-service)), matter more.

### 6. Tasks have no due date

- **Status:** Decided
- **Area:** `tasks/create`, `tasks/properties`
- **Found in:** the new-task dialog ([board 7b](design/boards.md#board-7b)).

**What we found.** An early draft of the dialog had a "Due date" button. Tasks don't have one:
`createIssueBaseSchema` in `packages/shared/src/validators/issue.ts` has no date field of that kind,
and neither do the shared types or the database schema.

**Why it matters.** A due date the UI can't save would look like it works and then disappear.

**Options.**

1. **Leave it out.** The dialog and properties show only fields the API stores.
2. **Keep it somewhere else.** A label or the description could carry a date, but nothing would act
   on it.
3. **Propose due dates upstream.**

**Decision.** Option 1. Board 7b dropped the button. Revisit if upstream adds due dates.

### 7. Model and effort overrides depend on the agent's adapter

- **Status:** Decided
- **Area:** `tasks/create`, `agents/runtime`
- **Found in:** the assignee capsule in the new-task dialog ([board 7b](design/boards.md#board-7b)).

**What we found.** A task can run on a different model or thinking effort than its agent's own
settings, through `assigneeAdapterOverrides.adapterConfig`. The old UI builds that payload in
`ui/src/lib/issue-assignee-overrides.ts`:

- It only applies to `claude_local`, `codex_local` and `opencode_local`. For any other adapter, and
  for people, it sends no overrides.
- The model always goes in `adapterConfig.model`.
- The effort key differs per adapter: `effort` (Claude), `modelReasoningEffort` (Codex), `variant`
  (OpenCode).
- The effort choices differ too (`thinkingEffortOptionsFor` in
  `ui/src/components/issue-properties/helpers.ts`). Codex's depend on the chosen model.

**Why it matters.** The design shows model and effort for every assignee, defaulting to "Agent
default". The UI has to know when the choice applies and which key to write.

**Options.**

1. **Mirror the old UI.** Show model and effort only for the three adapters, use the same key mapping
   and option lists, and send no override when both are left at "Agent default".
2. **Show the choice for every agent** and ignore it where it doesn't apply. That's misleading.

**Decision.** Option 1. For people and other adapters the capsule shows the assignee only, with a
short note in the menu.

### 8. Agent chats are tasks underneath

- **Status:** Decided
- **Area:** `agent-chat/*`, `inbox-search/search`, `tasks/views`
- **Found in:** the "tasks separated from agent chats" idea in
  [paperclip-redesign-ideas.md](paperclip-redesign-ideas.md), checked against
  `server/src/routes/issues.ts` and `server/src/services/agent-conversations.ts`.

**What we found.** Each person's chat with an agent is a row in `issues`:

- Opening a chat (`POST /api/companies/:companyId/chats/:agentRef`) creates a task titled
  "Chat with <agent>" and assigned to that agent. Columns `conversationAgentId` and
  `conversationUserId` mark it as a chat, `conversationState` says whether the agent is replying
  (`active`) or waiting for you (`waiting`), and `/new` increments `conversationSessionGeneration`. A
  unique index allows one chat per person and agent.
- Each message is a comment on that task, and each one wakes the agent through the normal run queue.
- The server keeps chats apart from real work. Task lists, work queues and the inbox leave them out.
  They can't have subtasks, be marked done or cancelled, or be reassigned. The agent's chat
  instructions (`AGENT_CHAT_DIRECTIVE`) tell it to plan in the chat and create ordinary project
  tasks for the work.
- Tasks an agent creates during a chat run are linked to the chat in `chatTaskHandoffs`. When one
  reaches `done`, the agent is woken in the chat (`chat_task_completed`) to report the result.
- The old UI shows a chat as the task page in "conversation mode", with the task header and
  properties hidden.

Two things leak through:

- A chat takes a task number (`TRA-57`) like any other task.
- Searches with a query (`q`) skip the filter, so chats can show up in search results.

**Why it matters.** The redesign ideas ask for tasks to be separated from chats. Most of that separation
already exists on the server; what's left is how the UI presents a chat.

**Options.**

1. **Build on hidden tasks.** `ui-new` draws a chat as a conversation (board 12), never as a task
   page. Handed-off tasks show as linked cards in the chat, and search results show a chat as a chat.
2. **Make chat its own kind of object**, stored and run outside tasks. A fork plugin could do this
   with the plugin SDK's task-less agent sessions (`ctx.agents.sessions`), but would lose what the
   built-in chat adds, such as handed-off tasks reporting back. Doing it in the server would be a
   large change in some of upstream's most active code.

**Decision.** Option 1, in stage 1 (M5). Option 2 was first kept as an optional exploration, then
dropped on Oct 24, 2026: Paperclip's MCP connection gives a fluid conversation outside tasks without
it ([build plan 3.12](build-plan.md#312-chat-outside-tasks-dropped)). A run per message is the
expected default, not a stopgap. Agent-initiated messages, such as briefings, are added to this chat separately
([build plan 3.13](build-plan.md#313-briefings-and-reports)).

### 9. Agent avatars need a runtime import from the shared package

- **Status:** Decided
- **Area:** `agents/*`, design system (avatars)
- **Found in:** building the `AgentAvatar` component for M0.

**What we found.** Agents are ClipLab characters. The server renders each one as a PNG
(`/api/agent-avatars/...`), and the URL encodes the agent's appearance, size, pixel ratio and pose.
`agentAvatarUrl`, `resolveAgentAppearance` and `characterStateForAgent` in
`packages/shared/src/agent-appearance.ts` build that URL and pick the palette and pose the server
expects. They're runtime code, and the module imports `zod`.

**Why it matters.** `ui-new` imports from `@paperclipai/shared` with `import type` only, to keep
the bundle free of server-side code. Copying the URL builder would drift from the server the first
time upstream changes the scheme.

**Options.**

1. **Import those three functions at runtime** from `@paperclipai/shared/agent-appearance` (the
   package exports each file through `./*`). That pulls `zod` into the bundle.
2. **Copy the functions into `ui-new`** and check them against upstream at each sync.
3. **Render ClipLab in the browser** (`packages/shared/src/cliplab`), as the old UI's
   `AgentCharacter.tsx` does. The build plan allows this import ("Avatars" under the stack), but a
   static avatar doesn't need it.

**Decision.** Option 1, limited to `ui/Avatar.tsx`. Animated characters, such as the appearance
editor (M5), can adopt the ClipLab runtime under the same exception when they're built; record any
other runtime import from the shared package here.

### 10. Some response types aren't exported from the shared package

- **Status:** Decided
- **Area:** shell, session check
- **Found in:** the API client for M0 (`api/health.ts`, `api/access.ts`, `api/companies.ts`).

**What we found.** Three responses `ui-new` reads at startup have no type in `@paperclipai/shared`:

- `GET /api/health` (`HealthStatus`): the old UI declares it in `ui/src/api/health.ts`.
- `GET /api/cli-auth/me` (`CurrentBoardAccess`): declared in `ui/src/api/access.ts`.
- `GET /api/companies/stats`: a map from company id to agent and task counts, untyped in the old
  UI. It leaves out companies with no agents or tasks, so a missing entry means zero.

**Why it matters.** Local copies of these types can drift from the server without the typecheck
noticing.

**Options.**

1. **Declare local types** with only the fields `ui-new` reads, each naming the old UI's
   declaration it mirrors.
2. **Propose exporting them from `packages/shared`** upstream.

**Decision.** Option 1 for now. Option 2 is a candidate for a small upstream pull request (stage
2a); if it lands, switch to the shared types.

### 11. Menus inside dialogs need to sit above the overlay

- **Status:** Decided
- **Area:** design system (layers)
- **Found in:** checking M0 on a phone-sized viewport, where the company switcher's sheet opened
  behind the nav drawer.

**What we found.** `tokens.css` sets `--z-popover: 30` below `--z-overlay: 50`, the level of dialogs
and the phone nav drawer. That suits a menu on the page, but menus and popovers also open from inside
dialogs (the new-task dialog's status and assignee menus) and from the drawer, and there they were
drawn underneath.

**Options.**

1. **Put menus, popovers and tooltips above the overlay level** in `ui/layer.css` and
   `ui/Tooltip.css` (`--z-overlay` + 1 and + 2), and keep `tokens.css` identical to the design copy.
2. **Change the tokens** in the design and in `ui-new`.

**Decision.** Option 1. If the design tokens are revised, fold the change in there.


### 12. What happens to each experimental flag

- **Status:** Open. The recommendations below need confirming (build plan, decision E).
- **Area:** every area a flag touches; listed per flag in
  [generated/flags.md](inventory/generated/flags.md).
- **Found in:** `instanceExperimentalSettingsSchema` and its metadata,
  `packages/shared/src/feature-catalog.ts`, checked against the server code that reads each flag.

**What we found.** The schema has 46 flags. The old UI reads 32 of them. 21 of those 32 are also
enforced by the server, which turns the feature's routes or background work on or off. Turning those
21 into permanent parts of the UI isn't something `ui-new` can do: with the flag off, the API refuses
or returns nothing. The other 11 only change what the old UI shows. The 13 flags the old UI never
reads (14) are server or runtime behavior.

**Why it matters.** The fork aims to settle on one interface without toggles. That works for the
UI-only flags. For the server-enforced ones, the switch remains an instance setting, and `ui-new`
follows it.

**Options.**

1. **Three outcomes per flag.**
   - *Built in:* a UI-only flag whose feature `ui-new` always has.
   - *Dropped:* a UI-only flag whose feature `ui-new` leaves out, or replaces with its own design.
   - *Follows the setting:* `ui-new` shows the feature when the server has it on
     (`GET /api/instance/settings/experimental`). The switch stays on the instance settings page,
     ported in M6.
2. **Build every feature in and require each instance to turn its flags on.** This is simpler for
   the UI, but it breaks on any instance that keeps a flag off.

**Recommendation.** Option 1, as follows.

UI-only flags:

| Flag | Outcome | Why |
| --- | --- | --- |
| `enableStreamlinedUi` | Dropped | `ui-new` is its own shell and navigation (M1). |
| `enableClassicTaskInterface` | Dropped | One task interface, from the boards (M2). |
| `enableCombinedInboxTasks` | Dropped | The boards keep Inbox separate from Tasks (board 14). |
| `enableDecisions` | Dropped | The Inbox and the requests proposal take its place (M3). |
| `enableGoalsSidebarLink` | Dropped | Goals become a project's lists (decision C). |
| `enableArtifactsV1` | Dropped | The artifact boards set the presentation. |
| `enablePaperclipDeveloperMode` | Dropped | Maintainer tooling (Honeycomb links). |
| `enableApps` | Built in | A compatibility key; Apps is always on. |
| `enableEnvironments` | Built in | Environments are a company settings section (boards 21–25). |
| `enableIssuePlanDecompositions` | Built in | Shown in a task's history when there is one (M2). |
| `enableExperimentalFileViewer` | **Ask** | A task's workspace file browser. Build it in (M2) or drop it. |

Server-enforced flags, all following the setting:

| Flag | Notes |
| --- | --- |
| `enableAgentChat` | Decision A: on in every `ui-new` deployment. |
| `enablePublicMcp` | Should be on: the MCP connection replaces chat outside tasks (3.12). Also needed by `enableOpenAiDot` and `enableGrokBot`. |
| `enableCases` | Decision F: the cases pages are dropped for now, so this has no surface in `ui-new` yet. |
| `enableConferenceRoomChat` | **Ask.** Team chat and its onboarding. The recommendation is no surface, as with chat outside tasks (3.12). |
| `enableSmokeLab` | No surface: maintainer tooling. |
| `enableServerInfoDebugView` | The server-info section in the account menu, when the setting is on. |
| `enableManagedSandboxOnly`, `enableIsolatedWorkspaces`, `enableNativeRunner` | Agent, project and environment settings show the controls these allow. |
| `enableChatConnectors`, `enableGitHubReviewBots`, `enableMemoryConnectors`, `enableFastResponses` | Apps and tools sections (M6). |
| `enableOpenAiDot`, `enableGrokBot`, `enableMuse`, `enableBuiltInAgents`, `enableBetaSkills` | New-agent choices and agent settings (M5). |
| `enableExternalObjects`, `enableSummaries`, `enableStatusCards` | Their panels on tasks, projects and workspaces, when the setting is on. |

The 14 flags the old UI doesn't read stay switches on the ported settings page, and `ui-new`
doesn't branch on them: `enableAiConnectionRouters`, `enableIsolatedWorkspacesByDefault`,
`enableStreamlinedLeftNavigation`, `enablePaperclipNotebook`, `enableSimplifiedEnglishInteractions`,
`enableFirstTaskPlanProposal`, `autoRestartDevServerWhenIdle`, `enableWorkspaceBranchReconcileForward`,
`enableWorkspaceDirtyQuarantineRepair`, `enableOwnerInstanceAdmin`, `enableSandboxDuplexBridge`,
`enableWorktreeRunExecution`, and the compatibility keys `enableMcpAggregators` and
`enableRunnerPreviewIngress`.

**Decision.** Not yet made.
