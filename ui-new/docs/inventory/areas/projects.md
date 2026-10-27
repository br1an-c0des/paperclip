# Projects and workspaces

Tier 1 (redesign). A **project** groups tasks and carries the code context agents work in: repositories or
a local folder, environment variables, and how task checkouts are made. A **workspace** is where code
actually lives on disk. There are two kinds:

- **Project workspaces:** a project's configured codebases (a repository checkout or local folder), one of
  them primary.
- **Execution workspaces:** the concrete checkout a task or run uses, either the shared project workspace
  or an isolated git worktree per task, with optional runtime services (dev servers and similar).

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Projects`,
`ProjectDetail`, `ProjectWorkspaceDetail`, `Workspaces`, `ExecutionWorkspaceDetail`, and **App shell**
for the new-project dialog and memberships. Upstream recipes: `maps/feature-map/projects.md`,
`workspaces.md`, `execution-environments.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Projects list (`pages/Projects.tsx`) | `/:co/projects` | All projects, split into "mine" and others. |
| Project detail (`pages/ProjectDetail.tsx`) | `/:co/projects/:projectId` with tabs `/issues`, `/workspaces`, `/configuration`, `/budget` (`/overview` now opens Configuration) | One project. Plugins can add tabs. |
| Project workspace (`pages/ProjectWorkspaceDetail.tsx`) | `/:co/projects/:projectId/workspaces/:workspaceId` | One configured codebase of a project. |
| Workspaces overview (`pages/Workspaces.tsx`) | `/:co/workspaces` | Every workspace in the company, grouped by project. |
| Execution workspace (`pages/ExecutionWorkspaceDetail.tsx`) | `/:co/execution-workspaces/:workspaceId` with tabs `/services`, `/configuration`, `/runtime-logs`, `/issues`, `/routines` | One task checkout. |
| New-project dialog (`components/NewProjectDialog.tsx`, app shell) | none | Opened from the sidebar and Projects list. |

## Projects

### `projects/lifecycle`: Create, list, archive

- **Where:** new-project dialog; Projects list; project header.
- **What:**
  - *Create:* name (a random color is assigned), source repositories picked from connected GitHub
    repositories, with an inline "Connect GitHub" flow. New projects start as `planned`.
  - *List:* sort by name, created, updated or target date; star toggle; projects you have left are listed
    separately from yours.
  - *Archive* from the project page; archived projects stay in task filters.
- **Requests:** `POST /api/companies/:companyId/projects`,
  `GET /api/companies/:companyId/project-repositories`, `GET /api/companies/:companyId/projects`,
  `PATCH /api/projects/:id` (archive).
- **Notes:** creation is also part of onboarding (`components/OnboardingWizard.tsx`). Recently opened
  projects are tracked locally for the sidebar.

### `projects/membership`: Join, leave, star

- **Where:** project header (`MembershipAction`, `StarToggle`), Projects list.
- **What:** join or leave a project and star it. Membership decides whether the project shows in your
  sidebar and in "mine".
- **Requests:** `GET /api/companies/:companyId/resource-memberships/me`,
  `PUT /api/companies/:companyId/resource-memberships/me/projects/:projectId`.
- **Notes:** the same mechanism exists for agents.

### `projects/task-context`: Project tasks

- **Where:** Project detail → Issues tab.
- **What:** the shared task list (`IssuesList`, same filters, grouping and board as the [Tasks](tasks.md)
  list) scoped to the project; create a task pre-filled with the project.
- **Requests:** `GET /api/companies/:companyId/issues` (project filter), `PATCH /api/issues/:id`.

### `projects/defaults`: Project configuration

- **Where:** Project detail → Configuration tab (`components/ProjectProperties.tsx`).
- **What:**
  - *General:* name, description (markdown, image upload), visibility (open or private, "keep private"),
    target date, created/updated.
  - *Env:* environment variables, with values from company secrets (create a secret inline) or user
    secret definitions.
  - *Environment:* which execution environment runs the project's work (flag `enableEnvironments`).
  - *Codebase:* repositories (`PUT /repositories`) or a local folder; clear local folder. Git
    authorization (since the 2026-10-26 sync): which connection grant background project Git work
    uses, chosen and authorized by a person (`ProjectGitAuthorization.tsx`).
  - *Execution workspaces:* enable isolated task checkouts, git worktree settings (base ref, branch
    template, worktree parent directory), provision / runtime provision / teardown commands, shared
    workspace concurrency.
  - *Access:* add and remove project members for private projects.
- **Requests:** `GET|PATCH /api/projects/:id`, `PUT /api/projects/:id/repositories`,
  `GET|PUT /api/projects/:id/git-authorization`,
  `GET|POST /api/companies/:companyId/secrets`, `GET /api/companies/:companyId/user-secret-definitions`,
  `GET /api/companies/:companyId/environments`, `GET|POST /api/projects/:id/access-members`,
  `DELETE /api/projects/:id/access-members/:memberId`, `POST /api/companies/:companyId/assets/images`.
- **Notes:** attaching a GitHub repository also imports skills from it (see upstream `projects.md`,
  "Automatic repository skills"). Isolated checkouts depend on flags `enableIsolatedWorkspaces` and
  `enableIsolatedWorkspacesByDefault`.

### `projects/budget`: Project budget

- **Where:** Project detail → Budget tab (`BudgetPolicyCard`).
- **What:** set a monthly spending policy for the project; see spend against it.
- **Requests:** `GET /api/companies/:companyId/budgets/overview`,
  `POST /api/companies/:companyId/budgets/policies`.
- **Notes:** company-wide budgets live under Activity and costs (Tier 2).

### `projects/summary`: AI summaries

- **Where:** summary card on project and workspace pages (`SummarySlotCard`).
- **What:** a generated summary of the project or workspace, with revision history and regenerate.
- **Requests:** `GET /api/companies/:companyId/summary-slots/:scopeKind/:slotKey` (+ `/revisions`),
  `POST .../generate`.
- **Notes:** flag `enableSummaries` (default off).

## Workspaces

### `workspaces/project-workspaces`: Configured codebases

- **Where:** Project detail → Workspaces tab (`components/ProjectWorkspacesContent.tsx`); Project
  workspace page.
- **What:** list a project's workspaces; add, edit and remove them; set the primary workspace; edit
  runtime config (services and commands); start, stop and restart runtime services and commands.
- **Requests:** `POST /api/projects/:projectId/workspaces`,
  `PATCH|DELETE /api/projects/:projectId/workspaces/:workspaceId`,
  `POST .../workspaces/:workspaceId/runtime-services/:action`,
  `POST .../workspaces/:workspaceId/runtime-commands/:action`.

### `workspaces/overview`: All workspaces

- **Where:** Workspaces page (`/workspaces`).
- **What:** every project and task workspace grouped by project (projects with running services first):
  path, branch, status, service count and primary service URL, linked tasks. Start/stop services, close
  or reopen a workspace from the card.
- **Requests:** `GET /api/companies/:companyId/workspace-overview`,
  `POST /api/execution-workspaces/:id/runtime-services/:action`,
  `POST /api/projects/:projectId/workspaces/:workspaceId/runtime-services/:action`,
  `GET /api/execution-workspaces/:id/close-readiness`, `PATCH /api/execution-workspaces/:id`.

### `workspaces/binding` and `/services`: Execution workspace detail

- **Where:** Execution workspace page; also reached from a task's workspace card.
- **What:**
  - *Services:* runtime services with ports and URLs; start, stop, restart; service port details.
  - *Configuration:* workspace settings, concrete location (paths and refs), source control, whether to
    inherit the project workspace's runtime config, lifecycle commands, linked objects.
  - *Runtime logs:* runtime and cleanup logs, recent workspace operations.
  - *Tasks:* tasks using this workspace (shared task list); update a task inline.
  - *Routines:* routines bound to the workspace; run one now.
  - *Close / reopen:* a close-readiness check (pending changes, active runs) before closing.
- **Requests:** `GET|PATCH /api/execution-workspaces/:id`,
  `POST /api/execution-workspaces/:id/runtime-commands/:action`,
  `GET /api/execution-workspaces/:id/workspace-operations`, `GET .../close-readiness`,
  `GET /api/heartbeat-runs/:runId/log`, `GET /api/companies/:companyId/routines`,
  `POST /api/routines/:id/run`, `GET /api/companies/:companyId/issues`, `PATCH /api/issues/:id`.
- **Notes:** a running badge doesn't prove the service is reachable from the browser (upstream gotcha).

### `workspaces/files-git`: Files and git state

- **Where:** task side panel files browser and workspace file tabs ([Tasks](tasks.md)); workspace
  configuration (source control).
- **What:** browse workspace files, see branch and repository state, reconcile a diverged branch.
- **Requests:** `GET /api/issues/:issueId/file-resources/*`,
  `POST /api/execution-workspaces/:id/reconcile-branch`.

## Switches that change this area

`enableIsolatedWorkspaces`, `enableIsolatedWorkspacesByDefault`, `enableEnvironments`,
`enableManagedSandboxOnly`, `enableSummaries`, `enableWorkspaceBranchReconcileForward`,
`enableWorkspaceDirtyQuarantineRepair`. Full list with affected files:
[generated/flags.md](../generated/flags.md).

## Redesign notes

- **Three workspace pages for one concept.** Project workspaces, the Workspaces overview and execution
  workspace detail overlap heavily (services, paths, linked tasks). A redesign could present "where the
  code lives" once, with project and task views into it.
- **Project detail is mostly configuration.** The old Overview tab now opens Configuration. The task list
  tab duplicates the main Tasks list with a project filter.
- **Workspace actions also live on tasks.** The task workspace card, files browser and branch reconcile
  ([Tasks](tasks.md)) reach the same records.
- **Membership vs privacy.** Joining/leaving (personal sidebar membership) and access members (who can
  see a private project) are separate mechanisms with similar names.
