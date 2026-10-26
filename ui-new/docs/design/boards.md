# Board index

Every screen in the redesign, in canvas order. Each entry links the board's source in
[boards/](boards/), says what it's for and which capabilities from the
[checklist](../inventory/capabilities.md) it covers, and lists the states its tweaks switch between.

**Status:** *Approved* boards are the design to build. *State* boards draw another state of the
board named, from a near-identical file. *Reference* boards document a system rather than a screen.

All boards are 1440px wide, drawn in the dark theme, and share the left nav described in the
[design system](design-system.md#components).

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
