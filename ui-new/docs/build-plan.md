# ui-new build plan

Nov 7, 2026 · built against upstream `f6cb3e43f` ([sync 2026-11-07](../../fork/sync-reports/2026-11-07.md))

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
| Agents message you first: a morning briefing, scheduled reports, reports after milestones | 1, then 3 | Raised in discussion on Oct 24, 2026. A recurring task does the work, and the agent sends the result to your chat with upstream's `send_chat_message` (added Nov 1, 2026), so the fork plugin tool and the upstream ask aren't needed ([3.13](#313-briefings-and-reports)). |
| A "fast mode" for meetings | 2b | Codex agents already have a `fastMode` setting (`codex_local`). `claude_local` has none ([2b-11](#2b-small-features-ask-upstream-first)). A fast model or low effort per message works today. |
| A core skill add-on for new behaviour | 3 | [3.10](#310-core-skill-add-on). Fork-owned, with no conflict. |
| A `COMPANY.md`: company-wide instructions every run in the company receives, like an agent's `AGENTS.md` | Idea, then 2b or 3 | Raised Oct 27, 2026 ([3.14](#314-company-instructions-companymd)). Not designed yet. |
| Help people understand what Paperclip is and how to use each feature: a user guide with worked examples, and an interactive guide in the app | Idea, then 1 or 3 | Raised Oct 28, 2026 ([3.15](#315-an-in-app-guide-to-paperclip)). Notes collect in [guides/](guides/README.md). Not designed yet. |
| Investigate and design upstream's Coordinator workspace (one conversation per agent, task proposals from chat, decision cards, a Needs You queue) against `ui-new`'s Inbox, requests and chat | 1 | Raised Oct 29, 2026, from the upstream sync ([3.16](#316-upstreams-coordinator-workspace)). Not investigated yet. |

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
| A | Agent chat flag ([decision 2](decisions.md#2-agent-chat-is-off-unless-the-instance-turns-it-on)) | M5 | Settled upstream Nov 7, 2026 (#19360): Agent Chat is always on and `enableAgentChat` is a compatibility key. `ui-new` drops its chat gate and switch (U57). Before that: turn it on in every `ui-new` deployment (option 1), falling back to agent settings if it's off (option 2). |
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
    ([3.13](#313-briefings-and-reports)); since Nov 1, 2026 agents can post them as messages
    themselves (`send_chat_message`).
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
Decided: decision queues are dropped; the Inbox is the one triage surface. Task and workspace leftovers are merged ([decision 38](decisions.md#38-gaps-found-building-task-and-workspace-leftovers)). Plugin spots and shell leftovers are merged: the remaining plugin mount points, the plugin config form and status, Create organization, starred agents, announcements and the development banners. Apps connections part 2 is merged: Assistants, Gateways, Advanced and the agent's Tools section. Apps channels and special setups are merged: chat endpoints, AgentMail, Composio and Arcade, Google Workspace, identities, agent channels and task integrations. Round 3 is complete.

#### M7: Ready to replace the old UI

Audit (Oct 28): [audit/m7-parity.md](audit/m7-parity.md) sorts every leftover in the 72 rows not yet
done or dropped into build (101 small, 23 medium), drop (24), API change (12), decide (11 questions)
and already done (29 stale notes), lists what the checklist misses, and proposes five rounds (A: old
links, shell and deploy; B: requests and Inbox; C: task panel, thread, documents and runs; D:
projects, agents, org, goals and recurring; E: Tier 2 depth), then the responsive pass. It also found
that `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` isn't in `deploy/docker-compose.yml` yet (see the memory
row above), and that `ui-new` has no way to turn on `enableAgentChat`.

The audit's eleven questions were answered on Oct 28 ([decision 39](decisions.md#39-decisions-from-the-m7-audit)),
and each slice does the phone layouts for its own screens rather than a separate responsive pass.

Progress:
- **Round 1 (Oct 28), complete:** A (old links, shell, user profile, the installable app and
  service worker, deploy fixes; decision 41), B (requests and Inbox, the aging shelf; decision 40),
  C1 (task panel, thread, documents, task list) and C2 (runs and workspaces) (decision 42). Phone
  layouts built for N1 on detail pages, M1–M4, M6, M7, M10 and M11.
- **Round 2 (Oct 29), complete:** D (agents, projects, goals, recurring, the outside-agent invite,
  phone M12 and M13; decision 45), E (tier 2 depth and the plugin compatibility stylesheet; decision
  46), cases (C1, C2, C5; decision 43) and status cards (decision 44; no real update yet).
- **Left after round 2:** the rows still `partial` in [capabilities.md](inventory/capabilities.md):
  shell leftovers, `tasks/feedback`, four project rows, `workspaces/files-git`, `runs-adapters/runs`,
  `approvals/tool-review`, `documents-artifacts/library`, company settings, skills, apps, status
  cards, onboarding (Copilot and gateway paths) and sign-in flows. Also: status cards' open question
  (decision 44), and small leftovers in decisions 43 and 45 (the Workspaces summary card, the phone
  toolbar width, the project header on phones).
- **Round 3 (Nov 2–3), complete:** run detail and agent chat (votes, briefing sources, read state
  and unread dots, board 18's entry point), Apps leftovers without voice (decision 46), company
  settings and skills (decision 46), status cards with real updates (decision 44, decided), and the
  agent YAML editor with onboarding's gateway path (decisions 36, 47). Projects lifecycle and
  membership closed on review. Speko voice is on hold.
- **Left after round 3:** `documents-artifacts/library` (waits for upstream project documents,
  decision D), the sign-in flows (need an instance that requires sign-in to check live), and
  `shell/coordinator-workspace` (to investigate and design, 3.16). Still open from earlier: the
  Workspaces summary card, the phone toolbar width (`.tv-toolbar--phone` is 394px at 390), the
  project header on phones, and the agent page's "From connections" instructions.
- **Upstream changes to integrate:** the [table below](#upstream-changes-to-integrate), from the
  Nov 3 audit of every sync report since Oct 15 and the Nov 3 sync.

##### Upstream changes to integrate

`ui-new` keeps adopting upstream's changes, not just staying compatible. Every sync change that
affects the board gets a line here, with an outcome, before `new-ui` moves (the
[upstream-sync skill](../../.claude/skills/upstream-sync/SKILL.md), step 9). Each capability row's
"Upstream sync" note links its line here.

Integration round 1 (Nov 5): four agents, `integrate/tasks` (U1, U2, U6, U15–U18),
`integrate/inbox-shell` (U3, U4, U14, U32, U33), `integrate/agents-runs` (U7, U10, U11 links, U19,
U22, U25, U27, U35, U37) and `integrate/chat-apps` (U5, U8, U9, U20, U21, U23, U24, U26, U28–U31,
U34).

The Nov 5 sync (`adb49a443..d3713d827`, [report](../../fork/sync-reports/2026-11-05.md)) added U40–U56
and folded its read-side change into U13.

Integration round 2 (Nov 5): four agents, `integrate/transcripts` (U41 check, U42, U43),
`integrate/task-state` (U40, U44–U47), `integrate/composer-requests` (U48, U50, U49 check) and
`integrate/settings-checks` (U56; U52–U55 checks). U13 with U51 follows as its own agent.

The Nov 7 sync (`d3713d827..f6cb3e43f`, [report](../../fork/sync-reports/2026-11-07.md)) added U57–U80,
and recorded upstream's Coordinator-first old UI on U36.

Integration round 3 (Nov 8): four agents, `integrate/task-run-state` (U62, U63, U64, U79 check),
`integrate/task-thread` (U58, U67; U60 and U68 checks), `integrate/chat-lists-routines` (U57, U59,
U65; U61, U69 and U80 checks; the phone toolbar width) and `integrate/agents-apps` (U70, U72; U71,
U73–U75 and U77 checks; U11's remaining differences and "From connections"). The collapsed request
cards and Inbox grouping from U36 follow once their artboard is approved.

Outcomes: **build** (an agent builds it), **decide** (a question for the user first), **check**
(verify, then build or close), **design** (needs boards first), **left out** (with the reason),
**done**. When a line is built or settled, mark it done or left out here and in its row.

The audit (Nov 3) found the Oct 15–26 syncs mostly built. The gaps start with the Oct 22 sync. Many
were noted on `done` rows as "Upstream sync …" without being built or recorded as a to-do. The
follow-ups that decisions 47 and 48 listed are moved here.

| # | Change | Sync | Upstream | Row | Outcome |
| --- | --- | --- | --- | --- | --- |
| U1 | **Monitoring status.** Tasks and search results carry `displayStatus`, which adds `monitoring` (an agent's task waiting on a saved monitor, with no run, reviewer or recovery). Lists and search filter by `displayStatus=`, and search returns its facet counts. The stored `status` is unchanged and is still what people set. | 11-03 | #18624 | `tasks/views`, `tasks/organize`, `tasks/properties`, `inbox-search/search` | done (Nov 5, `integrate/tasks`): a hollow Ion capsule, a Monitoring column and group, search facets; the picker sets `status`. Compact lists drop `displayStatus` (upstream candidate 24), so lists make one extra `displayStatus=monitoring` read until that's fixed. Every screen that shows a task's status shows it (follow-up, Nov 5); reads outside the task lists use the same workaround (`markMonitoring`) |
| U2 | **Provider and workspace failures** on interrupted tasks (`interruption.providerFailure`, `workspaceFailure`) and in run results. `readProviderFailure` is a runtime export. | 11-03 | #18622, #18770 | `tasks/recovery`, `runs-adapters/runs` | done (Nov 5): the task notice (`integrate/tasks`) and run detail (`integrate/agents-runs`); one shared notice, `ui/ProviderFailureNotice.tsx` (follow-up, Nov 5) |
| U3 | **`GET …/inbox/mine`**: the Updates tab in one read, with each source's errors. Read marks now refresh only the reader's own lists. | 11-03 | #18790 | `inbox-search/triage` | done (Nov 5, `integrate/inbox-shell`): Updates reads it, with each source's error above the rows; Cleared keeps the two list reads (the snapshot has no archived form) |
| U4 | **`boardBootstrap` on the session**: companies and board access with the session, read through `readBoardBootstrap`, to seed those reads on first load. | 11-03 | #18790 | `shell/company` | done (Nov 5, `integrate/inbox-shell`): seeds companies and board access; local_trusted gets no bootstrap |
| U5 | **AI connection account identity** (`…/ai-connections/:id/identity?grantId=`): the signed-in account and organization. | 11-03 | #18653 | Apps and tools | done (Nov 5, `integrate/chat-apps`): an Account panel on connected Claude subscriptions |
| U6 | **`sortField=created`**: server sort by created, kept in the URL, stable paging. `ui-new` always sends `updated` and sorts on the client. | 11-03 | `946735d03` | `tasks/organize`, `routines/run-now + /history` | done (Nov 5, `integrate/tasks`): sort sent to the server and kept in the URL |
| U7 | **Instructions bundle settings** (external folder, entry file; "Not yet" in decision 29), sending `requireExistingEntry`. | 11-03 | #18378 | `agents/instructions` | done (Nov 5, `integrate/agents-runs`): the panel already existed; external changes now send `requireExistingEntry` |
| U8 | **"Started by run"** on routine runs (`RoutineRun.createdByRunId`), linked to the run. | 11-03 | #18772 | `routines/run-now + /history` | done (Nov 5, `integrate/chat-apps`) |
| U9 | **Per-connection reads** on App detail: `…/review-counts` and `…/profile-configuration` instead of the company-wide attention and profiles reads. | 11-03 | `58308a3e6`, `554a770c6` | Apps and tools | done (Nov 5, `integrate/chat-apps`); the Advanced pages keep the company-wide profiles |
| U10 | **`agents:read` permission** (migration 0423): redacted configuration reads for agents. Check how Permissions, trust and the YAML editor handle a 403, and whether the grant should be listed. | 11-03 | #18766 | `agents/permissions`, `agents/configuration-yaml` | done (Nov 5, `integrate/agents-runs`): board users never get the 403 (the gate is for agents); the YAML editor explains one. Listing the grant read-only from `access.grants` is possible; adding or removing it has no API |
| U11 | **The old UI's refined agent page:** Activity, Runs, Costs and Budgets inside the agent; an agent history dialog; direct reports and allowed connectors panels; the identity card dropped. Its new URLs `/agents/:id/identity` and `/activity` aren't mapped in `SECTION_ALIASES`. | 11-03 | #18378 | `agents/overview`, `agents/audit`, `agents/revisions` | links done (Nov 5, `integrate/agents-runs`): identity → Instructions, activity and audit → History, runs and costs → Budget. The identity card (creator and signing key) is removed; "Created … by …" moved to the Profile footer, and the signing key is dropped, as upstream did. The rest to compare: the agent's report lists 12 differences |
| U12 | **Cursor Cloud** as a Paperclip Runner provider (experimental; repository or cloud environment, per-turn, only `CURSOR_API_KEY`). | 11-03 | #18068, #18069 | `agents/hire`, `agents/runtime` | left out for now (decided Nov 5): revisit with the Runner's managed-provider select (decision 45) |
| U13 | **Writes and reads that survive outages.** Writes: autosave, comments, new tasks and decisions queued and replayed with their idempotency keys; receipt recovery (`X-Paperclip-Receipt-Only`); request answers re-read interactions after an uncertain result. Reads (added by the Nov 5 sync, U51): an allowlist of approved reads persisted across reloads for 24 hours per user and company and dropped on a build change; component reads that keep loaded data and retry through the connectivity policy (`useResilientFetch`); run log chunks kept across stream changes; read errors always shown. `ui-new` only shows a reconnecting notice. | 10-29, 11-05 | #15754, #17960, #18825, #18822 | `shell/live-updates`, `tasks/interactions` | done (Nov 7, `integrate/resilience`), with U51. Writes (comments, explicit document saves, new tasks without attachments, request answers, decisions) queue in local storage per user and company, replay one at a time with their keys, and recover a lost answer by key or read-back; queued and failed writes show where they were made, with a sticky notice. `X-Paperclip-Receipt-Only` is honoured only by project creation, and request answers take no idempotency key, so those recover by re-reading. Not queued: verdicts, dismiss, approvals, routine actions |
| U14 | **Retry on interrupted tasks in the Inbox**: interruption state and Retry on Inbox task rows, as the task list has. | 10-22 | `d33b40a5c` | `inbox-search/triage` | done (Nov 5, `integrate/inbox-shell`): on Updates rows and failed-run alerts |
| U15 | **Subtasks an agent creates, shown inline** in the task feed. | 11-01 | #18320 | `tasks/thread` | done (Nov 5, `integrate/tasks`): subtasks and follow-ups as linked cards in the thread |
| U16 | **Batched run reads** (`GET /issues/:id/runs?runIds=`, up to 100). | 11-01 | — | `tasks/thread` | done (Nov 5, `integrate/tasks`), except the watchdog's per-run read: the batched read has no `outputSilence` |
| U17 | **Image gallery** in task documents. | 11-01 | `cd5f93055` | `documents-artifacts/documents` | done (Nov 5, `integrate/tasks`): a gallery with arrows, kept in the address as `&image=N` |
| U18 | **Routine tasks filter and Needs attention:** `?originKind=routine_execution`, and Needs attention from `GET …/attention/tasks`. Old `/issues?originKind=` links aren't mapped. | 11-01 | #18317, #18323 | `tasks/organize`, `shell/misc` (old links) | done (Nov 5, `integrate/tasks`): old links already work; a "Recurring task runs" filter (the Recurring view can't filter or group all routine-made tasks). Needs attention left out: no `ui-new` task view shows it |
| U19 | **Run events `?view=conversation`** and `alignStartToRecord` on the log, instead of reading everything from offset 0. | 10-26 | #17593, #17756 | `runs-adapters/runs` | done (Nov 5, `integrate/agents-runs`): the log tail starts on a whole record. `?view=conversation` is in `api/runs.ts` but fits only the thread's older-run history (not built) |
| U20 | **Chat history newest first:** the 20 newest comments (`oldestCommentId`), older ones on scroll. `ui-new` pages forward from the oldest. | 11-01 | #18358 | `agent-chat/history + /handoff` | done (Nov 5, `integrate/chat-apps`) |
| U21 | **Resume a saved AI sign-in setup** (`GET …/ai-connections/login/:sessionId/setup`). | 10-29 | #17737 | Apps and tools | done (Nov 5, `integrate/chat-apps`): Claude only, as `ui-new`'s sign-in dialog is |
| U22 | **Kimi Code and Antigravity in New agent** (Runner candidates through `candidateHarnesses`, operator-gated), with labels for `kimi_runtime` and `antigravity_runtime`. | 11-01 | `b866fa4bd`, `09c05c550` | `agents/hire` | done (Nov 5, `integrate/agents-runs`): Kimi Code with `enableNativeRunner`, Antigravity only when `candidateHarnesses` admits it |
| U23 | **Workspace file source label** ("Live workspace" or "Saved copy from …", from `data.workspace.source`). | 11-01 | #18403 | `workspaces/files-git` | done (Nov 5, `integrate/chat-apps`) |
| U24 | **GitHub "Retry access"** banner with a link to the installation settings (`github_installation_required`). | 10-26 | `3edba1157` | Apps and tools | done (Nov 5, `integrate/chat-apps`) |
| U25 | **Runner Test re-qualifies** the saved computer (`qualify-runner`), not only the environment test. | 10-26 | `f0877a9c7` | `agents/runtime` | done (Nov 5, `integrate/agents-runs`) |
| U26 | **Case types** (`GET …/cases/types`). There's no case list (decision F); check whether Group: Case needs it. | 10-22 | `505e1a558` | `cases/browse` | left out (Nov 5): Group: Case uses each case's own type, and nothing filters by type |
| U27 | **Kimi progress channel** (`payload.update.channel`) in native transcripts. | 11-01 | `59da15066` | `runs-adapters/runs` | closed (Nov 5): the channel is only in the old UI's database-event transcript, which `ui-new` doesn't port |
| U28 | **Live update interests:** `live.hello` and `live.interests` for run events, and `live.resync` with `controller_change`. | 10-29, 11-01 | #17456, #18518 | `shell/live-updates` | done (Nov 5, `integrate/chat-apps`), with the read-mark narrowing and Updates refreshing on run changes. A view that streams a run's transcript must hold `useRunInterest` |
| U29 | **Plugin bridge retry policy**: upstream's backoff, keeping the last good data. `ui-new` retries twice. | 10-29 | — | `shell/plugins` | done (Nov 5, `integrate/chat-apps`); `Retry-After` isn't honoured (`ApiError` keeps no headers) |
| U30 | **Plugin task side panels** opened by hand while the agent is idle and on runtime activity (`?view=plugin-panels`), availability checked with `runId` and `issueId` instead of polled. | 11-01 | #18131, #18363 | `shell/plugins` | done (Nov 5, `integrate/chat-apps`) |
| U31 | **`expectedVersionId` on ordinary Studio saves** and deletes, with a notice on 409. | 11-01 | #18334 | Skills | done (Nov 5, `integrate/chat-apps`) |
| U32 | **Nav counts from `GET …/attention/summary`.** | 11-01 | #18323 | `shell/navigation` | left out (Nov 5): the summary still counts requests on the aging shelf, which Needs you folds away, and gives no shelf count, so it can't be the nav's count (decision 24). The nav keeps the feed |
| U33 | **Decision history in the Inbox** (`GET …/attention/history`, cursor-paged). | 10-29 | #17983 | `inbox-search/triage` | done (Nov 5, `integrate/inbox-shell`): a History tab at `/inbox/history` with filters; covers interactions and Decisions, not approvals |
| U34 | **Chat task default**: an unassigned task made in chat goes to the chat's agent. Check `ui-new`'s chat task creation. | 10-29 | #17983 | `agent-chat/history + /handoff` | checked (Nov 5): no conflict; a suggested task in a chat now names the chat's agent |
| U35 | **Onboarding** against the new approval-before-tasks and first-task rules (server-only changes). | 10-29 | #17914, #17940 | Companies and onboarding | checked (Nov 5): matches |
| U36 | **The Coordinator workspace**, and the requests it uses (`pending-questions`, `decision-receipts`, `chat-handoffs`, document revisions, `attention/history`, `workspace-preferences/me`). Since Nov 7 it's the old UI's default for everyone: "Needs you" is renamed Inbox, Mine, Unread, Recent, Blocked and Everything move inside Tasks, All tasks is the first-visit default, and Classic is a per-person opt-in (`classic_workspace_enabled`). | 10-29, 11-01, 11-07 | #17983, #19360, #19363, #19393 | `shell/coordinator-workspace`, `inbox-search/triage`, `tasks/views` | decided (Nov 8, after using it on TES): `ui-new` keeps its own layout, and the Coordinator workspace isn't ported. Two of its ideas come into the Inbox: a minimal collapsed state for every request card, with Collapse all, and grouping by task, agent or project. A design artboard comes first, for review; the build follows. Earlier (Nov 7): Inbox separate from Tasks (board 14), `classic_workspace_enabled` ignored, as decision 47 did the Coordinator preference |
| U37 | **Recheck the mirrored effort tables** after the model catalog refresh (decision 13's rule). Probably handled on Oct 26, not confirmed. | 10-26 | #17809 | `tasks/run-control` | done (Nov 5): Codex's `gpt-5.6` alias and case, and Claude and Grok efforts on the Runner, fixed |
| U38 | **Unread chat dot on phones.** | 11-01 | #18374 | `agent-chat/history + /handoff` | done (M7 round 3, status cards: the dock's Agents entry) |
| U39 | **Stale decision text:** decision 1 named pipelines (removed upstream), decision 4 the removed "Run with provider trace" button. | 10-22 | `907774889`, #17211 | — | done (Nov 3) |
| U40 | **Provider usage limit on the task.** Codex and Claude rate-limit windows are saved per agent in `GET …/agents/:id/runtime-state` → `stateJson.providerRateLimits` and shown as a "Usage limit" line under the assignee ("5h 78% · resets 15:40", "Limited until …", "using credits") with a popover of every window. The `agent.runtime_state.updated` live event refreshes it; the summary rules are runtime exports of `@paperclipai/shared` (`summarizeProviderRateLimits`), so `ui-new` copies them. While a limit is active, the agent's queued runs wait as `provider_limit_wait` and the task says "Waiting for usage limit reset". | 11-05 | #19270, #19246 | `tasks/properties`, `agents/runtime` | done (Nov 5, `integrate/task-state`): a Usage limit line under the assignee with a popover, a row on the agent's Runtime section, and held or waiting run labels. The scheduled-retry property can't tell a usage-limit wait from a pool wait (`IssueScheduledRetry` has no `wakeReason`) |
| U41 | **Approving a harness-proposed plan.** Planning runs put Codex and Claude into native plan mode; a completed proposal becomes the task's Plan document and a `request_confirmation` (also on standard tasks). Approve resumes the agent, Request changes sends the reason back; receipts read "Approved Plan v1". | 11-05 | #19291 | `tasks/interactions`, `documents-artifacts/documents + /annotations` | checked (Nov 5): the pending card and the Plan document read well; settled cards read "You approved Plan vN" (with the actor, as other settled lines do) and link to that revision (follow-up, Nov 5). The live flow needs a real planning run |
| U42 | **Task-chat transcript upgrades:** tool rows that say what ran and how it went; Claude subagents as a collapsible tree; an inline diff for every file edit (`diffTruncated`); Codex reasoning summaries as headline bullets; hook and auto-review decisions as governance rows; harness status notices as chips; a warning at the top of the run when an MCP server failed to start; dedicated rows for web searches, model switches, waits and verification checks; the agent's native plan as a checklist card above the composer. | 11-05 | #19252, #19262, #19264, #19265, #19266, #19267, #19269, #19271, #19289 | `runs-adapters/runs`, `agent-chat/history + /handoff`, `tasks/thread` | done (Nov 5, `integrate/transcripts`): in the run modal and the chat's live reply, with a plan dock above the chat composer. Not built: the dock's file-change totals |
| U43 | **Re-sync the copied runner parser** (`ui-new/src/runs/paperclip-runner-parser.ts`): the `plan_proposal` family, the `streaming` status, `diffTruncated` on file changes, and rate-limit notices kept out of the transcript (`isProviderRateLimitNotice`, a runtime export to copy). | 11-05 | #19291, #19269, #19270 | `runs-adapters/runs` | done (Nov 5, `integrate/transcripts`): the copy matches upstream apart from its imports |
| U44 | **One status glyph for every task view.** `blockerAttention` now comes on task summaries, search results and case task links as well as tasks and lists. A blocked task covered by an active sub-task or dependency shows the "in queue" glyph with a reason ("Blocked · waiting on active sub-task X"). `ui-new` ignores `blockerAttention`. | 11-05 | #19329 | `tasks/views`, `tasks/properties`, `inbox-search/search`, `cases/task-links` | done (Nov 5, `integrate/task-state`): one `statusLook`; a covered blocked task keeps Blocked with a segmented Ion capsule and "Waiting on active sub-task X". Not where the data lacks `blockerAttention` (parent summaries, the feed's links, the palette). The chat and project dashboard capsules use it too (follow-up, Nov 5) |
| U45 | **Stop for failed native retries:** `execution.canStop` on the projection; cancel with a saved `cancellationRequestId`, checking the run's `nativeCancellation` intent in the reply; a Stop during slow startup answers 409 `native_stop_pending` and settles later; Stop rather than Cancel for failed runs. `ui-new`'s cancel posts `{}`. | 11-05 | #18899, #19189 | `tasks/run-control`, `runs-adapters/runs` | done (Nov 5, `integrate/task-state`) in the task's Runs and thread: Stop with a saved `cancellationRequestId`, 409 as Stopping…, Cancel vs Stop labels. The run modal and chat use it too, with wait labels (follow-up, Nov 5) |
| U46 | **Recovery presentation:** the saved-work recovery step (`recoveryStep`: checking the previous run, saving its files, finishing); a persisted Retry wait (`execution.retryWait`); Retry stays unclickable while a Retry is being prepared; "Recover saved files" on native export holds (`POST …/recovery-actions/recover-workspace`, with a saved idempotency key); named restore failures handed to the board. | 11-05 | #19260, #18845, #19268, #18848, #19207, #19208 | `tasks/recovery` | done (Nov 5, `integrate/task-state`): saved-work step, Retry wait, server-held Retry, Recover saved files with a saved request key, named restore failures |
| U47 | **Setup-draft assignees aren't "paused".** For `pauseReason: "setup"` the task says the agent is still being set up (runs start when setup finishes), or links to Finish setup when the draft is parked, never Resume. `ui-new/src/tasks/TaskNotices.tsx` says "… is paused". | 11-05 | #19322 | `tasks/recovery` | done (Nov 5, `integrate/task-state`): a setup notice with Finish setup instead of Paused |
| U48 | **Enter sends in task composers.** Enter sends task replies and new tasks and Shift+Enter adds a line, keeping autocomplete and IME confirmation; `enableLegacyComposerSubmit` brings back Command/Ctrl+Enter. `ui-new` sends with Command/Ctrl+Enter. | 11-05 | #19272 | `tasks/create`, `tasks/thread`, `steering/*` | done (Nov 5, `integrate/composer-requests`): Enter sends (Cmd/Ctrl+Enter too), Shift+Enter adds a line; with `enableLegacyComposerSubmit` on, only Cmd/Ctrl+Enter sends. Until the setting loads, Enter adds a line. On phones with the setting off there's no way to type a new line, as in the old UI. The runner-goal editor keeps Cmd/Ctrl+Enter; agent chat always sends with Enter, as the old UI's does |
| U49 | **Queued receipts:** a saved card response (approval, answer, declined connection) no longer hides the user's own queued messages, and its entry carries `source.summary` ("Declined: Slack connection"). | 11-05 | #19331 | `steering/*` | done (Nov 5, `integrate/composer-requests`): fixed entries show `source.summary`; the queue scrolls |
| U50 | **Confirmation prompts as Markdown,** in compact and expanded cards and receipts. `ui-new` puts the prompt into a plain title (`request-model.ts`). | 11-05 | #18851 | `tasks/interactions` | done (Nov 5, `integrate/composer-requests`): the prompt renders as Markdown on the card, with a plain title for rows; images become references. Settled receipts show the title only |
| U51 | **Reads that survive outages** (persisted approved reads, resilient component reads, read error rendering). | 11-05 | #18825, #18822 | `shell/live-updates` | done (Nov 7, with U13): an allowlist of reads saved for 24 hours per user and company, cleared on a build change or sign-out, credentials stripped; failed reads say why on the core screens; the run log keeps its chunks through an outage |
| U52 | **Manager picker on the agent profile,** with linked agent chips, blocking the agent itself and its reports; roster status and chat cells. | 11-05 | #18716 | `agents/organization`, `agents/overview` | done (Nov 5, `integrate/settings-checks`): a link to the manager, Direct reports chips, and "Manager unavailable". Not ported: the old roster's chat-cell tooltip, row highlight and floating bulk card, and greyed-out loop managers (ui-new hides them) |
| U53 | **Google Workspace connector flag** (`enableGoogleWorkspaceConnector`, off by default, server-enforced): while it's off, Paperclip's own Google Workspace connector is hidden and blocked and the Composio and Arcade Google apps show. | 11-05 | #19247 | Apps and tools | done (Nov 5, `integrate/settings-checks`): fixed. While the connector is off, Paperclip's per-service Google tiles show only for an existing connection, and the gateways' Google apps show |
| U54 | **`membershipRole` in the company user directory** (`GET …/user-directory`). | 11-05 | #15183 | Company settings | done (Nov 5, `integrate/settings-checks`): Members still needs `/members`, but lists the directory's people and roles read-only on a 403; the GitHub bot's Access tab reads the directory |
| U55 | **Deleting a project or agent can return 409** (`project_execution_admission_pending`, `agent_execution_admission_pending`) while a run's admission is unsettled. Project concurrency limits have storage but no API yet. | 11-05 | #18746 | `projects/lifecycle`, `agents/lifecycle` | checked (Nov 5): ui-new has no project delete, and the rejected-hire delete's toast shows the server's message |
| U56 | **Project storage is fixed at creation:** no "inherit the installed default" choice, and the control is locked on a plugin-backed project (the server refuses the change). `ProjectWorkspaceProviderConfiguration.source` lost `"default"`. | 11-05 | #19036 | `workspaces/project-workspaces` | done (Nov 5, `integrate/settings-checks`): "The installed default" removed; a plugin-backed project's storage is read-only; New project offers storage when the company has storage plugins (the old UI doesn't) |
| U57 | **Agent Chat is always on.** `enableAgentChat` is a deprecated compatibility key: `getExperimental()` always returns true, stored or managed off values are ignored, and the chat routes no longer answer 404 for "disabled". `ui-new` still gates chat on the flag (`chat/use-chat.ts`, `chat-index.ts`, `ChatRedirect.tsx`, `chat-read.tsx`), shows "needs the instance's agent chat setting" (`ChatView.tsx`) and has a Features switch (`settings/app/features-model.ts`). | 11-07 | #19360 | `agent-chat/history + /handoff`, Instance settings | build (decided Nov 7): remove the gate, the message and the Features switch. Decision 12 records the flag as built in (compatibility key); decision 2 is settled upstream |
| U58 | **Context window and Compact now** in task Properties: a Context row ("10% of 258k") with a hover breakdown of tokens, cost and compactions, refreshed every 8 s while a run is active (`GET /issues/:id/context-usage`, `IssueContextUsage` with a `compaction` state); "Compact now" (board only) queues a short run that does no task work (`POST /issues/:id/context/compact`), also while an Agent Chat waits; a finished run's `context.compacted` events become a thread divider. | 11-07 | #19273, #19378, #19801 | `tasks/properties`, `runs-adapters/runs` | build |
| U59 | **Routine responsible user:** a searchable person picker beside Default agent. `PATCH /routines/:id` takes `responsibleUserId`; `RoutineDetail.canChangeResponsibleUser` says who may change it (`tasks:assign`, instance admins, local operators); each change is a revision and an activity entry. `RecurringDetails.tsx` shows it read-only ("Nobody yet"). | 11-07 | #19128 | `routines/definition` | build |
| U60 | **Agent-created task trees stop at parent → child.** A deeper task an agent asks for becomes a sibling of the requester (`parentAdjusted` on the reply); the server-set `Issue.originIssueId` (migration 0434) records where it came from and feeds `createdFrom` and the `createdFromIssueId` filter (a recorded origin wins). Board users aren't limited. `ui-new`'s thread lists tasks made from this one through `createdFromIssueId` (`TaskActivity.tsx`) and marks `parentId === taskId` as a subtask (`thread-model.ts`), so siblings should show as follow-ups. | 11-07 | #19312 | `tasks/thread`, `task-coordination/delegation + /dependencies` | check: siblings show in the requester's thread as follow-ups, and the Subtasks section doesn't expect them |
| U61 | **Every subtask gets its own execution workspace.** A child never reuses a parent's or ancestor's workspace, by any route: an ancestor's `executionWorkspaceId` on create is dropped silently (only the strategy is kept), `inheritExecutionWorkspaceFromIssueId` copies only project and strategy, and old shared children move at their next run. `ui-new`'s New task "reuse another task's workspace" (`new-task.ts`, `NewTaskDialog.tsx`) can offer the parent's workspace for a sub-task, and the choice would be dropped without a word. | 11-07 | #19860 | `tasks/create`, `tasks/workspace` | check: leave the parent's and ancestors' workspaces out of the reuse list when a parent is set, and check the Details workspace editor |
| U62 | **In Progress only with a run.** Server summaries now project an `in_progress` task with no queued or running run to todo, blocked, in review or monitoring (`displayStatus`). The old UI uses `displayStatus` only while the stored status is `in_progress`, so a saved or optimistic status edit wins; `ui-new`'s `shownStatus` (`ui/status-meta.ts`) always prefers `displayStatus`. | 11-07 | #19453 | `tasks/views`, `tasks/properties` | build (small): follow the old UI's rule in `shownStatus` |
| U63 | **Recovery: confirm the previous server stopped.** New `userAction: "confirm_owner_stop"` when a killed owner can't be proved gone: owners and admins confirm with how they checked (`POST …/recovery-actions/resume-workspace-finalization` with stop evidence, or `…/confirm-controller-stopped`). Retry or Recover stays offered on retryable retained holds whose source can't be verified (`retainedSourceFallback`, the `native_provider_side_effect_pending` cause), and a pending native resume shows "resuming" with its time (`retry_scheduled`, `canRetry: false`) instead of a competing Retry. | 11-07 | #19717, #19742, #19840, #19503, #19523 | `tasks/recovery` | build. The sync added a waiting sentence for `confirm_owner_stop` (`WAITING_TEXT`), so it compiles; the confirm action isn't built |
| U64 | **Queued messages: Interrupt when steering is unavailable.** Interrupt is offered for a live native queue whose `steeringDisposition` is `unsupported` or `temporarily_unavailable`, an Interrupt is a hand-off rather than a failed attempt, Send is accepted before the previous run starts, and trailing spaces are kept. `ui-new`'s `rowDelivery` (`tasks/composer/queue-model.ts`) offers Interrupt only for legacy queues and fresh-session entries, and otherwise shows a disabled Steer. | 11-07 | #19450, #19633, #19370, #19456 | `steering/*`, `tasks/run-control` | build: Interrupt in place of the disabled Steer; check trailing spaces in the composer |
| U65 | **Unread message counts in agent chat pickers** (`unreadMessageCount` on chats). `ui-new` shows unread dots beside agents in the nav and on the dock. | 11-07 | #19627 | `agent-chat/history + /handoff`, `shell/navigation` | build: counts where the dots are (decided Nov 7) |
| U66 | **Chat navigation restored:** the contact directory with search and the create-agent dialog, agent chats pinned with pointer and keyboard reordering, and Recents scrolling under a fixed heading with no row limit. | 11-07 | #19685 | `agent-chat/history + /handoff`, `shell/navigation` | left out (decided Nov 7): starred agents are `ui-new`'s pins. Contacts and Recents: check against the nav's agent list |
| U67 | **Copy your own task message as Markdown,** with the copy control left of the timestamp. `ui-new` copies a whole task as Markdown (`TaskActions.tsx`), not a message. | 11-07 | #19442, #19451 | `tasks/thread` | build |
| U68 | **Thread rendering:** GitHub pull request and issue icons with `owner/repo#n` labels on inline links, image results as compact thumbnail grids, and contained patch previews with highlighted diff source. | 11-07 | #19476, #19626, #19478 | `tasks/thread`, `tasks/discussion` | check against `MessageBody.tsx` and the transcript's file rows |
| U69 | **Assignee avatars in task lists,** people's photos included. `ui-new`'s `TaskList.tsx` draws agent avatars in places. | 11-07 | #18607 | `tasks/views` | check |
| U70 | **Runner selection hidden in setup.** The old UI drops the runner dropdowns from agent setup, onboarding, built-in agent setup, company import and agent configuration: the server picks a qualified runner, and saved runner settings are kept. `ui-new`'s New agent has a Runner row with a switch link (`NewAgentPage.tsx`, `runnerSwitch`); the agent's Runtime section has "Switch to Paperclip Runner" or "Switch to the legacy runner". | 11-07 | #19517 | `agents/hire`, `agents/runtime` | build (decided Nov 7): New agent shows the runner read-only and drops the switch link. Agent Runtime keeps its switch until upstream #17905 lands (the runner-libc-probe-sync patch) |
| U71 | **Agent profile refinements:** a reworked header, inline name editing, identity panels and a sticky save footer; instruction files carry `createdAt` and `updatedAt`; empty direct reports hidden; a Chat action on the roster. | 11-07 | #19535 | `agents/overview`, `agents/instructions`, `agents/roster` | check, with U11 and U52 |
| U72 | **Codex defaults to `gpt-6.1-sol`** (`gpt-5.6-sol` stays selectable; the shared `PAPERCLIP_RUNNER_DEFAULT_MODELS`). The old UI's pool connector takes the new default; `ui-new`'s `apps/pools/pool-model.ts` still adds Codex members on `gpt-5.6-sol`. New local Codex and OpenCode agents now run warm by default (`paperclipRunnerCreationLifecycle`); `ui-new` writes `lifecycleMode: "per_turn"` only for the Runner-only ACPX harnesses, which matches. | 11-07 | #19623, #19888 | Apps and tools, `agents/hire` | build (one line) |
| U73 | **Connection-intent audience:** `setPhase` can send `setupAccess` (all agents, or a list of agent ids), and a tool connection made from a request defaults to all agents. `ui-new`'s `api/connection-intents.ts` sends only the phase. | 11-07 | #19352 | `tasks/interactions`, Apps and tools | check |
| U74 | **Personal AI account defaults:** a crown on the default account, and "Set as default for OpenAI or Claude" on other eligible personal accounts, with Retry on failure (`aiConnectionsApi.setDefault`). | 11-07 | #19845 | Apps and tools | check `AiConnections.tsx`'s personal accounts |
| U75 | **Onboarding:** unified sign-in actions with recovery from failed logins, the custom gateway under Advanced, stalled connection checks recover, account changes after Review, the agent starts when the opening question is answered, the onboarding task closes when the interview moves to chat, one question card, and announcements held until the first task is done. | 11-07 | #19336, #19510, #19505, #19557, #19698, #19886, #19643, #19512, #19514 | Companies and onboarding | check, as U35 was |
| U76 | **Links chat agents now write:** `/<prefix>/approvals/:id`, `/agents/:urlKey`, `/agents/:id/runs/:runId`, `/company/settings/instance/profile`, `/status/:id`, `/activity/commentary`, `/search`. | 11-07 | `29b641166`, `0f19eb39d`, `2fb4837cc`, `38d8ef89c`, #19842 | `shell/misc` | checked (Nov 7, during the sync): each has a route in `App.tsx`; `/company/settings/instance/profile` redirects to Account |
| U77 | **Managed plugin environment rows** (`managedByPaperclip`, `managedPluginEnvironment`; migration 0437), which can fill an unset instance default. `ui-new`'s `isManaged` (`settings/company/environments-model.ts`) will label them "managed by Paperclip". | 11-07 | #19490 | Company settings | check: they aren't mistaken for the managed sandbox or picked as the local default |
| U78 | **Exact revision currency:** an exact document-revision read says whether it's still current (`latestRevisionId`, `isLatest`, `ExactDocumentRevision`). | 11-07 | #19939 | `documents-artifacts/documents + /annotations` | left out: `ui-new` lists and restores revisions but doesn't read one alone. Revisit if the U41 revision link starts reading one |
| U79 | **Monitor waits during an active run** read "Monitor waits for current run" with Check now unavailable, and a busy-workspace wait (`workspace_busy`) is a quiet status in the composer strip and Properties rather than a pinned notice. | 11-07 | #19519, #19507 | `tasks/properties`, `tasks/recovery` | check against the monitor row and the scheduled-retry notice |
| U80 | **`taskIdentityChanged` on task live events:** the old UI refetches its `@task` mention pool only when a task's identifier, title or status changes. `ui-new`'s live updates refresh every issue list on every task event (`lib/live-events.tsx`). | 11-07 | #19931 | `shell/live-updates`, `tasks/discussion` | check: whether the composer's task mentions refetch on every task event |

- Plugin hosting (decision G): built in M6 rounds 2 and 3; the `organizationSwitcher` slot and local
  folders in M7 round 2.
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
| 14 | ~~"Report to chat": let any task or routine deliver its result into a person's chat with the agent~~ | Done upstream on Oct 30, 2026 (#18374, `send_chat_message` and `POST /api/agents/me/chat/messages`; [decision 48](decisions.md#48-upstream-sync-2026-11-01)). |
| 15 | Return the project's and goal's descriptions in `heartbeat-context` | Agents read it first, but it gives only names, so the "why" behind a task reaches them only if they load the full task ([decision 14](decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). |
| 16 | Each adapter's effort choices per model, beside `GET /api/companies/:companyId/adapters/:type/models` | [Decision 13](decisions.md#13-the-task-composer-overrides-runs-for-more-adapters-than-new-task-does). New task and the composer read one list instead of a mirrored copy that drifts. |

## Stage 3: experimental features

### How they're built

- **Plugin first.** One fork plugin, `packages/plugins/fork-paperclip`, can hold all of these. Plugins
  get their own Postgres schema and migrations, JSON routes under `/api/plugins/:pluginId/api/*` (which
  `ui-new` calls like any other API), agent tools, scheduled jobs, event subscriptions, and read access
  to allowed core tables. Plugins never conflict with upstream.
- **A fork skill to steer agents.** Plugins can't add to the core prompt. The skill in [3.10](#310-core-skill-add-on)
  tells agents when to use the plugin's tools: read project docs, save memory, read announcements
  (and when to message the user with upstream's `send_chat_message`).
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

Part of the same idea, noted Oct 28, 2026: chat should offer **prompt suggestions**, a predicted next
message you can accept, as in Claude Code. The Claude Agent SDK already makes them (the
`promptSuggestions` option sends a `prompt_suggestion` after each turn; never on the first turn, and
nearly free because it reuses the prompt cache). Paperclip loses them on the way: `acpx` doesn't pass
the option to the SDK, and `claude-agent-acp` discards the message. Both the adapter's default ACP
engine and the Runner's Claude ACPX profile go through those two packages; the Runner's Claude
Managed driver doesn't use the SDK. Supporting them means forwarding the option and the message,
a run event for it (the Runner's generic `Notification` event could carry it), and an API that keeps
the latest one per chat. Turn it on for chat runs only: ordinary task runs have no person replying,
so there's nothing to predict.

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
scheduled reports, and a report when a milestone is reached. Delivery into the chat now exists
upstream (below); plugins are added only where needed. This is its own feature, added to the
built-in chat as it is.

- **Have:**
  - Recurring tasks: routines with schedule, webhook and API triggers create a task for the agent
    each time.
  - Tasks handed off from a chat already report back to it when they're done (decision 8). That
    covers milestone reports for work that started in the chat.
  - Read markers on tasks (`POST /api/issues/:id/read`), so the chat can show what's new.
- **Have since Nov 1, 2026** (upstream #18374, [decision 48](decisions.md#48-upstream-sync-2026-11-01)):
  any run can post into its agent's chat with the responsible person (`send_chat_message`, or
  `POST /api/agents/me/chat/messages` for HTTP agents). The server picks the chat from the run and
  checks the source task's access; the message names its source task, and the chat is marked
  unread. Upstream's own example is a morning review routine leaving a digest in the chat. This
  replaces the fork plugin tool and the upstream ask planned here.
- **Missing:**
  - Routines triggered by events. They only have schedule, webhook and API triggers.
  - In `ui-new`: ~~the message's source label and unread dots~~ (done in M7 round 3, 2026-11-02;
    the phone dock has no unread count yet); making a recurring task's responsible person editable, since it decides whose chat a briefing reaches
    (`PATCH /routines/:id` doesn't take `responsibleUserId` yet,
    [decision 45](decisions.md#45-gaps-found-building-agents-projects-goals-and-recurring-tasks)).
- **Approach:**
  1. **UI only:** show briefing messages well in the chat: the source label, unread dots, perhaps a
     briefing card style. Done in M7 round 3 except a briefing card style.
  2. **A briefing recurring task:** its instructions (or a fork skill) tell the agent to send the
     result with `send_chat_message`. Try a real morning briefing on TES with a cheap model.
  3. **Milestone reports for work that didn't start in the chat:** something still has to start the
     run when the milestone happens: a plugin watching for events (a list's last task done, a project
     reaching a state) fires the briefing routine through its API trigger.

  Meetings (3.9) use the same delivery for their reminder and agenda.
- **Risk:** low: the delivery is upstream's; only step 3 needs a plugin.

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

### 3.15 An in-app guide to Paperclip

An idea raised Oct 28, 2026, while going through the M7 audit's decisions; not designed or scheduled
yet.

- **The idea:** help people understand what Paperclip is, everything it can do, and when and how to
  use each part. Upstream's docs mostly explain how a feature works and how to configure it; they
  rarely say why you'd choose it or walk through using it. Explaining outside agents for D2 (why
  invite one instead of using a built-in harness, when it helps and when it doesn't, an example flow)
  showed the kind of material that's missing.
- **Two forms:**
  1. **A written user guide**: per feature, what it's for, when it helps and when it doesn't, worked
     examples and an end-to-end flow. Notes start in [guides/](guides/README.md), beginning with
     [outside agents](guides/outside-agents.md); add one whenever a feature needs explaining in a
     decision or review.
  2. **An interactive guide in `ui-new`**: for example a guided tour on first use, "what's this?"
     explanations beside features, or a help page that links each guide to the page where the
     feature lives and offers to try it on sample data.
- **Have today:** `ui-new`'s onboarding (create a company, the first agent, Get started), empty states,
  and upstream's docs in `doc/` and `docs/`.
- **Questions:** how much of it is UI-only (likely all of it: guide text and tours ship with `ui-new`);
  whether the guide text lives in the app or is fetched from docs; how it avoids going stale as
  upstream changes features; and whether it's for first-time users only or a reference too.

### 3.16 Upstream's Coordinator workspace

Raised Oct 29, 2026, when the upstream sync outlined #17983 (`71f0c0c99`, Oct 26–29); the user wants it
investigated and designed for `ui-new`. Compared on Nov 8; decided (below).

- **What upstream built:** a per-person workspace, off by default and turned on in the old UI's
  Settings > Experimental (stored as a workspace preference, `GET|PUT …/workspace-preferences/me`, not
  an instance flag). One conversation per agent; task proposals from chat (a new task with no assignee
  defaults to the chat's agent); compact task and decision cards; document panels beside the chat; a
  Needs You queue with search, filters, grouping and history.
  - **Since the Nov 7 sync** (#19360, #19363, #19393) it's the old UI's default for everyone, and
    Agent Chat is standard. Classic is a per-person opt-in (`classic_workspace_enabled`, migration
    0433), and the old experiment value is ignored. "Needs you" is renamed **Inbox**, with the inbox
    icon; the old Inbox item under More is removed and old Inbox URLs redirect into Tasks. **Tasks**
    hosts Mine, Unread, Recent, Blocked and Everything through the personal-inbox code (read and
    unread state, archive and undo, swipe, grouping, saved columns), with **All tasks** as the
    first-visit default and the "Last updated" header unhighlighted until someone picks a sort.
    Organization table columns are saved per person and company. No API changes.
- **New requests:** `GET /issues/:id/pending-questions`, `/issues/:id/decision-receipts`,
  `/issues/:id/chat-handoffs`, `/issues/:id/documents/:key/revisions/:revisionId`, and
  `GET /companies/:companyId/attention/history` (decision history, cursor-paged).
- **Why it matters here:** it's upstream's own take on what `ui-new` redesigns: the Inbox's Needs you,
  requests (proposal 1) and agent chat (M5). It may change what the redesign should be, or give
  `ui-new` endpoints it lacked (decision history, pending questions).
- **To do:** use it in the old UI on TES; compare it board by board with `ui-new`'s Inbox, request
  cards and chat; decide what to adopt, merge or leave (and, under decision 12, what to do with its
  per-person switch); then design boards for the parts `ui-new` takes. Decided Nov 7: keep
  `ui-new`'s Inbox separate from Tasks (board 14), ignore `classic_workspace_enabled`, and run this
  comparison right after the Nov 7 sync, against the merged Coordinator. **Decided Nov 8**, after the user used the merged Coordinator on TES: `ui-new`'s overall direction stays, and the Coordinator workspace isn't ported. Two ideas come into the Inbox: a slimmer collapsed state for every request card (capsule, kind, title and a few crucial signs; a questions card collapses to its list of questions), with Collapse all, and grouping the cards by task, agent or project. They're designed as a review artboard first. Tracked as
  [U36](#upstream-changes-to-integrate); the area guide entry is
  [`shell/coordinator-workspace`](inventory/areas/app-shell.md#shellcoordinator-workspace-coordinator-workspace).

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
- After each upstream sync, give every change that affects the board a line in
  [Upstream changes to integrate](#upstream-changes-to-integrate), with an outcome, and link it from
  its capability row.
- Upstream syncs can move items between stages. When upstream ships something the plan expected to
  build (as Artifacts V1 and bulk agent edits did on 2026-10-24), update the matching milestone or
  stage 3 entry.
- When a question above is answered, edit the entries it affects, and mark the question answered with
  a link to them. Keep the numbering, since other entries refer to questions by number.
