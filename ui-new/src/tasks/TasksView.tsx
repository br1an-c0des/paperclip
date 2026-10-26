import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { useSearchParams } from "@solidjs/router";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { ChevronDown, ListFilter, Plus, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { Dock } from "@/layout/Panel";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useLabelsQuery } from "@/lib/company-data";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { PriorityBars, StatusCapsule } from "@/ui/Status";
import { Segmented } from "@/ui/Segmented";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { boardCollapseKey, boardColumns, boardStartsCollapsed } from "./board-model";
import { BoardView } from "./BoardView";
import { buildTaskGroups, PRIORITY_ORDER, startsCollapsed, STATUS_PICK_ORDER, type GroupNames, type TaskGroup } from "./list-model";
import { useTaskPeople } from "./people";
import { AssigneeItems, LabelDot, LabelItems, PriorityItems, StatusItems } from "./pickers";
import { useTaskUpdates } from "./task-updates";
import { TaskList } from "./TaskList";
import { TaskPanel } from "./TaskPanel";
import {
  applyFilters,
  EMPTY_FILTERS,
  filterCount,
  GROUP_BY_OPTIONS,
  LAYOUT_OPTIONS,
  readViewState,
  toggled,
  viewStateKey,
  writeViewState,
  type TaskFilters,
  type TaskLayout,
  type TaskViewState,
} from "./view-state";
import "./TasksView.css";

/*
 * A task list with its toolbar and docked panel: the whole company's tasks, or one project's, as a
 * list (board 1) or a board (board 4). The toolbar switches between them, groups, filters and
 * searches; each list keeps its layout, grouping, filters and folded groups (view-state.ts). In a
 * project the header's List and Board tabs choose the layout instead, so the page passes it in.
 * Ticking rows or cards brings up the selection bar, which changes every ticked task at once.
 *
 * The open task lives in the URL (`?task=TES-3`), so it survives a reload and the back button closes
 * it. A task that isn't in the list (a subtask from another project, say) is looked up on its own.
 */

/** The tasks for a list. A null scope waits, such as while a project is still being looked up. */
export function useTaskList(scope: () => { projectId?: string } | null) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, scope() ?? {}),
    queryFn: ({ signal }) => issuesApi.listAll(company().id, { ...scope(), includeBlockedBy: true, includeRoutineExecutions: true }, signal),
    enabled: scope() !== null,
    placeholderData: keepPreviousData,
  }));
}

export function TasksView(props: {
  projectId?: string;
  tasks: ReturnType<typeof useTaskList>;
  /** A layout the page sets, such as a project's Board tab; otherwise the saved one, with a switch. */
  layout?: TaskLayout;
}) {
  const company = useCompany();
  const commands = useCommands();
  const people = useTaskPeople();
  const labels = useLabelsQuery();
  const updates = useTaskUpdates();
  const [params, setParams] = useSearchParams<{ task?: string; section?: string }>();
  const tasks = () => props.tasks.data ?? [];

  // The view: saved per list, and read again when the list changes (another project).
  const storageKey = () => viewStateKey(company().id, props.projectId);
  const [view, setView] = createSignal<TaskViewState>(readViewState(storageKey()));
  const [search, setSearch] = createSignal("");
  const [checked, setChecked] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(
    on(
      storageKey,
      (key) => {
        setView(readViewState(key));
        setSearch("");
        setChecked(new Set<string>());
      },
      { defer: true },
    ),
  );
  const changeView = (next: Partial<TaskViewState>) => {
    const state = { ...view(), ...next };
    setView(state);
    writeViewState(storageKey(), state);
  };
  const changeFilters = (next: Partial<TaskFilters>) => changeView({ filters: { ...view().filters, ...next } });

  const tasksById = createMemo(() => new Map(tasks().map((task) => [task.id, task] as const)));
  const labelsById = createMemo(() => new Map((labels.data ?? []).map((label) => [label.id, label] as const)));
  const names: GroupNames = {
    agent: (id) => people.agent(id)?.name,
    person: (id) => people.personName(id),
    youId: () => people.youId(),
    label: (id) => labelsById().get(id),
    task: (id) => tasksById().get(id),
  };
  const visible = createMemo(() => applyFilters(tasks(), view().filters, search()));
  const groups = createMemo(() => buildTaskGroups(visible(), people.liveIssueIds(), { groupBy: view().groupBy, names }));
  const layout = () => props.layout ?? view().layout;
  const columns = createMemo(() => boardColumns(groups(), view().groupBy, view().filters));
  // The board folds its columns apart from the list's groups, with its own defaults.
  const collapseKey = (group: TaskGroup) =>
    layout() === "board" ? boardCollapseKey(view().groupBy, group) : `${view().groupBy}:${group.key}`;
  const isOpen = (group: TaskGroup) =>
    !(view().collapsed[collapseKey(group)] ?? (layout() === "board" ? boardStartsCollapsed(group) : startsCollapsed(group)));
  const toggleGroup = (group: TaskGroup, open: boolean) =>
    changeView({ collapsed: { ...view().collapsed, [collapseKey(group)]: !open } });

  // Ticks only count for tasks still in view.
  const checkedTasks = createMemo(() => visible().filter((task) => checked().has(task.id)));

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

  // Previous and next follow the list's order: groups (or columns) as shown, then rows within them.
  // Grouped by label, a task can show more than once; it counts where it first appears.
  const order = createMemo(() => {
    const seen = new Set<string>();
    const list: CompactIssue[] = [];
    for (const group of layout() === "board" ? columns() : groups()) {
      for (const row of group.rows) {
        if (seen.has(row.task.id)) continue;
        seen.add(row.task.id);
        list.push(row.task);
      }
    }
    return list;
  });
  const step = (delta: number) => {
    const current = openTask();
    if (!current) return undefined;
    const index = order().findIndex((task) => task.id === current.id);
    const next = index === -1 ? undefined : order()[index + delta];
    return next ? () => open(next) : undefined;
  };

  const open = (task: { id: string; identifier: string | null }) => setParams({ task: task.identifier ?? task.id });
  const close = () => setParams({ task: undefined, section: undefined });
  const activeFilters = () => filterCount(view().filters);
  const groupLabel = () => GROUP_BY_OPTIONS.find((option) => option.value === view().groupBy)?.label ?? "Status";

  return (
    <>
      <div class="tv-toolbar" role="toolbar" aria-label="Task list">
        <Show when={!props.layout}>
          <Segmented
            label="Layout"
            options={LAYOUT_OPTIONS}
            value={view().layout}
            onChange={(next) => changeView({ layout: next })}
          />
        </Show>
        <Menu>
          <Menu.Trigger as={Button}>
            {view().groupBy === "none" ? "No grouping" : `Group: ${groupLabel()}`}
            <ChevronDown size={12} stroke-width={2} aria-hidden="true" class="tv-caret" />
          </Menu.Trigger>
          <Menu.Content label="Group by" width={220}>
            <For each={GROUP_BY_OPTIONS}>
              {(option) => (
                <Menu.Item
                  hint={view().groupBy === option.value ? "✓" : undefined}
                  onSelect={() => changeView({ groupBy: option.value })}
                >
                  {option.label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
        <FilterMenu filters={view().filters} people={people} onChange={changeFilters} />
        <Show when={activeFilters() > 0}>
          <Button ghost size="compact" onClick={() => changeView({ filters: EMPTY_FILTERS })}>
            Clear filters
          </Button>
        </Show>
        <label class="tv-search">
          <Search size={14} aria-hidden="true" />
          <TextInput
            type="search"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search()) {
                event.preventDefault();
                setSearch("");
              }
            }}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </label>
        <Button
          variant="primary"
          class="tv-new"
          onClick={() => commands.openNewTask(props.projectId ? { projectId: props.projectId } : {})}
        >
          <Plus size={15} stroke-width={2.4} aria-hidden="true" />
          Task
        </Button>
      </div>
      <Show when={checkedTasks().length > 0}>
        <SelectionBar tasks={checkedTasks()} people={people} updates={updates} onClear={() => setChecked(new Set<string>())} />
      </Show>
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
            <Show
              when={groups().length > 0}
              fallback={
                <section class="card tv-note tv-note--row">
                  <p>No tasks match {search() ? "this search" : "these filters"}.</p>
                  <Button
                    size="compact"
                    onClick={() => {
                      setSearch("");
                      changeView({ filters: EMPTY_FILTERS });
                    }}
                  >
                    Show every task
                  </Button>
                </section>
              }
            >
              <Show
                when={layout() === "board"}
                fallback={
                  <TaskList
                    groups={groups()}
                    people={people}
                    updates={updates}
                    selectedId={openTask()?.id ?? null}
                    onOpen={open}
                    projectId={props.projectId}
                    isOpen={isOpen}
                    onToggleGroup={toggleGroup}
                    checked={checked()}
                    onCheckedChange={setChecked}
                  />
                }
              >
                <BoardView
                  columns={columns()}
                  people={people}
                  updates={updates}
                  selectedId={openTask()?.id ?? null}
                  onOpen={open}
                  projectId={props.projectId}
                  isOpen={isOpen}
                  onToggleGroup={toggleGroup}
                  checked={checked()}
                  onCheckedChange={setChecked}
                />
              </Show>
            </Show>
            <Show when={openTask()}>
              {(task) => <TaskPanel task={task()} onClose={close} onOpenTask={open} onPrevious={step(-1)} onNext={step(1)} />}
            </Show>
          </Dock>
        </Match>
      </Switch>
    </>
  );
}

type People = ReturnType<typeof useTaskPeople>;

/** One menu for every filter: status, priority, assignee and labels, each a set of ticks. */
function FilterMenu(props: { filters: TaskFilters; people: People; onChange: (next: Partial<TaskFilters>) => void }) {
  const labels = useLabelsQuery();
  const count = () => filterCount(props.filters);
  const assignee = (key: string) => ({
    checked: props.filters.assignees.includes(key),
    onChange: () => props.onChange({ assignees: toggled(props.filters.assignees, key) }),
  });
  return (
    <Menu>
      <Menu.Trigger as={Button} classList={{ "tv-filter--on": count() > 0 }}>
        <ListFilter size={14} aria-hidden="true" />
        Filter
        <Show when={count() > 0}>
          <span class="tv-filter-count">{count()}</span>
        </Show>
      </Menu.Trigger>
      <Menu.Content label="Filter tasks" width={260}>
        <Menu.Group label="Status">
          <For each={STATUS_PICK_ORDER}>
            {(status: IssueStatus) => (
              <Menu.CheckboxItem
                icon={<StatusCapsule status={status} size="row" />}
                checked={props.filters.statuses.includes(status)}
                onChange={() => props.onChange({ statuses: toggled(props.filters.statuses, status) })}
              >
                {STATUS_META[status].label}
              </Menu.CheckboxItem>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group label="Priority">
          <For each={PRIORITY_ORDER}>
            {(priority: IssuePriority) => (
              <Menu.CheckboxItem
                icon={<PriorityBars priority={priority} />}
                checked={props.filters.priorities.includes(priority)}
                onChange={() => props.onChange({ priorities: toggled(props.filters.priorities, priority) })}
              >
                {PRIORITY_META[priority].label}
              </Menu.CheckboxItem>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group label="Assignee">
          <Show when={props.people.youId()}>
            {(id) => (
              <Menu.CheckboxItem icon={<InitialsDisc name="You" seed={id()} size={20} you />} {...assignee(`user:${id()}`)}>
                You
              </Menu.CheckboxItem>
            )}
          </Show>
          <For each={props.people.assignableAgents()}>
            {(agent) => (
              <Menu.CheckboxItem icon={<AgentAvatar agent={agent} size={20} />} {...assignee(`agent:${agent.id}`)}>
                {agent.name}
              </Menu.CheckboxItem>
            )}
          </For>
          <For each={props.people.otherPeople()}>
            {(person) => (
              <Menu.CheckboxItem icon={<InitialsDisc name={person.name} seed={person.id} size={20} />} {...assignee(`user:${person.id}`)}>
                {person.name}
              </Menu.CheckboxItem>
            )}
          </For>
          <Menu.CheckboxItem icon={<span class="pick-none" aria-hidden="true" />} {...assignee("none")}>
            Unassigned
          </Menu.CheckboxItem>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group label="Labels">
          <For each={[...(labels.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}>
            {(label) => (
              <Menu.CheckboxItem
                icon={<LabelDot color={label.color} />}
                checked={props.filters.labels.includes(label.id)}
                onChange={() => props.onChange({ labels: toggled(props.filters.labels, label.id) })}
              >
                {label.name}
              </Menu.CheckboxItem>
            )}
          </For>
          <Menu.CheckboxItem
            icon={<LabelDot />}
            checked={props.filters.labels.includes("none")}
            onChange={() => props.onChange({ labels: toggled(props.filters.labels, "none") })}
          >
            No label
          </Menu.CheckboxItem>
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

/**
 * The bar over a ticked selection, after the agents table's (board 20): status, priority, assignee
 * and labels for every ticked task at once. A label is added to all of them, or taken off all of
 * them once they all have it.
 */
function SelectionBar(props: {
  tasks: CompactIssue[];
  people: People;
  updates: ReturnType<typeof useTaskUpdates>;
  onClear: () => void;
}) {
  const changeAll = (dataFor: (task: CompactIssue) => Record<string, unknown> | null) =>
    void props.updates.update(
      props.tasks.flatMap((task) => {
        const data = dataFor(task);
        return data ? [{ task, data }] : [];
      }),
    );
  const idsOf = (task: CompactIssue) => task.labelIds ?? task.labels?.map((label) => label.id) ?? [];
  const everyHas = (id: string) => props.tasks.every((task) => idsOf(task).includes(id));
  const count = () => props.tasks.length;

  return (
    <div class="tv-selection" role="toolbar" aria-label="Selected tasks">
      <span class="tv-selection-count">
        {count()} {count() === 1 ? "task" : "tasks"} selected
      </span>
      <span class="tv-selection-rule" aria-hidden="true" />
      <Menu>
        <Menu.Trigger as={Button} size="compact">
          Status
        </Menu.Trigger>
        <Menu.Content label="Set status" width={220}>
          <StatusItems onPick={(status) => changeAll((task) => (task.status === status ? null : { status }))} />
        </Menu.Content>
      </Menu>
      <Menu>
        <Menu.Trigger as={Button} size="compact">
          Priority
        </Menu.Trigger>
        <Menu.Content label="Set priority" width={200}>
          <PriorityItems onPick={(priority) => changeAll((task) => (task.priority === priority ? null : { priority }))} />
        </Menu.Content>
      </Menu>
      <Menu>
        <Menu.Trigger as={Button} size="compact">
          Assignee
        </Menu.Trigger>
        <Menu.Content label="Assign to" width={260}>
          <AssigneeItems
            people={props.people}
            onPick={(pick) =>
              changeAll((task) =>
                (task.assigneeAgentId ?? null) === pick.agentId && (task.assigneeUserId ?? null) === pick.userId
                  ? null
                  : { assigneeAgentId: pick.agentId, assigneeUserId: pick.userId },
              )
            }
          />
        </Menu.Content>
      </Menu>
      <Menu>
        <Menu.Trigger as={Button} size="compact">
          Labels
        </Menu.Trigger>
        <Menu.Content label="Labels" width={240}>
          <LabelItems
            checked={everyHas}
            onChange={(id, on) =>
              changeAll((task) => {
                const ids = idsOf(task);
                if (on) return ids.includes(id) ? null : { labelIds: [...ids, id] };
                return ids.includes(id) ? { labelIds: ids.filter((each) => each !== id) } : null;
              })
            }
          />
        </Menu.Content>
      </Menu>
      <Button ghost size="compact" class="tv-selection-clear" onClick={() => props.onClear()}>
        <X size={14} aria-hidden="true" />
        Clear
      </Button>
    </div>
  );
}
