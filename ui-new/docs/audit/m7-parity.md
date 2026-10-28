# M7 parity audit

Oct 28, 2026 · `new-ui` at `a10a79b02` (M6 round 3 complete) · inventory from upstream `3edba1157`

An audit of `ui-new` against the old UI, to plan M7 ("Ready to replace the old UI"). It reads every
row of [capabilities.md](../inventory/capabilities.md) that isn't `done` or `dropped`, checks the
notes against the code in `ui-new/src/`, and sorts what's left. It then compares the generated
inventory (routes, API methods, flags) with `ui-new`, and looks at the responsive pass,
accessibility and deployment.

How it was done: reading the code and docs only, with throwaway scripts that match the old UI's
request paths (`generated/inventory.json`) against the path fragments in `ui-new/src`. No browser,
no server. Anything not confirmed from code says **unverified**. This document changes nothing
else: `capabilities.md`, `build-plan.md` and `decisions.md` are left for the PM to update.

Buckets used below:

| Tag | Meaning |
| --- | --- |
| **Build S / M / L** | The API supports it. S is under a day for one agent, M a few days, L a week or more. |
| **Drop** | Not worth carrying; the reason is given. |
| **API** | Can't be built on the current API; see [API changes needed](#6-api-changes-needed). |
| **Decide** | A real product choice; see [Decisions needed](#5-decisions-needed). |
| **Done already** | The note is out of date; the code covers it. |

## 1. Summary

**Counts.** Across the 72 rows that aren't `done` or `dropped` (68 partial, 4 blank), the remaining
items sort as:

| Bucket | Items |
| --- | --- |
| Build S | 101 |
| Build M | 23 |
| Build L | 0 (the large pieces are groups of S and M items; see the slices) |
| Drop | 24 |
| API | 12 |
| Decide | 8 (they make up decisions D1, D2 and D5–D10; D3, D4 and D11 come from part B and deploy) |
| Done already | 29 |

The counts are per item in the per-row table (section 3). Part B's findings that land in an
existing row are counted there; its new rows and the deploy items are not.

**Rows that would reach `done`.** If every Build item were finished and the drops accepted, all 72
rows reach `done`, except:

- **10 rows wait on a decision:** the three cases rows (D1), `agents/hire` (D2),
  `inbox-search/triage` (D5), `Skills` (D6), `Company settings` (D7), `agents/runtime` (D8),
  `routines/definition` (D9), `shell/plugins` (D10). Each recommendation in section 5 lets its row
  reach `done` (or, for cases, `done` for the minimal version with the rest `dropped`).
- **10 rows keep API gaps** (for example `projects/membership`'s member roles). They can be marked
  `done` once those gaps are accepted as recorded in `decisions.md`, as `projects/task-context`
  already reads: `tasks/views`, `inbox-search/triage`, `inbox-search/search`,
  `projects/membership`, `projects/task-context`, `projects/defaults`, `projects/budget`,
  `runs-adapters/runs`, `agent-chat/*`, `documents-artifacts/library`.

**Can be marked `done` now.** 13 partial rows have nothing left to build, only stale notes, drops
to accept or API gaps: `shell/contextual-sidebars`, `shell/dialogs`, `shell/live-updates`,
`shell/company`, `tasks/discussion`, `projects/task-context`, `workspaces/files-git` (after a live
check of reconcile), `agents/organization`, `agents/primary-agent`, `agents/lifecycle`,
`goals/alignment`, `routines/triggers`, `approvals/tool-review`.

**One `done` row should go back to `partial`:** `tasks/interactions`. An agent's request to
connect an app (`connection_intent`) can't be answered: the card says "Connecting an app isn't in
this board yet. Use the classic board to finish it." (`requests/request-model.ts:143`). See part B.

**The biggest pieces of work.**

1. **Old links that land nowhere** (part B). Agents link to `/:co/approvals/:id` (the `paperclip`
   skill documents it), and unprefixed `/issues/TES-1`, `/projects/…`, `/agents/…` addresses show
   "No such company". `/issues/active`, project tabs like `/configuration`, and `#comment-<id>` /
   `#document-<key>` fragments on the task page aren't followed either.
2. **Requests that can't be acted on in `ui-new`:** connecting an app from an agent's request,
   deciding a proposal (Decisions, `POST /decisions/:id/decide`), join requests and stalled reviews
   in the Inbox ("Handled outside this board for now").
3. **The task panel's long tail:** the share sheet (access grants), routine/originating/depth rows,
   watchdog and runtime-request answers on runs, workspace operations, plan decompositions,
   review documents.
4. **Tier 2 depth:** environments (create and edit), secret providers, company import into an
   existing organization, the skills catalog and imports, costs beyond the summary, and the
   GitHub and Slack chat-endpoint setups.
5. **Deploy readiness:** no favicons, manifest or service-worker cleanup in `ui-new`; no switch to
   turn on agent chat on a fresh deployment; `CLAUDE_CODE_DISABLE_AUTO_MEMORY` missing from the
   Compose file the build plan says has it.

**Decisions the user must make** (section 5): cases in M7 (D1); external agent invites, Dot, Grok
and Muse (D2); status cards (D3); the user profile page (D4); decide-by and the aging shelf (D5);
Skill Studio test runs (D6); custom sandbox images and the terminal (D7); the old adapter sign-in
flows (D8); comment threads on recurring-task descriptions (D9); plugins that rely on Tailwind
(D10); the installable app and service worker (D11).

## 2. Proposed M7 rounds

Five agent-sized slices, in order of value. Each owns its folders; no two own the same files.
Two shared files every slice may append to: `src/api/queryKeys.ts` and `src/lib/live-events.tsx`
(expect small merge conflicts there, as in M6).

### Slice A: old links, the shell and deploy readiness

- **Goal:** every address the old UI, the `paperclip` skill, emails and Slack messages use lands
  somewhere sensible, the shell's last items are in, and the image is ready to replace the old UI.
- **Builds:**
  - Unprefixed redirects for `/issues/*`, `/agents/*`, `/projects/*`, `/routines/*`,
    `/execution-workspaces/*`, `/artifacts`, `/cases/*`, `/decisions`, `/tasks`, `/status*`,
    `/u/*` (S; for `/issues/<identifier>` use the identifier's prefix).
  - Redirects under a company: `/issues/active|all|backlog|done|recent`, `/tasks`,
    `/dashboard/live`, `/decisions` and `/decisions/queues/:key` (Inbox), `/goals` and
    `/goals/:id`, `/tools` and `/tools/:tab` (Apps → Advanced), `/company/settings/tools*`,
    `/:co/companies`, `/board-chat`; the project's old tabs `/configuration`, `/budget`,
    `/workspaces`, `/workspaces/:id` (to settings sections; today "This tab is still to come");
    `/:co/projects` (a project list or the Org dashboard's Projects); `/execution-workspaces/:id/*`
    (the Workspaces tab with it open); `/artifacts` (a company-wide Docs view) (S each, about M in
    all).
  - The approval page at `/:co/approvals/:id`, reusing `RequestCard`, with resubmit
    (`POST /approvals/:id/resubmit`) and removing a rejected hire (`DELETE /agents/:id`);
    `/approvals` and `/approvals/pending` to the Inbox; `/approvals/all` to a short history (M).
  - Nav: Run now, pause and resume from an agent's menu; a Starred projects group; recent tasks
    (`GET /companies/:id/issues/summaries`); collapsible sections and `[`; project and company
    order (`GET|PUT /sidebar-preferences/me`, `/companies/:id/sidebar-preferences/me`); the dock
    hidden on detail pages (S each).
  - Palette quick filters and the missing pages (Apps, Skills, Activity, Workload, Workspaces,
    Search, App settings); `]`, `y` and `g c` (S).
  - Server info in the You menu (`enableServerInfoDebugView`, from `/api/health`) (S).
  - The project header's star (S).
  - Deploy: favicons, `apple-touch-icon`, `site.webmanifest` with `display: standalone`,
    `theme-color`, `viewport-fit=cover`, the `PAPERCLIP_FAVICON_START/END` block in `index.html`,
    a self-unregistering `sw.js` (per D11), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in
    `deploy/docker-compose.yml`, a `brands` check in the Dockerfile (S each).
- **Closes:** `shell/navigation`, `shell/command-palette`, `shell/shortcuts`, `shell/misc`,
  `approvals/governance`, `projects/lifecycle`, `projects/membership` (bar member roles),
  `workspaces/project-workspaces`, `goals/hierarchy` (with slice D), part B's routes.
- **Owns:** `src/App.tsx`, `src/routes/` (not `routes/Tasks.tsx`), `src/layout/`, `src/shell/`,
  `src/lib/shortcuts.ts`, `src/lib/commands.tsx`, a new `src/approvals/`, `src/api/approvals.ts`,
  `src/activity/redirects.tsx`, `ui-new/index.html`, a new `ui-new/public/`, `ui-new/vite.config.ts`,
  `deploy/`.
- **Size:** L in all, mostly S pieces. Could split the deploy items off if it runs long.

### Slice B: requests and the Inbox

- **Goal:** everything that arrives in Needs you can be answered in `ui-new`.
- **Builds:**
  - Connect an app from an agent's request: setup options, connect or adopt, decline, phase
    (`GET /connection-intents/:id/setup-options`, `POST …/complete`, `…/decline`, `…/phase`,
    `POST /agents/:agentId/connection-intents/:interactionId/adopt`) (M).
  - Proposals (Decisions) with their change preview and per-effect results; decide and dismiss
    (`GET /decisions/:id`, `POST /decisions/:id/decide`, `POST /decisions/:id/dismiss`) (M).
  - Join requests approved or rejected on the card (`POST /companies/:id/join-requests/:id/approve|reject`) (S).
  - Stalled reviews (`POST /issues/:id/stalled-review-decision`) (S).
  - Cancel your own request (`POST /issues/:id/interactions/:id/cancel`) (S).
  - Budget stops: a link from the card to the incident in company settings → Budgets (S).
  - Inbox search, time grouping, the "New" pill (S each).
- **Closes:** `tasks/interactions` (after reopening it), `inbox-search/triage`, `decisions/feed`.
- **Owns:** `src/requests/`, `src/inbox/`, `src/api/interactions.ts`, `src/api/inbox.ts`,
  `src/api/access.ts`, new `src/api/decisions.ts` and `src/api/connection-intents.ts`.
- **Size:** M–L.

### Slice C: the task panel, thread, documents and runs

- **Goal:** the task panel and run modal cover the old task page.
- **Builds:**
  - Deep links on the task page: `#comment-<id>` (scroll to it) and `#document-<key>` (open it),
    and Jump to latest (S). Search then jumps to the matching comment (S) and refreshes live (S).
  - Details: the routine row (`GET /routines/:id`), originating task and depth, the
    reassign-while-running confirmation, browser access and model lane, the review-policy badge
    (S each).
  - The share sheet: access grants (`GET|POST /issues/:id/access-grants`,
    `POST …/access-grants/:grantId/revoke`) (M).
  - Accepted plan decompositions (`GET /issues/:id/accepted-plan-decompositions`), review documents
    for Markdown outputs (`POST /issues/:id/work-products/:id/review-document`) (S each).
  - Recovery action cards (`POST /issues/:id/recovery-actions/resolve`) (M, unverified how often
    the server still raises them).
  - New task: @-mentions in the description, reusing another task's worktree (S each).
  - Documents: image upload and @-mentions in the editor, source-trust badges, feedback votes on
    revisions (S each).
  - Workspace: choosing another project workspace, HTML and CSV previews, a recent mode, workspace
    operations and their logs (`GET /execution-workspaces/:id/workspace-operations`,
    `GET /workspace-operations/:id/log`), starting configured services
    (`POST /execution-workspaces/:id/runtime-commands/:action`) (S each).
  - Runs: Retry per row, watchdog decisions (`POST /heartbeat-runs/:id/watchdog-decisions`),
    runtime requests (`POST /heartbeat-runs/:id/runtime-requests/:id/resolve`), the run's
    workspace operations and tool decisions (`GET /companies/:id/tools/runs/:runId/decisions`),
    a link to the agent's trace setting (S each); structured transcripts for the adapters still
    drawn as plain lines (M, unverified).
  - External objects on tasks and the list filter, when `enableExternalObjects` is on
    (`POST /companies/:id/issues/external-object-summaries`, `GET /issues/:id/external-objects`) (M).
  - Integrations polish: attachments on a board send, keeping an unconfirmed send across a reload,
    following the pane's size, reconnecting a stalled view (S each).
  - The minimal cases section, if D1 picks it (M).
- **Closes:** every partial `tasks/*` row, `documents-artifacts/documents`,
  `documents-artifacts/attachments`, `workspaces/binding`, `runs-adapters/runs`,
  `inbox-search/search` (bar its API items), and the cases rows under D1's minimal option.
- **Owns:** `src/tasks/`, `src/runs/`, `src/documents/`, `src/files/`, `src/search/`,
  `src/workspaces/`, `src/routes/Tasks.tsx`, `src/api/issues.ts`, `src/api/comments.ts`,
  `src/api/documents.ts`, `src/api/runs.ts`, `src/api/heartbeats.ts`, `src/api/file-resources.ts`,
  `src/api/execution-workspaces.ts`, `src/api/workspaces.ts`, `src/api/search.ts`.
- **Size:** L. The natural split, if needed: the panel and thread (C1), runs and workspaces (C2).

### Slice D: projects, agents, the org, goals and recurring tasks

- **Goal:** the agent page and project settings cover the old agent and project pages.
- **Builds:**
  - Agents: the identity card (`GET /agents/:id/identity`), the trust preset
    (`PATCH /agents/:id/permissions`), creating a company secret from the editor, the skill version
    picker (`enableBetaSkills`), comparing two revisions, model detection
    (`GET /companies/:id/adapters/:type/detect-model`), instructions bundle settings (S each);
    changing the harness and AI connection, harness-specific fields (M each); built-in agents'
    provision, reset and routine controls when `enableBuiltInAgents` is on (M); chat composer
    mentions (S).
  - Projects: the workspace commands JSON editor, AI summaries when `enableSummaries` is on
    (`/companies/:id/summary-slots/*`, also the Workspaces summary card) (S each).
  - Goals: parent goal and the projects a goal serves in the goal editor (S).
  - Recurring tasks: responsible person, select options, execution workspace and environment for
    runs, the activity feed, plugin routine controls (S each).
- **Closes:** `projects/defaults`, `projects/summary`, `goals/hierarchy`, `goals/detail`, every
  partial `agents/*` row, `agent-chat/*`, every partial `routines/*` row.
- **Owns:** `src/projects/`, `src/agents/`, `src/org/`, `src/chat/`, `src/recurring/`,
  `src/workload/`, `src/api/agents.ts`, `src/api/org.ts`, `src/api/projects.ts`, `src/api/goals.ts`,
  `src/api/routines.ts`, `src/api/chat.ts`, `src/api/workload.ts`.
- **Size:** L.

### Slice E: settings, skills, apps, activity and plugins (tier 2)

- **Goal:** the tier 2 pages lose nothing the old ones had.
- **Builds:**
  - Company settings: create and edit environments (M); secret provider configs, discovery, health,
    remote import and access events (M); import into an existing organization with resumable
    transfers (M).
  - App settings: "Let agents tidy my inbox" (`GET|PUT /companies/:id/users/me/inbox-agent-policy`),
    an agent chat switch for admins (see part B) (S each).
  - Skills: the catalog (M); import from a path or URL, project scans, source preview and branches,
    updates, forks, stars, folders, comparing versions (S each).
  - Apps: AI connection pools (M); GitHub chat-endpoint registration and repository settings (M);
    Slack's managed setup and test message (M); Speko voice (M); Browser Use cloud settings,
    Railway SSH, test calls as an agent, Slack search, Photon's line picker, endpoint task
    defaults, Composio's catalog rows, profile entries, Vercel Connect (S each).
  - Activity: costs by provider, biller and person, finance, quotas, subscriptions and data quality
    (M); decision-model and fast-response history (S).
  - Plugins: the `organizationSwitcher` slot (M), local folders (S).
  - Onboarding: Copilot and gateway paths with New agent's credential fields (S, after slice D's
    harness fields).
- **Closes:** all seven tier 2 rows, `shell/plugins`.
- **Owns:** `src/settings/`, `src/skills/`, `src/apps/`, `src/activity/` (not `redirects.tsx`),
  `src/plugins/`, `src/connectors/`, `src/onboarding/`, `src/auth/`, and their API modules
  (`skills.ts`, `tools.ts`, `tool-access.ts`, `chat-endpoints.ts`, `connection-extras.ts`,
  `secrets.ts`, `environments.ts`, `costs.ts`, `budgets.ts`, `companies.ts`, `instance-settings.ts`,
  `plugins.ts`, `ai-connections.ts`, `browser-use.ts`, `email.ts`, `account.ts`, `admin.ts`).
- **Size:** L; the most separable slice, and the easiest to split by section.

## 3. Per-row table

"After" is the proposed status once the row's Build items are finished and its drops accepted.

### App shell

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `shell/navigation` | partial | **Build S** Run now, pause and resume from an agent's nav menu (reuse `org/actions.ts`) · **Build S** Starred projects group (memberships, as agents' stars) · **Build S** recent tasks (`GET /companies/:id/issues/summaries`) · **Build S** collapsible sections and `[` · **Build S** project and company order (`sidebar-preferences`, part B) · **Build S** hide the dock on detail pages · **Done already** plugin launchers and slots (`plugins/NavPlugins.tsx`) | done |
| `shell/contextual-sidebars` | partial | **Done already** `SectionRail` is used by company settings, App settings, the agent page and project settings | done |
| `shell/command-palette` | partial | **Build S** quick filters (search operator chips handed to Search) · **Build S** the missing pages (Apps, Skills, Activity, Workload, Workspaces, Search, App settings) · **Done already** New project | done |
| `shell/shortcuts` | partial | **Build S** `[` and `]` · **Build S** task keys `y` (archive from inbox) and `g c` (focus the composer) · **Drop** decision keys (the Decisions page is dropped, decision 12) · **Done already** the Inbox's keys in the cheatsheet | done |
| `shell/dialogs` | partial | **Done already** New project, New agent (a page), onboarding · **Drop** the new-goal dialog (goals are created in project settings, decision 14) | done |
| `shell/live-updates` | partial | **Drop** the polling fallback: the deploy's proxies (Tailscale, Caddy) carry WebSockets, a reconnect refetches, and run logs already poll; revisit if a proxy blocks WebSockets | done |
| `shell/company` | partial | **Done already** Create organization in the switcher (`layout/Nav.tsx`) | done |
| `shell/plugins` | partial | **Build M** the `organizationSwitcher` slot (a React icon adapter) · **Build S** local folders (`GET /plugins/:id/companies/:cid/local-folders`, `PUT …/:folderKey`, `/status`, `/validate`; `plugins/PluginSettingsView.tsx` says "still in the classic UI") · **Decide** plugins styled with Tailwind classes (D10) | done after D10 |
| `shell/misc` | partial | **Drop** the announcement's animation (a sandboxed HTML file; the still image shows) · **Build S** server info in the You menu (`enableServerInfoDebugView`; the old `SidebarServerInfo.tsx` reads `serverInfo` from `/api/health`) | done |

### Tasks

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `tasks/views` | partial | **Drop** drag on touch screens (mobile.md keeps the board view on desktop; the cell menus work on touch) · **API** manual order within a column (no order field) | done, with the API gap recorded |
| `tasks/organize` | partial | **Build M** the external-object status filter, with external objects when `enableExternalObjects` is on (`POST /companies/:id/issues/external-object-summaries` exists, so "no summary for it" is out of date) · **Drop** card density and column page size (board 4 doesn't draw them) · palette quick filters: see `shell/command-palette` | done |
| `inbox-search/triage` | partial | **Drop** queues (`decisions/queues` dropped Oct 28) · **Decide** decide-by and the aging shelf (D5) · **Build S** search in the inbox · **Build S** time grouping · **Build S** the "New" pill (unverified what board 14 draws) · **API** the morning brief (stage 3, 3.13) · **Done already** the keys in the cheatsheet · **Build S** join requests answered on the card (they say "Handled outside this board for now") · **Build S** stalled reviews (`POST /issues/:id/stalled-review-decision`, decision 24) | done after D5 |
| `inbox-search/search` | partial | **API** several assignees, projects or labels at once · **API** agent chats as a section (`conversationAgentId` on results, decision 31) · **Build S** jump to the matching comment (with `#comment-<id>` on the task page) · **Build S** live refresh · **Done already** the phone switcher's link (`layout/TasksSheet.tsx` opens the Search page) | done, with the API gaps recorded |
| `tasks/create` | partial | **Build S** @-mentions in the description (reuse `tasks/composer/mentions.ts`) · **Drop** Open as full page (Create and open covers it) · **Build S** reuse another task's worktree (`GET /companies/:id/execution-workspaces`) | done |
| `tasks/thread` | partial | **Build M** recovery action cards (`POST /issues/:id/recovery-actions/resolve`; the old `IssueDetail.tsx` still calls it; unverified how often the server raises them since the 10-22 interruption change) · **Build S** accepted plan decompositions (`GET /issues/:id/accepted-plan-decompositions`; decision 12 says "built in", but only an activity line exists) · **Drop** run conversation events (`/events?view=conversation`): the thread links runs to the run modal, which draws transcripts with the adapter parsers (decision 15) · **Build S** `#comment-<id>` deep links and Jump to latest | done |
| `tasks/discussion` | partial | **Done already** the `/goal` command (runner goal) · **Drop** "Reply instead" (no longer in the old UI) | done |
| `tasks/approvals` | partial | **Build S** the review-policy badge · **Done already** the Inbox · **Build S** resubmit after Request changes (`POST /approvals/:id/resubmit`, on the approval page) | done |
| `tasks/run-control` | partial | **Build S** Retry per row in the Runs section (`tasks/TaskRuns.tsx` shows "retry" but offers none) · **Build S** Details, notices and header from the core task (`?view=core`) · **Build S** watchdog decisions on a stuck run (`POST /heartbeat-runs/:runId/watchdog-decisions`) · **Build S** runtime requests, such as a native runner's permission prompt (`POST /heartbeat-runs/:runId/runtime-requests/:requestId/resolve`) | done |
| `tasks/properties` | partial | **Build S** the routine row (the 10-24 note describes the old UI; ui-new's Details has none) · **Build S** originating task and depth rows · **Build M** external objects (with `tasks/organize`) · **Build S** the reassign-while-running confirmation · **Build S** browser access and model-lane toggles (unverified field names) · **Build S** the Copilot model catalog (unverified) | done |
| `tasks/lifecycle` | partial | **Build S** Archive from inbox in the task header (with `y`) | done |
| `tasks/privacy` | partial | **Build M** the share sheet (`GET\|POST /issues/:id/access-grants`, `POST …/:grantId/revoke`; `tasks/TaskActions.tsx` says it isn't built) | done |
| `documents-artifacts/documents` | partial | **Build S** image upload in the editor (`POST /companies/:id/assets/images`) · **Build S** @-mentions in the editor · **Drop** the legacy description plan (plans live in the `plan` document) · **Build S** source-trust badges (unverified field) · **Build S** feedback votes on revisions · **Build S** `#document-<key>` links on the task page (only the chat follows them today) | done |
| `documents-artifacts/attachments` | partial | **Build S** review documents for Markdown outputs (`POST /issues/:id/work-products/:id/review-document`) · **Drop** Artifacts V1 (decision 12) | done |
| `tasks/workspace` | partial | **Build S** choose another project workspace · **Build S** HTML and CSV previews · **Build S** a recent mode | done |
| `tasks/feedback` | partial | **Build S** votes on document revisions and in agent chat (saves tested with mocks only; check live) | done |
| `tasks/integrations` | partial | **Build S** attachments on a board send · **Build S** keep an unconfirmed send across a reload · **Build S** follow the pane's size and reconnect a stalled view (tested with mocks only; check live) | done |

### Projects and workspaces

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `projects/lifecycle` | partial | **Done already** archive (settings → Archive) · **Build S** a project list at `/:co/projects` (today Not built yet) · **Drop** connecting GitHub inside New project (Apps owns connecting; the dialog links there) | done |
| `projects/membership` | partial | **Build S** the star in the project header · **API** member roles (decision 26) | done, with the API gap recorded |
| `projects/task-context` | partial | **Done already** nothing left to build · **API** run history range, status history, per-agent cost (decision 28) | done, with the API gaps recorded |
| `projects/defaults` | partial | **API** the shared-checkout stepper (decision 26) · **Build S** the workspace commands JSON editor (`projects/settings/CodeSection.tsx` says it stays in the old UI) · **Done already** Git authorization | done, with the API gap recorded |
| `projects/budget` | partial | **API** daily bars (no daily spend per project, decision 25) · **Done already** editing the budget (settings → Budget) | done, with the API gap recorded |
| `projects/summary` | (blank) | **Build S** AI summaries in the dashboard's Brief when `enableSummaries` is on (`GET /companies/:id/summary-slots/:scopeKind/:slotKey`, `POST …/generate`, `GET …/revisions`) | done |
| `workspaces/project-workspaces` | partial | **Done already** editing (board 11) · **Build S** the old `/projects/:key/workspaces/:id` page lands on settings → Code | done |
| `workspaces/binding + /services` | partial | **Build S** services configured but never started (`POST /execution-workspaces/:id/runtime-commands/:action` and the project-workspace twin take a target and run jobs; decision 26's "no endpoint" looks out of date, unverified) · **Build S** workspace operations and their logs (`GET /execution-workspaces/:id/workspace-operations`, `GET /workspace-operations/:id/log`) · **Done already** close readiness (decision 38) · **Build S** the standalone page's address `/:co/execution-workspaces/:id/*` opens the Workspaces tab with it (its sub-tabs map to the task, services and operations) | done |
| `workspaces/files-git` | partial | **Done already** nothing left (reconcile tested with mocks only; check live) | done |

### Agents

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `agents/roster` | partial | **Drop** bulk selection on phones (mobile.md's phone scope is triage and check-ins; managing agents stays on desktop) · built-in provisioning: see `agents/built-in` | done |
| `agents/organization` | partial | **Done already** org chart, Change manager, reports-to in Profile | done |
| `agents/primary-agent` | partial | **Done already** the crown, Make my primary agent, the chat home (`chat/ChatRedirect.tsx`). Unverified: whether the old UI also preselects the primary agent in New task | done |
| `agents/hire` | partial | **Decide** external invites, Dot, Grok and Muse (D2) · **Build M** harness-specific credential fields · **Build S** model lists per connection (unverified) · the approval path is untested live | done after D2 |
| `agents/overview` | partial | **Build S** the identity card: public key and creator (`GET /agents/:id/identity`) · **Done already** header, chat and runner card | done |
| `agents/lifecycle` | partial | **Done already** pause, resume, Run now, approve, clear error, retry setup, retire, reset sessions | done |
| `agents/skills` | partial | **Build S** the version picker (`enableBetaSkills`) | done |
| `agents/runtime` | partial | **Build M** changing the harness and AI connection · **Build S** model detection (`GET /companies/:id/adapters/:type/detect-model`) · **Build M** harness-specific extras · **Decide** the old adapter sign-in flows (D8) · **Drop** the Muse connection panel (with D2) | done after D8 |
| `agents/secrets` | partial | **Build S** create a company secret from the editor (reuse project settings' New secret) | done |
| `agents/permissions` | partial | **Build S** the trust preset and low-trust boundaries (`PATCH /agents/:id/permissions`; the page says "in the classic UI for now") | done |
| `agents/revisions` | partial | **Build S** compare two revisions (unverified that revisions carry full snapshots) | done |
| `agents/built-in` | partial | **Build M** provision, reset, run a routine, turn its schedule on or off (`/built-in-agents/:key/provision\|reset`, `…/routines/:routineKey/run\|enable\|disable`) when `enableBuiltInAgents` is on | done |
| `runs-adapters/runs` | partial | **Build M** structured transcripts for `paperclip_runner`, `cursor_cloud`, native and external adapters (unverified which still draw plain lines) · **Done already** find in run, copy link, Rerun, the chat entry point · **Build S** the link to the agent's trace setting · **API** instructions revision and skills under "Loaded with it" · **Build S** the run's workspace operations (`GET /heartbeat-runs/:id/workspace-operations`) · **Build S** tool decisions per run (`GET /companies/:id/tools/runs/:runId/decisions`) | done, with the API gap recorded |
| `agent-chat/history + /handoff` | partial | **Build S** mentions in the composer · **API** another person's chat has no address (decision 31) | done, with the API gap recorded |

### Goals

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `goals/hierarchy` | partial | **Drop** the goal tree page (decision 14) · **Build S** a parent goal in the goal editor · **Build S** `/goals` and `/goals/:id` links land somewhere (the goal's project settings) | done |
| `goals/detail` | partial | **Build S** which projects a goal serves, and its dates, in the goal editor | done |
| `goals/alignment` | partial | **Done already** the task's goal in Details and New task, the project's goals in settings | done |

### Routines

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `routines/management` | partial | **Build S** plugin routine controls (badge only today) · **Build S** the responsible person (`responsibleUserId`) | done |
| `routines/definition` | partial | **Decide** comment threads on the description (`/routines/:id/description/annotations*`, D9) · **Drop** hiring an agent from the picker (New agent is a page) | done after D9 |
| `routines/variables + /secrets` | partial | **Build S** editing select options | done |
| `routines/triggers` | partial | **Done already** every trigger kind, rotate, finish setup | done |
| `routines/delivery` | partial | **Build S** execution workspace and environment for runs (`executionWorkspaceId`, `executionWorkspacePreference`, `executionWorkspaceSettings`) | done |
| `routines/run-now + /history` | partial | **Build S** the activity feed (`GET /companies/:id/activity` filtered to the routine) | done |

### Approvals and decisions

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `approvals/governance` | partial | **Build M** the approval page at `/:co/approvals/:id` (the `paperclip` skill tells agents to link it) · **Build S** `/approvals`, `/pending` and `/all` · **Build S** removing a rejected hire's agent (`DELETE /agents/:id`) · **Build S** budget stops: a link to the incident in settings → Budgets | done |
| `decisions/feed` | partial | **Done already** the project and org views (dashboard "Waiting on you", Org "Needs you") · **Build M** proposals: change preview, decide, dismiss (`GET /decisions/:id`, `POST …/decide`, `…/dismiss`) | done |
| `approvals/tool-review` | partial | **Done already** the Inbox's request card and Apps → Review | done |

### Artifacts

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `documents-artifacts/library` | partial | **API** the project section (project documents, 2b-8, decision D) · **API** documents people wrote (decision 25) · **Build S** a company-wide view at `/:co/artifacts` (`projects/ProjectDocs.tsx` without a project) · **Drop** Artifacts V1 (decision 12) | done, with the API gaps recorded |

### Cases

Nothing is built yet: decision F places cases inside the task views when `enableCases` is on, and
`ui-new` reads `enableCases` only for the activity log's case filter. Decision 16 is still open.

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| `cases/browse` | (blank) | **Decide** cases in M7 (D1) · **Build S** `/cases` and `/cases/:id` links open the case's main task | per D1 |
| `cases/structure + /history` | (blank) | **Build M** the Case section in the task panel (board C1): phase, main task, related tasks, handoffs (`GET /issues/:id/cases`, `GET /cases/:id`, `GET /cases/:caseId/handoffs`) · **Drop** case documents, revisions and annotations (removed upstream on Oct 22) | per D1 |
| `cases/task-links` | (blank) | **Build M** case chips and Group: Case (board C2; a request per task or case, decision 16) · Start case in New task (board C5): part of D1 | per D1 |

### Tier 2

| Row | Now | Remaining items | After |
| --- | --- | --- | --- |
| Company settings | partial | **Build M** create and edit environments (`POST /companies/:id/environments`, `PATCH /environments/:id`, `POST …/environments/probe-config`, `GET /environments/:id/secret-refs`) · **Decide** custom sandbox images and the terminal (D7) · **Build M** secret provider configs (create, edit, disable, remove, discovery preview, health), remote import, a secret's access events · **Build M** import into an existing organization with resumable transfers (`/companies/import/transfers`) · **Drop** permission grants (the old page's grant controls come from plugins; `members/:id/permissions` and `role-and-grants` are unused in the old UI) · **Done already** plugin pages (`settings/company/PluginSection.tsx`) · **Drop** Cloud stacks (`GET /cloud/stacks`, Paperclip Cloud only) | done after D7 |
| Instance settings | partial | **Done already** a plugin's own settings pages (M6 round 3's config form) · **Build S** "Let agents tidy my inbox" (`GET\|PUT /companies/:id/users/me/inbox-agent-policy`, from the old Profile page) · **Build S** an agent chat switch for admins (part B) | done |
| Skills | partial | **Build M** the catalog (`/skills/catalog*`, `install-catalog`) · **Build S** import from a path or URL (`POST /skills/import`) · **Build S** project scans (`scan-projects`, `browse-project`, `skill-sources/adopt-project`) · **Build S** source preview, branches and repositories · **Build S** updates (`update-status`, `install-update`) · **Build S** forks · **Build S** stars · **Build S** folders (`folders/ensure-my`) · **Drop** comments (unused in the old UI) · **Decide** Studio test runs (D6) · **Build S** comparing versions | done after D6 |
| Apps and tools | partial | **Build M** AI connection pools (`/ai-connection-pools`, part B) · **Build M** GitHub endpoint registration and repository settings (12 `/chat-endpoints/:id/github/*` requests) · **Build M** Slack's managed setup, app registration, install, resume and test message · **Build M** Speko's voice test, calls from a task and callbacks (`/voice-sessions/*`, `/voice-callbacks/:id`) · **Build S** Browser Use cloud settings and profiles · **Build S** Railway SSH · **Build S** test a tool call as an agent (`/test-agents`, `/test-calls`) · **Build S** Slack search tools (`/slack/endpoints/:id/search*`) · **Build S** Photon's line picker · **Build S** endpoint task defaults · **Build S** Composio's catalog rows (copy the JSON, decision 10 style) · **Build S** profile entries (`POST /tool-profiles/:id/entries`, `DELETE /tool-profile-entries/:id`; unverified whether the wizard's `PATCH` covers it) · **Build S** Vercel Connect (unverified) · **Drop** Cloud connector enrollment (Paperclip Cloud only, unverified) | done |
| Activity and costs | partial | **Build M** costs by provider, biller and person, finance, quota windows, window spend, data quality, retry accounting, subscriptions (12 `/costs/*` requests) · **Build S** decision-model and fast-response call history (`/decision-model/history`, `/fast-response/history`) | done |
| Companies and onboarding | partial | **Done already** Create organization in the switcher · **Build S** the Copilot and gateway paths with credential fields (after `agents/hire`'s fields) · **Drop** the wizard's animation · hire and Get started untested live | done |
| Sign-in and connect flows | partial | Nothing to build. Sign-up, claims, MCP consent, chat identity and the Cloud handoff are unit-tested only: check them on the authenticated deployment | done after the live check |

### `done` rows worth a second look

- `tasks/interactions`: reopen as `partial`; connection requests can't be answered (slice B).
- `tasks/recovery`: its note says recovery action cards aren't built; they're under `tasks/thread`.
- `agents/instructions`: bundle settings (external folder, entry file) are **Build S** (slice D);
  "download all" is an API gap (decision 29).
- `workspaces/overview`: the summary card is **Build S** with `projects/summary`.
- `task-coordination/delegation`: "Not yet: subtasks expanded inline" is out of date (built in M2).

## 4. What the checklist misses

### Old routes with no `ui-new` route or redirect

`NotBuiltYet` and "No such company" don't count. Proposed home in brackets.

| Old address | What happens now | Proposed |
| --- | --- | --- |
| Unprefixed `/issues/:id`, `/agents/*`, `/projects/*`, `/routines/*`, `/execution-workspaces/*`, `/artifacts`, `/cases/*`, `/decisions`, `/tasks`, `/status*`, `/u/:slug`, `/issues`, `/agents` | "No such company" (`/:companyPrefix` takes the first segment) | **Build S**, new row `shell/legacy-links`, slice A |
| `/:co/approvals`, `/approvals/pending`, `/approvals/all`, `/approvals/:id` | Not built yet | `approvals/governance` |
| `/:co/issues/active`, `/all`, `/backlog`, `/done`, `/recent` | tries to load a task called "active" | `shell/legacy-links` |
| `/:co/tasks`, `/:co/dashboard/live`, `/:co/companies`, `/:co/board-chat` | Not built yet | `shell/legacy-links` |
| `/:co/decisions`, `/decisions/queues/:key` | Not built yet | `shell/legacy-links` (to the Inbox) |
| `/:co/goals`, `/goals/:id` | Not built yet | `goals/hierarchy` |
| `/:co/projects` | Not built yet | `projects/lifecycle` |
| `/:co/projects/:key/configuration`, `/budget`, `/workspaces`, `/workspaces/:id` | "This tab is still to come" | `shell/legacy-links` |
| `/:co/execution-workspaces/:id` (+ `/configuration`, `/issues`, `/routines`, `/runtime-logs`, `/services`) | Not built yet | `workspaces/binding` |
| `/:co/artifacts` | Not built yet | `documents-artifacts/library` |
| `/:co/cases`, `/cases/:id` | Not built yet | cases (D1) |
| `/:co/status`, `/status/:id`, `/status-cards*` | Not built yet | new row, D3 |
| `/:co/u/:userSlug` | Not built yet | new row, D4 |
| `/:co/tools`, `/tools/:tab`, `/:co/company/settings/tools*` | Not built yet / unknown section | `shell/legacy-links` (to Apps → Advanced) |
| `#comment-<id>`, `#document-<key>` on `/:co/issues/:id` | ignored (the chat follows `#document-`) | `tasks/thread`, `documents-artifacts/documents` |
| `/:co/design-guide`, `/dev/task-chat-lab`, `/tests/perf/long-thread`, `/ux-lab/*` | Not built yet | **Drop**: tier 3 maintainer pages |

The `paperclip` skill (`skills/paperclip`) documents `/<prefix>/approvals/<id>`,
`/<prefix>/issues/<id>#document-<key>` and `#comment-<id>`, so agents write these links into
comments today.

### Old-UI requests `ui-new` never calls

Of the 739 request paths the old UI's pages reach, about 230 have no matching path in `ui-new/src`
(a static match, so a few may be false: `costs/by-project` and `adapters/:type/models` are called
through template suffixes and were taken off by hand). Another 129 request paths are unused in the
old UI itself. Grouped by area:

| Group | Requests | Verdict |
| --- | --- | --- |
| Connection intents (`/connection-intents/:id/*`, `/agents/:id/connection-intents/:id/adopt`) | 5 | **Real gap**, `tasks/interactions` (reopen) |
| Decisions (`/decisions/:id`, `decide`, `dismiss`, company list) | 4 | **Real gap**, `decisions/feed` |
| Decision queues, triage and retention | 7 | Dropped (`decisions/queues`); decide-by and the aging shelf are D5 |
| Issues: access grants, stalled review, review document, plan decompositions, recovery actions, interaction cancel, summaries | 10 | **Real gaps**, task rows above; `reconstruct-workspace` is dead in the old UI (**Drop**) |
| Heartbeats: watchdog decisions, runtime requests, workspace operations and logs | 5 | **Real gaps**, `tasks/run-control`, `runs-adapters/runs`; `/issues/:id/active-run` is covered by live runs (**Drop**) |
| Execution and project workspaces: runtime commands, workspace operations | 3 | **Real gaps**, `workspaces/binding` |
| External objects (`/issues/external-object-summaries`, `/issues/:id/external-objects`, project summary) | 4 | **Real gap**, new row `tasks/external-objects` (follows `enableExternalObjects`) |
| Summary slots | 3 | **Real gap**, `projects/summary` |
| Cases (and case document annotations) | 8 + 5 | Cases rows (D1); case documents **Drop** |
| Routine description annotations | 5 | D9 |
| Sidebar preferences (company and project order) | 4 | **Real gap**, `shell/navigation` |
| Agents: identity, instructions diff, detect model, bundle settings | 4 | **Real gaps**, agent rows; `instructions-bundle/diff` is unverified (the suggested-edit diff may be drawn from candidates) |
| Agents: adapter and Claude sign-in sessions, OAuth token status, auth signal, `claude-login` | 14 | D8 (probably superseded by AI connections' local login) |
| Built-in agents: provision, reset, routines | 5 | **Real gap**, `agents/built-in` |
| Dot, Grok, Muse invitations and bindings; invite onboarding | 21 | D2 |
| AI connection pools | 4 | **Real gap**, needs adding to the Apps row's notes |
| AI connections: OAuth login result (`/ai-connections/login/:sessionId`) | 1 | Unverified; check against Apps → AI connections' OAuth flow |
| Tools: profile entries, Railway SSH, test calls, run decisions, Cloud connector, stdio templates | 11 | Apps row and `runs-adapters/runs`; Cloud connector **Drop**; stdio templates dead in the old UI (**Drop**) |
| Browser Use cloud grants | 3 | **Real gap**, Apps row |
| GitHub chat endpoints, Slack setup, Photon, Slack search, voice | 12 + 6 + 5 + 3 | **Real gaps**, Apps row (`enableChatConnectors`, `enableGitHubReviewBots`; tested with mocks only) |
| Email (`/email/connections`, `inspect`, `tasks/:id`) | — | Covered (helper-built paths; the first script run missed them) |
| Environments: create, probe config, secret refs | 3 | **Real gap**, Company settings |
| Environments: custom images, setup sessions, terminal | 8 | D7 |
| Secrets: provider configs, discovery, health, remote import, access events | about 10 | **Real gap**, Company settings |
| Company import transfers (resumable upload) | 4 | **Real gap**, Company settings |
| Costs and subscriptions | 15 | **Real gap**, Activity and costs |
| Decision model and fast-response history | 2 | **Real gap**, Activity and costs |
| Skills: catalog, imports, scans, updates, forks, stars, folders | 18 | **Real gap**, Skills |
| Skills: Studio test runs, inputs, templates | 11 | D6 |
| Inbox agent policy | 2 | **Real gap**, Instance settings |
| Plugin local folders | 2 (+2) | **Real gap**, `shell/plugins` |
| Approvals: resubmit; agents: delete (from approval detail) | 2 | **Real gaps**, `approvals/governance` |
| User profile (`/companies/:id/users/:slug/profile`) | 1 | D4 |
| Status cards | 9 | D3 |
| Smoke lab | 8 | **Drop**: maintainer tooling (decision 12) |
| Team catalog | 5 | **Drop**: only the old `DesignGuide` page calls it |
| Cloud stacks | 1 | **Drop**: Paperclip Cloud only |

The 129 request paths no old page calls (skill comments and categories, member permission grants,
OpenClaw invite prompts, the old recovery-action endpoints, voice sessions, trust rules, runtime
slots and others) are **Drop**: dead in the old UI.

### Proposed new rows

| ID | Capability | Bucket |
| --- | --- | --- |
| `shell/legacy-links` | Old and unprefixed addresses land on their new pages | Build S–M (slice A) |
| `tasks/external-objects` | External objects on tasks and projects, the list's status filter (`enableExternalObjects`) | Build M (slice C) |
| `apps/ai-connection-pools` (or a note on the Apps row) | AI connection pools on Apps → AI connections | Build M (slice E) |
| `status-cards` | Status cards (`enableStatusCards`, `/:co/status`) | D3 |
| `people/profile` | A person's profile page (`/:co/u/:slug`) | D4 |
| `shell/dashboard` | The old Dashboard and Dashboard live: covered by the Org dashboard; `/dashboard/live` redirects | Done already, plus a Build S redirect |

The README's "Undecided" areas (Dashboard, Status cards, User profile) become the last three rows.

### Flags whose outcome isn't reflected as decisions 12 and 32 say

| Flag | Decision says | In `ui-new` | Proposed |
| --- | --- | --- | --- |
| `enableAgentChat` | Always on in every `ui-new` deployment (decision A) | The Features card leaves it out ("always on"), and `ChatOff` tells people to use "the experimental settings", which `ui-new` doesn't have. A fresh deployment can't turn chat on from `ui-new` | **Build S**: a switch for admins (Features card or `ChatOff`), or a deploy step that sets it |
| `enableIssuePlanDecompositions` | Built in: shown in a task's history | Only an activity line (`tasks/activity-format.ts`); `accepted-plan-decompositions` is never read | **Build S**, `tasks/thread` |
| `enableCases` | Follows the setting: chip, panel section, Group: Case, Start case | Only the activity log's case filter | D1 |
| `enableSummaries` | Follows the setting: panels on projects and workspaces | Not read | **Build S**, `projects/summary` |
| `enableExternalObjects` | Follows the setting: panels on tasks | Not read | **Build M**, `tasks/external-objects` |
| `enableStatusCards` | Follows the setting | Not read | D3 |
| `enableServerInfoDebugView` | The server-info section in the account menu | Not read | **Build S**, `shell/misc` |
| `enableBuiltInAgents` | New-agent choices and agent settings | The roster lists them; no provisioning | **Build M**, `agents/built-in` |
| `enableBetaSkills` | Agent settings | Not read | **Build S**, `agents/skills` |
| `enableOpenAiDot`, `enableGrokBot`, `enableMuse` | New-agent choices | Not read | D2 |
| `enableManagedSandboxOnly` | Settings show only what it allows | Read in project Code and Workspaces; the old UI also hides host options in agent runtime, New agent, onboarding and task properties | **Unverified**: check New agent and Model and runtime |
| `enableNativeRunner` | Settings show the controls it allows | Not read; runner offers come from the adapters list (`supportedRunners`), which the server builds | **Unverified**, probably fine |

The other flags match: the dropped ones have no surface, the built-in ones are built in, and the
server-enforced ones are read where their feature is.

## 5. Decisions needed

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Cases in M7 | (a) Build C1, C2 and C5 in full (L), with decision 16 settled first. (b) A minimal read-only Case section in the task panel and `/cases/*` redirects (M). (c) Drop cases from `ui-new` until upstream settles them. | (b). Cases follow `enableCases`, which is off on the test instance, and upstream rewrote them on Oct 22. Mark C2's grouping and C5's Start case `dropped` for now, with a pointer to decision 16. |
| D2 | External agent invites, Dot, Grok and Muse | (a) Build each (M each, 21 requests). (b) Drop until one of their flags is turned on. | (b). All four are off by default and aren't part of how agents are hired here. Record them as dropped with the flag names, so a sync that turns one on raises it. |
| D3 | Status cards (`enableStatusCards`, `/:co/status`) | (a) Port the page behind the setting (M). (b) Drop. | (b), unless you use them: experimental, off by default, and Org dashboard's KPIs cover the summary. |
| D4 | A person's profile page (`/:co/u/:slug`) | (a) A small read-only page (S). (b) Redirect to company settings → Members. | (b) for M7; (a) later if people links become common. |
| D5 | Decide-by and the aging shelf (proposal item 14) | (a) Port them into the Inbox (decision triage and retention, archive proposals). (b) Drop them with the queues. | (b). Snooze covers decide-by for one person, and the queues they belonged to are dropped. |
| D6 | Skill Studio test runs (inputs, runs, templates, 11 requests) | (a) Port (M). (b) Drop. | (b) for M7: authoring works without them; revisit when skills are authored here regularly. |
| D7 | Custom sandbox images and the environment terminal | (a) Port (L: setup sessions and a terminal). (b) Drop. | (b) unless your environments use custom images; the old UI calls these maintainer-grade flows. |
| D8 | The old adapter sign-in flows (`login-sessions`, setup-token, `claude-login`, 14 requests) | (a) Port them into Model and runtime and New agent (M). (b) Drop as superseded by AI connections' local login. | Check first that a `claude_local` agent signs in through Apps → AI connections; if it does, (b). |
| D9 | Comment threads on a recurring task's description | (a) Port, reusing the document annotations (M). (b) Drop. | (b): the description is a short template; discussion belongs on its occurrences. |
| D10 | Plugins that style themselves with the old UI's Tailwind classes | (a) Ship a scoped Tailwind-compatible sheet for plugin areas. (b) Accept the gap and document it for plugin authors. | (b); revisit if a plugin you use breaks. |
| D11 | The installable app and the old service worker | (a) Manifest and icons only, plus a `sw.js` that unregisters the old worker. (b) Port the old worker (offline page, update reloads) as the base for push (decision 18). | (a) for the switch; (b) when push notifications are built. |

## 6. API changes needed

### Small upstream fix candidates

In the format of [fork/upstream-fixes.md](../../../fork/upstream-fixes.md); not added there. Each
needs the user's sign-off and a duplicate search first.

| Candidate | Problem | Likely fix | Fork workaround |
| --- | --- | --- | --- |
| Search filters take several values | `GET /api/companies/:companyId/search` takes one assignee, project or label | Accept repeated or comma-separated values | One value at a time |
| Search results mark chats | Results carry no `conversationAgentId`, so a chat shows as a task (decision 31) | Return it on task results, or leave chats out unless asked | Facet counts include chats |
| Costs by one agent | `/costs/by-agent` and `/costs/by-agent-model` take no agent (decision 29) | `?agentId=` | Fetch the company and filter |
| Run history by date range | `heartbeat-runs?summary=true&limit=1000` has no range or project filter (decision 28) | `from`, `to`, `projectId` | Marks days it couldn't load |
| Sign-up allowed in health | `PAPERCLIP_AUTH_DISABLE_SIGN_UP` isn't in `/api/health` (decision 36) | Expose it | Always offers sign-up |
| `executionBlocker` on compact issues | Retry on list rows can't see the blocker (`CompactIssue`) | Add the field | Uses the interruption's run |

### Larger ideas (stage 2b or 3)

- Project documents and attachments (2b-8, decision D): the Docs tab's project section.
- Documents people wrote in the artifacts list (decision 25): possibly a behaviour choice upstream.
- Daily spend per project (decision 25).
- Member roles on private projects and the shared-checkout count (decision 26).
- Issue status history, for blocked time in workload (decision 28).
- The run's instructions revision and skills ("Loaded with it").
- Manual order within a board column.
- An address for another person's chat (decision 31).
- The morning brief and reports to chat (3.13, 2b-14).
- Structured case phases and case membership on task lists (decision 16).
- "Download all" for an instructions bundle (decision 29).

## 7. Responsive, accessibility and deploy notes

### Responsive pass

From the stylesheets (`data-viewport="phone"` rules, `@container` and `@media` queries) and the
components that read the viewport; not checked in a browser.

| Phone board ([mobile.md](../design/mobile.md)) | State | Notes |
| --- | --- | --- |
| N1 dock, switcher, You | Built | The dock still shows on detail pages (M2, M9 and M11 hide it). |
| M1 task list | Not built | Only a 640px rule in `TasksView.css`; no quick filters row or phone header. |
| M2–M4 task details, activity, docs | Partly | The panel becomes a full-screen page (`layout/Panel.tsx`); no phone-specific layout. Unverified. |
| M5 the task plan | Built | Read-only on phones (`documents/DocumentView.tsx`). |
| M6 New task quick sheet | Not built | The dialog becomes a sheet (`ui/layer.tsx`) and has a 720px rule, but M6's short form isn't drawn. Unverified. |
| M7, M10 Inbox | Partly | Container rules for narrow widths; no phone layout. Unverified. |
| M8 agents | Built | `org/Org.css` has phone rules. Unverified which parts of M8. |
| M9 agent chat | Built | Phone rules and the Activity bottom sheet. |
| M11 run | Built | A full-screen sheet. |
| M12 project overview | Partly | One 900px rule in `ProjectDashboard.css`. |
| M13 project docs | Not built | |
| M14 search | Built | Phone rules in `Search.css`. |

Out of the phone's scope (mobile.md: settings, workload, the board view, recurring setup, the run
modal's input and trace) the screens should point to desktop. Only New task, the switcher and
Workload say "On desktop" today; settings, Apps, Skills and Activity don't. The responsive pass is
about M in all: M1, M6, M7/M10, M12, M13 and the dock on detail pages, plus "On desktop" notes.
It touches every slice's folders, so it fits best after the five slices, or as each slice's last
step for its own screens.

### Accessibility pass

Against [design-system.md](../design/design-system.md#accessibility), statically:

- **In place:** a global `:focus-visible` ring and a `prefers-reduced-motion` reset
  (`styles/base.css`); Kobalte gives menus, dialogs, listboxes and switches their roles; the toast
  region is `aria-live="polite"` (`ui/Toast.tsx`); keyboard alternatives exist for drag and drop
  (Shift+arrows on the board, Move up and down in the queue).
- **To check:**
  - Ten `outline: none` rules (`search/Search.css`, `agents/Agent.css`, `inbox/Inbox.css`,
    `layout/Panel.css`, `projects/NewProjectDialog.css`, `ui/layer.css`) need a visible
    replacement focus style.
  - `recurring/RecurringView.tsx:512`: a clickable `li` row; check there's a keyboard path (its
    link is focusable, so probably fine).
  - Token contrast in both themes, especially the tone foregrounds on their backgrounds.
    Unverified.
  - 44px touch targets on phone screens. Unverified.
  - An axe run with Playwright on the main screens in both themes. There's no Playwright smoke run
    yet, although the build plan asked for one from M2.

### Deploy readiness

- **What works:** `deploy/Dockerfile` builds `ui-new` and replaces `/app/ui/dist`; the server
  serves it with an SPA fallback and the branding transform (`server/src/app.ts`). `/brands` is
  copied into `dist/brands` by `vite.config.ts` (`closeBundle`). `/_plugins/:pluginId/ui/*` is a
  server route (`server/src/routes/plugin-ui-static.ts`), so it works at the same origin without
  Vite's proxy. Fonts are bundled from `@fontsource`.
- **Missing in the image:**
  - **Icons and manifest.** `ui-new/index.html` has no favicon links, `apple-touch-icon`,
    `site.webmanifest` (`display: standalone`, from the 2026-10-26 sync), `theme-color`, or
    `viewport-fit=cover` (the dock needs safe-area insets on iPhones). It also lacks the
    `<!-- PAPERCLIP_FAVICON_START/END -->` block the server fills in for worktree favicons. The
    old UI's files are in `ui/public/` (favicons, `android-chrome-*`, `site.webmanifest`); copy
    them the way `/brands` is copied, or into a new `ui-new/public/`.
  - **The old service worker.** Browsers that used the old UI at the same address keep
    `ui/public/sw.js` registered. With `ui-new`, `/sw.js` falls to the SPA fallback (HTML with
    status 200), so the browser's update check fails and the old worker stays (unverified per
    browser). Ship a `sw.js` that unregisters itself (D11).
- **Settings the plan expects but the deployment doesn't set:**
  - `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`: the build plan says it's in `deploy/docker-compose.yml`;
    it isn't.
  - `enableAgentChat` (decision A) and `enablePublicMcp` (decision 12) are instance settings in the
    database. `ui-new` has no switch for agent chat (part B), so a fresh deployment needs an API
    call or the new switch.
- **Running beside the old UI:** the image serves one UI, so "run it beside the old UI for a while"
  needs a plan. Running a second server on the same database would also run its schedulers
  (unverified, but risky). Safer: keep the production server on upstream's image (old UI) and
  serve `ui-new` beside it with `vite preview` (port 3102, which proxies `/api` and `/_plugins`
  with the forwarded-host headers), or any static server with the same proxy; then switch to
  `deploy/Dockerfile`. Document this in `deploy/README.md`.
- **Live checks owed before the switch**, all tested with mocks or unit tests only so far: hiring
  with approval, onboarding's hire and Get started, sign-up, board claim, MCP consent, chat
  identity, the Cloud handoff, chat endpoints, task integrations, branch reconcile, feedback votes.
