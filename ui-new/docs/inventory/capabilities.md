# Capability checklist

One row per capability of the existing UI. This is the tracking document for the redesign: fill in
**New home** while designing `ui-new`'s structure, and **Status** while building. Each ID links to its
entry in the area guide, which lists the requests behind it. New home links point to the screens in
the [design handoff](../design/boards.md).

Status values: blank (not decided), `planned`, `partial`, `done`, `dropped` (say why in Notes).

Seeded from the area guides; edit by hand from here on. When an upstream sync adds a capability
(see the inventory diff), add a row.

## Tier 1: redesign

### App shell

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [shell/navigation](areas/app-shell.md#shellnavigation-sidebar) | Sidebar | [1 Task list](../design/boards.md#board-1) (left nav on every board) | partial | M1: the designed nav: company switcher, search and new-task buttons, Org dashboard, Inbox with its badge, All tasks, projects with task counts, agents with live state (running first), and the you menu with settings. Not yet: pause, resume and wake from the nav, starred projects, recent tasks, plugin launchers and slots, collapsing sections. Upstream sync 2026-10-22: Pipelines link and `enablePipelines` removed; recent tasks load as summaries (`GET /api/companies/:companyId/issues/summaries`) |
| [shell/contextual-sidebars](areas/app-shell.md#shellcontextual-sidebars-section-sidebars) | Section sidebars | [21 Company settings](../design/boards.md#board-21), [26 Agent settings](../design/boards.md#board-26), [28 App settings](../design/boards.md#board-28) (settings section rails) | partial | M1: `SectionRail` (headings, items, a trailing tag; a scrolling row when narrow), used by the settings placeholder. The agent, routine, skills and apps rails come with those pages |
| [shell/command-palette](areas/app-shell.md#shellcommand-palette-command-palette) | Command palette | | partial | M1: Cmd/Ctrl+K: actions (new task, theme, shortcuts), pages, projects, agents, and a task search from the server. Not yet: new project (M4) and quick filters (with the task list, M2) |
| [shell/shortcuts](areas/app-shell.md#shellshortcuts-keyboard-shortcuts) | Keyboard shortcuts | | partial | M1: `c`, `/`, `?`, Cmd/Ctrl+K, `g i`, `g d`, and the cheatsheet. List, Inbox, task-detail and decision keys come with those screens; `[` and `]` wait for the collapsible nav and the task panel (M2) |
| [shell/dialogs](areas/app-shell.md#shelldialogs-global-create-dialogs) | Global create dialogs | [7b New task](../design/boards.md#board-7b) (tasks only) | partial | M1: New task, opened from any page through `useCommands().openNewTask()`. New project (M4), new agent and goal (M5), and onboarding come later |
| [shell/live-updates](areas/app-shell.md#shelllive-updates-live-updates-and-toasts) | Live updates and toasts | | partial | M0: one socket per company and cache refreshes. M1: toasts per `doc/TOASTS.md` (eligible task activity, failed runs, join requests), quiet after reconnects and capped per kind. Not ported: the polling fallback |
| [shell/company](areas/app-shell.md#shellcompany-company-context) | Company context | [19 Org dashboard](../design/boards.md#board-19) | partial | M0: company prefix in the URL, last company remembered. M1: the switcher in the designed nav; creating a company is still on the companies page |
| [shell/plugins](areas/app-shell.md#shellplugins-plugin-extension-points) | Plugin extension points | | | Needed before `ui-new` replaces the old UI: React for plugin areas, the bridge registry, module loader, slot mounts and the SDK's shared components ([FORK.md](../../../FORK.md#a-standalone-app-not-a-plugin)).. Upstream sync 2026-10-22: plugins can add agent detail tabs (`detailTab` slots, `/agents/:agentId/plugin:<pluginKey>:<slotId>`) |
| [shell/misc](areas/app-shell.md#shellmisc-other-shell-features) | Other shell features | | | |

### Tasks

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [tasks/views](areas/tasks.md#tasksviews-task-views) | Task views | [1 Task list](../design/boards.md#board-1), [4 Board view](../design/boards.md#board-4) | | Upstream sync 2026-10-22: Retry on interrupted task rows (`POST /api/issues/:issueId/retry`) |
| [tasks/organize](areas/tasks.md#tasksorganize-filter-sort-group-board) | Filter, sort, group, board | [1 Task list](../design/boards.md#board-1), [4 Board view](../design/boards.md#board-4) | | |
| [inbox-search/triage](areas/tasks.md#inbox-searchtriage-inbox-triage) | Inbox triage | [14 Inbox](../design/boards.md#board-14) | | Upstream sync 2026-10-22: Mine leaves out channel and routine work unless the person takes part, is assigned or is asked; Retry on interrupted tasks (`POST /api/issues/:issueId/retry`) |
| [inbox-search/search](areas/tasks.md#inbox-searchsearch-search) | Search | | | |
| [tasks/create](areas/tasks.md#taskscreate-new-task-dialog) | New-task dialog | [7b New task](../design/boards.md#board-7b) | partial | M1: board 7b: project, status, priority, labels, parent, goal, blocked by, billing code, private, attachments, assignee (agent or person) with model and effort ([decision 7](../decisions.md#7-model-and-effort-overrides-depend-on-the-agents-adapter); see [13](../decisions.md#13-the-task-composer-overrides-runs-for-more-adapters-than-new-task-does)), reviewer, approver, watchdog, work mode, workspace, review policy, a saved draft, Create and open. Not yet: @-mentions in the description and Open as full page (M2), reusing another task's worktree |
| [tasks/thread](areas/tasks.md#tasksthread-conversation-thread) | Conversation thread | [3 Activity thread](../design/boards.md#board-3), [6 Task modal](../design/boards.md#board-6) | | |
| [tasks/discussion](areas/tasks.md#tasksdiscussion-comment-and-reassign) | Comment and reassign | [3 Activity thread](../design/boards.md#board-3), [6 Task modal](../design/boards.md#board-6) | | |
| [steering/*](areas/tasks.md#steering-queued-messages-steer-interrupt-stop) | Queued messages, steer, interrupt, stop | [3 Activity thread](../design/boards.md#board-3), [16 Run modal](../design/boards.md#board-16) | | |
| [tasks/interactions](areas/tasks.md#tasksinteractions-agent-requests-in-the-thread) | Agent requests in the thread | [3 Activity thread](../design/boards.md#board-3), [15 Request cards](../design/boards.md#board-15) | |. Upstream sync 2026-10-24: dismiss any request to history without answering (`POST /api/issues/:id/interactions/:interactionId/dismiss`) |
| [tasks/approvals](areas/tasks.md#tasksapprovals-approvals-on-a-task) | Approvals on a task | [14 Inbox](../design/boards.md#board-14), [15 Request cards](../design/boards.md#board-15) | | |
| [tasks/run-control](areas/tasks.md#tasksrun-control-runs-live-state-and-run-debugging) | Runs, live state and run debugging | [16 Run modal](../design/boards.md#board-16) | | |
| [tasks/properties](areas/tasks.md#tasksproperties-properties-panel) | Properties panel | [2 Task details](../design/boards.md#board-2), [6 Task modal](../design/boards.md#board-6) | |. Upstream sync 2026-10-24: Routine row links a routine-created task to its routine (`GET /api/routines/:id`) |
| [task-coordination/delegation + /dependencies](areas/tasks.md#task-coordinationdelegation-and-dependencies-subtasks-and-blockers) | Subtasks and blockers | [2 Task details](../design/boards.md#board-2) | | |
| [task-coordination/tree-control](areas/tasks.md#task-coordinationtree-control-pause-resume-cancel-restore-a-task-tree) | Pause, resume, cancel, restore a task tree | | | |
| [tasks/lifecycle](areas/tasks.md#taskslifecycle-other-header-actions) | Other header actions | | | |
| [tasks/privacy](areas/tasks.md#tasksprivacy-private-tasks-and-sharing) | Private tasks and sharing | [7b New task](../design/boards.md#board-7b) | partial | M1: Private in New task's More fields. Sharing and access come with the task page (M2) |
| [documents-artifacts/documents + /annotations](areas/tasks.md#documents-artifactsdocuments-and-annotations-task-documents) | Task documents | [5 Docs and files](../design/boards.md#board-5), [7 Task modal with docs](../design/boards.md#board-7) | | |
| [documents-artifacts/attachments + /work-products](areas/tasks.md#documents-artifactsattachments-work-products-files-and-outputs) | Files and outputs | [5 Docs and files](../design/boards.md#board-5), [7 Task modal with docs](../design/boards.md#board-7) | |. Upstream sync 2026-10-24: Artifacts V1 presentation in the panel tab and thread behind `enableArtifactsV1` |
| [tasks/workspace](areas/tasks.md#tasksworkspace-execution-workspace-on-the-task) | Execution workspace on the task | [2 Task details](../design/boards.md#board-2), [7b New task](../design/boards.md#board-7b) | | M2 includes the workspace file viewer, built in rather than behind `enableExperimentalFileViewer` ([decision 12](../decisions.md#12-what-happens-to-each-experimental-flag)) |
| [tasks/recovery](areas/tasks.md#tasksrecovery-recovery-and-health-notices) | Recovery and health notices | | | Upstream sync 2026-10-15: execution blocker notice gained "Recovery details" (`GET /api/issues/:id/recovery-actions`, polled every 5s). Upstream sync 2026-10-18: "Continue from saved sources" after a destroyed workspace (`POST /api/issues/:id/recovery-actions/reconstruct-workspace`). Upstream sync 2026-10-22: one interruption state with a single Retry (`POST /api/issues/:issueId/retry`) replaces the recovery notices; "Recovery details" (`GET /api/issues/:id/recovery-actions`) and "Continue from saved sources" (`/reconstruct-workspace`) are no longer used by the old UI. Upstream sync 2026-10-24: project access denial notice with a link to the agent's project access and an explicit retry (`GET /api/agents/:id/project-access`) |
| [tasks/runner-goal](areas/tasks.md#tasksrunner-goal-runner-goal) | Runner goal | | | |
| [tasks/feedback](areas/tasks.md#tasksfeedback-feedback-votes) | Feedback votes | | | |
| [tasks/integrations](areas/tasks.md#tasksintegrations-integrations-surfaced-on-a-task) | Integrations surfaced on a task | | | |

### Projects and workspaces

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [projects/lifecycle](areas/projects.md#projectslifecycle-create-list-archive) | Create, list, archive | [10 Project settings](../design/boards.md#board-10) (archive only) | | |
| [projects/membership](areas/projects.md#projectsmembership-join-leave-star) | Join, leave, star | [10 Project settings](../design/boards.md#board-10) | | |
| [projects/task-context](areas/projects.md#projectstask-context-project-tasks) | Project tasks | [1 Task list](../design/boards.md#board-1), [8 Project dashboard](../design/boards.md#board-8) | | |
| [projects/defaults](areas/projects.md#projectsdefaults-project-configuration) | Project configuration | [10 Project settings](../design/boards.md#board-10), [11 Project settings: code](../design/boards.md#board-11) | | |
| [projects/budget](areas/projects.md#projectsbudget-project-budget) | Project budget | [8 Project dashboard](../design/boards.md#board-8), [10 Project settings](../design/boards.md#board-10) | | |
| [projects/summary](areas/projects.md#projectssummary-ai-summaries) | AI summaries | [8 Project dashboard](../design/boards.md#board-8) | | |
| [workspaces/project-workspaces](areas/projects.md#workspacesproject-workspaces-configured-codebases) | Configured codebases | [8 Project dashboard](../design/boards.md#board-8), [11 Project settings: code](../design/boards.md#board-11) | | |
| [workspaces/overview](areas/projects.md#workspacesoverview-all-workspaces) | All workspaces | | | |
| [workspaces/binding + /services](areas/projects.md#workspacesbinding-and-services-execution-workspace-detail) | Execution workspace detail | | | |
| [workspaces/files-git](areas/projects.md#workspacesfiles-git-files-and-git-state) | Files and git state | | | |

### Agents

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [agents/roster](areas/agents.md#agentsroster-agents-list-and-org-chart) | Agents list and org chart | [19 Org dashboard](../design/boards.md#board-19), [20 Manage agents](../design/boards.md#board-20) | |. Upstream sync 2026-10-24: status tabs removed (old tab URLs redirect to the full roster); harness filter and bulk edit of AI connection and default model (`PATCH /api/agents/:id` `runtimeSettings`) |
| [agents/organization](areas/agents.md#agentsorganization-reporting-relationships) | Reporting relationships | [19 Org dashboard](../design/boards.md#board-19) | | |
| [agents/primary-agent](areas/agents.md#agentsprimary-agent-personal-primary-agent) | Personal primary agent | | | |
| [agents/membership](areas/agents.md#agentsmembership-join-leave-star) | Join, leave, star | | | |
| [agents/hire](areas/agents.md#agentshire-new-agent) | New agent | | | Upstream sync 2026-10-18: personal Muse invitation variant (`enableMuse`, `/muse-invitations`). Upstream sync 2026-10-22: the agent record is saved when the name is submitted, then updated (`POST /api/companies/:companyId/agents`, `PATCH /api/agents/:id`); environment probe (`POST /api/environments/:environmentId/probe`) |
| [agents/overview](areas/agents.md#agentsoverview-overview) | Overview | [12 Agent chat](../design/boards.md#board-12) | | Upstream sync 2026-10-22: header "Run with provider trace" removed (re-run with trace stays on run detail) |
| [agents/lifecycle](areas/agents.md#agentslifecycle-pause-resume-terminate-recover) | Pause, resume, terminate, recover | [20 Manage agents](../design/boards.md#board-20) | | |
| [agents/instructions](areas/agents.md#agentsinstructions-instructions) | Instructions | [27 Agent instructions](../design/boards.md#board-27) | | |
| [agents/skills](areas/agents.md#agentsskills-skills) | Skills | [30 Settings outline](../design/boards.md#board-30) (outline only) | | |
| [agents/runtime](areas/agents.md#agentsruntime-harness--runtime-configuration) | Harness / Runtime configuration | [26 Agent settings](../design/boards.md#board-26) | | Upstream sync 2026-10-18: Muse connection panel for Muse-run agents (`/agents/:agentId/muse-binding/*`, `enableMuse`). Upstream sync 2026-10-22: "Upgrade to Paperclip Runner" for existing Claude and Codex agents. Upstream sync 2026-10-24: qualify the agent's Runner (`POST /api/agents/:id/qualify-runner`) |
| [agents/secrets](areas/agents.md#agentssecrets-secrets) | Secrets | [30 Settings outline](../design/boards.md#board-30) (outline only) | | |
| [agents/tools](areas/agents.md#agentstools-tools) | Tools | [30 Settings outline](../design/boards.md#board-30) (outline only) | | |
| [agents/channels](areas/agents.md#agentschannels-channels) | Channels | [30 Settings outline](../design/boards.md#board-30) (outline only) | | |
| [agents/permissions](areas/agents.md#agentspermissions-permissions--trust) | Permissions / Trust | [30 Settings outline](../design/boards.md#board-30) (outline only) | |. Upstream sync 2026-10-24: project access scope, view and add projects (`GET|POST /api/agents/:id/project-access`) |
| [agents/api-keys](areas/agents.md#agentsapi-keys-api-keys) | API keys | [30 Settings outline](../design/boards.md#board-30) (outline only) | | |
| [agents/revisions](areas/agents.md#agentsrevisions-configuration-revisions) | Configuration revisions | [30 Settings outline](../design/boards.md#board-30) (outline only) | | |
| [agents/audit](areas/agents.md#agentsaudit-agent-actions-audit) | Agent actions audit | | | |
| [agents/built-in](areas/agents.md#agentsbuilt-in-built-in-agents) | Built-in agents | [20 Manage agents](../design/boards.md#board-20) | | |
| [runs-adapters/runs](areas/agents.md#runs-adaptersruns-run-detail) | Run detail | [16 Run modal](../design/boards.md#board-16), [17 Run input](../design/boards.md#board-17) | | |
| [agent-chat/history + /handoff](areas/agents.md#agent-chathistory-and-handoff-conversations) | Conversations | [12 Agent chat](../design/boards.md#board-12) | | |

### Goals

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [goals/hierarchy](areas/goals.md#goalshierarchy-goal-tree-and-creation) | Goal tree and creation | | | |
| [goals/detail](areas/goals.md#goalsdetail-goal-detail-and-properties) | Goal detail and properties | | | |
| [goals/alignment](areas/goals.md#goalsalignment-goal-context-on-work) | Goal context on work | [2 Task details](../design/boards.md#board-2), [7b New task](../design/boards.md#board-7b) | | |

### Routines

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [routines/management](areas/routines.md#routinesmanagement-list-folders-run-now) | List, folders, run now | | | |
| [routines/definition](areas/routines.md#routinesdefinition-overview) | Overview | | | |
| [routines/variables + /secrets](areas/routines.md#routinesvariables-and-secrets-inputs) | Inputs | | | |
| [routines/triggers](areas/routines.md#routinestriggers-triggers) | Triggers | | | |
| [routines/delivery](areas/routines.md#routinesdelivery-delivery-and-run-policy) | Delivery and run policy | | | |
| [routines/run-now + /history](areas/routines.md#routinesrun-now-and-history-runs-activity-revisions) | Runs, activity, revisions | | | |

### Approvals and decisions

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [approvals/governance](areas/approvals-decisions.md#approvalsgovernance-approvals-list-and-detail) | Approvals list and detail | [14 Inbox](../design/boards.md#board-14), [15 Request cards](../design/boards.md#board-15) | | |
| [decisions/feed](areas/approvals-decisions.md#decisionsfeed-what-needs-me) | What needs me | [14 Inbox](../design/boards.md#board-14), [8 Project dashboard](../design/boards.md#board-8), [19 Org dashboard](../design/boards.md#board-19) | | |
| [decisions/queues](areas/approvals-decisions.md#decisionsqueues-decision-queues-and-triage) | Decision queues and triage | [14 Inbox](../design/boards.md#board-14) | | |
| [approvals/tool-review](areas/approvals-decisions.md#approvalstool-review-app-call-review) | App call review | [14 Inbox](../design/boards.md#board-14), [15 Request cards](../design/boards.md#board-15) | | |

### Artifacts

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [documents-artifacts/library](areas/artifacts.md#documents-artifactslibrary-artifact-library) | Artifact library | [9 Project docs](../design/boards.md#board-9) | |. Upstream sync 2026-10-24: Artifacts V1 presentation (stacks and tiles) behind `enableArtifactsV1`; design lab in `ui/src/artifact-directions` |

### Cases

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [cases/browse](areas/cases.md#casesbrowse-case-list) | Case list | | | Upstream sync 2026-10-22: read-only (inline edits and label filter removed, `PATCH /api/cases/:id` unused); type filter (`GET /api/companies/:companyId/cases/types`) |
| [cases/structure + /history](areas/cases.md#casesstructure-and-history-case-detail) | Case detail | | | Upstream sync 2026-10-22: read-only; document editing, revisions, annotations and event history removed; primary-task document previews and handoff history (`GET /api/cases/:caseId/handoffs`) |
| [cases/task-links](areas/cases.md#casestask-links-linked-work) | Linked work | | | Upstream sync 2026-10-22: primary task summary (phase, workflow, pending handoff) and related task links replace the embedded task components |

## Tier 2: port mostly as-is

Tracked per page group; see [areas/settings-and-admin.md](areas/settings-and-admin.md).

| Area | Pages | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [Company settings](areas/settings-and-admin.md#company-settings) | General, Connections, Members, Secrets, Export, Import, Plugin settings pages, Join requests | [21 Company settings](../design/boards.md#board-21), [30 Settings outline](../design/boards.md#board-30) | | Upstream sync 2026-10-22: General gains agent observability (`/observability`, + `/test`); decision model always on Connections; Connections gains prompt injection prevention (`/prompt-injection-prevention`, + `/models`, `/test`) |
| [Instance settings](areas/settings-and-admin.md#instance-settings) | Profile, Environments, Access, Experimental, Plugins, Adapters, Plugin pages | [28 App settings](../design/boards.md#board-28), [30 Settings outline](../design/boards.md#board-30) | | |
| [Skills](areas/settings-and-admin.md#skills) | Library, Sources, Studio | | | Upstream sync 2026-10-22: streamlined `/skills/studio` shows the library filtered to authored skills |
| [Apps and tools ("Connectors")](areas/settings-and-admin.md#apps-and-tools-connectors) | Browse, Connect, App detail, Review, Assistant connection, Gateways, Advanced, Chat endpoints | | | |
| [Activity and costs](areas/settings-and-admin.md#activity-and-costs) | Activity hub | | | Upstream sync 2026-10-22: Commentary tab (`/activity/commentary`; `GET /api/companies/:companyId/agent-commentary`, `/:id`); case filter on the activity log |
| [Companies and onboarding](areas/settings-and-admin.md#companies-and-onboarding) | Companies, Onboarding | | partial | M0: company list with counts (`/companies`); onboarding is M6 |
| [Sign-in and connect flows (outside a company)](areas/settings-and-admin.md#sign-in-and-connect-flows-outside-a-company) | Sign in, Board claim, CLI auth, Invite, MCP connect, Chat identity, Cloud OAuth handoff | | partial | M0: session check and email sign-in (`/auth`); sign-up and the other flows are M6 |

## Cross-cutting

| Item | Notes |
| --- | --- |
| Experimental flags | Decide per flag in [generated/flags.md](generated/flags.md): make permanent, drop, or keep as a setting. |
| Plugin extension points | Sidebar slots and launchers, shell overlays, project tabs, settings pages, full pages ([app shell](areas/app-shell.md)). |
| Live updates and toasts | Company event socket and toast rules ([app shell](areas/app-shell.md)). |
| Keyboard shortcuts | Global, list, task-detail and decision shortcuts ([app shell](areas/app-shell.md)). |
| Undecided areas | Dashboard, Status cards, User profile: not yet placed in a tier ([README](README.md#undecided)). Board chat (`enableConferenceRoomChat`) is dropped ([decision 12](../decisions.md#12-what-happens-to-each-experimental-flag)). Pipelines were removed upstream on 2026-10-22. |
