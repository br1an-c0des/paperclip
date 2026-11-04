# App shell

Tier 1 (redesign). Everything around the pages: navigation, global dialogs, the command palette,
keyboard shortcuts, live updates, toasts, and plugin extension points. It is mounted on every company
page by `components/Layout.tsx` (streamlined shell), with providers from `main.tsx`.

Source of truth for requests: the **App shell** section of [generated/pages.md](../generated/pages.md)
(about 166 requests, reachable from 490 files). Upstream recipes: `maps/feature-map/navigation-preferences.md`,
`companies.md`, `onboarding.md`, `plugins.md`.

## Layout

`components/Layout.tsx` renders: sidebar (`Sidebar`, `SidebarShell`), a secondary contextual sidebar for
some sections, breadcrumb bar, the page (`Outlet`), an optional properties panel, mobile bottom navigation,
the toast viewport, banners (announcements, dev-server restart, worktree), the keyboard shortcuts
cheatsheet, the command palette, global dialogs, and plugin overlays.

## Capabilities

### `shell/navigation`: Sidebar

- **Where:** `components/Sidebar.tsx` and `Sidebar*` components.
- **What (streamlined shell):**
  - *Top:* Search, Dashboard (with live-run count), Inbox (hidden when combined into Tasks), Chat,
    Decisions, Status (beta), Conference Room.
  - *Work:* Chat (as a rail when Agent Chat is on), Tasks (with inbox badge when combined), Projects with
    starred projects, Routines, Artifacts, Cases (beta), Goals, Workspaces.
  - *Org:* Agents, Skills, Connectors (Apps), Audit (Activity hub).
  - Agents list (`SidebarAgents`): your agents with status, pause/resume, wake; primary agent first.
  - Recent tasks (`SidebarRecentTasks`) with wake action; since the 2026-10-22 sync they load as
    bounded summaries (`GET /api/companies/:companyId/issues/summaries?ids=`).
  - Company menu: switch organization, create organization.
  - Account menu: view profile, settings, invite people, documentation, share feedback, sign out.
  - Plugin launchers and slots.
- **Requests:** `GET /api/companies/:companyId/agents`, `/built-in-agents`, `/attention` (badge),
  `/approvals` (badge), `/live-runs`, `GET /api/companies/:companyId/resource-memberships/me`,
  `POST /api/agents/:id/pause|resume|wakeup`, `GET /api/companies` (company list), `POST /api/companies`.
- **Notes:** eight links appear or disappear with flags: Inbox (`enableCombinedInboxTasks`), Chat
  (`enableAgentChat`), Decisions (`enableDecisions`), Status (`enableStatusCards`), Conference Room
  (`enableConferenceRoomChat`), Cases (`enableCases`), Goals (`enableGoalsSidebarLink`), Workspaces
  (`enableIsolatedWorkspaces`, hidden when the chat rail shows). (Pipelines and `enablePipelines` were
  removed upstream on 2026-10-22.)
  Section collapse state and recent items are kept locally.

### `shell/contextual-sidebars`: Section sidebars

- **What:** some sections swap in their own secondary navigation: agent (agent sections and
  conversations), routine, skills, apps (and app detail), company settings, chat setup.
- **Source:** `AgentContextualSidebar`, `AgentConversationsSidebar`, `RoutineContextualSidebar`,
  `SkillsContextualSidebar`, `AppsSidebar`, `AppDetailSidebar`, `CompanySettingsSidebar`.

### `shell/command-palette`: Command palette

- **Where:** Cmd/Ctrl+K (`components/CommandPalette.tsx`).
- **What:** actions (new task, new project, and others), pages, quick filters, search, and jump to tasks,
  projects and agents.
- **Requests:** `GET /api/companies/:companyId/issues`, `/projects`, `/agents`, `/labels`.

### `shell/shortcuts`: Keyboard shortcuts

- **Where:** `?` opens the cheatsheet (`components/KeyboardShortcutsCheatsheet.tsx`).
- **What:**
  - Global: `c` new task, `/` search current page or quick search, `[` toggle sidebar, `]` toggle panel,
    `?` show shortcuts, Cmd/Ctrl+K command palette.
  - Lists and inbox: `j`/`k` or arrows move, left/right collapse/expand, Enter open, `a`/`y` archive,
    `r` mark read, `U` mark unread.
  - Task detail: `y` quick-archive back to inbox, `g i` go to inbox, `g c` focus comment composer.
  - Decisions: Enter open/close, `x` dismiss.

### `shell/dialogs`: Global create dialogs

- **What:** new task ([tasks](tasks.md#taskscreate-new-task-dialog)), new project
  ([projects](projects.md)), new goal ([goals](goals.md)), new agent, and onboarding. Any page opens
  them through `DialogContext` (`openNewIssue`, `openNewProject`, `openNewGoal`, `openNewAgent`,
  `openOnboarding`).
- **Requests:** the creation requests listed in each area guide, plus the agent configuration form's
  adapter, model and AI-connection requests.

### `shell/live-updates`: Live updates and toasts

- **Where:** `context/LiveUpdatesProvider.tsx`.
- **What:** one WebSocket per company (`/api/companies/:companyId/events/ws`). Events:
  `activity.logged`, `agent.status`, `heartbeat.run.queued`, `heartbeat.run.status`,
  `heartbeat.run.progress`, `heartbeat.run.log`, `heartbeat.run.event`. The provider refreshes the
  affected cached data (tasks, comments, runs, agents, inbox) and shows toasts: someone created or
  updated a task you're involved in, someone wants to join, a chat couldn't start. Reconnects with
  backoff; polling is used as a fallback for some lists (`hooks/useSharedPolling.ts`, one tab leads).
- **Notes:** toast eligibility rules are in `doc/TOASTS.md` (only your own participation or explicit
  mentions).
- **Since the 2026-10-29 sync:**
  - Run transcripts share this socket instead of opening their own. The client sends
    `live.hello` and `live.interests` (the run IDs on screen), and the server sends transcript events
    only for those runs. Other runs produce a throttled `heartbeat.run.activity` (last output time).
    Clients that don't negotiate still get every event, but the server closes their socket (1013)
    when the backlog passes 1,000 items or 1 MiB.
  - A connection banner covers the whole app during an outage. Recovery is confirmed by
    `GET /api/health` or the socket. Reads keep cached data, and writes (autosave, comments, new
    tasks, decisions) are kept and retried with their original account and request key
    (`lib/connectivity.ts`, `hooks/useDurableAutosave.ts`, `hooks/useDurableSubmit.ts`).
- **Since the 2026-11-01 sync:** when one web server hands over to another, the server can send
  `live.resync` with reason `controller_change` to clients that negotiated `live.hello`. The
  replaced server's sockets close, so clients reconnect and refresh.

### `shell/company`: Company context

- **What:** the selected company comes from the URL prefix (`/:companyPrefix`); switching companies,
  creating one, and the no-companies empty state. Unprefixed URLs (`/issues`, `/agents/...`) redirect to
  the current company.
- **Requests:** `GET /api/companies`, `POST /api/companies`, `GET /api/auth/get-session`,
  `GET /api/cli-auth/me`.

### `shell/plugins`: Plugin extension points

- **What:** installed plugins can add sidebar launchers and slots, app-shell overlays, project tabs,
  agent detail tabs (`detailTab` slots for agents, at `/agents/:agentId/plugin:<pluginKey>:<slotId>`;
  added upstream on 2026-10-22), company settings pages (`/company/settings/:settingsRoutePath/*`) and
  full pages (`/:pluginRoutePath/*`). Plugin UI runs through a bridge (`plugins/bridge.ts`, including an
  EventSource stream).
- **Source:** `PluginSlotMount`, `PluginSlotOutlet`, `PluginLauncherOutlet`, `PluginAppShellOverlays`,
  `plugins/`.
- **Notes:** a new UI must keep these mount points (or a subset) for installed plugins to keep working.
- **Since the 2026-11-01 sync:** a task side panel can declare
  `taskSidePanel.activation: { namespace, activityKey }`. Runtime activity that matches opens it,
  read from `GET /api/heartbeat-runs/:runId/events?view=plugin-panels` (`heartbeatsApi.taskPanelActivations`,
  at most 128 panels) and live run updates. Panels can also be opened by hand while the assigned
  agent is idle. Availability (`GET /api/plugins/:pluginId/api<availabilityPath>?runId=&issueId=`)
  is checked up to three times after activity instead of on a timer (`hooks/useTaskPluginPanels.ts`).

### `shell/coordinator-workspace`: Coordinator workspace

- **What:** a per-person workspace, added upstream on 2026-10-29 (#17983). It's off by default and
  turned on in Settings > Experimental, stored as a workspace preference rather than an instance
  flag. It needs `enableAgentChat`. It has:
  - one conversation per agent;
  - task proposals from chat (a new task with no assignee goes to the chat's agent);
  - compact task and decision cards;
  - document panels beside the chat;
  - pinned destinations;
  - a Needs You queue with search, filters, grouping and history.
- **Requests:** `GET /api/workspace-preferences/me`,
  `PUT /api/companies/:companyId/workspace-preferences/me`, `GET /api/issues/:id/pending-questions`,
  `/decision-receipts`, `/chat-handoffs`, `/documents/:key/revisions/:revisionId`,
  `GET /api/companies/:companyId/attention/history` (cursor-paged decision history). Since the
  2026-11-01 sync, its counts and Needs attention use `GET /api/companies/:companyId/attention/summary`
  and `/attention/tasks`.
- **Notes:** upstream's own take on what `ui-new` redesigns: the Inbox's Needs you, requests and agent
  chat. Not ported. It's to be compared with `ui-new` and designed
  ([build plan 3.16](../../build-plan.md#316-upstreams-coordinator-workspace), U36).

### `shell/misc`: Other shell features

- Announcements (`AnnouncementWell`; `GET /api/announcements/*`, dismiss).
- Dev-server restart banner and worktree banner (development instances).
- Mobile bottom navigation.
- Breadcrumbs set by each page (`BreadcrumbContext`).
- Primary agent provider (`GET|PUT /api/companies/:companyId/primary-agent/me`).

## Switches that change this area

Most flags surface here first, through the sidebar. See the Notes on `shell/navigation` and
[generated/flags.md](../generated/flags.md).

## Redesign notes

- **The sidebar is where the switches show.** Settling the information architecture (which sections
  exist, permanently) removes most flag checks from the shell.
- **Several "home" candidates:** Dashboard, Inbox/Tasks My-work, Decisions and Chat each compete to be
  the landing page.
- **Global features to keep:** command palette, shortcuts, create dialogs, live updates with toasts, and
  plugin mount points. These are cross-cutting and easy to forget when redesigning page by page.
