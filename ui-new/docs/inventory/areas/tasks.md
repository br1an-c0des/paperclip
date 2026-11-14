# Tasks

Tier 1 (redesign). Tasks (called *issues* in the code and API) are the core work unit: a person or agent
creates one, an agent works it in runs, and the conversation, documents and outputs accumulate on it.

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Issues`,
`IssueDetail`, `Inbox` and `Search`, plus **App shell** for the new-task dialog. Upstream recipes:
`maps/feature-map/tasks.md`, `task-coordination.md`, `inbox-search.md`, `steering.md`,
`documents-artifacts.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Tasks list (`pages/Issues.tsx` → `components/IssuesList.tsx`) | `/:co/issues` | Organization-wide task collection. With combined inbox/tasks on, also hosts the personal inbox views. |
| Inbox (`pages/Inbox.tsx`) | `/:co/inbox/*` (redirects to `/issues?view=…` when combined) | Personal triage list: tasks plus approvals, failed runs and join requests. |
| Task detail (`pages/IssueDetail.tsx` → `TaskDetailSurface`) | `/:co/issues/:issueId` | One task: header, conversation thread, composer, side panel. |
| Search (`pages/Search.tsx`) | `/:co/search` | Company-wide full-text search. |
| New-task dialog (`components/NewIssueDialog.tsx`, in the app shell) | none | Opened from anywhere. |

Agent Chat (`/:co/chats/:agentRef`) reuses `TaskDetailSurface` in a conversation mode; see the
[agents guide](agents.md).

### Reference: task fields

- **Status:** `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`.
- **Priority:** `critical`, `high`, `medium`, `low`.
- **Visibility:** `open` or `private`.
- **Work mode** (per message or task): standard, planning ("plan before acting"), ask ("answer without changes").
- **Interaction kinds** (structured agent requests in the thread): `suggest_tasks`, `ask_user_questions`,
  `request_confirmation`, `request_checkbox_confirmation`, `request_item_verdicts`, `connection_intent`.

## Finding tasks

### `tasks/views`: Task views

- **Where:** Tasks list toolbar, Views menu (`components/TaskViewsMenu.tsx`, `lib/task-views.ts`).
- **What:** two groups of views, selected with `?view=`; the last-used view is remembered in local storage.
  - *My work* (rendered by the Inbox component): Mine (assigned to you or waiting on you), Unread, Blocked
    (grouped by blocker), Recent, Everything (tasks, approvals, failed runs, join requests).
  - *Organization* (rendered by `IssuesList`): All tasks, Active (`todo`, `in_progress`, `in_review`,
    `blocked`), Backlog, Done (`done`, `cancelled`).
- **Requests:** `GET /api/companies/:companyId/issues` (compact list, paged 100 at a time, sorted by
  updated), `POST /api/issues/:issueId/retry` (Retry on an interrupted task's row, since the 2026-10-22
  sync) and the Inbox requests below.
- **Notes:** flag `enableCombinedInboxTasks` (default off) merges Inbox into Tasks. With it off, Tasks is
  only the organization list and Inbox keeps its own pages at `/inbox/mine|recent|unread|blocked|all`.
  The badge on the Views menu is the inbox count (`hooks/useInboxBadge.ts`).

### `tasks/organize`: Filter, sort, group, board

- **Where:** `IssuesList` toolbar; also used for project, agent and workspace task lists.
- **What:**
  - *Filters:* status, priority, assignee, creator, label, project, workspace, live-only, external-object
    status (failed, waiting, running, auth required, unreachable, stale, none), and show/hide
    agent-created tasks.
  - *Sort:* status, priority, title, created, updated, workflow.
  - *Group:* none, status, priority, assignee, project, workspace, parent; groups collapse.
  - *Display:* list or Kanban board (card density, cold-lane mode, column page size); parent/child nesting;
    date separators.
  - *Search box* filters loaded tasks; the term is kept in `?q=`.
  - URL params pre-filter: `assignee`, `workspace`, `participantAgentId`.
- **Requests:** list as above; board columns fetch per status. Dragging a card or changing a value inline
  calls `PATCH /api/issues/:id`.
- **Notes:** view state is saved per surface in local storage (`viewStateKey`). Creating a task from a group
  header pre-fills that group's value. Keyboard: `j`/`k` or arrows move, left/right collapse/expand
  parents and groups, Enter opens.
- **Since the 2026-11-01 sync:** a Routine tasks filter under Visibility shows the tasks routines
  created, kept in the URL; a routine links to it. Needs attention reads the task IDs from
  `GET /api/companies/:companyId/attention/tasks` (`attentionApi.taskIndex`) and loads the rows in
  batches of up to 100; the list renders 100 rows, then 150 more at a time.

### `inbox-search/triage`: Inbox triage

- **Where:** Inbox (or My-work views).
- **What:** a personal feed of four item kinds: tasks, approvals, failed runs, join requests. Group by
  type, assignee, project or workspace; nesting of subtasks; search.
  - Mark read/unread, mark all read, archive and unarchive tasks from the inbox.
  - Approve/reject approvals and join requests inline; retry a failed run; Retry an interrupted task
    (since the 2026-10-22 sync).
  - Mine leaves out work that arrived through channels or routines unless the person takes part, is
    assigned the task or has a current request addressed to them (since the 2026-10-22 sync; the same
    rule applies to unread state, archives and task notifications).
- **Requests:** `POST|DELETE /api/issues/:id/read`, `POST|DELETE /api/issues/:id/inbox-archive`,
  `POST /api/approvals/:id/approve|reject`,
  `POST /api/companies/:companyId/join-requests/:requestId/approve|reject`, `POST /api/agents/:id/wakeup`
  (retry failed run), `POST /api/issues/:issueId/retry` (Retry an interrupted task), `GET /api/companies/:companyId/approvals`, `/heartbeat-runs`, `/join-requests`,
  `/dashboard`; dismissing and snoozing items goes through `inboxDismissalsApi` (server, shared with the
  Decisions page). Since the 2026-11-03 sync, the Mine tab opens from one snapshot,
  `GET /api/companies/:companyId/inbox/mine` (`InboxMineSnapshot`: the Mine rows, their context tasks
  and the latest failed runs, with per-source errors), instead of separate startup reads.
  Since the 2026-11-10 sync, Mine reads only the execution workspaces its rows reference,
  `GET /api/companies/:companyId/execution-workspaces?summary=true&ids=` (up to 100;
  `executionWorkspacesApi.listSummariesByIds`, #20388), and a Retry that didn't start shows its reason
  instead of opening the task (#20283).
- **Notes:** archiving is "out of my inbox", not completing the task. Read state for non-task items
  (approvals, failed runs, join requests) is browser-only local storage. Keyboard: `j`/`k`, `a` or `y`
  archive, `r` mark read, `U` mark unread, Enter open, left/right collapse. Blocked view groups by blocker
  (`components/BlockedInboxView.tsx`).

### `inbox-search/search`: Search

- **Where:** `/search`, and the search entry in navigation.
- **What:** full-text search with scopes: all, tasks, comments, documents, artifacts, agents, projects.
  Filters as chips or typed operators (status, priority, assignee, project, label, updated within); sort.
  Results link to the original record. Query, scope, filters and sort live in the URL.
- **Requests:** `GET /api/companies/:companyId/search` (`api/search.ts`), plus agents, projects and labels
  for filter pickers.

## Creating tasks

### `tasks/create`: New-task dialog

- **Where:** app shell dialog; opened from "New task" buttons (Tasks, Inbox toolbar, project and agent
  pages), list group headers (pre-filled), and the command palette.
- **What:** title, markdown description (image paste, drag-and-drop files), status (Backlog/Todo),
  priority, assignee (agent or person), project and project workspace, reviewer and approver, watchdog
  agent and instructions, assignee model lane / model override / thinking effort / Chrome, execution
  workspace mode (shared or isolated, or reuse an existing one), work mode (standard/plan/ask), private
  toggle, and staged files: attachments or documents (a staged `plan` document becomes the task's plan).
- **Requests:** `POST /api/companies/:companyId/issues`; then
  `POST /api/companies/:companyId/issues/:issueId/attachments` and `PUT /api/issues/:id/documents/:key`
  per staged file; `POST /api/companies/:companyId/assets/images` for pasted images.
- **Notes:** partial failures of staged uploads are reported after the task exists. Sub-task creation
  ("Add subtask") opens the same dialog with the parent set.

## Task detail

Layout (default chat-style presentation): header (breadcrumb/ancestors, title, status, assignee, live-run
pill, actions) → conversation thread → composer dock → right side panel with tabs. On mobile the side panel
becomes tabs behind "More actions → Properties".

Flag `enableClassicTaskInterface` (default off) swaps the thread for the older `IssueChatThread`
presentation with a separate Activity tab. The chat-style thread (`TaskChatThread` and
`components/task-chat/*`) is the default and the one to port.

### `tasks/thread`: Conversation thread

- **What:** a merged timeline of the task description, comments, agent run turns (thinking, tool calls,
  status, usage), system notices, structured interaction cards, approvals, plan previews, "skill created"
  / "project created" cards, field-change receipts, email messages, references to other tasks, and
  queued messages. Paged comment loading with "jump to latest"; live tail of the running agent.
- **Requests:** `GET /api/issues/:id`, `/comments` (paged), `/interactions`, `/approvals`,
  `/api/issues/:issueId/activity`, `/runs`, `/live-runs`, `/active-run`, `GET /api/heartbeat-runs/:runId`,
  `/events`, `/log`; live transcript over `WS /api/companies/:companyId/events/ws`.
  For a fast first paint, `GET /api/issues/:id?view=core`, `GET /api/issues/:id/recent-comments` (the
  latest comments, with `hasMore`), `/activity?view=recent`, `/activity?view=comment-inputs&commentIds=`
  (in batches of 100), `/runs?view=recent`, and `GET /api/heartbeat-runs/:runId/events?view=conversation`.
- **Notes:** opening a task marks it read (`POST /api/issues/:id/read`). Since the 2026-10-26 sync the
  old UI shows the recent conversation first and loads the full history behind it.
- **Since the 2026-11-01 sync:** subtasks an agent creates show inline in the feed as task cards
  (link, title, number, status), once each. The feed reads the runs it shows in batches with
  `GET /api/issues/:issueId/runs?runIds=` (`activityApi.runsByIdsForIssue`, up to 100 IDs per
  request).
- **Since the 2026-11-10 sync** (#20355, #20286, #20450): the old UI reads a task chat's whole first
  frame in one request, `GET /api/companies/:companyId/issues/chat-bootstrap?ids=` (up to 10;
  `issuesApi.chatBootstrap`, `hooks/useRecentTaskOpenWarmup.ts`) or `GET /api/issues/:ref/chat-bootstrap`,
  preloaded on hover and from Recents; the individual reads above remain (`lib/issue-chat-history-queries.ts`).
  A deferred request whose wait reason changes logs `issue.execution_waiting` (#20338), which refreshes
  open pages.
- **Since the 2026-11-13 sync** (#21119, #21266): a connected app's tool call can carry an MCP Apps
  view, shown as a sandboxed frame under the tool card: `GET /api/issues/:issueId/mcp-app-views`,
  `GET …/:viewId`, `POST …/:viewId/tool-calls`, `PUT …/:viewId/model-context`, `POST …/:viewId/messages`
  (`mcpAppsApi`), and provider tool icons from `GET /api/companies/:companyId/tool-icons` (U136).
- **Since the 2026-11-14 sync** (#21449): a long connected-app tool call shows live progress under
  its tool card. The old UI reads the running calls' latest progress on load with
  `GET /api/issues/:issueId/tool-call-progress` (`mcpAppsApi.toolCallProgress`) and follows the live
  event `heartbeat.run.tool_progress` (U154).

### `tasks/discussion`: Comment and reassign

- **Where:** composer (`components/task-chat/TaskChatComposer.tsx`).
- **What:** markdown with @mentions (agents, people, tasks), file/image attachments, run settings (agent,
  model, effort), plan/ask mode, private toggle, "Goal: keep pursuing" (runner goal). Sending can reopen a
  closed task, reassign it (comment + reassign in one step), or interrupt the current run. Delete own
  comments; cancel a queued comment before it's delivered.
- **Requests:** `POST /api/issues/:id/comments`, `DELETE /api/issues/:id/comments/:commentId`,
  `PATCH /api/issues/:id` (reassign), `POST /api/companies/:companyId/issues/:issueId/attachments`.
- **Notes:** drafts survive task switching and reload (upstream `steering/drafts`).

### `steering/*`: Queued messages, steer, interrupt, stop

- **What:** while an agent is running, new messages queue. Queue shows order and wait reason; edit,
  reorder and discard queued messages; "steer" sends one into the active run; interrupt stops the run and
  carries queued messages into the next one; stop ends the current response.
- **Requests:** `GET /api/issues/:id/queued-comments`, `PATCH|DELETE .../queued-comments/:commentId`,
  `PUT .../queued-comments/order`, `POST .../queued-comments/:commentId/steer`,
  `POST .../queued-comments/interrupt`, `POST /api/heartbeat-runs/:runId/cancel` (stop; "stop and
  finalize" also updates the task).
- **Since the 2026-11-09 sync** (#19970): your own plain queued follow-up is steered into the live
  turn after 5 s ("Sending in Xs · Edit · Cancel", one attempt per revision), only while steering is
  `available` on `paperclip_runner_v1`, never for request-card answers or fresh-session entries
  (`components/task-chat/queued-message-auto-steer.ts`, `TaskChatQueuedMessages.tsx`). It uses the
  same `POST .../queued-comments/:commentId/steer`. A run still preparing takes the queue into its
  first turn (`executionWait.reason: "first_turn_pending"`, #20168).
- **Since the 2026-11-10 sync** (#20367, #20292): each queued row renders its Markdown without images,
  plus up to three thumbnails of `/api/attachments/:id/content` or `/api/assets/:id/content` images and
  "+N" (`TaskChatQueuedMessages.tsx`). A chat message held at the agent's daily limit waits as a
  `deferred` queue with no queue id or target run, and its `executionWait.message` shows under the queue.

### `tasks/interactions`: Agent requests in the thread

- **What:** structured cards an agent posts and a person resolves: suggested tasks (accept creates
  them), questions (answer form), confirmations and checkbox confirmations (accept/reject), per-item
  verdicts, and connection intents (agent asks to connect an app or AI connection; complete, decline,
  set phase, adopt). Cards can be skipped or cancelled.
- **Dismiss** (since the 2026-10-24 sync): a person can set any request aside. It leaves the
  composer reminders and stops gating completion, stays in the conversation history and can be
  reopened from there. Dismissing never counts as an answer or approval (`dismissedAt`,
  `dismissedByUserId` on the interaction).
- **Requests:** `POST /api/issues/:id/interactions/:interactionId/accept|reject|respond|verdicts|skip|cancel|dismiss`
  (since the 2026-10-29 sync, accept, reject and respond read `GET /api/issues/:id/interactions` again
  to check an uncertain result after a dropped response);
  `/api/connection-intents/:interactionId/complete|decline|phase|setup-options`;
  `POST /api/agents/:agentId/connection-intents/:interactionId/adopt`;
  `PUT /api/companies/:companyId/ai-connections/default`.
- **Notes:** resolver policy can restrict who answers (anyone, not the creator, humans only).
  Flag `enableIssuePlanDecompositions` adds accepted plan decompositions
  (`GET /api/issues/:id/accepted-plan-decompositions`).

### `tasks/approvals`: Approvals on a task

- **What:** governed actions (e.g. hiring) attached to the task appear as approval cards; approve or
  reject in place.
- **Requests:** `GET /api/issues/:id/approvals`, `POST /api/approvals/:id/approve|reject`.

### `tasks/run-control`: Runs, live state and run debugging

- **What:** live-run pill and status island; stop a response; retry a failed run; resume a paused assignee
  agent (resume + wake); respond to an agent's runtime request (e.g. a permission prompt in a native-runner
  session); watchdog decisions on a run flagged as stuck (snooze, continue, dismiss false positive); run
  ledger of all runs; provider traces (view, reveal frame, download, delete); cost summary.
- **Requests:** `POST /api/heartbeat-runs/:runId/cancel`, `POST /api/agents/:id/wakeup`,
  `POST /api/agents/:id/resume`, `POST /api/heartbeat-runs/:runId/runtime-requests/:requestId/resolve`,
  `POST /api/heartbeat-runs/:runId/watchdog-decisions`, `GET|DELETE /api/heartbeat-runs/:runId/provider-trace`
  (+ `/download`, `/frames/:frameId/reveal`), `GET /api/companies/:companyId/provider-traces`,
  `GET /api/issues/:id/cost-summary`.
  Since the 2026-11-05 sync, Stop is offered on a failed native retry (`execution.canStop`): the old UI
  saves a `cancellationRequestId` and sends it in the cancel body, and checks the run's
  `nativeCancellation` intent in the reply (`lib/native-run-stop.ts`). A Stop during slow native startup
  answers 409 `native_stop_pending` and settles as cancelled later.
  Since the 2026-11-10 sync, a generic `adapter_failed` run carries `failureCause` (a bounded code such
  as `40001` or `ECONNRESET`), shown as "adapter failed (40001)" in the run ledger (#20483), and the
  live run status (`currentStatusMessage`, `currentToolName`, `lastAssistantSnippet`) covers storage
  waits: phase `waiting_for_storage`, "Waiting for file storage before starting the run log (45s so
  far)" (#20460).
- **Source:** `components/IssueRunLedger.tsx`, `components/TaskChatThread.tsx`.

### `tasks/properties`: Properties panel

- **Where:** side panel → Properties (`components/issue-properties/IssueProperties.tsx`).
- **What:**
  - *About:* status, priority, assignee, labels (and create label), project, parent, created / updated /
    started / completed, originating task, archived.
  - *Relationships:* blocked by (search and add), blocking, subtasks with completion, depth; the
    source routine of a routine-created task, linked (since the 2026-10-24 sync,
    `components/issue-properties/routine-origin-row.tsx`, `GET /api/routines/:id`).
  - *Execution:* execution policy (normal or auto, reviewers and approvers), model and model lane,
    monitor (external service; check now; cancel), watchdog (agent + instructions; open watchdog task),
    scheduled retry (retry now).
  - *Workspace:* execution workspace, branch, folder, services, pull requests.
- **Requests:** `PATCH /api/issues/:id` for most fields; `POST /api/companies/:companyId/labels`;
  `PUT|DELETE /api/issues/:id/watchdog`; `POST /api/issues/:id/monitor/check-now`;
  `POST /api/issues/:id/scheduled-retry/retry-now`; `GET /api/companies/:companyId/adapters/:type/models`.
  Since the 2026-11-05 sync, a "Usage limit" line under the assignee shows the agent's provider
  rate-limit windows, from `GET /api/agents/:id/runtime-state` (`stateJson.providerRateLimits`), refreshed by
  the `agent.runtime_state.updated` live event (`components/AgentRateLimitGauge.tsx`).
  Since the 2026-11-07 sync, a Context row ("10% of 258k") shows the agent's context window, with a
  hover breakdown of tokens, cost and compactions, refreshed every 8 s while a run is active
  (`GET /api/issues/:id/context-usage`, type `IssueContextUsage`). "Compact now" (board only) queues a
  short run that compacts the context and does no task work (`POST /api/issues/:id/context/compact`),
  also while an Agent Chat waits; the transcript shows a compaction divider
  (`components/issue-properties/context-usage-row.tsx`).
- **Notes:** title and description are edited inline in the header and description bubble (same PATCH).

### `task-coordination/delegation` and `/dependencies`: Subtasks and blockers

- **Where:** side panel → Subtasks and Tasks tabs (`components/task-detail/TaskDetailTasksPanel.tsx`),
  Properties → Relationships, "Related tasks" panel, sibling navigation (previous/next sibling).
- **What:** see parent chain and children with completion; add subtask; add or remove blockers; blocked
  tasks wake when blockers resolve.
- **Requests:** `GET /api/companies/:companyId/issues` (children, blockers search), `PATCH /api/issues/:id`.
- **Since the 2026-11-09 sync** (#20098): when a child or blocker stops on a recovery action that
  needs the board, the parent's page shows "A dependency needs the board" with each such task's link
  and its own Retry (`components/StalledDependencyNotice.tsx`). The list arrives on the task
  (`Issue.stalledDependencies`); each row reads the child (`GET /api/issues/:id`) to drop itself once
  the child's status moves on, and Retry sends `POST /api/issues/:issueId/retry`
  (`hooks/useTaskRetry.ts`). The waiting agent is woken once per stall (`issue_blocker_stalled`).
- **Since the 2026-11-10 sync** (#20366): the task's breadcrumbs show its immediate parent, truncated,
  with a non-interactive lock chip for a private parent (`components/BreadcrumbBar.tsx`).

### `task-coordination/tree-control`: Pause, resume, cancel, restore a task tree

- **Where:** "More task actions" menu.
- **What:** pause holds the task (and optionally its subtree); resume (optionally waking agents); cancel
  a subtree; restore a cancelled subtree. A preview shows what will be affected.
- **Requests:** `POST /api/issues/:id/tree-control/preview`, `GET .../tree-control/state`,
  `GET|POST /api/issues/:id/tree-holds`, `POST .../tree-holds/:holdId/release`.
- **Notes:** release policy can be manual or after active runs finish.

### `tasks/lifecycle`: Other header actions

- **What ("More task actions"):** add subtask, copy as markdown, archive from inbox, privacy items, tree
  controls, hide this task (`hiddenAt`, removes it from lists).
- **Requests:** `PATCH /api/issues/:id`, `POST /api/issues/:id/inbox-archive`.

### `tasks/privacy`: Private tasks and sharing

- **Where:** "More task actions" privacy items, share sheet (`components/IssueShareSheet.tsx`), composer
  "Private task".
- **What:** make a task private or open; grant and revoke access for specific people or agents; explains
  inherited privacy (from a private parent or project).
- **Requests:** `PATCH /api/issues/:id` (visibility), `GET|POST /api/issues/:id/access-grants`,
  `POST .../access-grants/:grantId/revoke`, `GET /api/issues/:id/privacy-constraints`.

### `documents-artifacts/documents` and `/annotations`: Task documents

- **Where:** side panel document tabs, documents section, plan document (`hooks/useIssuePlanDocument.ts`).
- **What:** keyed markdown documents (the `plan` document is special); edit with revisions; restore a
  revision; lock/unlock against concurrent edits; import a markdown file as a document; delete;
  annotation threads on document text (comment, resolve).
- **Requests:** `GET /api/issues/:id/documents`, `GET|PUT|DELETE .../documents/:key`,
  `GET .../revisions`, `GET .../revisions/:revisionId` (one revision, for a decision's exact review
  target; since the 2026-10-29 sync), `POST .../revisions/:revisionId/restore`, `POST .../lock|unlock`,
  `GET|POST /api/issues/:issueId/documents/:documentKey/annotations` (+ thread PATCH and comments).
- **Since the 2026-11-01 sync:** a document's images open in a gallery, in reading order
  (`components/DocumentMarkdownBody.tsx`, `ImageGalleryModal.tsx`).

### `documents-artifacts/attachments`, `/work-products`: Files and outputs

- **Where:** side panel Artifacts tab and attachment viewer, output section, files browser.
- **What:** upload (button or drop on the side panel), preview and delete attachments; outputs (work
  products) linked to the task, with a generated review document; artifacts list; browse and open files in
  the task's workspace; open a skill the task created.
- **Requests:** `GET /api/issues/:id/attachments`, `POST .../attachments`, `DELETE /api/attachments/:id`,
  `GET /api/attachments/:attachmentId/content`, `GET /api/issues/:id/work-products`,
  `POST .../work-products/:workProductId/review-document`, `GET /api/companies/:companyId/artifacts`,
  `GET /api/issues/:issueId/file-resources/list|content|resolve`, `GET /api/companies/:companyId/skills/:skillId`.
- **Notes:** flag `enableExperimentalFileViewer` changes the file viewer. Flag `enableArtifactsV1`
  (since the 2026-10-24 sync, default off) switches the panel's Artifacts tab to compact rows and the
  thread to grouped artifact rows (`components/artifacts/v1/*`).

### `tasks/workspace`: Execution workspace on the task

- **What:** workspace card (which checkout/worktree the task runs in, branch, services); start/stop
  runtime services; reconcile the workspace branch; worktree picker in the composer.
- **Requests:** `GET /api/companies/:companyId/execution-workspaces`,
  `POST /api/execution-workspaces/:id/runtime-commands/:action`,
  `POST /api/execution-workspaces/:id/reconcile-branch`. Since the 2026-11-10 sync, the summaries
  accept `?summary=true&ids=` (up to 100, #20388).
- **Notes:** flags `enableIsolatedWorkspaces`, `enableEnvironments`. See [projects](projects.md) for
  workspace pages.

### `tasks/recovery`: Recovery and health notices

- **What:** notices when the task is stuck, with one-click fixes: recovery actions (missing disposition,
  wait without target, stranded assignment, workspace or configuration validation, active-run watchdog,
  task-graph liveness), disposition recovery retry, reissue as an isolated recovery task, workspace export
  and base-ref recovery, execution blockers, write-denied notice, "retry access check".
  Since the 2026-10-22 sync, an interrupted task shows one state instead of separate recovery,
  failed-run and saved-message warnings: "Retry available", "Trying again in Ns" (scheduled retry), or
  "Taking longer than usual", with a single Retry button. Retry is also offered on task rows and in
  the Inbox. The "Recovery details" panel and the "Continue from saved sources" form are gone from the
  old UI; the server now recovers saved work itself.
  Since the 2026-10-24 sync, a task stopped because its agent may not read the project explains the
  denial and links to the agent's project access settings; after access is added, the task offers an
  explicit retry (`components/TaskProjectAccessNotice.tsx`, `GET /api/agents/:id/project-access`).
- **Requests:** `POST /api/issues/:issueId/retry` (Retry, with an idempotency key and the run it saw),
  `POST /api/issues/:id/recovery-actions/resolve`, `POST /api/companies/:companyId/issues` (reissue),
  `POST /api/execution-workspaces/:id/reconcile-branch`. The interruption state arrives on the task.
  Since the 2026-11-05 sync, "Recover saved files" on a native export hold reads
  `GET /api/issues/:id/recovery-actions` and sends `POST /api/issues/:id/recovery-actions/recover-workspace`
  with a saved idempotency key (`components/WorkspaceExportRecovery.tsx`); the interruption shows the
  recovery step (`recoveryStep`) and a Retry wait (`execution.retryWait`).
  Since the 2026-11-07 sync, when Paperclip can't verify that a killed previous server stopped
  (`userAction: "confirm_owner_stop"`), a company owner or admin confirms it, with how they checked,
  through `POST /api/issues/:id/recovery-actions/resume-workspace-finalization` (stop evidence) or
  `POST /api/issues/:id/recovery-actions/confirm-controller-stopped`; Retry or Recover stays offered on
  retryable retained holds whose source can't be verified (`retainedSourceFallback`), and a pending
  native resume shows "resuming" with its time instead of Retry (`components/WorkspaceExportRecovery.tsx`).
  Since the 2026-11-09 sync, records saved before Paperclip stored which server held them get the
  cause `ownership_owner_unprovable`, with `evidence.kind`, `recordId` and `recordUpdatedAt`; an owner
  or admin confirms how they checked through `POST /api/issues/:id/recovery-actions/confirm-owner-gone`
  (`{actionId, recordId, stopEvidence, recordVersion?}`, answering `queued` or `released`;
  `components/WorkspaceExportRecovery.tsx`). A Retry waiting on blockers (`retryWait.reason:
  "dependency_blocked"`) lists each unfinished blocker with a link and what to do
  (`components/ExecutionBlockerNotice.tsx`).
  Since the 2026-11-10 sync, a native run cut off before its runner's process was recorded presents
  `userAction: "confirm_run_stopped"` (`canRetry: false`); an owner or admin confirms that no agent is
  still working through `POST /api/issues/:id/recovery-actions/confirm-run-stopped` (`{runId,
  stopEvidence}`, answering `{runId, alreadyStopped, presentation}`; `components/ExecutionBlockerNotice.tsx`),
  and the parked Retry starts at once. A board-owned native recovery that can't verify the original
  host (`native_restart_recovery_blocked`, `evidence.reason: "controller_process_space_unverified"`)
  gets a containment form that sends `POST /api/issues/:id/recovery-actions/resolve` with
  `outcome: "restored"` and `executionReconciliation` (`components/IssueRecoveryActionCard.tsx`,
  `NativeControllerContainmentRecovery`). Retry answers `scheduledRetry {outcome, message}`
  (`hooks/useTaskRetry.ts`); a budget-held Retry presents `userAction: "budget"`; the interruption
  names a failed setup command (`setupFailure`) or a rejected model (`rejectedModel`); and the paused
  notice stays hidden while an agent's setup is repaired through a `connection_intent` card
  (`agentSetup: true`).
- **Unused by the old UI:** `POST /api/issues/:id/recovery-actions/reconstruct-workspace` (continue from
  saved sources).

### `tasks/runner-goal`: Runner goal

- **What:** "Goal: keep pursuing" from the composer sets a goal the runner keeps working toward; a widget
  shows progress with actions and reassignment.
- **Requests:** `GET /api/issues/:id/runner-goal`, `POST /api/issues/:id/runner-goal/actions`.

### `tasks/feedback`: Feedback votes

- **What:** thumbs up/down on agent output, with data-sharing terms.
- **Requests:** `GET|POST /api/issues/:id/feedback-votes`.

### `tasks/integrations`: Integrations surfaced on a task

- **Email:** a task linked to an email thread shows the messages; set up inboxes, resolve deliveries,
  control an inbox. `/api/companies/:companyId/email/*`, `POST /api/email/inboxes/:id/control`.
- **External chat:** a task bound to a chat conversation (Slack and others) shows a banner; publish a
  board message to it. `GET /api/issues/:issueId/chat-binding`,
  `POST /api/chat-endpoints/:endpointId/conversations/:conversationId/publications` (flag
  `enableChatConnectors`).
- **Browser use:** live viewer of an agent's browser; take control, resize the viewport.
  `/api/issues/:issueId/browsers/*`.
- **Grok bot:** stop Grok work (`enableGrokBot`).
- **Cases:** cases linked to the task (`GET /api/issues/:issueIdOrIdentifier/cases`, `enableCases`).
- **External objects:** pull requests and other linked objects with live status (`enableExternalObjects`).

## Live updates

The app shell's `LiveUpdatesProvider` listens on `WS /api/companies/:companyId/events/ws` and refreshes
task lists, details, comments and runs as events arrive; live run transcripts stream over the same socket
(`components/transcript/useLiveRunTranscripts.ts`). Task toasts fire only for your own participation or
mentions (`doc/TOASTS.md`). Details in the [app shell guide](app-shell.md).

## Switches that change this area

`enableCombinedInboxTasks` (Inbox inside Tasks), `enableClassicTaskInterface` (old thread),
`enableAgentChat` (conversation mode and chat links), `enableIssuePlanDecompositions`,
`enableExperimentalFileViewer`, `enableExternalObjects`, `enableChatConnectors`, `enableCases`,
`enableIsolatedWorkspaces`, `enableEnvironments`, `enableGrokBot`. Full list with affected files:
[generated/flags.md](../generated/flags.md).

## Redesign notes

- **Two list implementations.** Organization views use `IssuesList`; personal views use the Inbox
  component, with its own grouping, keyboard handling and item kinds. A redesign can unify them into one
  list with saved views, treating approvals, failed runs and join requests as item kinds.
- **Inbox read state is split.** Tasks track read/unread on the server; non-task inbox items only in the
  browser. Worth fixing if the inbox is redesigned.
- **Task detail is also Agent Chat.** `TaskDetailSurface` renders both; any redesign of one affects the
  other.
- **Two presentations.** Only the chat-style thread needs porting; dropping `enableClassicTaskInterface`
  removes a switch.
- **The side panel is a tab browser** (properties, subtasks, tasks, artifacts, documents, files,
  attachments, skills, browser) with persisted tab state. It holds a lot of functionality that a redesign
  could promote to first-class sections.
- **Feature density.** Task detail reaches 136 page-specific requests. The capabilities above are the
  checklist; most niche ones (provider traces, recovery, runtime requests, watchdog decisions) only appear
  when relevant and can stay contextual.
