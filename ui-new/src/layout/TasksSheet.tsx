import { createQuery } from "@tanstack/solid-query";
import { Check, ChevronDown, ChevronLeft, ChevronUp, LogOut, Monitor, Plus, Search } from "lucide-solid";
import { createEffect, For, Match, on, Show, Switch as SwitchFlow } from "solid-js";
import { companiesApi, statsFor } from "@/api/companies";
import { activeAgents } from "@/api/agents";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompaniesQuery, useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery, useSidebarBadgesQuery } from "@/lib/company-data";
import { useSession, useSignOut, useYouName } from "@/lib/session";
import { setTheme, themePreference, type ThemePreference } from "@/lib/theme";
import { InitialsDisc } from "@/ui/Avatar";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { companySummary, toggleCompanies, type SheetView, type TasksScope } from "./dock-model";
import { TasksIcon } from "./dock-icons";

/*
 * The Tasks switcher (design/mobile.md, N1), opened by tapping Tasks while in Tasks. It rises from
 * the foot of the screen under the dock and has three views:
 *
 * - projects: All tasks and each open project with its task count, then Search everything (the
 *   command palette, until search M14 is built);
 * - companies: the company name at the top is the company dropdown; it swaps the projects for every
 *   company you can enter. Adding a company happens on desktop;
 * - you: your avatar in the top-right corner: profile, theme (light, dark, system), push settings,
 *   a pointer to settings, and Sign out.
 *
 * It isn't modal (the dock stays usable, and Tasks closes it), but it takes focus when it opens,
 * Escape and the scrim close it, and the page under it doesn't scroll.
 */

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const satisfies readonly { value: ThemePreference; label: string }[];

export function TasksSheet(props: {
  id: string;
  view: Exclude<SheetView, "closed">;
  onView: (view: SheetView) => void;
  onClose: (returnFocus?: boolean) => void;
  scope: TasksScope | null;
}) {
  const company = useCompany();
  const companies = useCompaniesQuery();
  const projects = useProjectsQuery();
  const agents = useAgentsQuery();
  const badges = useSidebarBadgesQuery();
  const stats = createQuery(() => ({ queryKey: queryKeys.companies.stats, queryFn: companiesApi.stats }));
  const commands = useCommands();
  const session = useSession();
  const youName = useYouName();
  const signOut = useSignOut();

  const base = () => `/${company().issuePrefix}`;
  const sheetProjects = () => openProjects(projects.data);
  const currentSummary = () =>
    companySummary({
      projects: projects.data ? sheetProjects().length : undefined,
      agents: agents.data ? activeAgents(agents.data).length : undefined,
    });
  const allTasksCount = () => statsFor(stats.data, company().id)?.issueCount;

  let sheet: HTMLElement | undefined;
  // Each view starts with focus on its first control.
  createEffect(
    on(
      () => props.view,
      () => sheet?.querySelector<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")?.focus({ preventScroll: true }),
    ),
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    props.onClose();
  };

  const label = () => (props.view === "projects" ? "Switch project" : props.view === "companies" ? "Switch company" : "You");

  return (
    <>
      <div class="tsheet-scrim" aria-hidden="true" onClick={() => props.onClose()} />
      <section ref={sheet} id={props.id} class="tsheet" role="dialog" aria-label={label()} onKeyDown={onKeyDown}>
        <span class="layer-handle" aria-hidden="true" />
        <SwitchFlow>
          <Match when={props.view === "projects" || props.view === "companies"}>
            <div class="tsheet-top">
              <button
                type="button"
                class="tsheet-company"
                aria-haspopup="true"
                aria-expanded={props.view === "companies"}
                aria-label={props.view === "companies" ? `${company().name}, close the company list` : `${company().name}, switch company`}
                onClick={() => props.onView(toggleCompanies(props.view))}
              >
                <span class="tsheet-sq tsheet-sq--primary" aria-hidden="true">
                  {company().name.slice(0, 1).toUpperCase()}
                </span>
                <span class="tsheet-company-text">
                  <span class="tsheet-company-name">
                    <span class="tsheet-ellipsis">{company().name}</span>
                    <Show when={props.view === "companies"} fallback={<ChevronDown size={14} stroke-width={2.4} aria-hidden="true" />}>
                      <ChevronUp size={14} stroke-width={2.4} aria-hidden="true" />
                    </Show>
                  </span>
                  <Show when={currentSummary()}>
                    <span class="tsheet-meta">{currentSummary()}</span>
                  </Show>
                </span>
              </button>
              <button type="button" class="tsheet-you" aria-label="You: profile, theme and notifications" onClick={() => props.onView("you")}>
                <InitialsDisc name={youName()} you size={36} />
              </button>
            </div>

            <Show
              when={props.view === "companies"}
              fallback={
                <>
                  <h2 class="tsheet-h">Projects</h2>
                  <a class="tsheet-row" href={`${base()}/issues`} aria-current={props.scope?.kind === "all" ? "page" : undefined}>
                    <span class="tsheet-sq tsheet-sq--well" aria-hidden="true">
                      <TasksIcon size={15} />
                    </span>
                    <span class="tsheet-row-main">All tasks</span>
                    <Show when={allTasksCount() !== undefined}>
                      <small class="tsheet-count" aria-label={`${allTasksCount()} tasks`}>
                        {allTasksCount()}
                      </small>
                    </Show>
                    <Show when={props.scope?.kind === "all"}>
                      <Check size={16} stroke-width={2.4} aria-hidden="true" class="tsheet-check" />
                    </Show>
                  </a>
                  <For each={sheetProjects()}>
                    {(project) => {
                      const current = () =>
                        props.scope?.kind === "project" && (props.scope.key === project.urlKey || props.scope.key === project.id);
                      return (
                        <a class="tsheet-row" href={`${base()}/projects/${project.urlKey}`} aria-current={current() ? "page" : undefined}>
                          <span class="tsheet-sq" aria-hidden="true">
                            <InitialsDisc name={project.name.slice(0, 1)} seed={project.id} size={30} />
                          </span>
                          <span class="tsheet-row-main tsheet-ellipsis">{project.name}</span>
                          <Show when={project.taskCount !== undefined}>
                            <small class="tsheet-count" aria-label={`${project.taskCount} tasks`}>
                              {project.taskCount}
                            </small>
                          </Show>
                          <Show when={current()}>
                            <Check size={16} stroke-width={2.4} aria-hidden="true" class="tsheet-check" />
                          </Show>
                        </a>
                      );
                    }}
                  </For>
                  <div class="tsheet-actions">
                    <button
                      type="button"
                      class="tsheet-pill"
                      onClick={() => {
                        props.onClose(false);
                        commands.setPaletteOpen(true);
                      }}
                    >
                      <Search size={15} aria-hidden="true" />
                      Search everything
                    </button>
                  </div>
                </>
              }
            >
              <h2 class="tsheet-h">Companies</h2>
              <For each={companies.data ?? []}>
                {(item) => {
                  const current = () => item.id === company().id;
                  const counts = () => statsFor(stats.data, item.id);
                  const summary = () =>
                    current()
                      ? companySummary({
                          projects: projects.data ? sheetProjects().length : undefined,
                          agents: agents.data ? activeAgents(agents.data).length : undefined,
                          needsYou: badges.data?.inbox,
                        })
                      : companySummary({ agents: counts()?.agentCount, tasks: counts()?.issueCount });
                  return (
                    <a class="tsheet-row" href={`/${item.issuePrefix}/issues`} aria-current={current() ? "true" : undefined}>
                      <span class="tsheet-sq" aria-hidden="true">
                        <InitialsDisc name={item.name.slice(0, 1)} seed={item.id} size={30} />
                      </span>
                      <span class="tsheet-row-main">
                        <span class="tsheet-ellipsis">{item.name}</span>
                        <Show when={summary()}>
                          <span class="tsheet-meta">{summary()}</span>
                        </Show>
                      </span>
                      <Show when={current()}>
                        <Check size={16} stroke-width={2.4} aria-hidden="true" class="tsheet-check" />
                      </Show>
                    </a>
                  );
                }}
              </For>
              <div class="tsheet-row tsheet-row--note">
                <span class="tsheet-sq tsheet-sq--well" aria-hidden="true">
                  <Plus size={15} stroke-width={2.2} />
                </span>
                <span class="tsheet-row-main">Add a company</span>
                <small class="tsheet-count">On desktop</small>
              </div>
            </Show>
          </Match>

          <Match when={props.view === "you"}>
            <div class="tsheet-top tsheet-top--you">
              <button type="button" class="btn btn--icon btn--ghost" aria-label="Back to projects" onClick={() => props.onView("projects")}>
                <ChevronLeft size={20} stroke-width={2.2} aria-hidden="true" />
              </button>
              <InitialsDisc name={youName()} you size={44} />
              <div class="tsheet-profile">
                <h2 class="tsheet-profile-name">{youName()}</h2>
                <p class="tsheet-meta">
                  {[session.session()?.user.email, company().name].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>

            <h3 class="tsheet-h">Appearance</h3>
            <div class="tsheet-theme">
              <Segmented label="Theme" options={THEME_OPTIONS} value={themePreference()} onChange={setTheme} />
            </div>

            <h3 class="tsheet-h">Push notifications</h3>
            <div class="tsheet-push">
              <Switch
                checked={false}
                onChange={() => {}}
                disabled
                label="Notify this phone"
                description="Not available yet: Paperclip has no push notification API."
              />
            </div>

            <div class="tsheet-sep" />
            <a class="tsheet-row" href={`${base()}/company/settings`}>
              <span class="tsheet-sq tsheet-sq--well" aria-hidden="true">
                <Monitor size={16} />
              </span>
              <span class="tsheet-row-main">
                <span>Settings and admin</span>
                <span class="tsheet-meta tsheet-ellipsis">Company, secrets, plugins, routines, activity</span>
              </span>
              <small class="tsheet-count">On desktop</small>
            </a>
            <Show when={session.isAuthenticatedMode()}>
              <button type="button" class="tsheet-row tsheet-row--danger" onClick={() => void signOut()}>
                <span class="tsheet-sq" aria-hidden="true">
                  <LogOut size={16} />
                </span>
                <span class="tsheet-row-main">Sign out</span>
              </button>
            </Show>
          </Match>
        </SwitchFlow>
      </section>
    </>
  );
}

