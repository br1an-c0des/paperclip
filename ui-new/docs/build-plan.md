# ui-new build plan

Oct 26, 2026 · built against upstream `baec3abd67` ([sync 2026-10-26](../../fork/sync-reports/2026-10-26.md))

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
| Multiple lists ("sprints") per project | On hold | Lists need their own table: goals always give a project's tasks its first goal, and carry meanings lists shouldn't have ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). The boards are drawn ([L1 to L4](design/boards.md#lists-on-hold)) for when it resumes ([3.3](#33-lists-and-sprints-on-hold)). |
| Project dashboard showing every sprint | On hold | Waits for lists. Board L4 draws the section. |
| Goals assigned to lists: one list per sprint per goal | On hold | Waits for lists. Goals stay as they are meanwhile. |
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
| Tasks separated from agent chats and runs | 1 | Underneath, each chat is a hidden task, and the server already keeps it out of task lists ([decision 8](decisions.md#8-agent-chats-are-tasks-underneath)). Stage 1 builds on that: the chat is drawn as a conversation, never a task page, and work it hands off shows as linked tasks. A run per message is a fine default. For a fluid conversation outside tasks, connect Claude Code through Paperclip's MCP connection; taking chat out of tasks entirely is kept as a long-term idea ([3.12](#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea)). |
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
| Project description and goals sent with every run | 1 for names, then 2b | The run's prompt carries neither. `heartbeat-context`, which agents read first, returns the project's and goal's names but not their descriptions; `GET /api/issues/:id` has both ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). Adding the descriptions to `heartbeat-context` is [2b-15](#2b-small-features-ask-upstream-first). |
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
| Meetings: scheduled work sessions with an agent | 3, partly 1 | [3.9](#39-meetings). Each meeting is a scheduled task: the agent writes the agenda to it, you talk in its thread, and notes and the agreed actions follow. A routine's schedule trigger already creates a task for an agent at a set time. |
| Agents message you first: a morning briefing, scheduled reports, reports after milestones | 1, then 3 and 2b | Raised in discussion on Oct 24, 2026. A recurring task does the work, and the result reaches your chat through a fork plugin tool, later through "report to chat" upstream ([3.13](#313-briefings-and-reports), [2b-14](#2b-small-features-ask-upstream-first)). |
| A "fast mode" for meetings | 2b | Codex agents already have a `fastMode` setting (`codex_local`). `claude_local` has none ([2b-11](#2b-small-features-ask-upstream-first)). A fast model or low effort per message works today. |
| A core skill add-on for new behaviour | 3 | [3.10](#310-core-skill-add-on). Fork-owned, with no conflict. |
| A `COMPANY.md`: company-wide instructions every run in the company receives, like an agent's `AGENTS.md` | Idea, then 2b or 3 | Raised Oct 27, 2026 ([3.14](#314-company-instructions-companymd)). Not designed yet. |

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

### Design still coming

The boards cover most of stage 1, but not all of it. More are being designed, and will land in
[design/](design/README.md#still-to-design) while development runs:

- **Desktop boards for capabilities that have none yet:**
  - the command palette;
  - goals as a project setting;
  - workspaces, skills, apps and tools, activity;
  - onboarding and sign-in;
  - the settings sections that board 30 only outlines.

  The full list is the empty **New home** cells in [capabilities.md](inventory/capabilities.md).

New project, new agent, recurring tasks, search and cases now have boards, and the phone layouts are
in [design/mobile.md](design/mobile.md).

Development starts now on what's drawn and doesn't wait for these:

- In each milestone, build the screens that have boards first.
- Before starting a milestone, check [design/boards.md](design/boards.md) for boards added since.
- A tier 1 screen with no board yet (goals in project settings, for one) waits for its board. If the
  rest of the milestone is done first, build a plain version from the design system's components,
  and mark it `partial` in capabilities.md so it's revisited.
- Tier 2 screens (settings, skills, apps and tools, activity) port mostly as they are, so the design
  system and the board 30 outline are enough to build them. A board, if one comes, refines them.

### Desktop first, ready for mobile

Development doesn't wait for mobile wireframes, but it shouldn't build anything they would force it
to tear up. Most of the cost of adding mobile later comes from a few structural choices, and those
can be made now without knowing what the mobile screens look like:

- **The shell is a grid with named areas** (nav, main). Side panels dock in their own column beside
  the list they came from (boards 2, 3, 5). On a phone, the nav becomes the floating dock
  ([design/mobile.md](design/mobile.md#navigation)) and the side panel a full-screen page. That's a
  change to the grid at a breakpoint, not to the components inside it.
- **No fixed page widths.** The boards' 1440px is where the layout looks its best, not what it needs.
  Use `minmax(0, 1fr)`, `clamp()` and `min()`, as the design system already says.
- **Components respond to their container** (`@container`), not the viewport. A task row then works
  the same in the full list, in a side panel and on a phone.
- **Breakpoints live in one file**, even while only the desktop ones are used.
- **Nothing works only on hover.** Every hover action also has a way to reach it by tap: a visible
  button, or a menu. Test with `@media (hover: none)`.
- **Dialogs, popovers and panels each go through one wrapper component**, so each can switch to a
  full-screen sheet in one place.
- **Lists rank their columns**, so the least important drop first as the width shrinks.

The phone layouts have arrived ([design/mobile.md](design/mobile.md)): the dock, and phone versions
of the task list, task panel, new task, Inbox, agents, agent chat, runs, the project overview and
docs, and search. Each is folded in during or right after its milestone, while that code is fresh;
the shell's dock comes first, since it replaces the drawer `Shell.tsx` uses now. The rest wait for
the responsive pass in M7.

### Decisions to make early

| # | Decision | Needed by | Recommendation |
| --- | --- | --- | --- |
| A | Agent chat flag ([decision 2](decisions.md#2-agent-chat-is-off-unless-the-instance-turns-it-on)) | M5 | Turn `enableAgentChat` on as part of every `ui-new` deployment (option 1). Fall back to agent settings if it's off (option 2). |
| B | Task panel or modal ([design open question](design/README.md#open-questions)) | M2 | Decided Oct 26, 2026: build both. The docked panel (boards 2, 3, 5) is the default for now; a setting will choose between the panel and the modal (boards 6, 7). Pages without a list (Inbox, chat, dashboards) open the modal, and direct links open the full page. |
| C | Lists as goals | M4 | Superseded Oct 26, 2026: lists are on hold until they have their own storage ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). Goals stay a task property and a project setting. |
| D | Project-level docs ([decision 1](decisions.md#1-projects-cant-hold-documents-or-files)) | M4 | Decided: build "From tasks", and start the 2b-8 conversation upstream. The project section waits for project documents, with the plugin (3.4) if upstream declines. No hidden docs task. |
| E | Each experimental flag ([decision 12](decisions.md#12-what-happens-to-each-experimental-flag)) | M0 | Decided: built in, dropped, or following the instance setting, per flag. Agent chat and `enablePublicMcp` on; the file viewer built in (M2); Conference Room chat dropped. |
| F | Cases | M6 | Decided: no cases page. Cases show inside the task views, when the instance has `enableCases` on: a case chip with phase ticks on task rows and a Case section in the task panel (option A), Group: Case in the task list (option B), and a Start case switch in New task with an optional workflow template (C5). The agent who gets the task sets up the case and makes that task its main task; the request goes in the task description, since the API has no field for it. Designs: boards [C1, C2 and C5](design/boards.md#cases). |
| G | Hosting plugin UI ([FORK.md](../../FORK.md#a-standalone-app-not-a-plugin)) | M7 | Mount points for sidebar, project tabs, agent tabs, settings pages and full pages, with React loaded only for plugin areas. |
| H | Responsive layouts | M0 | Decided: desktop first, built ready for mobile, with mobile layouts folded in as their wireframes arrive ([Desktop first, ready for mobile](#desktop-first-ready-for-mobile)). |

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
- The layout pieces that keep mobile cheap later (decision H): the shell grid, the breakpoints file,
  and the dialog, popover and panel wrappers.

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
  - group by status, assignee, priority, label or parent;
  - filters, saved views and keyboard navigation.
  Saved views use local storage until stage 3 adds a plugin.
- Task panel and modal: Details, Activity and Docs and files (boards 2, 3, 5, 6, 7), including
  subtasks, blockers, workspace, privacy, tree control and the header actions.
- Thread and composer: comments, mentions, attachments, work modes, queued messages, steer and
  interrupt, request cards (board 15) for task interactions.
- Run modal: transcript, what the agent was sent, raw output, provider trace (boards 16–18,
  [decision 4](decisions.md#4-a-runs-full-model-input-only-exists-when-provider-tracing-is-on)).
- Task documents with the editor: revisions, locks, annotations.
- The workspace file viewer: browse and preview a task's workspace files, built in rather than
  behind `enableExperimentalFileViewer` ([decision 12](decisions.md#12-what-happens-to-each-experimental-flag)).
- Recovery and interruption state with Retry, and the project access notice from the 2026-10-24 sync.
- Faster task opening from the 2026-10-26 sync: the latest comments, the core task, and recent activity
  and runs first (`GET /api/issues/:id/recent-comments`, `?view=core`, `?view=recent`), then the full
  history.

Covers `tasks/*`, `steering/*`, `task-coordination/*`, `documents-artifacts/documents`,
`documents-artifacts/attachments`, `runs-adapters/runs`. Done when a task can go from created to done
in `ui-new` alone, including answering an agent's question and watching its run.

Progress (2026-10-26): everything above is built. Details and the task header still read the full
task first. The end-to-end test of the done condition is next, using the temporary
Connectors page ([decision 23](decisions.md#23-gaps-found-building-the-temporary-connectors-page)).

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

Progress (2026-10-27): the Inbox's first slice is built (Needs you, Updates, Alerts, Snoozed,
Cleared, keyboard triage, sign-offs, the needs-you badge). Left: proposals with a change preview,
budget resolution, queues and the aging shelf, and the audience settings (M6).

#### M4: Projects

- Project dashboard (board 8): brief, budget, code, agents at work, waiting on you, stuck work.
- Docs (board 9): "From tasks" on `GET /api/companies/:companyId/artifacts?projectId=&groupBy=task`.
  The project section waits for project documents (decision D).
- Agent workload (boards 31, 32), built from runs, live runs and assignments.
- Settings (boards 10, 11): details, members, repositories, workspaces, task checkouts, environment,
  variables, budget, archive, goals, and Git authorization (`GET|PUT /api/projects/:id/git-authorization`,
  since the 2026-10-26 sync).
- Goals folded into projects: the project's goals in settings and the task's goal in its properties,
  with no Goals page. Lists are on hold ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)).
- Recurring tasks replace Routines: Repeat in the new-task dialog, a Recurring view, and every routine
  setting (triggers, variables, delivery policy, run history) in the recurring task's panel. Each
  occurrence is a new task, grouped under its recurring task.
- New project.

Covers `projects/*`, `workspaces/*`, `goals/*`, `routines/*`, `documents-artifacts/library`.

Progress (2026-10-27): built: the dashboard, Docs, settings with goals and Git authorization,
recurring tasks, New project, and Agent workload (boards 31, 32, plus the company view, board 33, at
`/:prefix/workload`; gaps in [decision 28](decisions.md#28-gaps-found-building-agent-workload)).

#### M5: Agents and the organization

- Agent chat (boards 12, 13), with decision A, built on the hidden chat tasks
  ([decision 8](decisions.md#8-agent-chats-are-tasks-underneath)):
  - the chat is its own view, never the task page;
  - tasks handed off from the chat show as linked cards, and their results arrive as replies;
  - the reply streams in from the run's live output (`heartbeat.run.log`), if that turns out fast
    enough;
  - search shows a chat as a chat, not as a task;
  - the agent's briefings and reports show as cards between messages
    ([3.13](#313-briefings-and-reports)), until the plugin can post them as messages.
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

Progress (2026-10-27): first slices built: the agent page with its settings (boards 26, 27 and the
board 30 outline; harness and runner shown together, Memory, Runner state and sessions), the Org
dashboard (board 19), Manage agents with bulk edit (board 20), and company workload (board 33, with
M4's workload), New agent (N2, N3), and Agent chat (boards 12, 13, 18; `enableAgentChat` on, per
decision A). Left: the remaining settings sections (tools and channels, trust presets), composer
mentions in chat, and the gaps in decision [31](decisions.md#31-gaps-found-building-agent-chat). Gaps in decisions
[29](decisions.md#29-gaps-found-building-the-agent-page) and
[30](decisions.md#30-gaps-found-building-the-org-pages).

Follow-ups from using chat with Bob (2026-10-27):

- **A chat's documents.** Task links to a chat now open the chat, and the chat view shows none of the
  task's documents, so its `plan` document and anything the agent saves there (for example
  `paperclip-context-reference` on TES-13) can't be opened in `ui-new`. Show them in the chat, for
  example in the Activity column or as cards where they were saved.
- **The core skill in the Skills section.** Paperclip Runner agents don't get the `paperclip` skill:
  the Runner carries the same contract through its protocol and the server strips the skill from
  their saved set (`normalizePaperclipOperationalSkillPreference`). Legacy agents always get it,
  even with an empty set (`PAPERCLIP_OPERATIONAL_SKILL_KEY`). Show it as "Built into the Paperclip
  Runner" or "Always on" instead of a switch.
- **Chat scroll jumps to the bottom.** Reading earlier messages, the view returns to the bottom on
  its own after 10–20 seconds or on other events. Likely cause: `ChatView.tsx` scrolls to the bottom
  whenever `state.loading()` turns false, without checking the reader's position, and a refetch
  may also swap the thread for the loading card.

Done 2026-10-27: all three. The scroll cause was an agent-record refetch resetting the chat's
"loaded" flag (and a background error replacing the thread); the chat now jumps only on first open
and when you send, and otherwise follows only while you're at the bottom. Documents show in the
Activity column, as cards in the thread and, for the plan, a header button; they open over the chat
and `#document-<key>` links (including old task links) land on them. Skills show `paperclip` as
"Built into the Paperclip Runner" or "Always on", and for legacy agents `complain` and
`suggestion-box` as "Always on" too (mounted on every legacy run). Search results found in a chat's
document now open that document (fixed in M6 round 2).

#### M6: Settings and everything else

Tier 2, ported mostly as is into the new layout:

- Company settings (boards 21–25), including environments, import and export, and the audience
  settings.
- App settings (boards 28, 29, and the board 30 outline).
- Skills, Apps and tools, Activity and costs.
- Onboarding, and the sign-in and connect pages outside a company. These include the pages where you
  approve an MCP connection (`/mcp-connect/:id`, `/mcp-device`, `/assistant-connections`), which only
  work with `enablePublicMcp` on ([3.12](#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea)).

These are large areas: Apps and tools alone reaches about 60 requests per page. Plan a few iterations.

Progress (2026-10-27): round 1 built: company settings (boards 21–25), App settings (boards 28, 29),
and the Skills and Activity tabs; gaps in decisions [32](decisions.md#32-gaps-found-building-app-settings)–[34](decisions.md#34-gaps-found-building-skills-and-activity).
The experimental flags were decided on Oct 28 (decision 32): the sorting stands, and App settings
gets a Features card. Round 2 (started Oct 28): Apps and tools (replacing the temporary Connectors
page), onboarding and the pages outside a company, plugin hosting (brought forward from M7), and the
Features card. The Features card is merged (22 switches; the rest of the flags are dropped or built in). Apps and tools is merged: Browse, AI connections, Connect, a connection's page and Review ([decision 35](decisions.md#35-gaps-found-building-apps-and-tools)); Assistant connection, Gateways, Advanced and Chat endpoints are left for round 3. Onboarding and the pages outside a company are merged: sign-up, board claim, CLI auth, invites, MCP connect, chat identity, the Cloud handoff and a four-step onboarding ([decision 36](decisions.md#36-gaps-found-building-onboarding-and-the-pages-outside-a-company)). Plugin hosting is merged ([decision 37](decisions.md#37-gaps-found-building-plugin-hosting)); round 2 is complete.

Round 3 (started Oct 28): Apps connections part 2 (assistant connection, gateways, advanced, agent
tools), Apps channels and special setups (chat endpoints, agent channels, task integrations,
aggregators, identities), the remaining plugin spots and shell leftovers, and task and workspace
leftovers (runner goal, feedback votes, a Workspaces tab in the org header, branch reconcile).
Decided: decision queues are dropped; the Inbox is the one triage surface. Task and workspace leftovers are merged ([decision 38](decisions.md#38-gaps-found-building-task-and-workspace-leftovers)). Plugin spots and shell leftovers are merged: the remaining plugin mount points, the plugin config form and status, Create organization, starred agents, announcements and the development banners.

#### M7: Ready to replace the old UI

- Plugin hosting (decision G): built in M6 rounds 2 and 3. Left: the `organizationSwitcher` slot
  and choosing a plugin's local folders.
- Parity audit: every row in [capabilities.md](inventory/capabilities.md) is `done` or `dropped` with
  a reason.
- The responsive pass: mobile layouts for every screen not folded in earlier (decision H). And an
  accessibility pass against the design system's patterns.
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
| 14 | "Report to chat": let any task or routine deliver its result into a person's chat with the agent | Briefings and reports ([3.13](#313-briefings-and-reports)). The delivery already exists for tasks handed off from a chat (`chatTaskHandoffs`, decision 8); this adds a way to link other tasks. |
| 15 | Return the project's and goal's descriptions in `heartbeat-context` | Agents read it first, but it gives only names, so the "why" behind a task reaches them only if they load the full task ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). |
| 16 | Each adapter's effort choices per model, beside `GET /api/companies/:companyId/adapters/:type/models` | [Decision 13](decisions.md#13-the-task-composer-overrides-runs-for-more-adapters-than-new-task-does). New task and the composer read one list instead of a mirrored copy that drifts. |

## Stage 3: experimental features

### How they're built

- **Plugin first.** One fork plugin, `packages/plugins/fork-paperclip`, can hold all of these. Plugins
  get their own Postgres schema and migrations, JSON routes under `/api/plugins/:pluginId/api/*` (which
  `ui-new` calls like any other API), agent tools, scheduled jobs, event subscriptions, and read access
  to allowed core tables. Plugins never conflict with upstream.
- **A fork skill to steer agents.** Plugins can't add to the core prompt. The skill in [3.10](#310-core-skill-add-on)
  tells agents when to use the plugin's tools: read project docs, save memory, read announcements,
  message the user.
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

### 3.3 Lists and sprints (on hold)

On hold since Oct 26, 2026 ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). Boards
[L1 to L4](design/boards.md#lists-on-hold) draw it: the task list grouped by list, a list's panel, New list, and a
Lists section on the dashboard.

- **Have:** nothing that fits. Goals were the plan (decision C), but every task in a project with goals
  gets the first one, goals belong to the company rather than a project, and they mean the "why" behind
  work elsewhere.
- **Missing:** a list table (a list belongs to one project, and a task to at most one list, or none),
  list order, and later start and end dates, capacity, rollover of unfinished tasks and burndown.
- **Approach, when it resumes:** a fork plugin table first, or a proposal upstream if the plugin's
  limits matter: server-side task filters and agents can't see plugin data.
- **Risk:** medium. It's new storage for something the task list leans on.

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

- **Have:** routines with schedule triggers, ordinary tasks with threads and documents, fast responses
  (`enableFastResponses`), Codex fast mode.
- **Missing:** a calendar of meetings, the timing around each one, and a view that presents a meeting
  as a conversation.
- **What a meeting is** ([question 8](#questions-for-you)):
  - Its own conversation, not the agent's standing chat.
  - The agent prepares an agenda beforehand.
  - Afterwards, the agent writes notes, and the agreed actions become ordinary tasks linked from the
    notes.
- **Approach:** decided Oct 24, 2026: a scheduled task per meeting. A meeting can't be a second
  built-in chat, because the server allows one chat per person and agent (decision 8), and a task
  already has what a meeting needs: a thread, documents and linked tasks.
  1. A routine creates the meeting task, assigned to the agent, far enough ahead for the agent to
     write the agenda to it as the task's plan document.
  2. A reminder with the agenda reaches you in your chat with the agent, the same way briefings do
     ([3.13](#313-briefings-and-reports)).
  3. At the time, you talk in the task's thread, which `ui-new` draws as a conversation.
  4. Afterwards, the agent saves notes as a document on the task, and creates the action tasks,
     linked from the notes.

  Most of this exists already. The plugin adds a calendar view, one-off meetings (a routine's schedule
  repeats), and the reminder. Speed comes from a fast model or effort per message today, and 2b-11
  for Claude.
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

### 3.12 Chat outside tasks (dropped, kept as a long-term idea)

Kept as a long-term idea on Oct 27, 2026, after using the built-in chat: ultimately, agent chat should
be taken out of the task system and built as its own flow, designed for conversation rather than
adapted from a task (its own storage, turns, documents and memory, instead of a hidden task with
comments). It's a long way off and would mean a large change in upstream's server, so it stays here
as an idea to develop or propose upstream later; stage 1 keeps building on hidden tasks
([decision 8](decisions.md#8-agent-chats-are-tasks-underneath)). The notes below are the earlier
research.

Dropped Oct 24, 2026. What it was for, a fluid conversation that isn't a task underneath, is covered
by Paperclip's MCP connection instead ([doc/public-mcp.md](../../doc/public-mcp.md)):

- **What it is:** Claude Code, Codex or ChatGPT connects to one company over MCP
  (`POST /mcp/paperclip`), acting as you. The conversation lives in the assistant, and the work stays
  in Paperclip.
- **What it can do:** search and read tasks, create them, comment, update or finish them, write
  documents, upload attachments, and see pending approvals. With the `paperclip:configure` scope it
  can also edit agents, projects and skills. Its comments wake agents as yours would.
- **What it isn't:** a Paperclip agent. The assistant uses its own model and settings, not an agent's
  instructions, memory or skills. Talking to a particular agent stays in the built-in chat.
- **What it needs:**
  - the experimental setting `enablePublicMcp`, which should end up on (decision E);
  - a deployment with real user accounts;
  - an endpoint reachable over HTTPS (plain HTTP works only on localhost).

  Claude clients can't subscribe to the MCP's task events yet, so they check on tasks when asked
  rather than being told when one changes.
- **For `ui-new`:** the pages where you approve a connection, in M6.

Kept as a record of the research: Paperclip's chat connectors also create a task per conversation,
and only email can start one; plugins can't add a chat provider; and the plugin SDK has task-less
agent sessions (`ctx.agents.sessions`) and streaming to the UI (`ctx.streams`), which a fork plugin
messenger would have used. Agent-initiated messages are a separate feature
([3.13](#313-briefings-and-reports)), and don't depend on this one.

### 3.13 Briefings and reports

Raised in discussion on Oct 24, 2026. The agent writes to you first: a morning briefing, other
scheduled reports, and a report when a milestone is reached. "Report to chat" is the end goal, with
plugins added as needed. This is its own feature, added to the built-in chat as it is.

- **Have:**
  - Recurring tasks: routines with schedule, webhook and API triggers create a task for the agent
    each time.
  - Tasks handed off from a chat already report back to it when they're done (decision 8). That
    covers milestone reports for work that started in the chat.
  - Read markers on tasks (`POST /api/issues/:id/read`), so the chat can show what's new.
- **Missing:**
  - A way for any other run to post into your chat. The server only accepts a chat message from a
    run the chat started, so a briefing run's message would be refused.
  - Routines triggered by events. They only have schedule, webhook and API triggers.
- **Approach:**
  1. **In M5, UI only:** the chat shows the agent's report tasks as cards between messages. This
     needs a way to tell report tasks apart, so check what a routine can carry (a label, for
     example).
  2. **A fork plugin tool, "message the user":** any run can call it, including a briefing's. The
     plugin posts the message into the person's built-in chat as a comment from the agent. From
     reading the code, plugins can add comments attributed to an agent (`createComment` in
     `server/src/services/plugin-host-services.ts`), and the chat's check that a reply comes from one
     of its own runs doesn't apply to them. That's untested, and upstream could close it. Finding the
     chat's task ID is a detail to work out (`ui-new` knows it). The fork skill tells agents when to
     use the tool.
  3. **Upstream, "report to chat"** ([2b-14](#2b-small-features-ask-upstream-first)): the proper
     version, reusing the hand-off delivery. The plugin tool switches to it if it lands.
  4. **Milestone reports for work that didn't start in the chat:** the plugin watches for events (a
     list's last task done, a project reaching a state) and fires the briefing routine through its
     API trigger.

  Meetings (3.9) use the same delivery for their reminder and agenda.
- **Risk:** low for the plugin, with the caveat in step 2.

### 3.14 Company instructions (COMPANY.md)

An idea raised Oct 27, 2026; not designed or scheduled yet.

- **The idea:** a `COMPANY.md` document that behaves like an agent's `AGENTS.md`, but for the whole
  company: it's sent with, or referenced by, every new run in that company, whichever agent runs it.
  It would hold what every agent should know: the company's mission and context, house rules and
  conventions, who to ask for what, tone, and shared links.
- **Have today:**
  - each agent's own instructions bundle (`AGENTS.md` plus sibling files), added to the system
    prompt on a fresh session; on the Paperclip Runner, after the Runner's own rules
    (`PAPERCLIP_EXECUTION_PROMPT`);
  - company skills, which agents only get when each one is assigned the skill;
  - the company description, which isn't put into runs.
  - The name already exists in the Agent Companies package format: `COMPANY.md` is the company
    manifest that export and import read and write (`server/src/services/company-portability.ts`).
    Its body could be the natural home for these instructions, so an exported company carries them.
- **Missing:** no company-level text reaches a run. Getting the same guidance to every agent means
  copying it into each `AGENTS.md`.
- **Ways it could work, to explore:**
  1. **Upstream (2b):** the server stores a company instructions document and adds it to every run's
     prompt, next to the agent's instructions, for both runners. The cleanest, and it needs
     agreement upstream first.
  2. **Fork, without server changes:** a company document edited in `ui-new` (company settings), with
     every agent's `AGENTS.md` given a standard line that points at it, or a fork plugin that keeps a
     shared section of each agent's instructions in sync. Works now, but it's a copy, not one source.
  3. **A company skill assigned to every agent.** Easy, but a skill is read on demand, not always in
     context, and Runner agents treat skills differently.
- **Questions:** how it interacts with an agent's own instructions (which wins on conflict), size
  limits (it would be in every run's prompt), whether chats get it too, and who may edit it.

## Questions for you

All answered Oct 24, 2026.

1. ~~**"Tasks become separated from agent chats/runs."**~~ Stage 1 builds on the hidden chat tasks. A
   chat outside tasks was dropped in favor of the MCP connection
   ([3.12](#312-chat-outside-tasks-dropped-kept-as-a-long-term-idea)).
2. ~~**Lists and sprints.**~~ A project's lists were to be its goals. Reopened Oct 26, 2026: lists are
   on hold until they have their own storage ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold), [3.3](#33-lists-and-sprints-on-hold)).
3. ~~**Custom statuses.**~~ Each custom status maps onto one of the seven built-in ones
   ([3.1](#31-custom-statuses-and-status-rules)).
4. ~~**Recurring tasks.**~~ A new task each time, grouped under the recurring task ([M4](#m4-projects)).
5. ~~**Project docs while waiting on upstream.**~~ "From tasks" only; the project section waits for
   upstream or the plugin, with no hidden docs task ([decision D](#decisions-to-make-early)).
6. ~~**Runner visibility.**~~ All of session history, sandbox state, the Runner's own logs, and costs and
   usage ([3.11](#311-runner-visibility-beyond-the-api)).
7. ~~**Voting.**~~ Tabled, and may be dropped ([3.6](#36-voting)).
8. ~~**Meetings.**~~ Each meeting is a scheduled task, its own conversation: the agent writes the agenda
   to it beforehand, and notes and action tasks follow ([3.9](#39-meetings)).
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
