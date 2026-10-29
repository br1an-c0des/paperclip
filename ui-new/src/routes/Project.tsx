import type { IssueStatus, Project } from "@paperclipai/shared";
import { A, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { CalendarDays, Globe, Lock, Pencil } from "lucide-solid";
import { createEffect, createMemo, Match, Show, Switch } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { findProject, projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { ProjectDashboard } from "@/projects/ProjectDashboard";
import { ProjectDocs } from "@/projects/ProjectDocs";
import { ProjectSettings } from "@/projects/settings/ProjectSettings";
import { updatedLabel } from "@/tasks/list-model";
import { TasksView, useTaskList } from "@/tasks/TasksView";
import { buttonClass } from "@/ui/Button";
import { HeaderNumber, PageHeader, Tabs } from "@/ui/PageHeader";
import { Capsule, TonePill } from "@/ui/Status";
import type { Gradient } from "@/ui/status-meta";
import { WorkloadView } from "@/workload/Workload";
import { usePluginSlots } from "@/plugins/contributions";
import { isPluginTab, pluginTabValue } from "@/plugins/model";
import { PluginLauncherOutlet } from "@/plugins/PluginLaunchers";
import { PluginDetailTab, PluginSlotOutlet } from "@/plugins/PluginSlot";
import { ProjectStarButton } from "@/layout/nav-prefs";
import { PlannedNote } from "./Planned";
import { OPEN_STATUSES } from "./Tasks";
import { projectLegacyTab, withSearchAndHash } from "./legacy-model";

/*
 * A project's pages under its header card (boards 1 and 8). The project's address is its dashboard
 * (board 8), which the header's title links to; the tabs below are the project's tasks as a list
 * (board 1, `/issues` as in the old UI) or a board (board 4), with the docked panel, then Docs
 * (board 9), Agent workload (boards 31 and 32, `/workload`, with `?range=week|month`), and Settings
 * (boards 10 and 11, a section per URL under `/settings`). On the task tabs the tab sets the layout,
 * so the task view leaves out its own switch. `/overview` is the old UI's name for the project's home
 * and opens the dashboard too.
 *
 * Plugins' project tabs (`detailTab` slots for projects) follow, at `/plugin:<pluginKey>:<slotId>`
 * (the old UI's `?tab=plugin:…` lands there too), and their toolbar buttons and launchers sit in
 * the header's actions.
 *
 * The project list leaves archived projects out, so a key it doesn't know is looked up on its own;
 * that way an archived project's pages (and its settings, to restore it) still open.
 *
 * The old project tabs moved into settings: `/configuration` to Details, `/budget` to Budget, and
 * `/workspaces` (and one workspace's page) to Code and workspaces. The star beside the title puts
 * the project in your nav's Starred group.
 */

const PROJECT_TABS = [
  { label: "List", path: "/issues" },
  { label: "Board", path: "/board" },
  { label: "Agent workload", path: "/workload" },
  { label: "Docs", path: "/docs" },
  { label: "Settings", path: "/settings" },
];

export const PROJECT_STATUS: Record<Project["status"], { label: string; gradient: Gradient; tone?: "run" | "amber" | "green" }> = {
  backlog: { label: "Backlog", gradient: "ash" },
  planned: { label: "Planned", gradient: "ember", tone: "amber" },
  in_progress: { label: "In progress", gradient: "ion", tone: "run" },
  completed: { label: "Completed", gradient: "lagoon", tone: "green" },
  cancelled: { label: "Cancelled", gradient: "ash" },
};

type View = "dashboard" | "list" | "board" | "workload" | "docs" | "settings" | "plugin" | "legacy" | "later";

function viewFor(tab: string): View {
  if (tab === "" || tab === "overview") return "dashboard";
  if (projectLegacyTab(tab)) return "legacy";
  if (tab === "issues" || tab.startsWith("issues/")) return "list";
  if (tab === "board") return "board";
  if (tab === "workload") return "workload";
  if (tab === "docs") return "docs";
  if (tab === "settings" || tab.startsWith("settings/")) return "settings";
  if (isPluginTab(tab)) return "plugin";
  return "later";
}

function targetLabel(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function ProjectPage() {
  const params = useParams<{ projectKey: string; tab?: string }>();
  const company = useCompany();
  const projects = useProjectsQuery();
  const liveRuns = useLiveRunsQuery();
  const listed = createMemo(() => findProject(projects.data, params.projectKey));
  const single = createQuery(() => ({
    queryKey: [...queryKeys.projectSettings.detail(params.projectKey), company().id],
    queryFn: ({ signal }) => projectsApi.get(params.projectKey, company().id, signal),
    enabled: projects.isSuccess && !listed(),
    retry: false,
  }));
  const project = createMemo(() => listed() ?? (single.data?.companyId === company().id ? single.data : undefined));
  // A project's URL key follows its name, so a rename (here in settings, or elsewhere) moves the
  // page to the new address instead of losing the project.
  const navigate = useNavigate();
  let shown: { id: string; key: string } | undefined;
  createEffect(() => {
    const current = project();
    if (current) {
      shown = { id: current.id, key: params.projectKey };
      return;
    }
    // Only when this address showed the project a moment ago; not after following a link elsewhere.
    if (!shown || shown.key !== params.projectKey) return;
    const moved = projects.data?.find((candidate) => candidate.id === shown!.id);
    if (moved && moved.urlKey !== params.projectKey) {
      navigate(`/${company().issuePrefix}/projects/${moved.urlKey}${params.tab ? `/${params.tab}` : ""}`, { replace: true });
    }
  });
  const tasks = useTaskList(() => (project() ? { projectId: project()!.id } : null));
  const base = () => `/${company().issuePrefix}/projects/${params.projectKey}`;
  const view = () => viewFor((params.tab ?? "").replace(/\/$/, ""));
  const [search] = useSearchParams<{ tab?: string }>();
  const location = useLocation();
  const plugins = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: "project" }));
  const pluginContext = (found: Project) => ({
    companyId: company().id,
    companyPrefix: company().issuePrefix,
    projectId: found.id,
    projectRef: found.urlKey,
    entityId: found.id,
    entityType: "project" as const,
  });

  const list = () => (project() ? (tasks.data ?? []) : []);
  const open = () => list().filter((task) => OPEN_STATUSES.has(task.status as IssueStatus)).length;
  const blocked = () => list().filter((task) => task.status === "blocked").length;
  const running = createMemo(() => {
    const ids = new Set(list().map((task) => task.id));
    return new Set((liveRuns.data ?? []).filter((run) => run.issueId && ids.has(run.issueId)).map((run) => run.agentId)).size;
  });
  const updated = () => {
    let latest: number | null = null;
    for (const task of list()) {
      const at = new Date(task.lastActivityAt ?? task.updatedAt).getTime();
      if (latest === null || at > latest) latest = at;
    }
    return latest === null ? null : updatedLabel(new Date(latest));
  };

  return (
    <>
      <PageHeader
        crumbs={<span>Projects</span>}
        title={project()?.name ?? params.projectKey}
        titleHref={base()}
        titleHint="Project dashboard"
        titleAside={<Show when={project() && !project()!.archivedAt}>{<ProjectStarButton project={project()!} size={17} />}</Show>}
        numbers={
          <Show when={project() && tasks.data}>
            <HeaderNumber value={open()} label="open" />
            <Show when={running() > 0}>
              <HeaderNumber value={running()} label={running() === 1 ? "agent running" : "agents running"} />
            </Show>
            <Show when={blocked() > 0}>
              <HeaderNumber value={blocked()} label="blocked" tone="red" />
            </Show>
            <Show when={updated()}>
              {(label) => <span class="muted">Updated {label() === "Just now" || label() === "Yesterday" ? label().toLowerCase() : label()}</span>}
            </Show>
          </Show>
        }
        actions={
          <>
            <Show when={project()}>
              {(found) => (
                <>
                  <PluginSlotOutlet slotTypes={["toolbarButton", "contextMenuItem"]} context={pluginContext(found())} class="plugin-toolbar" errorBehavior="hidden" />
                  <PluginLauncherOutlet placementZones={["toolbarButton"]} context={pluginContext(found())} class="plugin-toolbar" errorBehavior="hidden" />
                </>
              )}
            </Show>
            <Show when={view() === "dashboard" && project()}>
              <A class={buttonClass({ size: "compact" })} href={`${base()}/settings`}>
                <Pencil size={14} aria-hidden="true" />
                Edit project
              </A>
            </Show>
          </>
        }
        tabs={
          <Tabs
            label="Project"
            items={[
              ...PROJECT_TABS.map((item) => ({ label: item.label, href: `${base()}${item.path}` })),
              ...plugins.slots().map((slot) => ({ label: slot.displayName, href: `${base()}/${pluginTabValue(slot)}` })),
            ]}
          />
        }
      >
        <Show when={view() === "dashboard" && project()}>{(found) => <ProjectFacts project={found()} />}</Show>
      </PageHeader>
      <Show when={project()} fallback={<p class="card pd-empty">{projects.isPending || single.isFetching ? "Loading the project…" : "There's no project with this address, or you can't open it."}</p>}>
        {(found) => (
          <Switch fallback={<PlannedNote milestone="M4">This tab is still to come.</PlannedNote>}>
            <Match when={view() === "legacy" && projectLegacyTab(params.tab ?? "")}>
              {(to) => <Navigate href={withSearchAndHash(`${base()}/${to()}`, location.search, location.hash)} />}
            </Match>
            <Match when={view() === "dashboard" && isPluginTab(search.tab) && search.tab}>
              {(tab) => <Navigate href={`${base()}/${tab()}`} />}
            </Match>
            <Match when={view() === "dashboard"}>
              <ProjectDashboard project={found()} tasks={tasks} base={base()} />
            </Match>
            <Match when={view() === "list" || view() === "board"}>
              <TasksView projectId={found().id} tasks={tasks} layout={view() === "board" ? "board" : "list"} />
            </Match>
            <Match when={view() === "workload"}>
              <WorkloadView scope={{ kind: "project", projectId: found().id }} tasks={() => (tasks.isSuccess ? (tasks.data ?? []) : undefined)} scopeName={found().name} />
            </Match>
            <Match when={view() === "docs"}>
              <ProjectDocs project={found()} tasks={tasks} />
            </Match>
            <Match when={view() === "plugin"}>
              <PluginDetailTab slots={plugins.slots()} tab={(params.tab ?? "").replace(/\/$/, "")} loading={plugins.query.isLoading} context={pluginContext(found())} />
            </Match>
            <Match when={view() === "settings"}>
              <ProjectSettings project={found()} base={base()} rest={(params.tab ?? "").replace(/^settings\/?/, "")} />
            </Match>
          </Switch>
        )}
      </Show>
    </>
  );
}

/** The dashboard's header line: status, target date and who can see the project (board 8). */
function ProjectFacts(props: { project: Project }) {
  const status = () => PROJECT_STATUS[props.project.status] ?? PROJECT_STATUS.backlog;
  return (
    <div class="ph-numbers project-facts">
      <Show
        when={status().tone}
        fallback={
          <span class="project-status">
            <Capsule gradient={status().gradient} size="tiny" />
            {status().label}
          </span>
        }
      >
        {(tone) => (
          <TonePill tone={tone()} compact icon={<Capsule gradient={status().gradient} size="tiny" live={props.project.status === "in_progress"} />}>
            {status().label}
          </TonePill>
        )}
      </Show>
      <Show when={props.project.targetDate}>
        {(target) => (
          <span class="project-fact">
            <CalendarDays size={14} aria-hidden="true" />
            Target {targetLabel(target())}
          </span>
        )}
      </Show>
      <span class="project-fact">
        {props.project.visibility === "private" ? <Lock size={14} aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}
        {props.project.visibility === "private" ? "Private" : "Open"}
      </span>
    </div>
  );
}
