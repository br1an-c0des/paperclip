# Existing UI inventory

What the current React UI (`ui/`) does, written down so the `ui-new` redesign can regroup pages freely
without dropping functionality.

## How it fits together

| Layer | Files | What it answers |
| --- | --- | --- |
| Generated inventory | [`generated/`](generated/) | Every route, the page behind it, and every API request each page can make. Mechanical and complete. |
| Area guides | [`areas/`](areas/) | What each page is *for*: its sections, what a person can do, and the request behind each action. Written by reading the code. |
| Capability checklist | [`capabilities.md`](capabilities.md) | One row per capability, with where it lives now and where it lands in `ui-new`. The tracking document for the redesign. |

The three share capability IDs such as `tasks/create`, reusing upstream's feature-map IDs (`maps/feature-map/`)
where they exist, so a capability can be followed from the checklist to its guide entry and its requests.

### Why API requests are the backbone

There are far too many buttons to list, but every real action ends in an API request or a navigation. If
`ui-new` covers every request the old UI makes (minus ones dropped on purpose), no functionality is lost.
Cataloguing *capabilities* instead of pages also means pages can be merged or split without losing track.

What a request list can't show, and the area guides must call out explicitly:

- client-side filtering, sorting, grouping and saved views
- keyboard shortcuts, drag-and-drop, and other interactions
- local preferences (browser storage)
- live updates pushed over the company event socket (`/api/companies/:companyId/events/ws`)

## Regenerating

```bash
pnpm --filter @paperclipai/ui-new inventory
```

Run it after every `git sync-ui` and commit the result. `git diff ui-new/docs/inventory/generated` then
shows exactly which routes, pages and requests upstream added, removed or changed. Triage those into the
area guides and the checklist. The output is deterministic, so an unchanged UI produces no diff.

How the generator works (`ui-new/scripts/ui-inventory.mjs`):

- **Routes** come from parsing `ui/src/App.tsx`, including nested routes, `.map()`-generated routes, flag
  conditions and gate wrappers. Only the streamlined shell (the default) is analyzed; production-shell-only
  routes are listed separately.
- **Requests** come from parsing every module in `ui/src/api/`: `api.get/post/...`, `fetch` and
  `requestResponse` calls, inlining the modules' URL helpers and following calls between API methods.
  Direct `fetch`, WebSocket and EventSource calls elsewhere in `ui/src` are included too.
- **Page attribution** follows each page's imports. Requests the app shell (`components/Layout.tsx` and
  the providers in `main.tsx`) can make are listed once under **App shell**, since the shell is on every
  page.

Limits: it's static analysis. It reports requests a page *can* reach through its imports, not ones made
on every visit, and a request reached only through a shared component may belong to a dialog the page
rarely opens. Treat it as a checklist, not a trace.

## Tiers

Every page in `generated/pages.md` falls in one tier. Tier 1 guides go deep; Tier 2 guides stay light.

### Tier 1: redesign

These may be merged or regrouped in `ui-new`.

| Area guide | Pages |
| --- | --- |
| [App shell](areas/app-shell.md) | `components/Layout.tsx` and everything global: sidebar, command palette, new-task and other dialogs, live updates |
| [Tasks](areas/tasks.md) | `Issues`, `IssueDetail`, `Inbox`, `Search` |
| [Projects and workspaces](areas/projects.md) | `Projects`, `ProjectDetail`, `ProjectWorkspaceDetail`, `Workspaces`, `ExecutionWorkspaceDetail` |
| [Agents](areas/agents.md) | `Agents`, `AgentDetail`, `NewAgent`, `AgentChats`, `AgentChat` |
| [Goals](areas/goals.md) | `Goals`, `GoalDetail` |
| [Routines](areas/routines.md) | `Routines`, `RoutineDetail` |
| [Approvals and decisions](areas/approvals-decisions.md) | `Approvals`, `ApprovalDetail`, `WhatNeedsMe`, `DecisionQueuePage` |
| [Artifacts](areas/artifacts.md) | `Artifacts` |
| [Cases](areas/cases.md) | `Cases`, `CaseDetail` |

### Undecided

Not yet placed in a tier: Dashboard (`Dashboard`, `DashboardLive`), Board chat (`BoardChat`), Pipelines
(`Pipelines.tsx`: pipelines, review queue, learnings, item detail; `PipelineSettings`), Status cards
(`StatusCards`), User profile (`UserProfile`).

### Tier 2: port mostly as-is

| Area guide | Pages |
| --- | --- |
| Company settings | `CompanySettings`, `CompanyConnections`, `CompanyAccess`, `Secrets`, `CompanyExport`, `CompanyImport`, `CompanySettingsPluginPage`, `JoinRequestQueue` |
| Instance settings | `ProfileSettings`, `CompanyEnvironments`, `InstanceAccess`, `InstanceExperimentalSettings`, `PluginManager`, `PluginSettings`, `AdapterManager`, `PluginPage` |
| Skills | `CompanySkills`, `SkillSources`, `SkillStudio` |
| Apps and tools | `Browse`, `AppsConnect`, `AppsReview`, `AppDetail`, `AppNotConnected`, `AssistantConnection`, `GatewaysList`, `GatewayDetail`, `AdvancedToolsRoute`, `ProfileWizardRoute`, `ProfileDetailRoute`, `ChatEndpointSetup`, `ChatEndpointDetail` |
| Activity and costs | `AuditHub`, `CompanyActivity` |
| Companies and onboarding | `Companies`, `OnboardingRoutePage` |
| Sign-in and connect flows (outside a company) | `Auth`, `BoardClaim`, `CliAuth`, `InviteLanding`, `McpConnect`, `ChatIdentityConfirm`, `PaperclipCloudOAuthHandoff` |

### Tier 3: skip

Developer and test pages: `DesignGuide`, `TaskChatLab`, `IssueChatLongThreadPerf`, `BootstrapSetupUxLab`,
`CrossIssueCollaborationUxLab`, `ResponsibleUserDenialUxLab`. Redirects and production-shell-only routes
need no port.

## Area guide format

Each guide in `areas/` starts with a short overview of the area and its pages, then one entry per
capability:

```markdown
### `tasks/create`: Create a task

- **Where:** new-task dialog (app shell, `N` shortcut, "New task" buttons on Tasks, Project, Agent pages)
- **What:** title, description (markdown, image paste), project, assignee, priority, status, labels, parent
- **Requests:** `POST /api/companies/:companyId/issues`; `POST /api/companies/:companyId/assets/images` for pasted images
- **Notes:** requires approval when …; live update refreshes lists; draft kept in local storage
- **Source:** `components/NewIssueDialog.tsx`
```

Notes cover what the request list can't: permissions and approval gates, confirmations, client-only
behavior, live updates, and feature flags or gates (a redesign goal is to remove most of those switches,
so each one is recorded where it appears).

Each Tier 1 guide also ends with **Redesign notes**: overlaps with other areas and other observations
that matter when regrouping pages.
