import type { IssueStatus } from "@paperclipai/shared";
import { useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { updatedLabel } from "@/tasks/list-model";
import { TasksView, useTaskList } from "@/tasks/TasksView";
import { HeaderNumber, PageHeader, Tabs } from "@/ui/PageHeader";
import { PlannedNote } from "./Planned";
import { OPEN_STATUSES } from "./Tasks";

/*
 * A project's pages under its header card (board 1). The List tab is the project's tasks with the
 * docked panel; Board comes later in M2, and Agent workload, Docs and Settings in M4.
 */

const PROJECT_TABS = [
  { label: "List", path: "" },
  { label: "Board", path: "/board" },
  { label: "Agent workload", path: "/workload" },
  { label: "Docs", path: "/docs" },
  { label: "Settings", path: "/settings" },
];

export function ProjectPage() {
  const params = useParams<{ projectKey: string; "*"?: string }>();
  const company = useCompany();
  const projects = useProjectsQuery();
  const liveRuns = useLiveRunsQuery();
  const project = createMemo(() =>
    projects.data?.find((candidate) => candidate.urlKey === params.projectKey || candidate.id === params.projectKey),
  );
  const tasks = useTaskList(() => (project() ? { projectId: project()!.id } : null));
  const base = () => `/${company().issuePrefix}/projects/${params.projectKey}`;
  const tab = () => (params["*"] ?? "").replace(/\/$/, "");

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
        numbers={
          <Show when={project() && tasks.data}>
            <HeaderNumber value={open()} label="open" />
            <Show when={running() > 0}>
              <HeaderNumber value={running()} label={running() === 1 ? "agent running" : "agents running"} />
            </Show>
            <Show when={blocked() > 0}>
              <HeaderNumber value={blocked()} label="blocked" tone="red" />
            </Show>
            <Show when={updated()}>{(label) => <span class="muted">Updated {label() === "Just now" ? "just now" : label()}</span>}</Show>
          </Show>
        }
        tabs={<Tabs label="Project" items={PROJECT_TABS.map((item) => ({ label: item.label, href: `${base()}${item.path}`, end: item.path === "" }))} />}
      />
      <Show
        when={tab() === ""}
        fallback={<PlannedNote milestone={tab() === "board" ? "M2" : "M4"}>This tab is still to come.</PlannedNote>}
      >
        <Show when={project()} fallback={<PlannedNote milestone="M2">Loading the project…</PlannedNote>}>
          {(found) => <TasksView projectId={found().id} tasks={tasks} />}
        </Show>
      </Show>
    </>
  );
}
