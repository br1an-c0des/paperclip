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
    starred projects, Routines, Artifacts, Cases (beta), Pipelines, Goals, Workspaces.
  - *Org:* Agents, Skills, Connectors (Apps), Audit (Activity hub).
  - Agents list (`SidebarAgents`): your agents with status, pause/resume, wake; primary agent first.
  - Recent tasks (`SidebarRecentTasks`) with wake action.
  - Company menu: switch organization, create organization.
  - Account menu: view profile, settings, invite people, documentation, share feedback, sign out.
  - Plugin launchers and slots.
- **Requests:** `GET /api/companies/:companyId/agents`, `/built-in-agents`, `/attention` (badge),
  `/approvals` (badge), `/live-runs`, `GET /api/companies/:companyId/resource-memberships/me`,
  `POST /api/agents/:id/pause|resume|wakeup`, `GET /api/companies` (company list), `POST /api/companies`.
- **Notes:** nine links appear or disappear with flags: Inbox (`enableCombinedInboxTasks`), Chat
  (`enableAgentChat`), Decisions (`enableDecisions`), Status (`enableStatusCards`), Conference Room
  (`enableConferenceRoomChat`), Cases (`enableCases`), Pipelines (`enablePipelines`), Goals
  (`enableGoalsSidebarLink`), Workspaces (`enableIsolatedWorkspaces`, hidden when the chat rail shows).
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

### `shell/company`: Company context

- **What:** the selected company comes from the URL prefix (`/:companyPrefix`); switching companies,
  creating one, and the no-companies empty state. Unprefixed URLs (`/issues`, `/agents/...`) redirect to
  the current company.
- **Requests:** `GET /api/companies`, `POST /api/companies`, `GET /api/auth/get-session`,
  `GET /api/cli-auth/me`.

### `shell/plugins`: Plugin extension points

- **What:** installed plugins can add sidebar launchers and slots, app-shell overlays, project tabs,
  company settings pages (`/company/settings/:settingsRoutePath/*`) and full pages
  (`/:pluginRoutePath/*`). Plugin UI runs through a bridge (`plugins/bridge.ts`, including an
  EventSource stream).
- **Source:** `PluginSlotMount`, `PluginSlotOutlet`, `PluginLauncherOutlet`, `PluginAppShellOverlays`,
  `plugins/`.
- **Notes:** a new UI must keep these mount points (or a subset) for installed plugins to keep working.

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
