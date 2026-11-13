import type { Agent, Project } from "@paperclipai/shared";
import { A, useLocation, useNavigate } from "@solidjs/router";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Ellipsis,
  Keyboard,
  LogOut,
  Moon,
  Palette,
  PanelLeftClose,
  Pause,
  Play,
  Plug,
  Plus,
  Radar,
  Repeat,
  Search,
  Settings2,
  Star,
  Sun,
  UserRound,
  UserRoundMinus,
  Zap,
} from "lucide-solid";
import { For, Show, type JSX, type ParentProps } from "solid-js";
import { agentState } from "@/lib/agent-state";
import { useCommands } from "@/lib/commands";
import { useCompaniesQuery, useCompany } from "@/lib/company";
import { useNeedsYouCount } from "@/inbox/needs-you";
import { isOrgPage } from "./dock-model";
import { NavPlugins, NavProjectPlugins } from "@/plugins/NavPlugins";
import { GlobalToolbarPlugins, PluginOrganizationSwitcher } from "@/plugins/ShellPlugins";
import { useAgentStars } from "@/agents/AgentStar";
import { useCanCreateCompany } from "@/onboarding/can-create";
import { actionTargets, useAgentActions } from "@/org/actions";
import { profilePath } from "@/profile/profile-model";
import { ServerInfo } from "@/shell/ServerInfo";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { useSession, useSignOut, useYouName } from "@/lib/session";
import { theme, toggleTheme } from "@/lib/theme";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { Grain } from "@/ui/Grain";
import { Menu } from "@/ui/Menu";
import { ScrollList } from "@/ui/ScrollList";
import { TaskStatusCapsule } from "@/ui/Status";
import { navSection, setNavHidden, setNavMode, useCompanyOrder, useProjectStars, useRecentTasks } from "./nav-prefs";
import { useNavLists } from "./nav-lists";
import { isProjectPage, showStatusLink } from "./nav-model";
import { ChatUnreadBadge } from "@/chat/chat-read";
import "@/ui/nav.css";
import "./Nav.css";

/*
 * The left nav (board 1, on every board): the company row, the tools row (search and new task),
 * Inbox with its badge (what's waiting on you, as the Inbox's Needs you tab counts it); what you
 * starred; projects with their task counts; agents with their live state; the tasks you opened
 * lately; Connections and you at the bottom. The item owning the current page is raised with the --sel
 * pill: the router marks it `.active` for every page under it, and `aria-current` on the exact page.
 *
 * The company row ("layout B") is the company's disc and name, a link to its dashboard that took
 * over from the old "Org dashboard" item: it stays raised on every organization page (the roster at
 * `/agents`, workload and the org tabs; `isOrgPage`), as boards 20 and 33 draw it, with
 * `aria-current` on the dashboard itself. The Repeat button at its end, and only that, opens the
 * company menu. A plugin's `organizationSwitcher` replaces the whole row (it draws the current
 * company and its own menu, as the old sidebar's company row did). Under it, the tools row: a
 * search field that opens the ⌘K palette and New task (`C`). Company settings is on the dashboard
 * header and in the palette; the You row holds only your menu.
 *
 * A project row opens the project's tasks (its List view, `/projects/:key/issues`) and stays raised
 * on all the project's pages (`isProjectPage`). The + beside "Projects" opens New project (board N1).
 *
 * Your nav (nav-prefs.tsx): projects and agents you've starred sit in Starred above the rest; each
 * project's "…" moves it up or down (your order, kept on the server), stars it or leaves it (out of
 * your nav); each agent's "…" runs it now, pauses or resumes it (org/actions.ts) and stars it.
 * Project rows wait until your order and stars have loaded, so they never reshuffle. Project and
 * agent rows are keyed by id, so a refetch updates them in place instead of rebuilding them (which
 * remounted the plugin items under each project and closed an open "…" menu); nav-lists.ts holds
 * these lists for the rail's flyouts too. Every section folds from its heading. The company menu
 * lists companies in the order you gave them on the companies page.
 *
 * `[` folds the whole nav to the icon rail (NavRail.tsx) and back, and Shift+`[` hides it (the shell
 * then offers it back); the You menu has both, as Collapse sidebar and Hide navigation. While it
 * folds, the labels fade first (Nav.css, `[data-fold]`), then the column narrows (Shell.tsx). Plugins
 * live only here: the rail has no plugin sections, project plugin items or toolbar buttons.
 *
 * Three zones: the company row, the tools row, Inbox and Status stay pinned at the top; Connections and
 * you stay pinned at the bottom; between them Starred, Projects, Agents, Recent tasks
 * and plugins' sections each scroll on their own, without the browser's scrollbar: a slim
 * gradient capsule shows where you are, or on a touch screen the edge with more beyond it glows
 * (ui/ScrollList.tsx). A short list keeps its height; long ones share what's left (Nav.css).
 * The nav's right edge drags to resize it (Shell.tsx).
 *
 * An agent whose chat has agent messages you haven't read (a reply, or a briefing it sent from a
 * task; decision 48) has a badge beside its name saying how many (U65), except the chat open now,
 * which marks itself read (chat/chat-read.tsx).
 *
 * Status (status cards, decision 39, D3) sits under Inbox while the instance has `enableStatusCards`
 * on, as in the old sidebar.
 *
 * Plugins' global toolbar buttons sit under the tools row; the company menu offers Create
 * organization (the onboarding page) when you may create one. The You menu holds View profile and,
 * with `enableServerInfoDebugView` on, the server's restart time, commit and checkout state.
 */

function InboxIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

/** The palette's shortcut as this keyboard writes it. "Ctrl K" is wider, so it gives way sooner (Nav.css). */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const PALETTE_HINT = IS_MAC ? "⌘K" : "Ctrl K";

/**
 * The company row: the company's disc and name link to its dashboard, raised on every organization
 * page as "Org dashboard" was; the Repeat button at its end opens the company menu.
 */
function CompanyRow() {
  const company = useCompany();
  const location = useLocation();
  /** Every organization page (the roster, workload, the org tabs) raises the company row. */
  const orgPage = () => isOrgPage(location.pathname, company().issuePrefix);
  return (
    <div class="company-row">
      <A class="navi company-link" href={`/${company().issuePrefix}/dashboard`} classList={{ active: orgPage() }} title={company().name}>
        <span class="company-mark grained" aria-hidden="true">
          <InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={28} />
          <Grain />
        </span>
        <span class="company-name disp">{company().name}</span>
      </A>
      <CompanyMenu />
    </div>
  );
}

/**
 * What the company menu offers, for it and the rail's company card (NavRail.tsx): the companies in
 * the order you gave them on the companies page, and whether you may create one.
 */
export function useCompanyChoices() {
  const companies = useCompaniesQuery();
  const order = useCompanyOrder();
  const canCreate = useCanCreateCompany();
  return {
    ordered: () => order.ordered(companies.data ?? []),
    canCreate: () => canCreate().allowed,
  };
}

/** The company menu: companies in your order, All companies, and Create organization. */
function CompanyMenu() {
  const company = useCompany();
  const choices = useCompanyChoices();
  const navigate = useNavigate();
  return (
    <Menu placement="bottom-end">
      <Menu.Trigger class={buttonClass({ variant: "icon", ghost: true }) + " company-switch"} aria-label="Switch company" title="Switch company">
        <Repeat size={16} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Companies" width={260}>
        <Menu.Group label="Companies">
          <For each={choices.ordered()}>
            {(item) => (
              <Menu.Item
                onSelect={() => navigate(`/${item.issuePrefix}`)}
                icon={<InitialsDisc name={item.name.slice(0, 1)} seed={item.id} size={22} />}
                hint={item.id === company().id ? "Current" : item.issuePrefix}
              >
                {item.name}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Item onSelect={() => navigate("/companies")} icon={<Building2 size={16} />} description="Change their order there">
          All companies
        </Menu.Item>
        <Show when={choices.canCreate()}>
          <Menu.Item onSelect={() => navigate("/onboarding")} icon={<Plus size={16} />}>
            Create organization
          </Menu.Item>
        </Show>
      </Menu.Content>
    </Menu>
  );
}

/**
 * The You menu's content, for the full nav's You row and the rail's avatar: your profile, App
 * settings, the theme, the shortcuts, Collapse sidebar (`[`, Expand sidebar on the rail) and Hide
 * navigation (Shift+`[`), the style guide, the server's details, and Sign out.
 */
export function YouMenuContent(props: { rail?: boolean }) {
  const session = useSession();
  const company = useCompany();
  const commands = useCommands();
  const navigate = useNavigate();
  const signOut = useSignOut();
  return (
    <Menu.Content label="Account and appearance" width={260}>
      <Menu.Item onSelect={() => navigate(profilePath(company().issuePrefix, { id: session.youId() }))} icon={<UserRound size={16} />}>
        View profile
      </Menu.Item>
      <Menu.Item onSelect={() => navigate(`/${company().issuePrefix}/company/settings/instance`)} icon={<Settings2 size={16} />}>
        App settings
      </Menu.Item>
      <Menu.Item onSelect={toggleTheme} icon={theme() === "dark" ? <Sun size={16} /> : <Moon size={16} />}>
        {theme() === "dark" ? "Use light theme" : "Use dark theme"}
      </Menu.Item>
      <Menu.Item onSelect={() => commands.setShortcutsOpen(true)} icon={<Keyboard size={16} />} hint="?">
        Keyboard shortcuts
      </Menu.Item>
      <Menu.Item onSelect={() => navigate("/style-guide")} icon={<Palette size={16} />}>
        Style guide
      </Menu.Item>
      <Menu.Separator />
      <Show
        when={props.rail}
        fallback={
          <Menu.Item onSelect={() => setNavMode("rail")} icon={<ChevronsLeft size={16} />} hint="[">
            Collapse sidebar
          </Menu.Item>
        }
      >
        <Menu.Item onSelect={() => setNavMode("full")} icon={<ChevronsRight size={16} />} hint="[">
          Expand sidebar
        </Menu.Item>
      </Show>
      <Menu.Item onSelect={() => setNavHidden(true)} icon={<PanelLeftClose size={16} />} hint="Shift [">
        Hide navigation
      </Menu.Item>
      <ServerInfo />
      <Show when={session.isAuthenticatedMode()}>
        <Menu.Separator />
        <Menu.Item onSelect={() => void signOut()} icon={<LogOut size={16} />}>
          Sign out
        </Menu.Item>
      </Show>
    </Menu.Content>
  );
}

function YouRow() {
  const name = useYouName();
  return (
    <div class="nav-you">
      <Menu placement="top-start">
        <Menu.Trigger class="nav-you-trigger" aria-label={`${name()}: account and appearance`}>
          <InitialsDisc name={name()} you size={30} />
          <span class="nav-you-name">{name()}</span>
        </Menu.Trigger>
        <YouMenuContent />
      </Menu>
    </div>
  );
}

/** A nav section whose heading folds it; `head` adds controls beside the heading. */
function NavSection(props: ParentProps<{ id: string; title: string; note?: JSX.Element; head?: JSX.Element; action?: boolean }>) {
  const section = navSection(props.id);
  const headId = () => `nav-${props.id}-h`;
  return (
    <div class="nav-group nav-group--scroll" role="group" aria-labelledby={headId()}>
      <div class="nav-head" classList={{ "nav-head--action": props.action }}>
        <h2 id={headId()}>
          <button type="button" class="nav-fold" aria-expanded={!section.folded()} onClick={section.toggle}>
            {props.title}
            <ChevronDown size={12} stroke-width={2.4} aria-hidden="true" class="nav-fold-caret" />
          </button>
        </h2>
        {props.note}
        {props.head}
      </div>
      <Show when={!section.folded()}>
        <ScrollList class="nav-list">{props.children}</ScrollList>
      </Show>
    </div>
  );
}

/** A row's "…" menu, shown on hover and focus. */
function RowMenu(props: ParentProps<{ label: string }>) {
  return (
    <Menu placement="bottom-end">
      <Menu.Trigger class="nav-row-menu" aria-label={props.label}>
        <Ellipsis size={15} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label={props.label} width={240}>
        {props.children}
      </Menu.Content>
    </Menu>
  );
}

export function Nav() {
  const company = useCompany();
  const commands = useCommands();
  const needsYou = useNeedsYouCount();
  const recent = useRecentTasks();
  const experimental = useExperimentalSettingsQuery();

  const base = () => `/${company().issuePrefix}`;
  const inboxCount = () => needsYou() ?? 0;
  // Projects and agents as the rail's flyouts list them too; rows keyed by id (nav-lists.ts).
  const lists = useNavLists();
  const { starredProjects, otherProjects, starredProjectIds, otherProjectIds, starredAgentIds, otherAgentIds, projectsArranged } = lists;
  const starred = lists.starredAgents;
  const projectRow = (id: string, list: () => Project[]) => {
    const project = lists.latestProject(id);
    return (
      <Show when={project()}>
        {(current) => <NavProject project={current()} base={base()} list={list()} onMove={(delta) => lists.projectOrder.move(list(), id, delta)} />}
      </Show>
    );
  };
  const agentRow = (id: string) => {
    const agent = lists.latestAgent(id);
    return <Show when={agent()}>{(current) => <NavAgent agent={current()} base={base()} running={lists.running()} unread={lists.unreadChats.countFor(id)} />}</Show>;
  };
  const runningCount = lists.runningCount;
  const navAgents = lists.navAgents;

  return (
    <>
      <div class="nav-zone nav-zone--top">
        <div class="nav-top">
          <PluginOrganizationSwitcher>
            <CompanyRow />
          </PluginOrganizationSwitcher>
          <div class="nav-tools">
            <button
              type="button"
              class="nav-search"
              aria-label="Search and commands"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => commands.setPaletteOpen(true)}
            >
              <Search size={15} aria-hidden="true" />
              <span class="nav-search-label">Search…</span>
              <kbd class="nav-search-kbd" classList={{ "nav-search-kbd--long": !IS_MAC }} aria-hidden="true">
                {PALETTE_HINT}
              </kbd>
            </button>
            <button
              type="button"
              class={buttonClass({ variant: "secondary" }) + " nav-new-task"}
              aria-label="New task"
              aria-keyshortcuts="C"
              onClick={() => commands.openNewTask()}
            >
              <Plus size={15} stroke-width={2.4} aria-hidden="true" />
              Task
            </button>
          </div>
        </div>
        <GlobalToolbarPlugins />

        <div class="nav-group">
          <A class="navi navi--badged" href={`${base()}/inbox`}>
            <InboxIcon />
            <span class="navi-text">Inbox</span>
            <Show when={inboxCount() > 0}>
              <span class="navi-badge" aria-label={`${inboxCount()} waiting`}>
                {inboxCount() > 99 ? "99+" : inboxCount()}
              </span>
            </Show>
          </A>
          <Show when={showStatusLink(experimental.data)}>
            <A class="navi" href={`${base()}/status`}>
              <Radar size={16} aria-hidden="true" />
              <span class="navi-text">Status</span>
            </A>
          </Show>
        </div>
      </div>

      <div class="nav-zone nav-zone--lists">
        <Show when={starred().length > 0 || starredProjects().length > 0}>
          <NavSection id="starred" title="Starred">
            <Show when={projectsArranged()}>
              <For each={starredProjectIds()}>{(id) => projectRow(id, starredProjects)}</For>
            </Show>
            <For each={starredAgentIds()}>{agentRow}</For>
          </NavSection>
        </Show>

        <NavSection
          id="projects"
          title="Projects"
          action
          head={
            <button
              type="button"
              class={buttonClass({ variant: "icon", size: "compact", ghost: true }) + " nav-head-add"}
              aria-label="New project"
              onClick={() => commands.openNewProject()}
            >
              <Plus size={14} stroke-width={2.2} aria-hidden="true" />
            </button>
          }
        >
          <A class="navi navi--disc" href={`${base()}/issues`}>
            <span class="navi-all" aria-hidden="true" />
            All tasks
            <span class="navi-note">company</span>
          </A>
          <Show when={projectsArranged()}>
            <For each={otherProjectIds()}>{(id) => projectRow(id, otherProjects)}</For>
          </Show>
        </NavSection>

        <NavSection
          id="agents"
          title="Agents"
          note={
            <Show when={runningCount() > 0}>
              <span class="nav-head-note">{runningCount()} running</span>
            </Show>
          }
        >
          <For each={otherAgentIds()} fallback={<Show when={navAgents().length === 0}><p class="nav-empty">No agents yet.</p></Show>}>
            {agentRow}
          </For>
        </NavSection>

        <Show when={recent().length > 0}>
          <NavSection id="recent" title="Recent tasks">
            <For each={recent()}>
              {(task) => (
                <A class="navi navi--task" href={`${base()}/issues/${encodeURIComponent(task.identifier ?? task.id)}`} title={task.title}>
                  <TaskStatusCapsule task={task} size="row" />
                  <span class="navi-label">{task.title}</span>
                  <span class="navi-note mono">{task.identifier}</span>
                </A>
              )}
            </For>
          </NavSection>
        </Show>

        <NavPlugins />
      </div>

      <div class="nav-zone nav-zone--bottom">
        <div class="nav-group">
          {/* Was the temporary Connectors page; Connections (once Apps and tools) took its place. */}
          <A class="navi" href={`${base()}/connections`}>
            <Plug size={16} aria-hidden="true" />
            <span class="navi-text">Connections</span>
          </A>
        </div>

        <YouRow />
      </div>
    </>
  );
}

function NavProject(props: { project: Project; base: string; list: Project[]; onMove: (delta: -1 | 1) => void }) {
  const stars = useProjectStars();
  const navigate = useNavigate();
  const location = useLocation();
  const href = () => `${props.base}/projects/${props.project.urlKey}`;
  // The row opens the project's tasks (its List view) and stays raised on all of its pages.
  const onProject = () => isProjectPage(location.pathname, props.base.slice(1), props.project);
  const index = () => props.list.findIndex((entry) => entry.id === props.project.id);
  const starred = () => stars.starred(props.project.id);
  return (
    <>
      <div class="nav-row">
        <A class="navi navi--disc" href={`${href()}/issues`} classList={{ active: onProject() }}>
          <InitialsDisc name={props.project.name.slice(0, 1)} seed={props.project.id} size={24} />
          <span class="navi-label">{props.project.name}</span>
          <Show when={props.project.taskCount !== undefined}>
            <span class="navi-count" aria-label={`${props.project.taskCount} tasks`}>
              {props.project.taskCount}
            </span>
          </Show>
        </A>
        <RowMenu label={`${props.project.name}: actions`}>
          <Show when={!starred()}>
            <Menu.Item icon={<ArrowUp size={16} />} disabled={index() <= 0} onSelect={() => props.onMove(-1)}>
              Move up
            </Menu.Item>
            <Menu.Item icon={<ArrowDown size={16} />} disabled={index() === -1 || index() >= props.list.length - 1} onSelect={() => props.onMove(1)}>
              Move down
            </Menu.Item>
          </Show>
          <Menu.Item icon={<Star size={16} fill={starred() ? "currentColor" : "none"} />} onSelect={() => stars.toggle(props.project)}>
            {starred() ? "Unstar" : "Star"}
          </Menu.Item>
          <Menu.Item icon={<Settings2 size={16} />} onSelect={() => navigate(`${href()}/settings`)}>
            Project settings
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item icon={<UserRoundMinus size={16} />} description="Takes it out of your nav" onSelect={() => void stars.leave(props.project)}>
            Leave project
          </Menu.Item>
        </RowMenu>
      </div>
      <NavProjectPlugins project={props.project} />
    </>
  );
}

function NavAgent(props: { agent: Agent; base: string; running: ReadonlySet<string>; unread: number }) {
  const state = () => agentState(props.agent, props.running);
  const actions = useAgentActions();
  const stars = useAgentStars();
  const can = (action: "pause" | "resume" | "wake") => actionTargets(action, [props.agent]).length > 0;
  const starred = () => stars.starred(props.agent.id);
  return (
    <div class="nav-row">
      <A class="navi navi--agent" href={`${props.base}/agents/${props.agent.urlKey}`}>
        <AgentAvatar agent={props.agent} size={24} ring={state().key === "running"} />
        <span class="navi-label">{props.agent.name}</span>
        <Show when={props.unread > 0}>
          <ChatUnreadBadge count={props.unread} from={props.agent.name} />
        </Show>
        <span class="navi-state" style={{ color: state().tone }}>
          {state().label}
        </span>
      </A>
      <RowMenu label={`${props.agent.name}: actions`}>
        <Menu.Item icon={<Zap size={16} />} disabled={!can("wake") || actions.busy() !== null} description="Starts a heartbeat now" onSelect={() => void actions.wake([props.agent])}>
          Run now
        </Menu.Item>
        <Show
          when={can("resume")}
          fallback={
            <Menu.Item icon={<Pause size={16} />} disabled={!can("pause") || actions.busy() !== null} onSelect={() => void actions.pause([props.agent])}>
              Pause
            </Menu.Item>
          }
        >
          <Menu.Item icon={<Play size={16} />} disabled={actions.busy() !== null} onSelect={() => void actions.resume([props.agent])}>
            Resume
          </Menu.Item>
        </Show>
        <Menu.Separator />
        <Menu.Item icon={<Star size={16} fill={starred() ? "currentColor" : "none"} />} onSelect={() => stars.toggle(props.agent)}>
          {starred() ? "Unstar" : "Star"}
        </Menu.Item>
      </RowMenu>
    </div>
  );
}
