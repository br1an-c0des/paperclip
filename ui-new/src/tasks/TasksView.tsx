import { useSearchParams } from "@solidjs/router";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { Plus } from "lucide-solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { Dock } from "@/layout/Panel";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { buildTaskGroups } from "./list-model";
import { useTaskPeople } from "./people";
import { TaskList } from "./TaskList";
import { TaskPanel } from "./TaskPanel";
import "./TasksView.css";

/*
 * A task list with its docked panel: the whole company's tasks, or one project's. The open task
 * lives in the URL (`?task=TES-3`), so it survives a reload and the back button closes it. A task
 * that isn't in the list (a subtask from another project, say) is looked up on its own.
 */

/** The tasks for a list. A null scope waits, such as while a project is still being looked up. */
export function useTaskList(scope: () => { projectId?: string } | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, scope() ?? {}),
    queryFn: ({ signal }) => issuesApi.listAll(company().id, { ...scope(), includeBlockedBy: true }, signal),
    enabled: scope() !== null,
    placeholderData: keepPreviousData,
  }));
}

export function TasksView(props: { projectId?: string; tasks: ReturnType<typeof useTaskList> }) {
  const commands = useCommands();
  const people = useTaskPeople();
  const [params, setParams] = useSearchParams<{ task?: string }>();
  const tasks = () => props.tasks.data ?? [];

  const openRef = () => params.task ?? null;
  const fromList = createMemo(() => {
    const ref = openRef();
    return ref ? tasks().find((task) => task.identifier === ref || task.id === ref) : undefined;
  });
  const looked = createQuery(() => ({
    queryKey: queryKeys.issues.detail(openRef() ?? ""),
    queryFn: ({ signal }) => issuesApi.get(openRef()!, signal),
    enabled: openRef() !== null && !fromList() && props.tasks.isSuccess,
  }));
  const openTask = () => fromList() ?? (looked.data && openRef() ? looked.data : undefined);

  // Previous and next follow the list's order: groups in status order, then rows within them.
  const order = createMemo(() =>
    buildTaskGroups(tasks(), people.liveIssueIds()).flatMap((group) => group.rows.map((row) => row.task)),
  );
  const step = (delta: number) => {
    const current = openTask();
    if (!current) return undefined;
    const index = order().findIndex((task) => task.id === current.id);
    const next = index === -1 ? undefined : order()[index + delta];
    return next ? () => open(next) : undefined;
  };

  const open = (task: { id: string; identifier: string | null }) => setParams({ task: task.identifier ?? task.id });
  const close = () => setParams({ task: undefined });

  return (
    <>
      <div class="tv-toolbar">
        <Button variant="primary" onClick={() => commands.openNewTask(props.projectId ? { projectId: props.projectId } : {})}>
          <Plus size={15} stroke-width={2.4} aria-hidden="true" />
          Task
        </Button>
      </div>
      <Switch>
        <Match when={props.tasks.isError && !props.tasks.data}>
          <section class="card tv-note">
            <p>The tasks couldn't be loaded: {(props.tasks.error as Error).message}</p>
          </section>
        </Match>
        <Match when={!props.tasks.data}>
          <section class="card tv-note" aria-busy="true">
            <p class="muted">Loading tasks…</p>
          </section>
        </Match>
        <Match when={tasks().length === 0}>
          <section class="card tv-note">
            <p>No tasks yet.</p>
          </section>
        </Match>
        <Match when={true}>
          <Dock>
            <TaskList tasks={tasks()} people={people} selectedId={openTask()?.id ?? null} onOpen={open} projectId={props.projectId} />
            <Show when={openTask()}>
              {(task) => (
                <TaskPanel task={task()} onClose={close} onOpenTask={open} onPrevious={step(-1)} onNext={step(1)} />
              )}
            </Show>
          </Dock>
        </Match>
      </Switch>
    </>
  );
}
