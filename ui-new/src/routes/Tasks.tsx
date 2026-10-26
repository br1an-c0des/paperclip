import type { IssueStatus } from "@paperclipai/shared";
import { useNavigate, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Match, Show, Switch } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { TaskDetails } from "@/tasks/TaskDetails";
import { TasksView, useTaskList } from "@/tasks/TasksView";
import { HeaderNumber, PageHeader } from "@/ui/PageHeader";
import "./Tasks.css";

/*
 * `/:prefix/issues`, every task in the company, and `/:prefix/issues/:ref`, one task on its own
 * page. Direct links (from agents, Slack, email) land on the full page (build plan, decision B); from
 * a list, tasks open in the docked panel instead.
 */

export const OPEN_STATUSES: ReadonlySet<IssueStatus> = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);

export function TasksPage() {
  const company = useCompany();
  const tasks = useTaskList(() => ({}));
  const open = () => (tasks.data ?? []).filter((task) => OPEN_STATUSES.has(task.status as IssueStatus)).length;
  const blocked = () => (tasks.data ?? []).filter((task) => task.status === "blocked").length;
  return (
    <>
      <PageHeader
        crumbs={<span>{company().name}</span>}
        title="All tasks"
        numbers={
          <Show when={tasks.data}>
            <HeaderNumber value={open()} label="open" />
            <Show when={blocked() > 0}>
              <HeaderNumber value={blocked()} label="blocked" tone="red" />
            </Show>
          </Show>
        }
      />
      <TasksView tasks={tasks} />
    </>
  );
}

export function TaskPage() {
  const params = useParams<{ issueRef: string }>();
  const company = useCompany();
  const navigate = useNavigate();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(params.issueRef),
    queryFn: ({ signal }) => issuesApi.get(params.issueRef, signal),
  }));
  return (
    <Switch>
      <Match when={task.isError}>
        <PageHeader crumbs={<span>Task</span>} title={<span class="mono">{params.issueRef}</span>} />
        <section class="card task-page-note">
          <p>This task couldn't be loaded: {(task.error as Error).message}</p>
        </section>
      </Match>
      <Match when={task.data}>
        {(found) => (
          <>
            <PageHeader
              crumbs={
                <>
                  <span>{found().project?.name ?? "Tasks"}</span>
                  <span aria-hidden="true">/</span>
                  <span class="mono">{found().identifier}</span>
                </>
              }
              title={found().title}
            />
            <section class="card task-page">
              <TaskDetails
                taskId={found().id}
                initial={found()}
                hideTitle
                onOpenTask={(next) => navigate(issuePath(company().issuePrefix, next))}
              />
            </section>
          </>
        )}
      </Match>
    </Switch>
  );
}
