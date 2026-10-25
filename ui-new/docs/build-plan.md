# ui-new build plan

Oct 24, 2026 · built against upstream `5c3dce09b5` ([sync 2026-10-24](../../fork/sync-reports/2026-10-24.md))

How the redesign gets built, and in what order. It sorts every idea in
[paperclip-redesign-ideas.md](paperclip-redesign-ideas.md) into three stages and lays out stage 1 as
milestones.

How it fits with the other redesign docs:

| Doc | Answers |
| --- | --- |
| [inventory/capabilities.md](inventory/capabilities.md) | What the old UI does, and where each capability lands. The checklist each milestone closes rows in. |
| [design/boards.md](design/boards.md), [design/design-system.md](design/design-system.md) | What the new UI looks like. |
| [decisions.md](decisions.md) | Gaps between the design and the API, and what was decided. |
| [proposals/unifying-requests.md](proposals/unifying-requests.md) | The requests model for questions, decisions and approvals. |
| This plan | The order of the work, and which ideas need more than the UI. |

## The three stages

| Stage | What it covers | Where the work happens | Conflict with upstream |
| --- | --- | --- | --- |
| **1. New UI only** | The approved boards, built on the API as it is. Every existing capability ported or dropped on purpose. | `ui-new/` on `new-ui`, plus `deploy/` | None |
| **2. Small upstream changes** | Fixes, docs and small features that any Paperclip user would benefit from. | `fix/*` and `docs/*` branches off `master`, sent to `paperclipai/paperclip` | None. They return through the normal sync. |
| **3. Experimental features** | New data or new agent behaviour the API doesn't have. | A fork plugin (`packages/plugins/fork-*`), a fork skill, and fork patches only where unavoidable. Each feature on its own `exp/<name>` branch. | Low for plugins and skills. Higher for patches. |

How an idea is sorted:

- If the API already stores it, it's stage 1, even when the old UI never shows it that way.
- If it's a small fix or feature upstream would plausibly accept, it's stage 2.
- If it needs new storage, or changes what agents do, it's stage 3, built as a plugin first.

Several ideas split across stages: the part the API covers ships in stage 1, and the rest waits.

Stage 1 is the priority. Stage 2 pull requests can go out whenever one is ready, because they don't touch
the fork. Stage 3 starts once stage 1 works well, except the fork skill (3.10), which is cheap and can
start earlier.

## Your ideas, sorted

Each line from [paperclip-redesign-ideas.md](paperclip-redesign-ideas.md), with its stage and how
it gets built. Stage numbers like 2a-6 and 3.4 refer to the lists further down.

### Tasks

| Idea | Stage | How |
| --- | --- | --- |
| A fuller, more interactive Tasks page, like ClickUp | 1 | Boards 1 and 4, with inline edits, multi-select, drag between groups, quick add, keyboard navigation and saved views. All of it is `PATCH /api/issues/:id` and the list endpoints ([M2](#m2-tasks)). |
| "Tags" for categorizing tasks | 1 | Labels already exist: company-wide, colored, filterable (`GET\|POST /api/companies/:companyId/labels`). The boards draw them as outline pills. |
| Custom fields and columns | 3 | No field storage exists. A plugin side table keyed by task ([3.2](#32-custom-fields)). |
| Custom status text | 3 | Statuses are a fixed list (`ISSUE_STATUSES`). Agents, review stages and the inbox all depend on it, so each custom status maps onto one of the seven ([3.1](#31-custom-statuses-and-status-rules)). |
| Statuses that trigger review or approval | 1, then 3 | Review stages already do this: moving a task to `in_review` or `done` starts its configured review, then approval. Stage 1 shows that as a rule on the task ("When it's done, Sam reviews, then Alex approves"). Rules on other statuses are 3.1. |
| AI tags `@user` in comments to say who it's waiting on | 1, then 3 | Stage 1 shows what a task waits on (`reviewAttention`, stage participants, requests addressed to a person). Getting agents to do this consistently is agent guidance, which goes in the fork skill ([3.10](#310-core-skill-add-on)). |
| Multiple lists ("sprints") per project | 1 | Each list is one of the project's goals (decision C). Tasks already carry a `goalId`, and projects link goals (`goalIds`), so it needs no new storage. Named lists for now; sprint dates and capacity are [3.3](#33-sprints), for later. |
| Project dashboard showing every sprint | 1 | Board 8 gains a lists section. |
| Goals assigned to lists: one list per sprint per goal | 1 | The same mapping: the goal *is* the list. |
| Mention another task in a comment | 1 (exists) | Mentions already become related work on both tasks (`IssueRelatedWorkItem`, with mention counts and sources). The thread renders them as task links. |
| ClickUp-style relationships and dependencies | 1, then 2b or 3 | Blockers exist (`blockedByIssueIds`, the only relation type is `blocks`). Other relation types, like "relates to" or "duplicates", are new: [2b-13](#2b-small-features-ask-upstream-first). |
| Assigned comments, like ClickUp | 3 | No comment assignment exists ([3.8](#38-assigned-comments-and-review-assignments)). |
| Review stages through assigned comments | 3 | Same feature as above. Stage 1 keeps the existing stage editor (requests proposal item 13). |
| Ticket prefix per project | 2b, otherwise 3 | Identifiers come from the company's `issuePrefix` and are generated by the server. A per-project prefix needs a server change ([2b-9](#2b-small-features-ask-upstream-first)). |

### Agents, chats and runs

| Idea | Stage | How |
| --- | --- | --- |
| Clicking an agent opens one endless chat | 1 | Board 12, on `GET\|POST /api/companies/:companyId/chats/:agentRef`. The server only serves chat with `enableAgentChat` on ([decision 2](decisions.md#2-agent-chat-is-off-unless-the-instance-turns-it-on)). |
| The chat shows runs in progress, or is ready for input | 1 | Board 12's states (busy, replying, idle) and its activity timeline ([decision 3](decisions.md#3-agents-can-work-on-several-things-at-once)). |
| Tasks separated from agent chats and runs | 1, optionally 3 | Underneath, each chat is a hidden task, and the server already keeps it out of task lists ([decision 8](decisions.md#8-agent-chats-are-tasks-underneath)). Stage 1 builds on that: the chat is drawn as a conversation, never a task page, and work it hands off shows as linked tasks. A chat that runs outside tasks entirely is an optional exploration ([3.12](#312-chat-outside-tasks-optional)). |
| A task's progress as short notes in the right sidebar | 1 | Board 3, from `GET /api/issues/:issueId/activity`, comments and runs. |
| "Go to" the run, then interrupt, add context or start over | 1 | The run modal (boards 16–18) with steer, queue and interrupt (`/queued-comments/*`, `POST /api/heartbeat-runs/:runId/cancel`). "New session" is the chat's `/new`, or `POST /api/agents/:id/runtime-state/reset-session`. |
| Task runs open as separate windows, to talk to the agent about that run | 1 | Same run modal. A message sent from it is queued or steered into that task's run. |
| Paperclip Runner visibility | 1, then 3 | Stage 1 shows what the API has: runtime state, task sessions (`GET /api/agents/:id/task-sessions`, unused by the old UI), run events, workspace operations, runner goal and provider traces. Data the Runner keeps only on disk is [3.11](#311-runner-visibility-beyond-the-api) ([question 6](#questions-for-you)). |

### Memory

| Idea | Stage | How |
| --- | --- | --- |
| Memory files visible per agent in its settings | 1 | A Memory section reading `MEMORY.md`, `memory/` and `life/` from the agent's files (`GET /api/agents/:id/instructions-bundle`), plus the agent's memory connections ([decision 5](decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other), option 4). |
| Every run sees the same per-agent memory | Deploy setting now, then 2a | Now: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `deploy/docker-compose.yml`, a fork-only file, which reaches `claude_local` runs. Paperclip Runner agents don't inherit the server's variables, so they need it in their adapter `env` (decision 5, option 1). Later: the upstream fix ([2a-6](#2a-fixes-and-docs-send-when-ready)). Claude Managed agents keep no memory between sessions unless they have a memory connector, or [3.5](#35-memory-service). |
| Clean up memory across harnesses; maybe Postgres or a memory MCP server | 3 | A memory plugin with its own schema and agent tools ([3.5](#35-memory-service)). |

### Projects, goals, docs and artifacts

| Idea | Stage | How |
| --- | --- | --- |
| Goals as part of a project, with no Goals page | 1 | The project header shows its goals (board 8 already links one), edited in project settings. `goals/hierarchy` and `goals/detail` move there. |
| Project description and goals sent with every run | 1 (exists) | Agents read `GET /api/issues/:id/heartbeat-context`, which returns the task's project and goal. Check exactly which fields it includes during M4. If the description is missing, that's a small stage 2 change. |
| Documents attached to a whole project | 1 for now, then 2b, or 3 if declined | [Decision 1](decisions.md#1-projects-cant-hold-documents-or-files). M4 builds "From tasks". Project documents are proposed upstream ([2b-8](#2b-small-features-ask-upstream-first)), and the project section waits for them, with the plugin ([3.4](#34-project-knowledge-base)) as the fallback. No hidden docs task as a stopgap. |
| Project docs listed in the run prompt, with short descriptions | 3, or 2b | Plugins can't add to the core prompt. The fork skill can tell agents to call a plugin tool for them ([3.4](#34-project-knowledge-base)). If upstream adds project documents, it could return them in `heartbeat-context` instead. |
| Docs that point to files in a repo | 1 for tasks, 3 for projects | Tasks already support this: work products with `metadata.resourceRef.kind: "workspace_file"`, and `/api/issues/:issueId/file-resources/*`. Project-level references are part of 3.4. |
| Agent-made and uploaded docs look the same | 1 | One tile and row component for documents, attachments and work products (boards 5 and 9). Upstream's new Artifacts V1 (`enableArtifactsV1`) takes the same direction and is worth comparing. |
| A built-in markdown editor | 1 for tasks | Task documents already have revisions, locks and annotations. Project-level documents wait on decision 1. |

### Routines, decisions and governance

| Idea | Stage | How |
| --- | --- | --- |
| Routines become tasks marked "recurring", with no Routines page | 1 | The new-task dialog gains Repeat. Saving a recurring task creates a routine and a schedule trigger (`POST /api/companies/:companyId/routines`, `POST /api/routines/:id/triggers`). Each occurrence is an ordinary task, and since the 2026-10-24 sync those link back to their routine. A "Recurring" view of the task list replaces the Routines page ([question 4](#questions-for-you)). |
| No separate Decisions page | 1 | The Inbox (board 14) and the requests model ([proposal](proposals/unifying-requests.md)). |
| Drop the CEO strategy approval | 1, then 2a | Stage 1 shows `approve_ceo_strategy` as an ordinary formal approval. The skill still tells CEOs to ask for one; [2a-3](#2a-fixes-and-docs-send-when-ready) rewords or questions that. |
| Governance formalized in a general way | 1 | The requests model: shape, outcome, audience, subject. Merging storage is left to upstream (see the proposal's "Left to upstream"). |

### New ideas

| Idea | Stage | How |
| --- | --- | --- |
| Voting | Tabled | Set aside, and may be dropped ([3.6](#36-voting)). |
| Group announcement channels | 3 | [3.7](#37-announcement-channels). The old UI's Board chat is a concierge for running the company, not this. |
| Meetings: scheduled work sessions with an agent | 3, partly 1 | [3.9](#39-meetings). Each meeting is its own conversation, with an agenda before, notes after and the agreed actions as tasks. A routine's schedule trigger already starts work for an agent at a set time. |
| A "fast mode" for meetings | 2b | Codex agents already have a `fastMode` setting (`codex_local`). `claude_local` has none ([2b-11](#2b-small-features-ask-upstream-first)). A fast model or low effort per message works today. |
| A core skill add-on for new behaviour | 3 | [3.10](#310-core-skill-add-on). Fork-owned, with no conflict. |

## Stage 1: the new UI

### How it's built

- **Framework.** SolidJS with `@solidjs/router`, as scaffolded.
- **Data.** `@tanstack/solid-query`. The old UI uses `@tanstack/react-query` with central keys
  (`ui/src/lib/queryKeys.ts`) and invalidates them from the live-events socket. The same model ports
  almost one to one, and makes `LiveUpdatesProvider` straightforward to mirror.
- **API modules.** `ui-new/src/api/<area>.ts` mirroring `ui/src/api/`, with types imported from
  `@paperclipai/shared` using `import type`. Port each module when its first screen needs it.
- **URLs.** Keep the old UI's shapes (`/:companyPrefix/issues/:id`, `/:companyPrefix/agents/:id`,
  `/:companyPrefix/projects/:key`). Agents, Slack messages and emails link to these (the skill documents
  them), so they must keep working, as pages or redirects.
- **Styling.** Copy [design/tokens.css](design/tokens.css) in as is. Use plain CSS per component,
  drawing on the tokens and the boards' class structure. Dark is the default, light is supported.
- **Primitives.** Kobalte (`@kobalte/core`) for menus, popovers, dialogs, tooltips, listboxes and
  switches. It provides the ARIA patterns the design system lists. Icons from `lucide-solid`, the Solid
  twin of the old UI's `lucide-react`.
- **Avatars.** ClipLab (`packages/shared/src/cliplab`) has no framework code, and `@paperclipai/shared`
  exports deep paths (`./*`). So `ui-new` can import it at runtime, as an exception to the `import type`
  rule. Record it in [decisions.md](decisions.md) when it's adopted.
- **Tests.** Vitest and `@solidjs/testing-library` for view models (the requests model, list grouping,
  override payloads) and key components. A Playwright smoke run against a dev server from M2 on.
  `typecheck` stays part of every sync.
- **Tracking.** As each screen lands, fill in **Status** in [capabilities.md](inventory/capabilities.md)
  (`partial`, `done`, or `dropped` with the reason). Record new API gaps in [decisions.md](decisions.md).

### Decisions to make early

| # | Decision | Needed by | Recommendation |
| --- | --- | --- | --- |
| A | Agent chat flag ([decision 2](decisions.md#2-agent-chat-is-off-unless-the-instance-turns-it-on)) | M5 | Turn `enableAgentChat` on as part of every `ui-new` deployment (option 1). Fall back to agent settings if it's off (option 2). |
| B | Task panel or modal ([design open question](design/README.md#open-questions)) | M2 | Panel when opened from a list or board (boards 2, 3, 5). Modal when opened from anywhere without a list: Inbox, chat, dashboards (boards 6, 7). Full page for direct links. |
| C | Lists as goals | M4 | Decided: a project's lists are its goals, as named lists without dates for now ([question 2](#questions-for-you)). |
| D | Project-level docs ([decision 1](decisions.md#1-projects-cant-hold-documents-or-files)) | M4 | Decided: build "From tasks", and start the 2b-8 conversation upstream. The project section waits for project documents, with the plugin (3.4) if upstream declines. No hidden docs task. |
| E | Each experimental flag | M0 | Settle every flag in [generated/flags.md](inventory/generated/flags.md) as permanent, dropped, or a plain setting where the server still enforces it. Record the results in a new decisions entry. |
| F | Cases | M6 | Drop for now: they're experimental and read-only on the board. Mark `cases/*` dropped with that reason, and revisit if upstream builds them out. |
| G | Hosting plugin UI ([FORK.md](../../FORK.md#a-standalone-app-not-a-plugin)) | M7 | Mount points for sidebar, project tabs, agent tabs, settings pages and full pages, with React loaded only for plugin areas. |

The board set already settles one of the requests proposal's open questions: alerts get their own
Inbox tab (board 14 has Needs you, Updates, Alerts, Snoozed and Cleared).

### Milestones

Tasks come first because everything else embeds their pieces: the thread, request cards, the run
modal and the new-task dialog.

#### M0: Foundations

- Tokens, fonts (Hanken Grotesk, Fragment Mono), grain, theme switching.
- Router with the company prefix, session check (`GET /api/auth/get-session`), sign-in redirect,
  company list and selection.
- API client modules, the query layer, and the live-events socket with reconnects and invalidation.
- Shared components: buttons, pills, status capsules, priority bars, label pills, fields, switch,
  segmented control, menu, popover, tooltip, dialog, avatar (ClipLab and initials disc).
- A `/style-guide` route, ported from [style-guide.html](design/style-guide.html), for checking
  components in both themes.

Done when the style guide renders in both themes and a signed-in user sees their companies.

#### M1: Shell

- Left nav: company switcher, search and new-task buttons, Org dashboard, Inbox with its badge, projects
  with counts, agents with live state, you and settings.
- Page header card with tabs, and the section rail settings use.
- New-task dialog (board 7b), with [decisions 6 and 7](decisions.md#6-tasks-have-no-due-date).
- Command palette, keyboard shortcuts with their cheatsheet, toasts following the old UI's rules
  (`doc/TOASTS.md`).

Covers `shell/*` except plugins. Done when you can move around the app and create a task.

#### M2: Tasks

- Task list (board 1) and board view (board 4), company-wide and per project.
- The ClickUp-style interactions:
  - inline edits of status, priority, assignee and labels;
  - multi-select with bulk changes;
  - dragging between groups and columns;
  - quick add in a group;
  - subtasks expanded inline;
  - group by status, assignee, priority, label, list (goal) or parent;
  - filters, saved views and keyboard navigation.
  Saved views use local storage until stage 3 adds a plugin.
- Task panel and modal: Details, Activity and Docs and files (boards 2, 3, 5, 6, 7), including
  subtasks, blockers, workspace, privacy, tree control and the header actions.
- Thread and composer: comments, mentions, attachments, work modes, queued messages, steer and
  interrupt, request cards (board 15) for task interactions.
- Run modal: transcript, what the agent was sent, raw output, provider trace (boards 16–18,
  [decision 4](decisions.md#4-a-runs-full-model-input-only-exists-when-provider-tracing-is-on)).
- Task documents with the editor: revisions, locks, annotations.
- Recovery and interruption state with Retry, and the project access notice from the 2026-10-24 sync.

Covers `tasks/*`, `steering/*`, `task-coordination/*`, `documents-artifacts/documents`,
`documents-artifacts/attachments`, `runs-adapters/runs`. Done when a task can go from created to done
in `ui-new` alone, including answering an agent's question and watching its run.

#### M3: Inbox and requests

- Inbox (board 14): Needs you, Updates, Alerts, Snoozed, Cleared, with kind filters and keyboard
  triage.
- The requests view model from the attention feed, per the [proposal](proposals/unifying-requests.md):
  - questions and suggested tasks;
  - proposals with a change preview and per-effect results;
  - formal approvals with discussion and revisions;
  - budget resolution instead of approve and reject;
  - tool reviews and secret requests.
  Questions and suggested tasks can be dismissed back to history (since the 2026-10-24 sync).
- Review stages shown as sign-off requests, with where the task returns.
- Live refresh on `decision.*`, `approval.*`, `issue.thread_interaction_*` and `issue.updated`.
- Port or drop queues, triage and the aging shelf (proposal item 14). Port the audience settings
  (item 15) in M6.

Covers `inbox-search/triage`, `decisions/*`, `approvals/*`, `tasks/approvals`, `tasks/interactions`.

#### M4: Projects

- Project dashboard (board 8): brief, budget, code, agents at work, waiting on you, stuck work. Plus a
  lists section: the project's goals, each with its tasks.
- Docs (board 9): "From tasks" on `GET /api/companies/:companyId/artifacts?projectId=&groupBy=task`.
  The project section waits for project documents (decision D).
- Agent workload (boards 31, 32), built from runs, live runs and assignments.
- Settings (boards 10, 11): details, members, repositories, workspaces, task checkouts, environment,
  variables, budget, archive, and goals.
- Goals folded into projects, and shown as the project's lists (decision C).
- Recurring tasks replace Routines: Repeat in the new-task dialog, a Recurring view, and every routine
  setting (triggers, variables, delivery policy, run history) in the recurring task's panel. Each
  occurrence is a new task, grouped under its recurring task.
- New project.
- Check what `heartbeat-context` returns for the project and goal, and open a 2a item if the
  description is missing.

Covers `projects/*`, `workspaces/*`, `goals/*`, `routines/*`, `documents-artifacts/library`.

#### M5: Agents and the organization

- Agent chat (boards 12, 13), with decision A, built on the hidden chat tasks
  ([decision 8](decisions.md#8-agent-chats-are-tasks-underneath)):
  - the chat is its own view, never the task page;
  - tasks handed off from the chat show as linked cards, and their results arrive as replies;
  - the reply streams in from the run's live output (`heartbeat.run.log`), if that turns out fast
    enough;
  - search shows a chat as a chat, not as a task.

  Note how responsive it feels in use: that decides whether [3.12](#312-chat-outside-tasks-optional)
  is worth exploring.
- Org dashboard (board 19), Manage agents (board 20) including upstream's new bulk edit of connections
  and models, and company workload (board 33).
- Agent settings (boards 26, 27, and the board 30 outline): profile, instructions, skills, model and
  runtime, tools and channels, secrets, budget, permissions and project access, API keys, history.
- Memory section (decision 5, option 4). It says which memory applies to the agent's harness: files
  for `claude_local` and the Paperclip Runner, and none for Claude Managed unless the agent has a
  memory connector.
- Runner information: runtime state, session history from task sessions, Runner qualification, the
  upgrade offer, and usage and cost from runs and the costs API (`/api/companies/:companyId/costs/*`).
  List what's still missing for [3.11](#311-runner-visibility-beyond-the-api).
- New agent (hire flow).

Covers `agents/*`, `agent-chat/*`.

#### M6: Settings and everything else

Tier 2, ported mostly as is into the new layout:

- Company settings (boards 21–25), including environments, import and export, and the audience
  settings.
- App settings (boards 28, 29, and the board 30 outline).
- Skills, Apps and tools, Activity and costs.
- Onboarding, and the sign-in and connect pages outside a company.

These are large areas: Apps and tools alone reaches about 60 requests per page. Plan a few iterations.

#### M7: Ready to replace the old UI

- Plugin hosting (decision G).
- Parity audit: every row in [capabilities.md](inventory/capabilities.md) is `done` or `dropped` with
  a reason.
- A responsive pass (boards are 1440px only), and an accessibility pass against the design system's
  patterns.
- Deploy with [deploy/](../../deploy/README.md), run it beside the old UI for a while, then switch.

After M7, stage 3 work starts in earnest.

## Stage 2: small upstream contributions

Each is one change on its own `fix/*` or `docs/*` branch off `master`, following upstream's
`CONTRIBUTING.md` and PR template ([FORK.md](../../FORK.md#contributing-fixes-upstream)). None is
carried as a fork patch, and none is merged into `new-ui`. Search upstream for duplicates before
starting each one.

### 2a. Fixes and docs (send when ready)

Bug fixes and docs don't need agreement first.

| # | Change | Kind | Source |
| --- | --- | --- | --- |
| 1 | Refuse approve and reject on budget-override approvals | Fix | [Requests proposal](proposals/unifying-requests.md#small-upstream-contributions), item 1 |
| 2 | Document how an agent reads a Decision's outcome | Docs | Same, item 2 |
| 3 | Stop the skill promising an unenforced CEO-strategy gate (or open an issue) | Docs | Same, item 3. Goes with dropping strategy approval. |
| 4 | Log participant changes for every review stage (optional) | Fix | Same, item 4 |
| 5 | Report the review-stage bypass, with failing tests | Bug report | Same, item 5 |
| 6 | Turn off Claude Code's auto memory when an agent has `para-memory-files` | Fix | [Decision 5](decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other), option 3 (revives #2700, using the environment variable) |
| 7 | Make `scripts/link-plugin-dev-sdk.mjs` work on Windows without symlink rights, using a directory junction | Fix | Found in the [2026-10-24 sync](../../fork/sync-reports/2026-10-24.md): `pnpm install` fails with `EPERM` unless Developer Mode is on |

### 2b. Small features (ask upstream first)

`CONTRIBUTING.md` asks for agreement in upstream's Discord `#dev` channel before feature code is written.
Each of these starts as a short message there. If upstream declines, the idea moves to stage 3 or is
dropped.

| # | Change | Why |
| --- | --- | --- |
| 8 | Documents and attachments on projects, returned in `heartbeat-context` | Decision 1, and your project knowledge idea. Cases already have documents, so the pattern exists. |
| 9 | A ticket prefix per project | Your notes. Touches identifier generation, so expect discussion. |
| 10 | A per-run request summary: prompt and tool-definition sizes, message count, tokens per call | [Decision 4](decisions.md#4-a-runs-full-model-input-only-exists-when-provider-tracing-is-on), option 3. Lets the run modal explain context size without tracing. |
| 11 | A fast-mode option for `claude_local`, matching Codex's `fastMode` | Meetings |
| 12 | Due dates on tasks | Only if you want them back ([decision 6](decisions.md#6-tasks-have-no-due-date)) |
| 13 | More relation types ("relates to", "duplicates") | Only if mentions and blockers prove too little |

## Stage 3: experimental features

### How they're built

- **Plugin first.** One fork plugin, `packages/plugins/fork-paperclip`, can hold all of these. Plugins
  get their own Postgres schema and migrations, JSON routes under `/api/plugins/:pluginId/api/*` (which
  `ui-new` calls like any other API), agent tools, scheduled jobs, event subscriptions, and read access
  to allowed core tables. Plugins never conflict with upstream.
- **A fork skill to steer agents.** Plugins can't add to the core prompt. The skill in [3.10](#310-core-skill-add-on)
  tells agents when to use the plugin's tools: read project docs, save memory, read announcements.
  Plugin plus skill covers most of stage 3 without touching upstream code.
- **Patches only when unavoidable.** Ask first, then follow
  [FORK.md](../../FORK.md#changing-server-database-and-packages): a hook in new files over edits to
  upstream logic, with a `FORK:` marker and a FORK-PATCHES.md entry. Never a migration in upstream's
  numbered sequence.
- **One branch per feature.** `exp/<name>` off `new-ui`, merged back once it's stable. Add the branch
  type to FORK.md's branch table when the first one starts.
- **Known limits.** The plugin worker can't read the attention feed, Decisions, budgets or runs
  (FORK.md). Features that need those combine data in `ui-new` instead.

### 3.1 Custom statuses and status rules

- **Have:** seven fixed statuses. Review and approval stages start on `in_review` and `done`.
- **Missing:** your own status names, and rules on other statuses.
- **Approach:** decided ([question 3](#questions-for-you)): keep the seven as the underlying state,
  and let a project define display statuses that each map onto one of them ("QA" maps to `in_review`,
  "Waiting on client" to `blocked`). The plugin stores the mapping and each task's display status, and
  agents and review stages keep working unchanged. Rules ("moving to QA asks Sam to sign off") become
  plugin event handlers that set up review stages through the API. Fully custom workflows, which would
  mean changing upstream's status enum, are out of scope.
- **Risk:** low as a plugin.

### 3.2 Custom fields

- **Have:** labels, priority, project, goal, billing code.
- **Missing:** typed fields per project (text, number, select, date, person) shown as list columns.
- **Approach:** plugin tables for field definitions per project and values per task, plus agent tools
  to read and set fields. `ui-new` merges the values into lists, filters and grouping.
- **Risk:** low. Filtering and sorting on server-side lists can't use plugin fields, so `ui-new` filters
  what it has loaded, or the plugin returns matching task IDs.

### 3.3 Sprints

Later. Named lists cover sprints for now ([question 2](#questions-for-you)); this entry is for when
dates start to matter.

- **Have:** lists are goals (decision C): status, description, parent, and a link to projects.
- **Missing:** start and end dates, capacity, rollover of unfinished tasks, burndown.
- **Approach:** plugin data attached to a goal (dates, capacity), plus a scheduled job that rolls over
  unfinished tasks at the end. The dashboard shows a burndown from task activity.
- **Risk:** low.

### 3.4 Project knowledge base

- **Have:** task documents and files, project descriptions, workspace file references on tasks.
- **Missing:** documents and files owned by a project, references to repo files, and getting them to
  every run with a short description of each.
- **Approach:** prefer upstream (2b-8). If declined: plugin storage for project docs and references,
  an agent tool that returns the project's document index, and the fork skill telling agents to call it
  at the start of each task.
- **Risk:** low as a plugin. Duplicates upstream's model if upstream adds it later, so ask first.

### 3.5 Memory service

- **Have:** three memory systems that don't coordinate (decision 5). Your agents run on
  `claude_local`, the Paperclip Runner and Claude Managed ([question 9](#questions-for-you)). Claude
  Managed agents have no agent folder, so file memory can't work for them at all.
- **Missing:** one memory store per agent, the same for every harness, that people can read and edit.
- **Approach:** after the 2a-6 fix, a plugin with a memory schema in Postgres (per agent, optionally per
  project), agent tools to search and save, and a Memory section in agent settings to review and
  correct entries. The fork skill takes over from `para-memory-files` for agents that opt in. A memory
  MCP server is the same idea for harnesses that only speak MCP. Check first that plugin tools reach
  Claude Managed agents, since they're the ones with no memory today. Until then, a memory connector
  (`enableMemoryConnectors`) is their only option, which makes that flag's decision (E) matter more.
- **Risk:** medium. It competes with upstream's memory connectors and its unbuilt memory-service plan,
  so check upstream's direction before building.

### 3.6 Voting

Tabled Oct 24, 2026, and may be dropped. The sketch below is kept as a record, not as planned work.

- **Have:** Decisions (people only), and cards that only one actor answers.
- **Missing:** a proposal many agents vote on, with options, abstentions, questions and amendments.
- **Approach:** plugin tables for proposals, options and ballots. Agent tools to propose, vote, ask or
  amend. The plugin wakes the agents involved by commenting on the task with mentions, and closes the
  vote on quorum or a deadline. `ui-new` shows the vote as a request card and on the task.
- **Risk:** low.

### 3.7 Announcement channels

- **Have:** comments on tasks, chats with single agents, Slack and other chat connectors.
- **Missing:** one message to many agents that each records or acts on.
- **Approach:** plugin channels with members (all agents, or some), and an agent tool to read unseen
  announcements. The fork skill tells agents to check at the start of each run. Announcements reach
  agents on their next run and don't wake them ([question 10](#questions-for-you)), so they add no runs
  or cost.
- **Risk:** low.

### 3.8 Assigned comments and review assignments

- **Have:** mentions, review stages, requests addressed to a named person or agent.
- **Missing:** a comment assigned to someone, which stays open until they resolve it.
- **Approach:** plugin records that mark a comment as assigned, with resolve and reopen, shown in the
  assignee's Inbox. Later, a review stage could be driven by assigned comments. Check first whether a
  person can already create a request addressed to an agent through the API, because that may cover
  most of it.
- **Risk:** low as a plugin. Driving stages from it touches upstream's busiest code, so leave that until
  upstream's review-stage work lands.

### 3.9 Meetings

- **Have:** routines with schedule triggers, ordinary tasks with threads and documents, task-less
  plugin sessions (3.12), fast responses (`enableFastResponses`), Codex fast mode.
- **Missing:** a calendar of meetings, the timing around each one, and a view that presents a meeting
  as a conversation.
- **What a meeting is** ([question 8](#questions-for-you)):
  - Its own conversation, not the agent's standing chat.
  - The agent prepares an agenda beforehand.
  - Afterwards, the agent writes notes, and the agreed actions become ordinary tasks linked from the
    notes.
- **Approach:** a meeting can't be a second built-in chat, because the server allows one chat per
  person and agent (decision 8). Two ways to build it:
  - **A task per meeting.** A routine creates the meeting task, assigned to the agent, far enough
    ahead for the agent to prepare the agenda as the task's plan document. At the time, you talk in
    the task's thread, which `ui-new` draws as a conversation. Afterwards, the agent saves notes as a
    document and creates the action tasks. This is mostly existing pieces. The plugin adds the
    calendar, one-off meetings, and the reminder when a meeting starts.
  - **A plugin session.** Built on `ctx.agents.sessions`, as in 3.12, with the plugin storing the
    conversation. Closer to a natural chat, but it uses fewer built-in pieces.

  Speed comes from a fast model or effort per message today, and 2b-11 for Claude.
- **Risk:** low.

### 3.10 Core skill add-on

- **Have:** upstream's `paperclip` skill, and a company skill library that can import skills.
- **Missing:** fork guidance: say who the agent is waiting on with an `@user` mention, use the plugin's
  tools, follow fork conventions.
- **Approach:** a fork-owned skill (for example `skills/paperclip-fork/SKILL.md` in a fork-only folder)
  imported into the company library and assigned alongside `paperclip`, never replacing it. Grows with
  each stage 3 feature.
- **Risk:** none. It can start during stage 1, once the first convention is worth teaching.

### 3.11 Runner visibility beyond the API

- **Wanted** ([question 6](#questions-for-you)): session history, sandbox state, the Runner's own
  logs, and costs and usage.
- **Have:** what M5 shows from the API: runtime state, task sessions, run events and transcripts,
  workspace operations, runner goal, provider traces, and usage and cost from runs and the costs API.
  That likely covers session history and costs.
- **Missing:** sandbox state and the Runner's own logs, and whatever else the Runner keeps only on
  disk (ACP state, for example).
- **Approach:** M5 lists exactly what's still missing. Then propose exposing it upstream (2b), since
  plugins can't read runs.

### 3.12 Chat outside tasks (optional)

An exploration you may or may not take up. The stage 1 chat, built on hidden tasks, may turn out to
work fine, in which case this is dropped.

- **Have:**
  - Chats stored as hidden tasks ([decision 8](decisions.md#8-agent-chats-are-tasks-underneath)).
    Each message wakes the agent through the run queue, the adapter starts, and the reply arrives as
    a comment. `enableFastResponses` adds a quick acknowledgement first.
  - Task-less agent sessions for plugins. `ctx.agents.sessions` in the plugin SDK creates a session
    with an agent, sends it messages and streams back the run's output as it's written
    (`server/src/services/plugin-host-services.ts`). The agent's own session carries over between
    messages, and no task is created. `ctx.streams` forwards events to the UI over server-sent events
    (`GET /api/plugins/:pluginId/bridge/stream/:channel`), and the SDK's own example of it is a chat.
  - The board concierge (`POST /api/board/chat/stream`). It skips the run queue, starts the Claude
    CLI straight away and streams the reply token by token, but it still saves the conversation on a
    standing task.
- **Missing:** a chat that behaves like an ordinary LLM conversation, with replies streamed as they're
  written and its own message history rather than a task's comments.
- **Approach:**
  1. Find out where any delay comes from in the stage 1 chat (waiting in the queue, the adapter
     starting up, or the model itself), because each has a different fix.
  2. Then try the options in order, from least to most invasive:
     - Stream from the run's live output in the chat view. This is UI only, and part of M5.
     - A fork plugin chat on `ctx.agents.sessions`: the plugin stores the messages and streams
       replies, and `ui-new` draws them. Plugin sessions still go through the run queue, so this
       fixes how the chat feels, not how long the agent takes to start. They also lose what the
       built-in chat adds: its instructions to the agent, handed-off tasks reporting back, and the
       person's identity on each run (runs are requested by the plugin as `system`).
     - A streaming reply path for agent chat that skips the queue, like the concierge's, proposed
       upstream.
- **Risk:** none for the UI option, and low for the plugin. A server change upstream would be high:
  agent chat and the run queue are some of upstream's busiest code.

## Questions for you

All answered Oct 24, 2026.

1. ~~**"Tasks become separated from agent chats/runs."**~~ Stage 1 builds on the hidden chat tasks, and
   a chat outside tasks is the optional [3.12](#312-chat-outside-tasks-optional).
2. ~~**Lists and sprints.**~~ A project's lists are its goals, as named lists for now. Sprint dates and
   capacity come later ([decision C](#decisions-to-make-early), [3.3](#33-sprints)).
3. ~~**Custom statuses.**~~ Each custom status maps onto one of the seven built-in ones
   ([3.1](#31-custom-statuses-and-status-rules)).
4. ~~**Recurring tasks.**~~ A new task each time, grouped under the recurring task ([M4](#m4-projects)).
5. ~~**Project docs while waiting on upstream.**~~ "From tasks" only; the project section waits for
   upstream or the plugin, with no hidden docs task ([decision D](#decisions-to-make-early)).
6. ~~**Runner visibility.**~~ All of session history, sandbox state, the Runner's own logs, and costs and
   usage ([3.11](#311-runner-visibility-beyond-the-api)).
7. ~~**Voting.**~~ Tabled, and may be dropped ([3.6](#36-voting)).
8. ~~**Meetings.**~~ Each meeting is its own conversation, with an agenda before, notes after and the
   actions as tasks ([3.9](#39-meetings)).
9. ~~**Memory.**~~ `claude_local`, the Paperclip Runner and Claude Managed
   ([memory ideas](#memory), [3.5](#35-memory-service)).
10. ~~**Announcements.**~~ They reach agents on their next run, without waking them
    ([3.7](#37-announcement-channels)).

## Keeping this plan current

- After each milestone, update its row statuses in [capabilities.md](inventory/capabilities.md) and
  mark the milestone done here.
- Upstream syncs can move items between stages. When upstream ships something the plan expected to
  build (as Artifacts V1 and bulk agent edits did on 2026-10-24), update the matching milestone or
  stage 3 entry.
- When a question above is answered, edit the entries it affects, and mark the question answered with
  a link to them. Keep the numbering, since other entries refer to questions by number.
