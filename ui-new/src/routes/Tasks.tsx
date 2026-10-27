import type { IssueStatus } from "@paperclipai/shared";
import { useNavigate, useParams } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";
import { issuePath } from "@/api/issues";
import { useCompany } from "@/lib/company";
import { TaskHeaderActions } from "@/tasks/TaskActions";
import { TitleEditor, useTaskChange } from "@/tasks/TaskEditors";
import { TaskSections } from "@/tasks/TaskSections";
import { TasksView, useTaskByRef, useTaskList } from "@/tasks/TasksView";
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
  // Read under the task's id, so live events refresh the page and edits patch it (TRA-41).
  const task = useTaskByRef(() => params.issueRef);
  const change = useTaskChange(task.task);
  return (
    <Switch>
      <Match when={task.error()}>
        <PageHeader crumbs={<span>Task</span>} title={<span class="mono">{params.issueRef}</span>} />
        <section class="card task-page-note">
          <p>This task couldn't be loaded: {(task.error() as Error).message}</p>
        </section>
      </Match>
      <Match when={task.task()}>
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
              title={<TitleEditor title={found().title} onChange={change} />}
              actions={<TaskHeaderActions taskId={found().id} onHidden={() => navigate(`/${company().issuePrefix}/issues`)} />}
            />
            <section class="card task-page">
              <TaskSections
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
