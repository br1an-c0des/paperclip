# Phone layouts

How `ui-new` works on a phone: the navigation, what the phone is for, and every phone screen, with
the desktop boards it corresponds to and the capabilities from the
[checklist](../inventory/capabilities.md) it covers. The sources are in [mobile/](mobile/); see
[README](README.md#reading-a-board-file) for how to read them.

All phone boards are 390×844, drawn in the dark theme with the same tokens as the desktop boards. The
IDs are the phone canvas's own: M1 to M14 for screens, N1, N2 and N5 for navigation. The phone N
boards are unrelated to the desktop N boards (creating things) in [boards.md](boards.md).

## Navigation

**N1, the floating dock, is chosen.** One pill floats at the bottom of every top-level screen with
three places: Inbox (with its count), Tasks and Agents. Only the current place shows its label; the
others are icons. Beside the pill is a 56px round New task button. The dock hides while you scroll
down and comes back when you scroll up.

Tapping Tasks again, while already in Tasks, opens the switcher sheet:

- **Projects:** All tasks and each project with its count, then Project overview and Search
  everything.
- **The company name** at the top is the company dropdown: every company with its projects, agents
  and what needs you. Adding a company happens on desktop.
- **You** is your avatar in the sheet's top-right corner: profile, theme (light, dark, system), push
  notification settings, a pointer to what lives on desktop, and Sign out.

Two alternates are kept to try later:

- **N2, tab bar:** five fixed tabs with labels (Inbox, Tasks, New task in the middle, Agents, You).
  The most familiar pattern, but it takes about 80px all the time.
- **N5, Now:** a home screen instead of tabs (what needs you, agents at work, your projects), with
  every other screen one level down and a Now pill to come back. The calmest option, but moving
  between two places takes more taps.

A side drawer and a single command pill were also tried and rejected.

`ui-new/src/layout/Shell.tsx` currently turns the nav into a drawer on phone-sized screens. The dock
replaces that drawer; the grid change at the breakpoint stays as the
[build plan](../build-plan.md#desktop-first-ready-for-mobile) describes, with the docked side panel
becoming a full-screen page.

## Scope

The phone is for **triage and check-ins**: answer requests, chat with agents, comment on tasks, read
basic documents and create basic tasks. Settings and heavy editing stay on desktop: settings of every
kind, agent workload, the board view, setting up recurring tasks, and the run modal's input, raw
output and provider trace. Phone screens point to desktop where something lives there ("Fix on
desktop", "On desktop").

## Tasks

<a id="phone-m1"></a>
### M1 · Task list

[Main.dc.html](mobile/Main.dc.html)

A project's tasks in status groups. The header has the project (tap its name to switch), key numbers
and the agents on it, then the project views (Overview, List, Docs), Group: Status and quick filters
such as Assigned to me. Rows show ID, title, assignee, priority, subtasks, Running and notes, and the
time; each group has add task and folds.

Desktop: [1](boards.md#board-1). Covers `tasks/views`, `tasks/organize`, `projects/task-context`.

<a id="phone-m2"></a>
### M2 · Task: details

[TaskDetail.dc.html](mobile/TaskDetail.dc.html)

A task as its own page, with Back to the project, watchers and more actions. Under the title: the live
run, subtask progress, and the sections (Details, Activity with new count, Files). Details has status
with quick moves (Move to In review, Mark done), assignee with model and effort, reviewer, priority,
labels, and behind More: project, goal, dates and workspace. Then the description, its documents and
outputs as chips, subtasks, dependencies, and a comment bar at the foot.

Desktop: [2](boards.md#board-2), [6](boards.md#board-6). Covers `tasks/properties`,
`task-coordination/delegation + /dependencies`, `goals/alignment`, `tasks/workspace`.

<a id="phone-m3"></a>
### M3 · Task: activity and commenting

[TaskActivity.dc.html](mobile/TaskActivity.dc.html)

The thread: system lines, comments, an agent's question as a request card, the live run with its last
steps, View run and Stop, and a queued message with Steer now and Edit. The composer has attach,
mention, who it's addressed to, and Queue with a menu to steer now or interrupt.

Desktop: [3](boards.md#board-3), [6](boards.md#board-6). Covers `tasks/thread`, `tasks/discussion`,
`steering/*`, `tasks/interactions`.

<a id="phone-m4"></a>
### M4 · Task: docs and files

[TaskFiles.dc.html](mobile/TaskFiles.dc.html)

Documents (revision, author, comment count, who's editing), attachments (image and log previews) and
outputs (pull request, artifact), with a kind filter and Upload.

Desktop: [5](boards.md#board-5), [7](boards.md#board-7). Covers
`documents-artifacts/documents + /annotations`, `documents-artifacts/attachments + /work-products`.

<a id="phone-m5"></a>
### M5 · Document: the task plan

[Document.dc.html](mobile/Document.dc.html)

A task document read as Markdown: kind, author, revision and time, then the body. Commented passages
are highlighted with a count. At the foot: the revision picker and "Comment on this plan".

Desktop: [5](boards.md#board-5) (a document opened from Docs and files). Covers
`documents-artifacts/documents + /annotations`.

<a id="phone-m6"></a>
### M6 · New task: a quick sheet

[NewTask.dc.html](mobile/NewTask.dc.html)

A sheet over the page: project, title, description, status, priority, labels, and the assignee with
the agent's own model and effort. More adds reviewer, parent and goal. Attach, or take a photo. No
Repeat, cases or run overrides: those stay on desktop.

Tweak: `moreOpen`.

Desktop: [7b](boards.md#board-7b). Covers `tasks/create`, `shell/dialogs` (tasks only).

## Inbox, agents and runs

<a id="phone-m7"></a>
### M7 · Inbox: needs you

[Inbox.dc.html](mobile/Inbox.dc.html)

The Inbox tabs (Needs you, Updates, Alerts, Snoozed, Cleared), a kind filter, and the request cards,
most urgent first, each with its task as a footer: a tool call, a budget stop, a sign-off, a question
form, a yes-or-no question, suggested tasks, a proposal with options and what option 1 changes, and a
formal hire approval with its revision and comments.

Desktop: [14](boards.md#board-14), [15](boards.md#board-15). Covers `inbox-search/triage`,
`decisions/feed`, `decisions/queues`, `approvals/governance`, `approvals/tool-review`,
`tasks/approvals`, `tasks/interactions`.

<a id="phone-m8"></a>
### M8 · Agents

[Agents.dc.html](mobile/Agents.dc.html)

This month's spend against the company budget, split by agent, with running, blocked and paused
counts. A filter (All, Running, Needs attention, Idle) and one row per agent: avatar with status,
model, current task or reason, the last step, answers it's waiting on, unread count. A pending hire
links to its approval in the Inbox.

Desktop: [19](boards.md#board-19), [20](boards.md#board-20). Covers `agents/roster`.

<a id="phone-m9"></a>
### M9 · Agent chat

[AgentChat.dc.html](mobile/AgentChat.dc.html)

The endless conversation with one agent: messages, a task created from the chat, files and documents
it shared, an answered question, a session break, and the live reply with its steps, Transcript and
Stop. While the agent works on a task, a strip shows it with Watch run. The activity sheet (what it's
doing now, up next, today) replaces desktop's right column.

Tweaks: `state` (busy, replying, idle), `activityOpen`.

Desktop: [12](boards.md#board-12), [13](boards.md#board-13). Covers `agent-chat/history + /handoff`,
`agents/overview`.

<a id="phone-m10"></a>
### M10 · Inbox: updates and alerts

[InboxUpdates.dc.html](mobile/InboxUpdates.dc.html)

Updates: a kind filter, Mark all seen, a morning brief card, then updates grouped by time (who did
what, with a snippet, a status change or a run). Alerts: things that broke or are about to (a budget
stop, a failed run, an expiring connection), each with its fixes.

Tweak: `view` (updates, alerts).

Desktop: [14](boards.md#board-14) (its Updates and Alerts tabs). Covers `inbox-search/triage`. The
morning brief depends on [3.13](../build-plan.md#313-briefings-and-reports).

<a id="phone-m11"></a>
### M11 · Run: live, and finished

[Run.dc.html](mobile/Run.dc.html)

A run as a page: agent and task, previous and next run, status, trigger and stats, Stop, Rerun and
Open task. Live, it shows what the agent is doing now and a queued note with Steer now; finished, the
result, changed files, pull request and outputs. Then the transcript with thinking and tool calls.
Input, raw output and provider trace open on desktop.

Tweak: `state` (live, finished).

Desktop: [16](boards.md#board-16), [18](boards.md#board-18). Covers `tasks/run-control`,
`runs-adapters/runs`, `steering/*`.

## Projects and search

<a id="phone-m12"></a>
### M12 · Project: overview

[ProjectOverview.dc.html](mobile/ProjectOverview.dc.html)

The project dashboard stacked: the brief with earlier briefs, waiting on you, agents at work with
their last step, the month's budget with daily spend, stuck work, and the code (repository, branch,
task checkouts, dev server).

Desktop: [8](boards.md#board-8). Covers `projects/summary`, `projects/budget`, `decisions/feed`,
`projects/task-context`, `workspaces/project-workspaces`.

<a id="phone-m13"></a>
### M13 · Project: docs and files

[ProjectDocs.dc.html](mobile/ProjectDocs.dc.html)

A kind filter, the project's own docs and files, then "From tasks" grouped by task, with closed tasks
shown or hidden, and Upload.

Desktop: [9](boards.md#board-9). Covers `documents-artifacts/library`. The project section waits on
project documents ([decision 1](../decisions.md#1-projects-cant-hold-documents-or-files)).

<a id="phone-m14"></a>
### M14 · Search

[Search.dc.html](mobile/Search.dc.html)

Search within the project or everywhere: kind chips with counts, active filters, and results grouped
by kind with highlighted matches. A filter sheet sets where, status, assignee, updated and whether to
include closed tasks. With no results it offers ways to loosen the search; before typing, recent
searches and a note on what's searched (a task ID jumps straight to it).

Tweak: `state` (results, empty, recent).

Desktop: [S1](boards.md#board-s1), [S2](boards.md#board-s2), [S3](boards.md#board-s3). Covers
`inbox-search/search`.

## Navigation boards

<a id="phone-n1"></a>
### N1 · Floating dock (chosen)

[NavDock.dc.html](mobile/NavDock.dc.html)

Four phones: the task list with the dock; the Tasks switcher; the switcher with the company list open;
You, opened from the switcher. See [Navigation](#navigation).

Desktop: the left nav on every board, and [19](boards.md#board-19) for the company. Covers
`shell/navigation`, `shell/company`.

<a id="phone-n2"></a>
### N2 · Tab bar with a You tab (alternate)

[NavTabBar.dc.html](mobile/NavTabBar.dc.html)

Two phones: the task list with a five-tab bar, and the You tab (company and switch, theme, push
settings, and what's on desktop: company settings, secrets, plugins and skills, routines, activity).

Covers `shell/navigation`, `shell/company`.

<a id="phone-n5"></a>
### N5 · Now: a home screen as the hub (alternate)

[NavNow.dc.html](mobile/NavNow.dc.html)

Two phones: the Now screen (what needs you by kind with the most urgent request, agents at work,
projects, New task) and a pushed screen with the Now pill to come back.

Covers `shell/navigation`, `decisions/feed`.
