# Capability checklist

One row per capability of the existing UI. This is the tracking document for the redesign: fill in
**New home** while designing `ui-new`'s structure, and **Status** while building. Each ID links to its
entry in the area guide, which lists the requests behind it.

Status values: blank (not decided), `planned`, `partial`, `done`, `dropped` (say why in Notes).

Seeded from the area guides; edit by hand from here on. When an upstream sync adds a capability
(see the inventory diff), add a row.

## Tier 1: redesign

### App shell

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [shell/navigation](areas/app-shell.md#shellnavigation-sidebar) | Sidebar | | | |
| [shell/contextual-sidebars](areas/app-shell.md#shellcontextual-sidebars-section-sidebars) | Section sidebars | | | |
| [shell/command-palette](areas/app-shell.md#shellcommand-palette-command-palette) | Command palette | | | |
| [shell/shortcuts](areas/app-shell.md#shellshortcuts-keyboard-shortcuts) | Keyboard shortcuts | | | |
| [shell/dialogs](areas/app-shell.md#shelldialogs-global-create-dialogs) | Global create dialogs | | | |
| [shell/live-updates](areas/app-shell.md#shelllive-updates-live-updates-and-toasts) | Live updates and toasts | | | |
| [shell/company](areas/app-shell.md#shellcompany-company-context) | Company context | | | |
| [shell/plugins](areas/app-shell.md#shellplugins-plugin-extension-points) | Plugin extension points | | | |
| [shell/misc](areas/app-shell.md#shellmisc-other-shell-features) | Other shell features | | | |

### Tasks

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [tasks/views](areas/tasks.md#tasksviews-task-views) | Task views | | | |
| [tasks/organize](areas/tasks.md#tasksorganize-filter-sort-group-board) | Filter, sort, group, board | | | |
| [inbox-search/triage](areas/tasks.md#inbox-searchtriage-inbox-triage) | Inbox triage | | | |
| [inbox-search/search](areas/tasks.md#inbox-searchsearch-search) | Search | | | |
| [tasks/create](areas/tasks.md#taskscreate-new-task-dialog) | New-task dialog | | | |
| [tasks/thread](areas/tasks.md#tasksthread-conversation-thread) | Conversation thread | | | |
| [tasks/discussion](areas/tasks.md#tasksdiscussion-comment-and-reassign) | Comment and reassign | | | |
| [steering/*](areas/tasks.md#steering-queued-messages-steer-interrupt-stop) | Queued messages, steer, interrupt, stop | | | |
| [tasks/interactions](areas/tasks.md#tasksinteractions-agent-requests-in-the-thread) | Agent requests in the thread | | | |
| [tasks/approvals](areas/tasks.md#tasksapprovals-approvals-on-a-task) | Approvals on a task | | | |
| [tasks/run-control](areas/tasks.md#tasksrun-control-runs-live-state-and-run-debugging) | Runs, live state and run debugging | | | |
| [tasks/properties](areas/tasks.md#tasksproperties-properties-panel) | Properties panel | | | |
| [task-coordination/delegation + /dependencies](areas/tasks.md#task-coordinationdelegation-and-dependencies-subtasks-and-blockers) | Subtasks and blockers | | | |
| [task-coordination/tree-control](areas/tasks.md#task-coordinationtree-control-pause-resume-cancel-restore-a-task-tree) | Pause, resume, cancel, restore a task tree | | | |
| [tasks/lifecycle](areas/tasks.md#taskslifecycle-other-header-actions) | Other header actions | | | |
| [tasks/privacy](areas/tasks.md#tasksprivacy-private-tasks-and-sharing) | Private tasks and sharing | | | |
| [documents-artifacts/documents + /annotations](areas/tasks.md#documents-artifactsdocuments-and-annotations-task-documents) | Task documents | | | |
| [documents-artifacts/attachments + /work-products](areas/tasks.md#documents-artifactsattachments-work-products-files-and-outputs) | Files and outputs | | | |
| [tasks/workspace](areas/tasks.md#tasksworkspace-execution-workspace-on-the-task) | Execution workspace on the task | | | |
| [tasks/recovery](areas/tasks.md#tasksrecovery-recovery-and-health-notices) | Recovery and health notices | | | Upstream sync 2026-10-15: execution blocker notice gained "Recovery details" (`GET /api/issues/:id/recovery-actions`, polled every 5s). Upstream sync 2026-10-18: "Continue from saved sources" after a destroyed workspace (`POST /api/issues/:id/recovery-actions/reconstruct-workspace`) |
| [tasks/runner-goal](areas/tasks.md#tasksrunner-goal-runner-goal) | Runner goal | | | |
| [tasks/feedback](areas/tasks.md#tasksfeedback-feedback-votes) | Feedback votes | | | |
| [tasks/integrations](areas/tasks.md#tasksintegrations-integrations-surfaced-on-a-task) | Integrations surfaced on a task | | | |

### Projects and workspaces

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [projects/lifecycle](areas/projects.md#projectslifecycle-create-list-archive) | Create, list, archive | | | |
| [projects/membership](areas/projects.md#projectsmembership-join-leave-star) | Join, leave, star | | | |
| [projects/task-context](areas/projects.md#projectstask-context-project-tasks) | Project tasks | | | |
| [projects/defaults](areas/projects.md#projectsdefaults-project-configuration) | Project configuration | | | |
| [projects/budget](areas/projects.md#projectsbudget-project-budget) | Project budget | | | |
| [projects/summary](areas/projects.md#projectssummary-ai-summaries) | AI summaries | | | |
| [workspaces/project-workspaces](areas/projects.md#workspacesproject-workspaces-configured-codebases) | Configured codebases | | | |
| [workspaces/overview](areas/projects.md#workspacesoverview-all-workspaces) | All workspaces | | | |
| [workspaces/binding + /services](areas/projects.md#workspacesbinding-and-services-execution-workspace-detail) | Execution workspace detail | | | |
| [workspaces/files-git](areas/projects.md#workspacesfiles-git-files-and-git-state) | Files and git state | | | |

### Agents

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [agents/roster](areas/agents.md#agentsroster-agents-list-and-org-chart) | Agents list and org chart | | | |
| [agents/organization](areas/agents.md#agentsorganization-reporting-relationships) | Reporting relationships | | | |
| [agents/primary-agent](areas/agents.md#agentsprimary-agent-personal-primary-agent) | Personal primary agent | | | |
| [agents/membership](areas/agents.md#agentsmembership-join-leave-star) | Join, leave, star | | | |
| [agents/hire](areas/agents.md#agentshire-new-agent) | New agent | | | Upstream sync 2026-10-18: personal Muse invitation variant (`enableMuse`, `/muse-invitations`) |
| [agents/overview](areas/agents.md#agentsoverview-overview) | Overview | | | |
| [agents/lifecycle](areas/agents.md#agentslifecycle-pause-resume-terminate-recover) | Pause, resume, terminate, recover | | | |
| [agents/instructions](areas/agents.md#agentsinstructions-instructions) | Instructions | | | |
| [agents/skills](areas/agents.md#agentsskills-skills) | Skills | | | |
| [agents/runtime](areas/agents.md#agentsruntime-harness--runtime-configuration) | Harness / Runtime configuration | | | Upstream sync 2026-10-18: Muse connection panel for Muse-run agents (`/agents/:agentId/muse-binding/*`, `enableMuse`) |
| [agents/secrets](areas/agents.md#agentssecrets-secrets) | Secrets | | | |
| [agents/tools](areas/agents.md#agentstools-tools) | Tools | | | |
| [agents/channels](areas/agents.md#agentschannels-channels) | Channels | | | |
| [agents/permissions](areas/agents.md#agentspermissions-permissions--trust) | Permissions / Trust | | | |
| [agents/api-keys](areas/agents.md#agentsapi-keys-api-keys) | API keys | | | |
| [agents/revisions](areas/agents.md#agentsrevisions-configuration-revisions) | Configuration revisions | | | |
| [agents/audit](areas/agents.md#agentsaudit-agent-actions-audit) | Agent actions audit | | | |
| [agents/built-in](areas/agents.md#agentsbuilt-in-built-in-agents) | Built-in agents | | | |
| [runs-adapters/runs](areas/agents.md#runs-adaptersruns-run-detail) | Run detail | | | |
| [agent-chat/history + /handoff](areas/agents.md#agent-chathistory-and-handoff-conversations) | Conversations | | | |

### Goals

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [goals/hierarchy](areas/goals.md#goalshierarchy-goal-tree-and-creation) | Goal tree and creation | | | |
| [goals/detail](areas/goals.md#goalsdetail-goal-detail-and-properties) | Goal detail and properties | | | |
| [goals/alignment](areas/goals.md#goalsalignment-goal-context-on-work) | Goal context on work | | | |

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
| [approvals/governance](areas/approvals-decisions.md#approvalsgovernance-approvals-list-and-detail) | Approvals list and detail | | | |
| [decisions/feed](areas/approvals-decisions.md#decisionsfeed-what-needs-me) | What needs me | | | |
| [decisions/queues](areas/approvals-decisions.md#decisionsqueues-decision-queues-and-triage) | Decision queues and triage | | | |
| [approvals/tool-review](areas/approvals-decisions.md#approvalstool-review-app-call-review) | App call review | | | |

### Artifacts

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [documents-artifacts/library](areas/artifacts.md#documents-artifactslibrary-artifact-library) | Artifact library | | | |

### Cases

| ID | Capability | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [cases/browse](areas/cases.md#casesbrowse-case-list) | Case list | | | |
| [cases/structure + /history](areas/cases.md#casesstructure-and-history-case-detail) | Case detail | | | |
| [cases/task-links](areas/cases.md#casestask-links-linked-work) | Linked work | | | |

## Tier 2: port mostly as-is

Tracked per page group; see [areas/settings-and-admin.md](areas/settings-and-admin.md).

| Area | Pages | New home | Status | Notes |
| --- | --- | --- | --- | --- |
| [Company settings](areas/settings-and-admin.md#company-settings) | General, Connections, Members, Secrets, Export, Import, Plugin settings pages, Join requests | | | |
| [Instance settings](areas/settings-and-admin.md#instance-settings) | Profile, Environments, Access, Experimental, Plugins, Adapters, Plugin pages | | | |
| [Skills](areas/settings-and-admin.md#skills) | Library, Sources, Studio | | | |
| [Apps and tools ("Connectors")](areas/settings-and-admin.md#apps-and-tools-connectors) | Browse, Connect, App detail, Review, Assistant connection, Gateways, Advanced, Chat endpoints | | | |
| [Activity and costs](areas/settings-and-admin.md#activity-and-costs) | Activity hub | | | |
| [Companies and onboarding](areas/settings-and-admin.md#companies-and-onboarding) | Companies, Onboarding | | | |
| [Sign-in and connect flows (outside a company)](areas/settings-and-admin.md#sign-in-and-connect-flows-outside-a-company) | Sign in, Board claim, CLI auth, Invite, MCP connect, Chat identity, Cloud OAuth handoff | | | |

## Cross-cutting

| Item | Notes |
| --- | --- |
| Experimental flags | Decide per flag in [generated/flags.md](generated/flags.md): make permanent, drop, or keep as a setting. |
| Plugin extension points | Sidebar slots and launchers, shell overlays, project tabs, settings pages, full pages ([app shell](areas/app-shell.md)). |
| Live updates and toasts | Company event socket and toast rules ([app shell](areas/app-shell.md)). |
| Keyboard shortcuts | Global, list, task-detail and decision shortcuts ([app shell](areas/app-shell.md)). |
| Undecided areas | Dashboard, Board chat, Pipelines, Status cards, User profile: not yet placed in a tier ([README](README.md#undecided)). |
