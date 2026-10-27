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
| 4 | [A run's full model input only exists when provider tracing is on](#4-a-runs-full-model-input-only-exists-when-provider-tracing-is-on) | `runs-adapters/runs`, `agents/runtime` | Decided | Oct 20, 2026 |
| 5 | [Agents can have three memory systems that don't know about each other](#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other) | `agents/runtime`, `agents/skills`, `agents/instructions`, Connectors | Open | Oct 22, 2026 |
| 6 | [Tasks have no due date](#6-tasks-have-no-due-date) | `tasks/create`, `tasks/properties` | Decided | Oct 24, 2026 |
| 7 | [Model and effort overrides depend on the agent's adapter](#7-model-and-effort-overrides-depend-on-the-agents-adapter) | `tasks/create`, `agents/runtime` | Decided | Oct 24, 2026 |
| 8 | [Agent chats are tasks underneath](#8-agent-chats-are-tasks-underneath) | `agent-chat/*`, `inbox-search/search`, `tasks/views` | Decided | Oct 24, 2026 |
| 9 | [Agent avatars need a runtime import from the shared package](#9-agent-avatars-need-a-runtime-import-from-the-shared-package) | `agents/*`, design system | Decided | Oct 25, 2026 |
| 10 | [Some response types aren't exported from the shared package](#10-some-response-types-arent-exported-from-the-shared-package) | shell, session | Decided | Oct 25, 2026 |
| 11 | [Menus inside dialogs need to sit above the overlay](#11-menus-inside-dialogs-need-to-sit-above-the-overlay) | design system | Decided | Oct 25, 2026 |
| 12 | [What happens to each experimental flag](#12-what-happens-to-each-experimental-flag) | every flagged area | Decided | Oct 25, 2026 |
| 13 | [The task composer overrides runs for more adapters than New task does](#13-the-task-composer-overrides-runs-for-more-adapters-than-new-task-does) | `tasks/create`, `agents/runtime` | Decided | Oct 25, 2026 |
| 14 | [Lists need their own storage, so they're on hold](#14-lists-need-their-own-storage-so-theyre-on-hold) | `goals/*`, `tasks/organize`, `projects/task-context` | Decided | Oct 26, 2026 |
| 15 | [Run transcripts use the adapter packages' parsers at runtime](#15-run-transcripts-use-the-adapter-packages-parsers-at-runtime) | `runs-adapters/runs`, `tasks/run-control` | Decided | Oct 26, 2026 |
| 16 | [Cases don't store the structure the case boards draw](#16-cases-dont-store-the-structure-the-case-boards-draw) | `cases/*`, `tasks/views` | Open | Oct 26, 2026 |
| 17 | [Search results are shaped differently from board S1](#17-search-results-are-shaped-differently-from-board-s1) | `inbox-search/search` | Open | Oct 26, 2026 |
| 18 | [The phone layouts assume push notifications](#18-the-phone-layouts-assume-push-notifications) | phone navigation, `inbox-search/triage` | Open | Oct 26, 2026 |
| 19 | [The document editor is CodeMirror 6, loaded on demand](#19-the-document-editor-is-codemirror-6-loaded-on-demand) | `documents-artifacts/documents`, `tasks/workspace` | Decided | Oct 26, 2026 |
| 20 | [More shared code the task screens need at runtime](#20-more-shared-code-the-task-screens-need-at-runtime) | `documents-artifacts/annotations`, `tasks/discussion`, `tasks/approvals` | Decided | Oct 26, 2026 |
| 21 | [Open questions from the phone shell](#21-open-questions-from-the-phone-shell) | `shell/navigation`, `shell/company`, design system | Open | Oct 26, 2026 |
| 22 | [Smaller API gaps found building M2's task screens](#22-smaller-api-gaps-found-building-m2s-task-screens) | `tasks/*`, `steering/*`, `documents-artifacts/*` | Open | Oct 26, 2026 |
| 23 | [Gaps found building the temporary Connectors page](#23-gaps-found-building-the-temporary-connectors-page) | Apps and tools (AI connections) | Open | Oct 26, 2026 |
| 24 | [Gaps found building the Inbox](#24-gaps-found-building-the-inbox) | `inbox-search/triage`, `approvals/*`, `decisions/*` | Open | Oct 27, 2026 |
| 25 | [Gaps found building the project dashboard and Docs](#25-gaps-found-building-the-project-dashboard-and-docs) | `projects/*`, `documents-artifacts/library` | Open | Oct 27, 2026 |
| 26 | [Gaps found building project settings](#26-gaps-found-building-project-settings) | `projects/*`, `workspaces/*`, `goals/*` | Open | Oct 27, 2026 |
| 27 | [Gaps found building recurring tasks](#27-gaps-found-building-recurring-tasks) | `routines/*` | Open | Oct 27, 2026 |
| 28 | [Gaps found building agent workload](#28-gaps-found-building-agent-workload) | `projects/task-context`, `agents/roster` | Open | Oct 27, 2026 |

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

- **Status:** Decided
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

**Decision.** Option 1, decided Oct 26, 2026, as screens 16 to 18 draw it. The request summary of
option 3 stays proposed upstream as [2b-10](build-plan.md#2b-small-features-ask-upstream-first).

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

- **Status:** Decided (build plan, decision E).
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
| `enableGoalsSidebarLink` | Dropped | No Goals page: goals show on tasks and in project settings ([decision 14](#14-lists-need-their-own-storage-so-theyre-on-hold)). |
| `enableArtifactsV1` | Dropped | The artifact boards set the presentation. |
| `enablePaperclipDeveloperMode` | Dropped | Maintainer tooling (Honeycomb links). |
| `enableApps` | Built in | A compatibility key; Apps is always on. |
| `enableEnvironments` | Built in | Environments are a company settings section (boards 21–25). |
| `enableIssuePlanDecompositions` | Built in | Shown in a task's history when there is one (M2). |
| `enableExperimentalFileViewer` | Built in | A task's workspace file browser, for reviewing an agent's work (M2). |

Server-enforced flags, all following the setting:

| Flag | Notes |
| --- | --- |
| `enableAgentChat` | Decision A: on in every `ui-new` deployment. |
| `enablePublicMcp` | Should be on: the MCP connection replaces chat outside tasks (3.12). Also needed by `enableOpenAiDot` and `enableGrokBot`. |
| `enableCases` | Decision F: no cases page. When the setting is on, cases show inside the task views: the case chip, the task panel's Case section, Group: Case, and Start case in New task. |
| `enableConferenceRoomChat` | No surface: team chat and its onboarding are dropped, as with chat outside tasks (3.12). |
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

**Decision.** Option 1, as recommended above (Oct 25, 2026). The file viewer is built into the task
panel in M2, and Conference Room chat is dropped. A flag that upstream adds later gets a row here,
with the same three outcomes; the upstream sync report flags new ones.

### 13. The task composer overrides runs for more adapters than New task does

- **Status:** Decided
- **Area:** `tasks/create`, `agents/runtime`
- **Found in:** building the assignee capsule in M1, against
  `ui/src/components/task-chat/composer-run-settings.ts`.

**What we found.** [Decision 7](#7-model-and-effort-overrides-depend-on-the-agents-adapter) follows
the old new-task dialog, which still overrides only `claude_local`, `codex_local` and
`opencode_local`, with a fixed Claude effort list (low, medium, high). Upstream's newer task composer
(the run settings under a task's comment box) has moved on:

- It overrides 11 adapters: the three above plus `pi_local`, `kimi_local`, `gemini_local`, `cursor`,
  `cursor_cloud`, `grok_local`, `hermes_local` and `paperclip_runner`.
- Effort keys differ further: `reasoningEffort` (Grok), `thinking` (Pi), `effort` (Kimi).
- Effort lists depend on the model for Claude too (`claudeLocalReasoningEffortsForModel`: none for
  Haiku; up to `xhigh` and `max` for the newest Opus, Sonnet and Fable models), and for Grok and Kimi.
- The lists are runtime functions in the adapter packages (`@paperclipai/adapter-*`), not types, so
  `ui-new` can't import them without breaking the `import type` rule, and copies drift silently.
  `new-task.ts` already mirrors the Codex table by hand.

**Why it matters.** M1's capsule offers fewer choices than the composer does for the same agent, and
the Claude list is wrong for the newest models. M2 builds the composer, which needs the full set.

**Options.**

1. **Keep decision 7 for New task; mirror the composer in M2.** New task stays as the old dialog
   behaves; the M2 composer copies the 11-adapter rules by hand, and the upstream sync checks the
   adapter packages for changes.
2. **One mirrored table for both, now.** Extend `new-task.ts` to the composer's adapters and model
   lists, so New task and the composer agree from the start. Same drift risk, more to check.
3. **Ask upstream for an endpoint** that returns each adapter's effort choices per model (beside
   `GET /api/companies/:companyId/adapters/:type/models`), as a small upstream PR. No copies to
   drift; New task and the composer read the same list.

**Recommendation.** Option 3, with option 2 as the fallback until it lands: the model list already
comes from the server, and the efforts belong with it.

**Decision.** Option 3 with option 2 as the fallback, decided Oct 26, 2026. The endpoint is a small
feature, so it starts as a message in upstream's `#dev` channel
([2b-16](build-plan.md#2b-small-features-ask-upstream-first)). Until it lands, `new-task.ts` holds one
mirrored table that New task and the composer share, and the upstream sync checks the adapter
packages for changes to it.


### 14. Lists need their own storage, so they're on hold

- **Status:** Decided
- **Area:** `goals/*`, `tasks/organize`, `projects/task-context`
- **Found in:** the lists boards ([L1 to L4](design/boards.md#lists-on-hold)), checked against
  `server/src/services/issue-goal-fallback.ts`, `server/src/services/heartbeat/run-preparation.ts`,
  `server/src/routes/issues.ts` and upstream's history for goals.

**What we found.** Build plan decision C made each of a project's lists one of its goals. Goals don't
fit that well:

- **How goals are stored.** Goals belong to the company and form one tree (`parentId`, with levels
  company, team, agent and task). Projects link goals many to many through `project_goals`, and keep
  the first one in the older `projects.goal_id` column too. A task points to at most one goal
  (`issues.goal_id`). The server doesn't check that a task's goal is one its project links, and the task
  list endpoint can't filter by goal.
- **Every task in a project with goals has one.** When a task is created without a goal, the server
  gives it the project's first goal, or the company's default goal when it has no project
  (`resolveIssueGoalId`). Clearing the goal later puts the project's first goal back
  (`resolveNextIssueGoalId`). So a task can't sit in a project without being in a list, and the first
  goal acts as a default list.
- **Deleting a goal only removes its row.** `DELETE /api/goals/:id` doesn't clear the tasks, projects
  or sub-goals that point to it, so the database should refuse while any remain. Not tested. The old UI
  retires goals by cancelling them instead.
- **What reaches a run.** The prompt that starts a run carries the task's title, description, status,
  priority and work mode, with no project or goal (`run-preparation.ts`). Agents fetch the rest:
  - `GET /api/issues/:id/heartbeat-context`, which the core skill tells them to read first, returns
    the goal's id, title, status, level and parent, and the project's id, name, status and target date.
    Neither description is included.
  - `GET /api/issues/:id` returns the full goal and project, with descriptions, plus each parent task's
    project and goal.
  - Both use the task's goal, or else the project's first goal, or else the company's default goal.
- **Where upstream is taking goals.** The goals table hasn't changed since February and the goal
  service since March; since then the pages have only had app-wide changes, plus a check on project goal
  ids (#12779, Sep 3). The Goals sidebar link was hidden on Jul 7 (#9189) "while the goals surface is
  being evaluated", with the pages kept. Cases arrived two days later (#9198) and are still growing
  (workflows and handoffs, Oct 20 and 21). "Session goals" in the Paperclip Runner (Sep 8) are a
  different thing: an objective for one agent session. Onboarding, plugins, cost tracking and the README
  still use company goals.

**Why it matters.** The lists in the boards need things goals can't give: tasks in no list, lists that
belong to one project, their own order, and later sprint dates. Built on goals, the first list would
quietly collect every new task, and lists would carry the meaning goals have elsewhere, as the "why"
agents and onboarding see. They would also rest on a surface upstream is keeping out of view.

**Options.**

1. **Keep lists as goals** (decision C), with the first list shown as the project's default.
2. **A fork plugin table** mapping tasks to lists (stage 3). Server-side filters and agents wouldn't
   see the lists.
3. **Propose lists upstream** as a new table. Bigger than the small features in stage 2.
4. **Put lists on hold** until one of those is worth the database work.

**Decision.** Option 4, decided Oct 26, 2026. It replaces build plan decision C. Lists need their own
table, so they wait; boards L1 to L4 stay in the board set, marked on hold, as the design for when they come back
([3.3](build-plan.md#33-lists-and-sprints-on-hold)). Goals keep their old role in the meantime: a task
property, and the project's goals in project settings, with no Goals page. Separately, returning the
goal and project descriptions in `heartbeat-context` is a small upstream change
([2b-15](build-plan.md#2b-small-features-ask-upstream-first)).

### 15. Run transcripts use the adapter packages' parsers at runtime

- **Status:** Decided
- **Area:** `runs-adapters/runs`, `tasks/run-control`
- **Found in:** building the run modal (boards 16–18, `ui-new/src/runs/`).

**What we found.** A run's log is the harness's raw output. Each adapter package turns its own output
into transcript entries with a parser exported from its `/ui` path (`@paperclipai/adapter-claude-local`,
codex, cursor, gemini, grok, kimi, opencode, pi, openclaw-gateway and hermes), and
`@paperclipai/adapter-utils` has the log and command redaction. The old UI imports them at runtime.
Some transcripts have no package parser:

- `paperclip_runner` and `cursor_cloud` parsers live in `ui/src`.
- Native-runtime runs build their transcript from run events
  (`ui/src/components/transcript/native-run-events.ts`, about 1,000 lines).
- External and plugin adapters' parsers are loaded from the server at run time.

Two smaller gaps came up alongside:

- `GET /api/heartbeat-runs/:id` has no `adapterType`, and returns row fields (such as `runtimeMode`)
  that the shared `HeartbeatRun` type leaves out. `ui-new` takes the adapter type from the run's
  `adapter.invoke` event, or else the agent, which is wrong if the agent has changed adapters since.
- The `adapter.invoke` payload doesn't record the instructions revision or the skills a run loaded,
  which board 17's "Loaded with it" shows. This could feed the request summary in
  [2b-10](build-plan.md#2b-small-features-ask-upstream-first).

**Why it matters.** `ui-new` imports from `@paperclipai/shared` with `import type` only
([decision 9](#9-agent-avatars-need-a-runtime-import-from-the-shared-package) is the one exception so
far). Copying the parsers would drift every time upstream changes a harness's output.

**Options.**

1. **Import the adapter packages' `/ui` parsers at runtime**, as the old UI does.
2. **Copy the parsers into `ui-new`** and check them at each sync.
3. **Propose upstream that the server serves a parsed transcript.**

**Decision.** Option 1, decided Oct 26, 2026. `ui-new` depends on the eleven packages above as
workspace dependencies, a second exception to `import type` alongside decision 9. Runs without a
package parser show plain lines and say so. Porting the runner, Cursor Cloud and native-run parsers,
or proposing upstream that they move into packages, is still open. The parsers grew the main bundle
past Vite's 500 KB warning (627 KB); loading the run modal as its own chunk is the fix when it matters.

### 16. Cases don't store the structure the case boards draw

- **Status:** Open
- **Area:** `cases/*`, `tasks/views`
- **Found in:** boards C1, C2 and C5, checked against the cases API.

**What we found.**

- **Phases are free text.** A workflow is a name and a prompt, and a case stores only its current
  `phase` as text. The phase track, its agents, "Phase 4 of 6", the ticks, and the template preview's
  loops and waits have no structured source. Rounds per phase can be counted from
  `GET /api/cases/:caseId/handoffs`.
- **No count of a workflow's cases.** C5's "Used by 5 cases" has no endpoint; the case list can't
  filter by workflow.
- **Task lists don't carry case membership.** Case chips on rows and Group: Case need
  `GET /api/issues/:id/cases` per task or `GET /api/cases/:id` per case. The case list gives only each
  case's main task.

**Why it matters.** Cases come in M6 ([decision F](build-plan.md#decisions-to-make-early)). Without
these, the case views either parse prose or make a request per task.

**Options.** To decide before M6: draw what the API stores (the phase as text, no track), load case
membership per visible task, or propose structured phases and a membership field upstream. Upstream
is still changing cases, so check its direction first.

**Decision.** Open.

### 17. Search results are shaped differently from board S1

- **Status:** Decided 2026-10-27
- **Area:** `inbox-search/search`
- **Found in:** boards S1 to S3, checked against the search API.

**What we found.** S1 draws one row per matching comment, with its author, and document results with
a revision number. The API returns comment matches as task results, each with one best-matching
snippet and no author, and document results without a revision.

**Options.** Draw results as the API returns them (a task with its best snippet), or fetch more per
result, or propose richer results upstream.

**Decision.** Draw results as the API returns them: a comment match is a row for its task with the
best-matching snippet, no author; documents without a revision number. No extra requests per result.
If authors or revisions turn out to matter, propose richer results upstream later.

**Found building it.** A task that matches directly and through a comment shows only its title and
description snippets, even in the Comments view. In All, a task matched by its title and a document
counts under Tasks and Docs but shows once (under Tasks), so Docs can have a count and no row; the
page says so. A kind's view only gets that kind's count, so the other tabs reuse All's counts when
cached rather than spend a second request (60 searches a minute per person). Agents and projects
count 0 while any task filter is set. The API takes one assignee, project and label at a time.

### 18. The phone layouts assume push notifications

- **Status:** Open
- **Area:** phone navigation ([design/mobile.md](design/mobile.md)), `inbox-search/triage`
- **Found in:** the phone navigation boards (N1, N2): the You sheet has push settings.

**What we found.** There's no web-push subscription or notification preference API. The phone
layouts' morning brief (M10) also depends on build plan [3.13](build-plan.md#313-briefings-and-reports).

**Options.** Leave push settings out of the You sheet until there's an API, propose web push
upstream, or build it as a fork plugin (stage 3).

**Decision.** Open.

### 19. The document editor is CodeMirror 6, loaded on demand

- **Status:** Decided
- **Area:** `documents-artifacts/documents`, `tasks/workspace`
- **Found in:** building the document editor and the workspace file viewer (M2, `src/documents/`,
  `src/files/`).

**What we found.** The old UI's editor is React. `ui-new` needs one that works in Solid, and the
main chunk was already past Vite's 500 KB warning ([decision 15](#15-run-transcripts-use-the-adapter-packages-parsers-at-runtime)).

**Options.**

1. **CodeMirror 6**, framework-agnostic. Its packages were already in the lockfile through the old UI.
2. **A textarea with a live preview.** Smallest, but no highlighting, search or list continuation.

**Decision.** Option 1, loaded only when needed. The editor uses `@lezer/markdown` directly
rather than `@codemirror/lang-markdown`, which would pull in the HTML, CSS and JavaScript grammars.

- **Costs, gzipped:** the editor is about 115 KB on first edit. The code viewer is about 107 KB on the
  first source file, plus 5–20 KB per language; the two share about 97 KB of CodeMirror core.
- **Main chunk:** it doesn't grow (619 KB raw, 187 KB gzipped).

Documents save explicitly (Save, or Ctrl/Cmd+S) on the revision the edit started from, instead of
the old UI's autosave. That avoids a revision every second and makes conflicts predictable. A
conflict keeps the draft and offers the differences, their version, or overwrite.

### 20. More shared code the task screens need at runtime

- **Status:** Decided
- **Area:** `documents-artifacts/annotations`, `tasks/discussion`, `tasks/approvals`
- **Found in:** the M2 composer, document editor and Details slices.

**What we found.**

- **Comment anchors.** Comments on a document's text must anchor the way the server re-anchors them.
  The helpers are in `@paperclipai/shared/document-anchors`.
- **Mention links.** The composer writes `agent://`, `user://` and `/issues/REF` links, whose formats
  live in the shared package's `project-mentions.ts`.
- **Execution policy.** The old UI validates a task's review stages with the shared zod schema
  `issueExecutionPolicySchema`.

**Decision.**

- **Comment anchors:** imported at runtime (`src/documents/anchor.ts`), as a third exception to
  `import type` after decisions 9 and 15. Copying them would drift from the server's re-anchoring.
- **Mention formats:** copied locally, in the style of decision 10. They're small and stable.
- **Execution policy:** the shape is checked by hand. A policy the editor doesn't recognise is
  shown as unreadable and never overwritten. Switching to the shared schema at runtime would be
  more faithful; revisit if the hand check drifts.

### 21. Open questions from the phone shell

- **Status:** Open
- **Area:** `shell/navigation`, `shell/company`, design system
- **Found in:** building the floating dock ([design/mobile.md](design/mobile.md)).

1. **A System theme.** The You sheet offers Light, Dark and System, which loosens the design
   system's "light and dark" line. Built that way; confirm or drop System.
2. **The dock on detail pages.** It stays on task and agent pages for now. The phone boards (M2,
   M9, M11) hide it and use a back control, which those pages don't have yet. Hide it once they do.
3. **The Org dashboard on phones.** It isn't one of the dock's places. Either phones land on the
   Inbox, or the dashboard goes in the Tasks switcher.
4. **The agents list URL.** There's no agents list page yet. The old UI's `/agents/all` would be
   read as an agent called "all". Decide the URL before M5.
5. **Needs-you counts for other companies.** The company list shows them only for the current
   company; others would need one sidebar-badges request each.

### 22. Smaller API gaps found building M2's task screens

- **Status:** Open
- **Area:** `tasks/*`, `steering/*`, `documents-artifacts/*`
- **Found in:** the M2 composer, document editor and Details slices.

Each is handled in `ui-new` for now. They're possible upstream proposals if they start to matter.

- **No watchers and no private comments.** The old UI has neither on the thread, and the comments
  API has no field for privacy. Private comments are dropped.
- **Steering takes three requests.** There's no "post and steer": the composer posts, reads the
  queue, then steers with `{queueId, revision, targetRunId}`. A 409 shows a retry message.
- **Run settings stay on the task.** The composer's model and effort go to `PATCH /issues/:id` as
  `assigneeAdapterOverrides`, so they apply until changed, as in the old UI. There's no per-message
  override.
- **Approval events don't refresh a task's approvals.** They invalidate the company's approvals, so
  the card refreshes the task's section itself after acting.
- **No editing presence on documents.** A lock is a freeze, not an edit session, and only board
  users can lock. The UI says "Locked by X", not board 5's "X is editing".
- **Comment counts per document** take one request per row.
- **The changed-file count** on "Browse workspace files" runs a git scan (`list?mode=changed`,
  cached 30 s). The file-resources endpoints are board-only and rate-limited, and can't list a
  task's candidate workspaces.
- **The project access notice** links to `/agents/:agentKey/permissions`, which shows "not built
  yet" until the M5 agent pages.
- **The recent windows don't say where they end.** `/recent-comments` mixes picked-out comments
  with the latest run of comments, and `/activity?view=recent` (50) and `/runs?view=recent` (2) have
  no `hasMore`. `ui-new` mirrors the server's limits (the 4 newest comments, a full page means more),
  so the gap marker lands in the wrong place if upstream changes them.
- **No server-side log search.** Find in run only covers the log that's loaded and drawn.
- **Some response types aren't exported** from the shared package (the tree-control state, the
  adapter model entry). Declared locally, as in [decision 10](#10-some-response-types-arent-exported-from-the-shared-package).

### 23. Gaps found building the temporary Connectors page

- **Status:** Open
- **Area:** Apps and tools (AI connections)
- **Found in:** the temporary Connectors page, built ahead of M6 to test agent runs end to end.

Both are handled in `ui-new` for now.

- **The list doesn't say who created a shared connection.** `GET /api/companies/:companyId/ai-connections`
  returns `ownerUserId` only for personal connections, but only the creator may reconnect a shared
  one. Reconnect is offered to every manager, and the server's 403 has the last word.
- **`localAiLoginSupported` isn't in `ui-new`'s `HealthStatus` type.** The page reads it through a
  local type extension, falling back to `deploymentMode === "local_trusted"` as the old UI does.

### 24. Gaps found building the Inbox

- **Status:** Open
- **Area:** `inbox-search/triage`, `approvals/*`, `decisions/*`
- **Found in:** the Inbox's first slice (M3, board 14).

- **Approvals in the attention feed have no linked task.** `relatedIssue` is null even when the
  approval is linked to one, so the Inbox reads `GET /api/approvals/:id/issues` per approval.
- **The nav's Inbox badge counts something else.** `GET /companies/:id/sidebar-badges` adds up
  approvals, failed runs, join requests and unread Mine tasks, with `approval:<id>`-style dismissal
  keys, while feed dismissals use `attention:…` keys. Clearing an approval in the Inbox doesn't lower
  the badge. The feed's own `deskBadgeCount` matches Needs you; switching the nav to it means reading
  the feed in the nav. **Decided 2026-10-27:** the badge counts what's waiting on you, matching Needs
  you (the feed's count), not `sidebar-badges`. Built: the count is what Needs you lists (active, not
  cleared or snoozed, not alerts). The feed's `deskBadgeCount` measures something else (items that
  arrived or are due today, alerts and snoozed included), so the nav reads the whole feed on every
  page. `sidebar-badges` is no longer shown anywhere but is still invalidated in places.
- **Stalled reviews have no inline action yet.** `POST /issues/:id/stalled-review-decision` exists
  but isn't ported; stalled reviews open the task.
- **Sign-offs act through the task's status.** The current reviewer approves with `done` and a
  comment, or sends back with another status and a comment (`issue-execution-policy.ts`); there's no
  separate review endpoint. The Inbox draws sign-offs with its own card until the request model
  gains a review-stage source.

### 25. Gaps found building the project dashboard and Docs

- **Status:** Open
- **Area:** `projects/*`, `documents-artifacts/library`
- **Found in:** the project dashboard, Docs tab and New project (M4, boards 8, 9, N1).

- **The artifacts list leaves out what people wrote.** `GET /api/companies/:id/artifacts` lists only
  documents an agent created or updated and attachments an agent uploaded
  (`server/src/services/company-artifacts.ts`). A project's Docs tab misses documents its people
  wrote. Possible upstream proposal.
- **Grouped artifacts are thin.** Groups carry no task status or assignee (joined from the project's
  task list) and three previews; a larger group costs one more request; 100 groups a page.
- **No daily spend per project.** `costs/by-project` gives totals for a range, so the budget block
  has no daily bars; the pace is estimated from the month's total.
- **Waiting on you is filtered in the browser.** The attention feed has no project filter, so the
  dashboard reads the Inbox's feed (one shared cache) and keeps the project's items, then loads each
  task's interactions and approvals. Approvals not linked to a task don't show.
- **New project:** the lead can only be an agent (`leadAgentId`), the repository list has no branch,
  and board N1's chart icon isn't an allowed project icon.
- **Phone links that assume a project's base URL is its task list:** the phone switcher
  (`TasksSheet.tsx`) and the dock's task-list detection (`dock-model.ts`) still treat any
  `/projects/:key/...` path as a task list. To fix in the follow-up slice.

### 26. Gaps found building project settings

- **Status:** Open
- **Area:** `projects/*`, `workspaces/*`, `goals/*`
- **Found in:** project settings (M4, boards 10 and 11).

- **Clearing a project's variables with `null` fails.** `PATCH /api/projects/:id` with
  `{ env: null }` answers 422 "env must be an object", although the schema allows null: the route
  passes anything but `undefined` to `normalizeEnvConfig` (`server/src/routes/projects.ts`,
  `services/secrets.ts`). The old UI sends null too. `ui-new` sends `{}`. Upstream fix candidate 7.
- **A rename changes the project's URL key**, so `GET /projects/:oldKey` fails afterwards; the page
  follows the project by id.
- **The project list leaves archived projects out** unless asked (`includeArchived=true`); the page
  reads an archived project on its own.
- **`executionWorkspacePolicy.environmentId` only applies to isolated checkouts**: where a run
  executes is decided from the task, agent, instance and default. The environment picker sits in
  Task checkouts for that reason.
- **No endpoints** for board 10's member roles, the shared-checkout count it draws, or runtime
  services that are configured but never started.

### 27. Gaps found building recurring tasks

- **Status:** Open
- **Area:** `routines/*`
- **Found in:** recurring tasks (M4, boards R1–R4, N4–N7).

- **A schedule needs defaults.** `POST /routines/:id/triggers` answers 422 "Scheduled routines
  require defaults for required variables" while a placeholder has no default, so New task asks for
  them and the panel warns before adding a schedule.
- **No atomic create.** A recurring task and its triggers take several requests, and creating a
  routine takes no idempotency key; a failed trigger leaves the recurring task without it (a
  warning toast says so).
- **No delete.** Routines can only be archived.
- **One input per placeholder.** The server derives inputs from the description, so an input is
  added by writing a placeholder.

### 28. Gaps found building agent workload

- **Status:** Open
- **Area:** `projects/task-context`, `agents/roster`
- **Found in:** agent workload (M4, boards 31–33): the project's Agent workload tab and the company
  page at `/:prefix/workload`. There's no workload API; both are worked out from run history, live
  runs and task assignments (`ui-new/src/workload/`).

- **Run history has no date range or project filter.**
  `GET /companies/:id/heartbeat-runs?summary=true&limit=1000` returns only the latest 1000 runs, so a
  busy company's 30-day view is cut short. The view marks the days it couldn't load and says so.
- **No issue status history.** Past blocked time can't be known, so the heatmap has no blocked
  cells and no "Most time blocked" marker. Today's blocked stretch is approximate: it starts at the
  task's last update, or after the agent's last run today.
- **Cost has no time or per-project breakdown per agent.** Spend comes from each run's `costUsd`
  and is hidden when no run reported one, as with subscription runs.
- **No teams.** The company view groups agents by role (Leadership, Product, Research, Engineering,
  General), with built-in agents last.
- **No estimates or suggestions in the API.** "About 2h left at this pace" is left out, and the
  "1 suggestion" pill (the oldest urgent unassigned task for the free agent with the least open
  work) is worked out in the UI.
- **Only heartbeat schedules are drawn** as scheduled bars; routine schedules aren't.
- **Built-in agents** (`GET /companies/:id/built-in-agents`) answer 404 while `enableBuiltInAgents`
  is off, so the request is only made when it's on.

