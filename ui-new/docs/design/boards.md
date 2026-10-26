# Board index

Every screen in the redesign, in canvas order. Each entry links the board's source in
[boards/](boards/), says what it's for and which capabilities from the
[checklist](../inventory/capabilities.md) it covers, and lists the states its tweaks switch between.

**Status:** *Approved* boards are the design to build. *State* boards draw another state of the
board named, from a near-identical file. *Reference* boards document a system rather than a screen.
*On hold* boards are kept for a feature that's waiting on a decision; don't build them yet.

All boards are 1440px wide, drawn in the dark theme, and share the left nav described in the
[design system](design-system.md#components). Boards 1 to 34 are numbered; the later groups use the
canvas's letters: C for cases, N for creating things, R for recurring tasks, L for lists, S for
search. The phone layouts are in [mobile.md](mobile.md).

## Tasks

<a id="board-1"></a>
### 1 · Task list

[Main.dc.html](boards/Main.dc.html) · Approved

A project's tasks grouped by status in group cards, with Backlog and Done collapsed. The project
header card carries key numbers, the agents on the project, and the tabs (List, Board, Agent workload,
Docs, Settings); its title links to the dashboard. The header also has the status disc stacks.

Covers `tasks/views`, `tasks/organize`, `projects/task-context`, `shell/navigation`.

<a id="board-2"></a>
### 2 · Task open: details

[TaskDetail.dc.html](boards/TaskDetail.dc.html) · Approved

A task opened in a panel docked beside the list. The panel takes its own column; the list keeps its
full rows and scrolls sideways, with the Name column pinned. The panel has three sections (Details,
Activity, Docs and files); this board shows Details: description, properties, subtasks and
dependencies, and the task's workspace.

Covers `tasks/properties`, `task-coordination/delegation + /dependencies`, `goals/alignment`,
`tasks/workspace`.

<a id="board-3"></a>
### 3 · Task open: activity thread

[TaskActivity.dc.html](boards/TaskActivity.dc.html) · Approved

The panel's Activity section: the conversation thread with comments, an agent's question as a request
card, the live run, and steering of queued messages.

Covers `tasks/thread`, `tasks/discussion`, `steering/*`, `tasks/interactions`.

<a id="board-5"></a>
### 5 · Task open: docs and files

[TaskFiles.dc.html](boards/TaskFiles.dc.html) · Approved

The panel's Docs and files section: documents, attachments and outputs as tiles.

Covers `documents-artifacts/documents + /annotations`, `documents-artifacts/attachments + /work-products`.

<a id="board-4"></a>
### 4 · Board view

[Board.dc.html](boards/Board.dc.html) · Approved

The same tasks as columns by status, Done collapsed.

Covers `tasks/views`, `tasks/organize`.

<a id="board-6"></a>
### 6 · Task modal: details and activity

[TaskModal.dc.html](boards/TaskModal.dc.html) · Approved

The task opened as a modal over the project instead of a side panel, showing its details and the
activity thread. The scrim sits at z-index 50 so the project header can't show through.

Covers what boards 2 and 3 cover.

<a id="board-7"></a>
### 7 · Task modal: details and docs

[TaskModalFiles.dc.html](boards/TaskModalFiles.dc.html) · Approved

The modal showing details with docs and files.

Covers what boards 2 and 5 cover.

<a id="board-7b"></a>
### 7b · New task

[NewTask.dc.html](boards/NewTask.dc.html) · Approved

The new-task dialog:

- Status, priority, labels and **More fields** on top. More fields adds parent, goal and blocked by
  under Plan, and billing code and private under Admin.
- A bordered title and description, then attachments.
- One assignment row: the assignee capsule summarizes assignee, model and effort. Its menu picks the
  agent on the left and the model and effort on the right, each defaulting to the agent's own setting.
  A reviewer pill, and a + menu that adds approver and watchdog.
- Small pills for work mode, workspace and review policy beside Cancel and Create task.

Tweaks: `assigneeOpen`, `moreOpen` (both start closed).

Covers `tasks/create`, `shell/dialogs` (tasks only), `tasks/privacy`. Every field maps to
`createIssueBaseSchema` in `packages/shared/src/validators/issue.ts`; see decisions
[6](../decisions.md#6-tasks-have-no-due-date) and
[7](../decisions.md#7-model-and-effort-overrides-depend-on-the-agents-adapter).

## Project

<a id="board-8"></a>
### 8 · Project dashboard

[ProjectDashboard.dc.html](boards/ProjectDashboard.dc.html) · Approved

The project's home:

- The header card.
- One full-width card holding Brief (an AI summary with revisions), Budget (month to date, daily
  spend, pace) and Code (repository, branch, open task checkouts, dev server) as three tinted wells.
  Below a divider, "Agents at work" shows each agent's avatar with its current task and recent
  activity on hover.
- "Waiting on you": request cards with a kind filter.
- "Stuck work": items waiting on someone that aren't requests.

Tweak: `requests` (one or two columns).

Covers `projects/task-context`, `projects/summary`, `projects/budget`, `workspaces/project-workspaces`,
`decisions/feed`.

<a id="board-31"></a>
### 31 · Project agent workload

[AgentWorkload.dc.html](boards/AgentWorkload.dc.html) · Approved

The project's Agent workload tab:

- One frame on top: "Who's waiting on whom" chains (details in a tooltip), and open work per agent.
  A "1 suggestion" pill opens Paperclip's proposal as a popover.
- A range control below it:
  - **Today** shows run lanes on an hour grid with a "now" line, each agent's queue on the right.
  - **7 days** and **30 days** show a heatmap. The busiest, most blocked and most spare agents get a
    marker badge with a tooltip.

Tweaks: `range` (today, week, month), `tipOpen`.

A new view with no direct match in the old UI; it draws on `agents/roster` and `runs-adapters/runs`.

<a id="board-32"></a>
### 32 · Project agent workload: last 7 days

[AgentWorkloadWeek.dc.html](boards/AgentWorkloadWeek.dc.html) · State of 31 (`range` = week)

<a id="board-9"></a>
### 9 · Project docs

[ProjectDocs.dc.html](boards/ProjectDocs.dc.html) · Approved

"Project docs and files" for material that belongs to the whole project, then "From tasks": every
task's documents, attachments and outputs grouped by task, with a type filter and closed tasks shown or
hidden.

Covers `documents-artifacts/library`. The project-level section has no API yet; see decision
[1](../decisions.md#1-projects-cant-hold-documents-or-files).

<a id="board-10"></a>
### 10 · Project settings: general

[ProjectSettings.dc.html](boards/ProjectSettings.dc.html) · Approved

One settings page with sections: Details, Visibility and members, Repositories, Project workspaces,
Task checkouts, Execution environment, Environment variables, Monthly budget, Archive.

Tweak: `section` (general, code, environment, budget, archive).

Covers `projects/defaults`, `projects/membership`, `projects/budget`, `projects/lifecycle` (archive),
`workspaces/project-workspaces`.

<a id="board-11"></a>
### 11 · Project settings: code and workspaces

[ProjectSettingsCode.dc.html](boards/ProjectSettingsCode.dc.html) · State of 10 (`section` = code)

## Agents

<a id="board-12"></a>
### 12 · Agent chat: working on a task

[AgentChat.dc.html](boards/AgentChat.dc.html) · Approved

Clicking an agent opens one endless conversation with it. Answered requests settle into the thread;
an activity timeline on the right shows what it's doing now and what's up next.

Tweak: `state` (busy, replying, idle).

Covers `agent-chat/history + /handoff`, `agents/overview`. See decisions
[2](../decisions.md#2-agent-chat-is-off-unless-the-instance-turns-it-on) and
[3](../decisions.md#3-agents-can-work-on-several-things-at-once).

<a id="board-13"></a>
### 13 · Agent chat: replying

[AgentChatReplying.dc.html](boards/AgentChatReplying.dc.html) · State of 12 (`state` = replying)

## Inbox and requests

<a id="board-14"></a>
### 14 · Inbox: needs you

[Inbox.dc.html](boards/Inbox.dc.html) · Approved

Everything waiting on you, as one stack of request cards with a kind filter. Each card has a context
column: the task it's about, the tasks it changes, discussion.

Covers `inbox-search/triage`, `decisions/feed`, `decisions/queues`, `approvals/governance`,
`approvals/tool-review`, `tasks/approvals`. Questions, decisions and approvals are unified as requests
([proposal](../proposals/unifying-requests.md)).

<a id="board-15"></a>
### 15 · Request cards

[RequestCards.dc.html](boards/RequestCards.dc.html) · Reference

The request card system:

- The four kinds: question, proposal, approval and suggested tasks.
- The anatomy of a card.
- Every response shape: options, chips, a field, a diff, code, a meter, an agent, stages.
- States after an answer, including partly applied proposals, approved tool calls that failed, and
  approvals waiting on someone else.

Covers `tasks/interactions`, `approvals/governance`, `approvals/tool-review`.

## Runs

<a id="board-16"></a>
### 16 · Task run: live, from the task thread

[RunModal.dc.html](boards/RunModal.dc.html) · Approved

The run modal opened from the thread. It has a header with stats and four views:

- **Transcript:** messages, thinking, tool calls with diffs.
- **What the agent was sent:** the prompt and what was loaded with it.
- **Raw output.**
- **Provider trace.**

Tweaks: `run` (live, finished), `view` (transcript, input, raw, trace).

Covers `tasks/run-control`, `runs-adapters/runs`, `steering/*`. See decision
[4](../decisions.md#4-a-runs-full-model-input-only-exists-when-provider-tracing-is-on).

<a id="board-17"></a>
### 17 · Task run: what the agent was sent

[RunModalInput.dc.html](boards/RunModalInput.dc.html) · State of 16 (`view` = input)

<a id="board-18"></a>
### 18 · Task run: finished, from agent chat

[RunModalFinished.dc.html](boards/RunModalFinished.dc.html) · State of 16 (`run` = finished, opened over agent chat)

## Organization

<a id="board-19"></a>
### 19 · Org dashboard: org chart

[OrgDashboard.dc.html](boards/OrgDashboard.dc.html) · Approved

The company's home:

- An org chart with an inspector for the selected agent.
- Needs you.
- Recent activity.
- Runs over the last 14 days.
- Projects.
- Spend by agent this month.

Tweak: `selected` (which agent the inspector shows).

Covers `agents/roster`, `agents/organization`, `decisions/feed`, `shell/company`.

<a id="board-20"></a>
### 20 · Org: manage agents

[OrgAgents.dc.html](boards/OrgAgents.dc.html) · Approved

Every agent in a table with filters (all, running, needs attention, paused, idle, built in) and bulk
actions on a selection.

Tweak: `filter`.

Covers `agents/roster`, `agents/lifecycle`, `agents/built-in`.

<a id="board-33"></a>
### 33 · Company agent workload

[OrgWorkload.dc.html](boards/OrgWorkload.dc.html) · Approved

Board 31 for the whole company: agents grouped by team, with open work coloured by project.

Tweaks: `range`, `tipOpen`.

## Settings

<a id="board-21"></a>
### 21 · Company settings: general

[CompanySettings.dc.html](boards/CompanySettings.dc.html) · Approved

Organization settings as one page with a section rail:

- **General:** organization, hiring, agent requests, feedback, danger zone.
- **Members:** people, invites, join requests.
- **Connections:** decision model, fast responses, prompt injection check, run telemetry.
- **Secrets.**
- **Budgets.**

Sections that aren't drawn yet show their planned contents.

Tweak: `section` (general, members, connections, secrets, budgets, environments, transfer, linear).

Covers the Tier 2 "Company settings" row.

<a id="board-22"></a>
### 22 · Company settings: members

[CompanySettingsMembers.dc.html](boards/CompanySettingsMembers.dc.html) · State of 21 (`section` = members)

<a id="board-23"></a>
### 23 · Company settings: connections

[CompanySettingsConnections.dc.html](boards/CompanySettingsConnections.dc.html) · State of 21 (`section` = connections)

<a id="board-24"></a>
### 24 · Company settings: secrets

[CompanySettingsSecrets.dc.html](boards/CompanySettingsSecrets.dc.html) · State of 21 (`section` = secrets)

<a id="board-25"></a>
### 25 · Company settings: budgets

[CompanySettingsBudgets.dc.html](boards/CompanySettingsBudgets.dc.html) · State of 21 (`section` = budgets)

<a id="board-26"></a>
### 26 · Agent settings: model and runtime

[AgentSettings.dc.html](boards/AgentSettings.dc.html) · Approved

An agent's settings with a section rail. Model and runtime has five parts: harness and model, where it
runs, when it wakes, run limits, debugging. Instructions shows the instruction files and a change a run
suggested to `AGENTS.md`, as a diff.

Tweak: `section` (profile, instructions, skills, runtime, tools, secrets, budget, permissions, keys,
history). The rest are outlined on board 30.

Covers `agents/runtime`, `agents/instructions`.

<a id="board-27"></a>
### 27 · Agent settings: instructions

[AgentSettingsInstructions.dc.html](boards/AgentSettingsInstructions.dc.html) · State of 26 (`section` = instructions)

<a id="board-28"></a>
### 28 · App settings: general

[AppSettings.dc.html](boards/AppSettings.dc.html) · Approved

Settings for this instance:

- **General:** deployment and sign-in, privacy, backups.
- **Harnesses:** in use, other built-in, installed from npm.

Tweak: `section` (account, general, orgs, admins, harnesses, plugins).

Covers the Tier 2 "Instance settings" row.

<a id="board-29"></a>
### 29 · App settings: harnesses

[AppSettingsHarnesses.dc.html](boards/AppSettingsHarnesses.dc.html) · State of 28 (`section` = harnesses)

<a id="board-30"></a>
### 30 · Settings outline: every section

[SettingsOutline.dc.html](boards/SettingsOutline.dc.html) · Reference

The map of every settings section across organization, agent and app settings, including plugin
sections. Experimental is not carried over. Use it for the settings sections that have no board yet.

## Reference

<a id="board-34"></a>
### 34 · Agent avatars (reference)

[AgentAvatars.dc.html](boards/AgentAvatars.dc.html) · Reference

The ClipLab avatars:

- Nine poses, and the animated versions used on the project dashboard.
- How an agent's status picks its pose.
- This company's agents.
- 17 palettes plus Muted dream.
- Sizes.

The avatars are rendered from `packages/shared/src/cliplab`.

## Cases

Shown only when the instance has `enableCases` on. There's no cases page: cases live in the task views
([decision F](../build-plan.md#decisions-to-make-early)). Like upstream's own pages, these boards only
read cases; agents write them. The exceptions are answering a case's requests, starting a draft case
and cancelling a queued hand-off.

<a id="board-c1"></a>
### C1 · Cases, option A (chosen): the task carries the case

[CasesInTask.dc.html](boards/CasesInTask.dc.html) · Approved

The task list (board 1) with cases on the rows, and a task open in the docked panel:

- A task that is a case's main task shows the case ID and its phase ticks; a task linked to a case
  shows the case ID. An "In a case" filter sits beside Group.
- The panel rail gains a **Case** section (Details, Case, Activity, Docs and files, Runs). It shows the
  case's type, ID and status, "This is the case's main task" and Open case; the title and summary; the
  workflow's phase track, each phase with its agent and state (done, working now, up next, waiting on
  you, hand-off queued, rounds taken); a strip with the request when a phase waits on you; the case's
  fields; its documents and files; the hand-offs between agents; other tasks in the case; child cases.

Tweak: `history` (hand-offs shown or hidden).

Covers `cases/structure + /history`, `cases/task-links`.

<a id="board-c2"></a>
### C2 · Cases, option B (chosen): group the list by case

[CasesGrouped.dc.html](boards/CasesGrouped.dc.html) · Approved

The task list with **Group: Case**. Each case is a group card:

- A header with the title, type and ID, status, phase ticks with the current phase, and a few key
  fields as stats, then the workflow's name and the document count.
- A strip when the case waits on you (Review) or has a hand-off queued (Cancel hand-off).
- Rows with a Role column (Main task, Work, Reference), assignee, status and updated, and notes such as
  "Asks you a question" or "Blocked by TRA-41".
- Child cases nest inside their parent's card. A draft case shows "No work yet" and a button that
  starts its workflow.

"Not in a case" comes last, and done cases are hidden behind Show.

Tweak: `fields` (the stats in each header).

Covers `cases/browse` (in place of the case list), `cases/task-links`, `tasks/organize` (Group: Case).

<a id="board-c5"></a>
### C5 · New task: Start case, with an optional workflow template

[CasesNewTask.dc.html](boards/CasesNewTask.dc.html) · Approved

New task (board 7b) with a **Start a case** switch:

- **On:** the assignee sets up a case and makes this task its main task; a line asking for it is added
  to the description. A **Workflow template** picker (None, or one of the company's templates) shows
  a preview: what it's for, how often it's used, its phases with their agents, and its loops and
  waits. The assignee defaults to the first phase's agent ("Sets up the case"), and the button reads
  Create and start case.
- **Off:** an **Add to case** pill links the new task to an existing case, with a role (Work or
  Reference).

The rows behind the dialog show case chips, and "Case requested" on a task whose case is being set up.

Tweaks: `startCase`, `template` (None, Strategy pipeline, Dataset build, Bug fix).

Covers `tasks/create`, `cases/task-links`. Templates are the company's workflows
(`GET /api/companies/:companyId/workflows`).

## Creating things

<a id="board-n1"></a>
### N1 · New project: a modal, like New task

[NewProject.dc.html](boards/NewProject.dc.html) · Approved

A dialog over the task list, laid out like New task:

- An icon tile (the name's first letter or one of 15 icons, on one of 8 colours), then the name and
  description.
- Pills for status (Backlog, Planned, In progress), lead, and visibility (Open, or Private with its
  members), and a target date.
- **Code:** GitHub (repositories from connected accounts; the first is the primary, each with its
  branch), a local folder on the server, or none.

Tweaks: `iconOpen`, `repoOpen`.

Covers `projects/lifecycle` (create), `projects/membership`, `workspaces/project-workspaces`,
`shell/dialogs`.

<a id="board-n2"></a>
### N2 · New agent, a page: profile

[NewAgentProfile.dc.html](boards/NewAgentProfile.dc.html) · Approved

A page (Agents / New agent) in two steps, Profile and Harness and model, with a preview card on the
right. Profile has the avatar (one of 16 ClipLab palettes, or an uploaded image), name, role, reports
to, title, and "What they do", which other agents read when they decide what to hand over. Continue
saves the agent as a paused draft that can be finished later from Agents.

Tweaks: `step` (profile, harness and model), `needsApproval`.

Covers `agents/hire`.

<a id="board-n3"></a>
### N3 · New agent, a page: harness and model

[NewAgentModel.dc.html](boards/NewAgentModel.dc.html) · State of N2 (`step` = harness and model)

The harness (Claude Code, Codex, OpenCode, Gemini CLI, Cursor, Pi, Kimi, Hermes, each with how many
agents use it), its sign-in, the model, where it runs, thinking effort, the runner (Paperclip Runner
where the harness supports it), and Test. The button is Hire agent, or Ask for approval when the
organization approves new agents first (`needsApproval`).

<a id="board-n4"></a>
### N4 · New task: the Repeat menu

[NewTaskRepeat.dc.html](boards/NewTaskRepeat.dc.html) · Approved

New task (board 7b) with a **Repeat** pill. Its menu:

- **On a schedule:** Daily, Weekdays, Weekly (pick days), Monthly (on a day) or Custom (cron), a time
  and time zone, and the next three runs.
- **When a webhook arrives:** sent by an app or script, or by GitHub.
- **If the last one is still open:** add it to the open one, skip it, or create another anyway.
- Don't repeat, and Done.

With Repeat on, the dialog becomes "New recurring task". Only the fields a recurring task copies to
each occurrence stay: title, description, assignee (agents only), project, priority, goal and parent.
Status, labels, attachments, reviewer, approver, watchdog, model and effort, the Admin fields and the
footer pills go away, and a tooltip on the pill says so. The button is Create recurring task, with
"create and start the first one now" in its menu.

Tweaks: `repeat` (off, daily, weekdays, weekly, monthly, custom), `repeatOpen`, `webhook`, `connect`
(no, waiting, received, rejected), and board 7b's `assigneeOpen` and `moreOpen`.

Covers `tasks/create`, `routines/definition`, `routines/triggers`, `routines/delivery`. Saving creates
a routine and its triggers (`POST /api/companies/:companyId/routines`,
`POST /api/routines/:id/triggers`).

<a id="board-n5"></a>
### N5 · New task: a recurring task, ready to create

[NewTaskRecurring.dc.html](boards/NewTaskRecurring.dc.html) · State of N4 (`repeatOpen` off)

The pill reads "Weekdays at 09:00", and "First one Mon Oct 26, 09:00" sits beside the button.

<a id="board-n6"></a>
### N6 · New task: Repeat with a webhook as well

[NewTaskWebhook.dc.html](boards/NewTaskWebhook.dc.html) · State of N4 (`webhook` on)

<a id="board-n7"></a>
### N7 · New task: after Create, connect the webhook

[NewTaskConnect.dc.html](boards/NewTaskConnect.dc.html) · State of N4 (`connect` = waiting)

After Create, a "Connect your app" (or "Connect GitHub") dialog: the triggers as chips, the webhook
URL and its secret (shown only now; rotate it later from the recurring task's panel), "Copy setup
steps for an agent", and a live check for a test event (waiting, received, or a signature that didn't
match). Turn on webhook, or Finish later, which leaves the webhook off.

## Recurring tasks

Routines become tasks marked recurring, with no Routines page
([build plan](../build-plan.md#routines-decisions-and-governance)).

<a id="board-r1"></a>
### R1 · Recurring tasks: a view of the task list

[Recurring.dc.html](boards/Recurring.dc.html) · Approved

The task list with **Show: Recurring** (beside Tasks, in the toolbar) and Group: Folder. Each row has
the name, assignee, when it runs (its trigger kinds and schedule), the next run, the last run (the task
it made and its status), and an on switch. A row expands to its recent runs, and each folder has an
actions menu. Opening a row docks the recurring task's panel, with Details, Runs and History.

Tweaks: `panel` (none, details, runs, history), `runOpen`.

Covers `routines/management`.

<a id="board-r2"></a>
### R2 · Recurring task: triggers, inputs and run policy

[RecurringDetails.dc.html](boards/RecurringDetails.dc.html) · State of R1 (`panel` = details)

The panel's Details:

- Active switch, next run, Run now.
- Properties (assignee, project, priority, goal, parent task, folder), and the description with its
  placeholders as chips.
- **Triggers:** schedule, webhook (Copy URL, Rotate secret) and API, each with a switch and when it
  last fired; Add trigger.
- **Inputs:** name, type, default and whether it's required, plus the built-in `date`.
- **Secrets.**
- **Run policy:** if the last one is still open, missed runs, and "Only when something changed" (in
  this project or anywhere).

Covers `routines/definition`, `routines/variables + /secrets`, `routines/triggers`,
`routines/delivery`.

<a id="board-r3"></a>
### R3 · Recurring task: runs, with Run now

[RecurringRuns.dc.html](boards/RecurringRuns.dc.html) · State of R1 (`panel` = runs, `runOpen` on)

Each run's time, source (schedule, webhook, API, Run now) and outcome: the task it made and that
task's status, or skipped, added to the open one, or failed with the reason. A filter (all, created a
task, no task). The Run now popover takes the inputs and who to assign.

Covers `routines/run-now + /history`.

<a id="board-r4"></a>
### R4 · Recurring task: history of changes

[RecurringHistory.dc.html](boards/RecurringHistory.dc.html) · State of R1 (`panel` = history)

Revisions with who, when and what changed, and Restore on older ones.

Covers `routines/run-now + /history` (revisions).

## Lists (on hold)

On hold: lists need their own storage, since goals don't fit
([decision 14](../decisions.md#14-lists-need-their-own-storage-so-theyre-on-hold)). The boards are
kept for when lists come back ([3.3](../build-plan.md#33-lists-and-sprints-on-hold)). No capability of
the old UI depends on them.

<a id="board-l1"></a>
### L1 · Lists: the task list grouped by list

[Lists.dc.html](boards/Lists.dc.html) · On hold

The task list with Group: List. Each list's card shows its status, progress by status ("n of m
done"), owner, details and add task; tasks in no list come last.

Tweaks: `panel` (none, list), `newList`.

<a id="board-l2"></a>
### L2 · A list open in the docked panel

[ListDetails.dc.html](boards/ListDetails.dc.html) · On hold · State of L1 (`panel` = list)

The list's status, owner, the company goal it serves, created date, description, progress, and who's
on it. Show only this list.

<a id="board-l3"></a>
### L3 · New list

[NewList.dc.html](boards/NewList.dc.html) · On hold · State of L1 (`newList` on)

Name, description, status, owner, the goal it serves, and tasks to move into it.

<a id="board-l4"></a>
### L4 · Project dashboard with its lists

[ProjectDashboardLists.dc.html](boards/ProjectDashboardLists.dc.html) · On hold

Board 8 with a Lists section: each list's progress, status, owner and what's moving now, New list,
and achieved lists folded away.

Tweak: `requests`, as on board 8.

## Search

<a id="board-s1"></a>
### S1 · Search: everything, grouped by kind

[Search.dc.html](boards/Search.dc.html) · Approved

A search page:

- The query, scope tabs with counts (All, Tasks, Comments, Docs, Files, Agents, Projects), filter
  chips, a Filter menu (status, priority, assignee, project, label, updated; they can also be typed,
  like `status:blocked` or `updated:7d`) and sort.
- In All, a section per kind with its top results and "All n": tasks (status and the matched
  snippet), agent chats (shown as chats, not tasks), comments (author and snippet), docs (revision and
  snippet), files, agents and projects. Matches are highlighted.
- A "Narrow tasks" column with counts per status, assignee and updated.

Tweaks: `scope`, `filterMenu`, `noResults`.

Covers `inbox-search/search` (`GET /api/companies/:companyId/search`; the facet counts are its
`filterOptionCounts`).

<a id="board-s2"></a>
### S2 · Search: tasks, with filters and the Filter menu

[SearchTasks.dc.html](boards/SearchTasks.dc.html) · State of S1 (`scope` = tasks, `filterMenu` on)

<a id="board-s3"></a>
### S3 · Search: no results, with ways to loosen the filters

[SearchEmpty.dc.html](boards/SearchEmpty.dc.html) · State of S1 (`noResults` on)

"No tasks match these filters", with ways out: remove one filter (with the count it would give), or
clear every filter. These come from the response's `zeroResults`.
