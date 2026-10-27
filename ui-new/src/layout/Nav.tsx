import { A, useNavigate } from "@solidjs/router";
import { Building2, ChevronDown, Keyboard, LogOut, Moon, Palette, Plug, Plus, Search, Sun } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { activeAgents } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { agentState, runningAgentIds, sortAgentsForNav } from "@/lib/agent-state";
import { useCommands } from "@/lib/commands";
import { useCompaniesQuery, useCompany } from "@/lib/company";
import { useAgentsQuery, useLiveRunsQuery, useProjectsQuery, useSidebarBadgesQuery } from "@/lib/company-data";
import { useSession, useSignOut, useYouName } from "@/lib/session";
import { theme, toggleTheme } from "@/lib/theme";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { buttonClass } from "@/ui/Button";
import { Grain } from "@/ui/Grain";
import { Menu } from "@/ui/Menu";
import "@/ui/nav.css";
import "./Nav.css";

/*
 * The left nav (board 1, on every board): company switcher with search and new task; Org dashboard
 * and Inbox with its badge; projects with their task counts; agents with their live state; you and
 * settings at the bottom. The item owning the current page is raised with the --sel pill: the
 * router marks it `.active` for every page under it, and `aria-current` on the exact page.
 *
 * New project (the + beside "Projects") waits for M4, where the new-project dialog is designed.
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
  const navigate = useNavigate();
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
          <For each={companies.data ?? []}>
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
        <Menu.Item onSelect={() => navigate("/companies")} icon={<Building2 size={16} />}>
          All companies
        </Menu.Item>
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
        <Menu.Content label="Account and appearance" width={240}>
          <Menu.Item onSelect={toggleTheme} icon={theme() === "dark" ? <Sun size={16} /> : <Moon size={16} />}>
            {theme() === "dark" ? "Use light theme" : "Use dark theme"}
          </Menu.Item>
          <Menu.Item onSelect={() => commands.setShortcutsOpen(true)} icon={<Keyboard size={16} />} hint="?">
            Keyboard shortcuts
          </Menu.Item>
          <Menu.Item onSelect={() => navigate("/style-guide")} icon={<Palette size={16} />}>
            Style guide
          </Menu.Item>
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

export function Nav() {
  const company = useCompany();
  const commands = useCommands();
  const badges = useSidebarBadgesQuery();
  const projects = useProjectsQuery();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();

  const base = () => `/${company().issuePrefix}`;
  const running = createMemo(() => runningAgentIds(liveRuns.data));
  const navAgents = createMemo(() => sortAgentsForNav(activeAgents(agents.data), running()));
  const runningCount = () => navAgents().filter((agent) => agentState(agent, running()).key === "running").length;
  const inboxCount = () => badges.data?.inbox ?? 0;

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

      <div class="nav-group">
        <A class="navi" href={`${base()}/dashboard`}>
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
      </div>

      <div class="nav-group">
        <div class="nav-head">
          <h2>Projects</h2>
        </div>
        <A class="navi navi--disc" href={`${base()}/issues`}>
          <span class="navi-all" aria-hidden="true" />
          All tasks
          <span class="navi-note">company</span>
        </A>
        <For each={openProjects(projects.data)}>
          {(project) => {
            const href = () => `${base()}/projects/${project.urlKey}`;
            return (
              <A class="navi navi--disc" href={href()}>
                <InitialsDisc name={project.name.slice(0, 1)} seed={project.id} size={24} />
                <span class="navi-label">{project.name}</span>
                <Show when={project.taskCount !== undefined}>
                  <span class="navi-count" aria-label={`${project.taskCount} tasks`}>
                    {project.taskCount}
                  </span>
                </Show>
              </A>
            );
          }}
        </For>
      </div>

      <div class="nav-group">
        <div class="nav-head">
          <h2>Agents</h2>
          <Show when={runningCount() > 0}>
            <span class="nav-head-note">{runningCount()} running</span>
          </Show>
        </div>
        <For each={navAgents()} fallback={<p class="nav-empty">No agents yet.</p>}>
          {(agent) => {
            const href = () => `${base()}/agents/${agent.urlKey}`;
            const state = () => agentState(agent, running());
            return (
              <A class="navi navi--agent" href={href()}>
                <AgentAvatar agent={agent} size={24} ring={state().key === "running"} />
                <span class="navi-label">{agent.name}</span>
                <span class="navi-state" style={{ color: state().tone }}>
                  {state().label}
                </span>
              </A>
            );
          }}
        </For>
      </div>

      <div class="nav-group">
        {/* Temporary: the Connectors page stands in for M6's Apps and tools. */}
        <A class="navi" href={`${base()}/connectors`}>
          <Plug size={16} aria-hidden="true" />
          Connectors
        </A>
      </div>

      <YouRow />
    </>
  );
}
