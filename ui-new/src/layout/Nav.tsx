import type { Agent, IssueStatus, Project } from "@paperclipai/shared";
import { A, useLocation, useNavigate } from "@solidjs/router";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
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
  Search,
  Settings2,
  Star,
  Sun,
  UserRound,
  UserRoundMinus,
  Zap,
} from "lucide-solid";
import { createMemo, For, Show, type JSX, type ParentProps } from "solid-js";
import { activeAgents } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { agentState, runningAgentIds, sortAgentsForNav } from "@/lib/agent-state";
import { useCommands } from "@/lib/commands";
import { useCompaniesQuery, useCompany } from "@/lib/company";
import { useNeedsYouCount } from "@/inbox/needs-you";
import { isOrgPage } from "./dock-model";
import { NavPlugins, NavProjectPlugins } from "@/plugins/NavPlugins";
import { GlobalToolbarPlugins } from "@/plugins/ShellPlugins";
import { useAgentStars } from "@/agents/AgentStar";
import { starredAgents } from "@/agents/star-model";
import { useCanCreateCompany } from "@/onboarding/can-create";
import { actionTargets, useAgentActions } from "@/org/actions";
import { profilePath } from "@/profile/profile-model";
import { ServerInfo } from "@/shell/ServerInfo";
import { useAgentsQuery, useExperimentalSettingsQuery, useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { useSession, useSignOut, useYouName } from "@/lib/session";
import { theme, toggleTheme } from "@/lib/theme";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { Grain } from "@/ui/Grain";
import { Menu } from "@/ui/Menu";
import { StatusCapsule } from "@/ui/Status";
import { navSection, setNavHidden, useCompanyOrder, useProjectOrder, useProjectStars, useRecentTasks } from "./nav-prefs";
import { showStatusLink, visibleProjects } from "./nav-model";
import "@/ui/nav.css";
import "./Nav.css";

/*
 * The left nav (board 1, on every board): company switcher with search and new task; Org dashboard
 * and Inbox with its badge (what's waiting on you, as the Inbox's Needs you tab counts it); what
 * you starred; projects with their task counts; agents with their live state; the tasks you opened
 * lately; you and settings at the bottom. The item owning the current page is raised with the --sel
 * pill: the router marks it `.active` for every page under it, and `aria-current` on the exact page.
 *
 * "Org dashboard" stays raised on every organization page (the roster at `/agents`, workload and the
 * org tabs; `isOrgPage`), as boards 20 and 33 draw it. The + beside "Projects" opens New project (board N1).
 *
 * Your nav (nav-prefs.tsx): projects and agents you've starred sit in Starred above the rest; each
 * project's "…" moves it up or down (your order, kept on the server), stars it or leaves it (out of
 * your nav); each agent's "…" runs it now, pauses or resumes it (org/actions.ts) and stars it. Every
 * section folds from its heading, and `[` hides the whole nav (the shell then offers it back). The
 * switcher lists companies in the order you gave them on the companies page.
 *
 * Status (status cards, decision 39, D3) sits under Inbox while the instance has `enableStatusCards`
 * on, as in the old sidebar.
 *
 * Plugins' global toolbar buttons sit under the company switcher; the switcher offers Create
 * organization (the onboarding page) when you may create one. The You menu holds View profile and,
 * with `enableServerInfoDebugView` on, the server's restart time, commit and checkout state.
 */

function OrgIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="3.5" />
      <rect x="14" y="3" width="7" height="5" rx="2.5" />
      <rect x="14" y="12" width="7" height="9" rx="3.5" />
      <rect x="3" y="16" width="7" height="5" rx="2.5" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

function CompanySwitcher() {
  const company = useCompany();
  const companies = useCompaniesQuery();
  const order = useCompanyOrder();
  const navigate = useNavigate();
  const canCreate = useCanCreateCompany();
  return (
    <Menu>
      <Menu.Trigger class="company-switch" aria-label={`Company: ${company().name}. Switch company`}>
        <span class="company-switch-mark grained" aria-hidden="true">
          <InitialsDisc name={company().name.slice(0, 1)} seed={company().id} size={28} />
          <Grain />
        </span>
        <span class="company-switch-name disp">{company().name}</span>
        <ChevronDown size={14} aria-hidden="true" class="company-switch-caret" />
      </Menu.Trigger>
      <Menu.Content label="Companies" width={260}>
        <Menu.Group label="Companies">
          <For each={order.ordered(companies.data ?? [])}>
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
        <Show when={canCreate().allowed}>
          <Menu.Item onSelect={() => navigate("/onboarding")} icon={<Plus size={16} />}>
            Create organization
          </Menu.Item>
        </Show>
      </Menu.Content>
    </Menu>
  );
}

function YouRow() {
  const session = useSession();
  const company = useCompany();
  const commands = useCommands();
  const navigate = useNavigate();
  const name = useYouName();
  const signOut = useSignOut();
  return (
    <div class="nav-you">
      <Menu placement="top-start">
        <Menu.Trigger class="nav-you-trigger" aria-label={`${name()}: account and appearance`}>
          <InitialsDisc name={name()} you size={30} />
          <span class="nav-you-name">{name()}</span>
        </Menu.Trigger>
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
          <Menu.Item onSelect={() => setNavHidden(true)} icon={<PanelLeftClose size={16} />} hint="[">
            Hide navigation
          </Menu.Item>
          <Menu.Item onSelect={() => navigate("/style-guide")} icon={<Palette size={16} />}>
            Style guide
          </Menu.Item>
          <ServerInfo />
          <Show when={session.isAuthenticatedMode()}>
            <Menu.Separator />
            <Menu.Item onSelect={() => void signOut()} icon={<LogOut size={16} />}>
              Sign out
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu>
      <A
        class={buttonClass({ variant: "icon", ghost: true })}
        href={`/${company().issuePrefix}/company/settings`}
        aria-label="Settings"
      >
        <SettingsIcon />
      </A>
    </div>
  );
}

/** A nav section whose heading folds it; `head` adds controls beside the heading. */
function NavSection(props: ParentProps<{ id: string; title: string; note?: JSX.Element; head?: JSX.Element; action?: boolean }>) {
  const section = navSection(props.id);
  const headId = () => `nav-${props.id}-h`;
  return (
    <div class="nav-group" role="group" aria-labelledby={headId()}>
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
      <Show when={!section.folded()}>{props.children}</Show>
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
  const projects = useProjectsQuery();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const recent = useRecentTasks();
  const experimental = useExperimentalSettingsQuery();

  const location = useLocation();

  const base = () => `/${company().issuePrefix}`;
  /** Every organization page (the roster, workload, the org tabs) raises "Org dashboard". */
  const orgPage = () => isOrgPage(location.pathname, company().issuePrefix);
  const running = createMemo(() => runningAgentIds(liveRuns.data));
  const stars = useAgentStars();
  const projectStars = useProjectStars();
  const projectOrder = useProjectOrder();
  const starred = createMemo(() => starredAgents(stars.memberships.data, activeAgents(agents.data)));
  const starredIds = createMemo(() => new Set(starred().map((agent) => agent.id)));
  const navAgents = createMemo(() => sortAgentsForNav(activeAgents(agents.data), running()));
  const otherAgents = createMemo(() => navAgents().filter((agent) => !starredIds().has(agent.id)));
  const runningCount = () => navAgents().filter((agent) => agentState(agent, running()).key === "running").length;
  const inboxCount = () => needsYou() ?? 0;

  // Projects you haven't left, in your order; starred ones move up to Starred.
  const shownProjects = createMemo(() => projectOrder.ordered(visibleProjects(openProjects(projects.data), projectStars.memberships.data)));
  const starredProjects = createMemo(() => {
    const ids = projectStars.memberships.data?.starredProjectIds ?? [];
    const byId = new Map(openProjects(projects.data).map((project) => [project.id, project] as const));
    return ids.flatMap((id) => byId.get(id) ?? []);
  });
  const otherProjects = createMemo(() => shownProjects().filter((project) => !projectStars.starred(project.id)));

  const projectRow = (project: Project, list: () => Project[]) => (
    <NavProject project={project} base={base()} list={list()} onMove={(delta) => projectOrder.move(list(), project.id, delta)} />
  );

  return (
    <>
      <div class="nav-top">
        <CompanySwitcher />
        <button
          type="button"
          class={buttonClass({ variant: "icon", ghost: true })}
          aria-label="Search and commands"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => commands.setPaletteOpen(true)}
        >
          <Search size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class={buttonClass({ variant: "icon" })}
          aria-label="New task"
          aria-keyshortcuts="C"
          onClick={() => commands.openNewTask()}
        >
          <Plus size={16} stroke-width={2.2} aria-hidden="true" />
        </button>
      </div>
      <GlobalToolbarPlugins />

      <div class="nav-group">
        <A class="navi" href={`${base()}/dashboard`} classList={{ active: orgPage() }}>
          <OrgIcon />
          Org dashboard
        </A>
        <A class="navi navi--badged" href={`${base()}/inbox`}>
          <InboxIcon />
          Inbox
          <Show when={inboxCount() > 0}>
            <span class="navi-badge" aria-label={`${inboxCount()} waiting`}>
              {inboxCount() > 99 ? "99+" : inboxCount()}
            </span>
          </Show>
        </A>
        <Show when={showStatusLink(experimental.data)}>
          <A class="navi" href={`${base()}/status`}>
            <Radar size={16} aria-hidden="true" />
            Status
          </A>
        </Show>
      </div>

      <Show when={starred().length > 0 || starredProjects().length > 0}>
        <NavSection id="starred" title="Starred">
          <For each={starredProjects()}>{(project) => projectRow(project, starredProjects)}</For>
          <For each={starred()}>{(agent) => <NavAgent agent={agent} base={base()} running={running()} />}</For>
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
        <For each={otherProjects()}>{(project) => projectRow(project, otherProjects)}</For>
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
        <For each={otherAgents()} fallback={<Show when={navAgents().length === 0}><p class="nav-empty">No agents yet.</p></Show>}>
          {(agent) => <NavAgent agent={agent} base={base()} running={running()} />}
        </For>
      </NavSection>

      <Show when={recent().length > 0}>
        <NavSection id="recent" title="Recent tasks">
          <For each={recent()}>
            {(task) => (
              <A class="navi navi--task" href={`${base()}/issues/${encodeURIComponent(task.identifier ?? task.id)}`} title={task.title}>
                <StatusCapsule status={task.status as IssueStatus} size="row" />
                <span class="navi-label">{task.title}</span>
                <span class="navi-note mono">{task.identifier}</span>
              </A>
            )}
          </For>
        </NavSection>
      </Show>

      <NavPlugins />

      <div class="nav-group">
        {/* Was the temporary Connectors page; Apps and tools (the org's Apps tab) took its place. */}
        <A class="navi" href={`${base()}/apps`}>
          <Plug size={16} aria-hidden="true" />
          Apps
        </A>
      </div>

      <YouRow />
    </>
  );
}

function NavProject(props: { project: Project; base: string; list: Project[]; onMove: (delta: -1 | 1) => void }) {
  const stars = useProjectStars();
  const navigate = useNavigate();
  const href = () => `${props.base}/projects/${props.project.urlKey}`;
  const index = () => props.list.findIndex((entry) => entry.id === props.project.id);
  const starred = () => stars.starred(props.project.id);
  return (
    <>
      <div class="nav-row">
        <A class="navi navi--disc" href={href()}>
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

function NavAgent(props: { agent: Agent; base: string; running: ReadonlySet<string> }) {
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
