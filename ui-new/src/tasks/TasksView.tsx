import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { useLocation, useSearchParams } from "@solidjs/router";
import { createQuery, keepPreviousData } from "@tanstack/solid-query";
import { ArrowUpDown, ChevronDown, CircleCheck, CornerDownRight, ListFilter, Plus, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { api } from "@/api/client";
import { ISSUE_LIST_PAGE_SIZE, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { Dock } from "@/layout/Panel";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useLabelsQuery, useProjectsQuery } from "@/lib/company-data";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { PriorityBars, RunningPill, StatusCapsule } from "@/ui/Status";
import { Segmented } from "@/ui/Segmented";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { boardCollapseKey, boardColumns, boardStartsCollapsed, CLOSED_STATUSES } from "./board-model";
import { BoardView } from "./BoardView";
import { buildTaskGroups, PRIORITY_ORDER, shownRows, startsCollapsed, STATUS_PICK_ORDER, type GroupNames, type TaskGroup } from "./list-model";
import { useTaskPeople } from "./people";
import { AssigneeItems, LabelDot, LabelItems, PriorityItems, StatusItems } from "./pickers";
import { useTaskRetry } from "./retry";
import { addView, deleteView, localSavedViews, renameView, sameSettings, savedViewsScope, updateView, type SavedView, type ViewSettings } from "./saved-views";
import { SavedViewsMenu } from "./SavedViews";
import { defaultDir, dirLabels, sortTasks, SORT_OPTIONS } from "./task-sort";
import { useTaskUpdates } from "./task-updates";
import { TaskList } from "./TaskList";
import { TaskModal } from "./TaskModal";
import { opensAs, taskOpenMode } from "./task-open-mode";
import { TaskPanel } from "./TaskPanel";
import { parseListUrl, PREFILTER_PARAMS, withUrlFilters } from "./view-url";
import {
  applyFilters,
  creatorKey,
  EMPTY_FILTERS,
  filterCount,
  GROUP_BY_OPTIONS,
  LAYOUT_OPTIONS,
  readViewState,
  toggled,
  viewStateKey,
  writeViewState,
  type BoardDisplay,
  type SortField,
  type TaskFilters,
  type TaskLayout,
  type TaskViewState,
} from "./view-state";
import { useWorkspaceSummaries, workspaceLookup } from "./workspaces";
import "./TasksView.css";

/*
 * A task list with its toolbar and docked panel: the whole company's tasks, or one project's, as a
 * list (board 1) or a board (board 4). The toolbar switches between them, picks a saved view
 * (saved-views.ts), groups, sorts, filters and searches; each list keeps its layout, grouping,
 * filters, sort, board display options and folded groups (view-state.ts). In a project the header's
 * List and Board tabs choose the layout instead, so the page passes it in. Ticking rows or cards
 * brings up the selection bar, which changes every ticked task at once. A parent's row unfolds to
 * show its subtasks, indented; on the board, "Show subtasks on cards" lists them on each card.
 *
 * The URL carries what a link should reproduce (view-url.ts): the search (`?q=`), the old list's
 * pre-filters, and the open task (`?task=TES-3`), so it survives a reload and the back button
 * closes it. A task that isn't in the list (a subtask from another project, say) is looked up on
 * its own. It opens docked beside the list, or as a modal over it when that setting is on
 * (task-open-mode.ts).
 */

type ListScope = { projectId?: string };

/**
 * Every page of the tasks an agent took part in. The server filters those (`participantAgentId`),
 * which issuesApi's list filters don't carry yet, so the request is built here, as issuesApi.listAll
 * builds its own.
 */
async function listParticipantTasks(companyId: string, scope: ListScope, agentId: string, signal: AbortSignal) {
  const tasks: CompactIssue[] = [];
  for (let offset = 0; ; offset += ISSUE_LIST_PAGE_SIZE) {
    const params = new URLSearchParams({
      view: "compact",
      sortField: "updated",
      sortDir: "desc",
      participantAgentId: agentId,
      includeBlockedBy: "true",
      includeRoutineExecutions: "true",
      limit: String(ISSUE_LIST_PAGE_SIZE),
      offset: String(offset),
    });
    if (scope.projectId) params.set("projectId", scope.projectId);
    const page = await api.get<CompactIssue[]>(`/companies/${companyId}/issues?${params}`, { signal });
    tasks.push(...page);
    if (page.length < ISSUE_LIST_PAGE_SIZE) return tasks;
  }
}

/**
 * The tasks for a list. A null scope waits, such as while a project is still being looked up. A
 * `?participantAgentId=` in the URL narrows it to the tasks that agent took part in.
 */
export function useTaskList(scope: () => ListScope | null) {
  const company = useCompany();
  const location = useLocation();
  const participant = () => parseListUrl(location.search).participantAgentId;
  return createQuery(() => {
    const key = queryKeys.issues.view(company().id, scope() ?? {});
    const agentId = participant();
    return {
      queryKey: agentId ? [...key, "participant", agentId] : key,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        agentId
          ? listParticipantTasks(company().id, scope() ?? {}, agentId, signal)
          : issuesApi.listAll(company().id, { ...scope(), includeBlockedBy: true, includeRoutineExecutions: true }, signal),
      enabled: scope() !== null,
      placeholderData: keepPreviousData,
    };
  });
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
  const projects = useProjectsQuery();
  const updates = useTaskUpdates();
  const retry = useTaskRetry();
  const location = useLocation();
  const [params, setParams] = useSearchParams<{ task?: string; section?: string }>();
  const tasks = () => props.tasks.data ?? [];

  // What the URL says: the search, and pre-filters that replace the saved view's.
  const url = createMemo(() => parseListUrl(location.search, people.youId()));
  const urlFilters = createMemo(() => JSON.stringify(url().filters));
  // The search box keeps its own text and writes it to `?q=`; a change to the URL from elsewhere
  // (the back button, a link) comes back into the box, but the box's own writes don't, so a slow
  // navigation can't undo typing.
  const urlSearch = createMemo(() => url().search);
  const [search, setSearchText] = createSignal(urlSearch());
  const written = new Set<string>();
  createEffect(
    on(
      urlSearch,
      (q) => {
        if (!written.delete(q)) setSearchText(q);
      },
      { defer: true },
    ),
  );
  /** Sets the search, with any other URL changes in the same navigation so neither undoes the other. */
  const setSearch = (value: string, more: Record<string, undefined> = {}) => {
    setSearchText(value);
    if (value !== urlSearch()) written.add(value);
    setParams({ ...more, q: value || undefined }, { replace: true, scroll: false });
  };

  // The view: saved per list, and read again when the list changes (another project) or the URL's
  // pre-filters do.
  const storageKey = () => viewStateKey(company().id, props.projectId);
  const [view, setView] = createSignal<TaskViewState>(withUrlFilters(readViewState(storageKey()), url().filters));
  const [checked, setChecked] = createSignal<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(
    on(
      [storageKey, urlFilters],
      ([key], previous) => {
        setView(withUrlFilters(readViewState(key), url().filters));
        if (previous?.[0] !== key) {
          setChecked(new Set<string>());
          setExpanded(new Set<string>());
        }
      },
      { defer: true },
    ),
  );
  const changeView = (next: Partial<TaskViewState>) => {
    const state = { ...view(), ...next };
    setView(state);
    writeViewState(storageKey(), state);
  };
  // Changing filters by hand takes over from the URL's pre-filters, so the URL stops claiming them.
  const dropUrlFilters = () => {
    if (Object.keys(url().filters).length > 0) setParams({ ...PREFILTER_PARAMS }, { replace: true, scroll: false });
  };
  const changeFilters = (next: Partial<TaskFilters>) => {
    changeView({ filters: { ...view().filters, ...next } });
    dropUrlFilters();
  };
  const clearFilters = () => {
    changeView({ filters: EMPTY_FILTERS });
    dropUrlFilters();
  };
  const changeBoard = (next: Partial<BoardDisplay>) => changeView({ board: { ...view().board, ...next } });
  const toggleExpanded = (id: string, open: boolean) => {
    const next = new Set(expanded());
    if (open) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };

  // Saved views, per list.
  const viewsScope = () => savedViewsScope(company().id, props.projectId);
  const [savedViews, setSavedViews] = createSignal<SavedView[]>(localSavedViews.read(viewsScope()));
  createEffect(on(viewsScope, (scope) => setSavedViews(localSavedViews.read(scope)), { defer: true }));
  const storeViews = (views: SavedView[]) => {
    setSavedViews(views);
    localSavedViews.write(viewsScope(), views);
  };
  const settings = (): ViewSettings => ({ groupBy: view().groupBy, filters: view().filters, sort: view().sort, search: search() });
  const currentView = createMemo(() => {
    const now = settings();
    const picked = savedViews().find((each) => each.id === view().savedViewId);
    return picked && sameSettings(picked, now) ? picked : savedViews().find((each) => sameSettings(each, now));
  });
  const editedView = () => (currentView() ? undefined : savedViews().find((each) => each.id === view().savedViewId));
  const pickView = (saved: SavedView) => {
    changeView({ groupBy: saved.groupBy, filters: saved.filters, sort: saved.sort, savedViewId: saved.id });
    setSearch(saved.search, PREFILTER_PARAMS);
  };

  // Workspaces are only looked up when the view needs them: grouped or filtered by workspace, or
  // with the filter menu open.
  const [filterMenuOpen, setFilterMenuOpen] = createSignal(false);
  const summaries = useWorkspaceSummaries(
    () => view().groupBy === "workspace" || view().filters.workspaces.length > 0 || filterMenuOpen(),
  );
  const workspaces = createMemo(() => workspaceLookup(projects.data ?? [], summaries.data ?? []));

  const tasksById = createMemo(() => new Map(tasks().map((task) => [task.id, task] as const)));
  const labelsById = createMemo(() => new Map((labels.data ?? []).map((label) => [label.id, label] as const)));
  const projectsById = createMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project] as const)));
  const names: GroupNames = {
    agent: (id) => people.agent(id)?.name,
    person: (id) => people.personName(id),
    youId: () => people.youId(),
    label: (id) => labelsById().get(id),
    task: (id) => tasksById().get(id),
    project: (id) => projectsById().get(id),
    get workspace() {
      return workspaces();
    },
  };
  const layout = () => props.layout ?? view().layout;
  const hideClosed = () => layout() === "board" && !view().board.closed;
  const visible = createMemo(() => {
    const shown = applyFilters(tasks(), view().filters, search(), { liveIssueIds: people.liveIssueIds(), workspaceOf: workspaces().of });
    return hideClosed() ? shown.filter((task) => !CLOSED_STATUSES.has(task.status)) : shown;
  });
  const groups = createMemo(() =>
    buildTaskGroups(sortTasks(visible(), view().sort), people.liveIssueIds(), { groupBy: view().groupBy, names }),
  );
  const columns = createMemo(() => boardColumns(groups(), view().groupBy, view().filters, !hideClosed()));
  // The board folds its columns apart from the list's groups, with its own defaults.
  const collapseKey = (group: TaskGroup) =>
    layout() === "board" ? boardCollapseKey(view().groupBy, group) : `${view().groupBy}:${group.key}`;
  const isOpen = (group: TaskGroup) =>
    !(view().collapsed[collapseKey(group)] ?? (layout() === "board" ? boardStartsCollapsed(group) : startsCollapsed(group)));
  const toggleGroup = (group: TaskGroup, open: boolean) =>
    changeView({ collapsed: { ...view().collapsed, [collapseKey(group)]: !open } });

  // Ticks only count for tasks still in view.
  const checkedTasks = createMemo(() => visible().filter((task) => checked().has(task.id)));

  // The filter menu offers what the list has: the people and agents who created its tasks, its
  // projects and its workspaces.
  const creatorKeys = createMemo(() => [...new Set(tasks().map(creatorKey))]);
  const projectOptions = createMemo(() => {
    const used = new Set(tasks().map((task) => task.projectId ?? "none"));
    return (projects.data ?? [])
      .filter((project) => used.has(project.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project) => ({ id: project.id, name: project.name, color: project.color }))
      .concat(used.has("none") ? [{ id: "none", name: "No project", color: null }] : []);
  });
  const workspaceOptions = createMemo(() => {
    const used = new Set(tasks().map((task) => workspaces().of(task) ?? "none"));
    const named = [...used]
      .filter((id) => id !== "none")
      .map((id) => ({ id, name: workspaces().name(id) ?? `Workspace ${id.slice(0, 8)}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return named.length > 0 ? named.concat(used.has("none") ? [{ id: "none", name: "Default workspace" }] : []) : [];
  });

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

  // Previous and next follow the list's order: groups (or columns) as shown, then rows within them,
  // with unfolded subtasks under their parent on the list. Grouped by label, a task can show more
  // than once; it counts where it first appears.
  const order = createMemo(() => {
    const seen = new Set<string>();
    const list: CompactIssue[] = [];
    for (const group of layout() === "board" ? columns() : groups()) {
      const rows = layout() === "board" ? group.rows : shownRows(group.rows, expanded()).map((shown) => shown.row);
      for (const row of rows) {
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
  const groupOptions = () => GROUP_BY_OPTIONS.filter((option) => !(props.projectId && option.value === "project"));
  const groupLabel = () => GROUP_BY_OPTIONS.find((option) => option.value === view().groupBy)?.label ?? "Status";
  const participantName = () => {
    const id = url().participantAgentId;
    return id ? (people.agent(id)?.name ?? "an agent") : null;
  };

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
        <SavedViewsMenu
          views={savedViews()}
          current={currentView()}
          edited={editedView()}
          onPick={pickView}
          onSave={(name) => {
            const views = addView(savedViews(), name, settings());
            storeViews(views);
            changeView({ savedViewId: views.at(-1)!.id });
          }}
          onUpdate={(saved) => storeViews(updateView(savedViews(), saved.id, settings()))}
          onRename={(saved, name) => storeViews(renameView(savedViews(), saved.id, name))}
          onDelete={(saved) => storeViews(deleteView(savedViews(), saved.id))}
        />
        <Menu>
          <Menu.Trigger as={Button}>
            {view().groupBy === "none" ? "No grouping" : `${layout() === "board" ? "Columns" : "Group"}: ${groupLabel()}`}
            <ChevronDown size={12} stroke-width={2} aria-hidden="true" class="tv-caret" />
          </Menu.Trigger>
          <Menu.Content label={layout() === "board" ? "Columns by" : "Group by"} width={220}>
            <For each={groupOptions()}>
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
        <SortMenu sort={view().sort} onChange={(sort) => changeView({ sort })} />
        <Show when={layout() === "board"}>
          <Button
            variant="icon"
            ghost
            class="tv-toggle"
            aria-pressed={view().board.subtasks}
            aria-label="Show subtasks on cards"
            title="Show subtasks on cards"
            onClick={() => changeBoard({ subtasks: !view().board.subtasks })}
          >
            <CornerDownRight size={16} aria-hidden="true" />
          </Button>
        </Show>
        <span class="tv-toolbar-end">
          <FilterMenu
            filters={view().filters}
            people={people}
            creators={creatorKeys()}
            projects={props.projectId ? [] : projectOptions()}
            workspaces={workspaceOptions()}
            onOpenChange={setFilterMenuOpen}
            onChange={changeFilters}
          />
          <Show when={activeFilters() > 0}>
            <Button ghost size="compact" onClick={clearFilters}>
              Clear filters
            </Button>
          </Show>
          <Show when={layout() === "board"}>
            <Button
              ghost
              size="compact"
              class="tv-toggle"
              aria-pressed={view().board.closed}
              title={view().board.closed ? "Hide the Done and Cancelled columns" : "Show the Done and Cancelled columns"}
              onClick={() => changeBoard({ closed: !view().board.closed })}
            >
              <CircleCheck size={14} aria-hidden="true" />
              Closed
            </Button>
          </Show>
        </span>
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
      <Show when={participantName()}>
        {(name) => (
          <div class="tv-scope">
            <span>Tasks {name()} took part in</span>
            <Button ghost size="compact" onClick={() => setParams({ participantAgentId: undefined }, { replace: true })}>
              <X size={14} aria-hidden="true" />
              Show all tasks
            </Button>
          </div>
        )}
      </Show>
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
            <p>{participantName() ? `${participantName()} hasn't taken part in any tasks.` : "No tasks yet."}</p>
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
                      changeView({ filters: EMPTY_FILTERS, board: { ...view().board, closed: true } });
                      setSearch("", PREFILTER_PARAMS);
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
                    retry={retry}
                    selectedId={openTask()?.id ?? null}
                    onOpen={open}
                    projectId={props.projectId}
                    isOpen={isOpen}
                    onToggleGroup={toggleGroup}
                    checked={checked()}
                    onCheckedChange={setChecked}
                    expanded={expanded()}
                    onToggleExpanded={toggleExpanded}
                  />
                }
              >
                <BoardView
                  columns={columns()}
                  people={people}
                  updates={updates}
                  retry={retry}
                  selectedId={openTask()?.id ?? null}
                  onOpen={open}
                  projectId={props.projectId}
                  isOpen={isOpen}
                  onToggleGroup={toggleGroup}
                  checked={checked()}
                  onCheckedChange={setChecked}
                  showSubtasks={view().board.subtasks}
                />
              </Show>
            </Show>
            <Show when={openTask()}>
              {(task) => (
                <Show
                  when={opensAs(taskOpenMode(), true) === "modal"}
                  fallback={<TaskPanel task={task()} onClose={close} onOpenTask={open} onPrevious={step(-1)} onNext={step(1)} />}
                >
                  <TaskModal task={task()} onClose={close} onOpenTask={open} onPrevious={step(-1)} onNext={step(1)} canDock />
                </Show>
              )}
            </Show>
          </Dock>
        </Match>
      </Switch>
    </>
  );
}

type People = ReturnType<typeof useTaskPeople>;

/** The sort menu: a field, then which way, in words that fit the field. */
function SortMenu(props: { sort: TaskViewState["sort"]; onChange: (sort: TaskViewState["sort"]) => void }) {
  const label = () => SORT_OPTIONS.find((option) => option.value === props.sort.field)?.label ?? "Updated";
  const dirs = () => dirLabels(props.sort.field);
  const pick = (field: SortField) => props.onChange(field === props.sort.field ? props.sort : { field, dir: defaultDir(field) });
  return (
    <Menu>
      <Menu.Trigger as={Button} aria-label={`Sort: ${label()}, ${dirs()[props.sort.dir].toLowerCase()}`}>
        <ArrowUpDown size={14} aria-hidden="true" />
        Sort: {label()}
        <ChevronDown size={12} stroke-width={2} aria-hidden="true" class="tv-caret" />
      </Menu.Trigger>
      <Menu.Content label="Sort tasks" width={240}>
        <Menu.Group label="Sort by">
          <For each={SORT_OPTIONS}>
            {(option) => (
              <Menu.Item
                hint={props.sort.field === option.value ? "✓" : undefined}
                description={option.value === "workflow" ? "Blockers before the tasks they hold up" : undefined}
                onSelect={() => pick(option.value)}
              >
                {option.label}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group label="Order">
          <For each={["asc", "desc"] as const}>
            {(dir) => (
              <Menu.Item hint={props.sort.dir === dir ? "✓" : undefined} onSelect={() => props.onChange({ ...props.sort, dir })}>
                {dirs()[dir]}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

/**
 * One menu for every filter, each a set of ticks: running now and agent-made tasks first, then
 * status, priority, assignee, labels, creator, project and workspace. Creators, projects and
 * workspaces offer the ones the list's tasks have.
 */
function FilterMenu(props: {
  filters: TaskFilters;
  people: People;
  creators: readonly string[];
  projects: readonly { id: string; name: string; color: string | null }[];
  workspaces: readonly { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  onChange: (next: Partial<TaskFilters>) => void;
}) {
  const labels = useLabelsQuery();
  const count = () => filterCount(props.filters);
  const assignee = (key: string) => ({
    checked: props.filters.assignees.includes(key),
    onChange: () => props.onChange({ assignees: toggled(props.filters.assignees, key) }),
  });
  const creator = (key: string) => ({
    checked: props.filters.creators.includes(key),
    onChange: () => props.onChange({ creators: toggled(props.filters.creators, key) }),
  });
  // Creators: you, then agents, then other people, then automation, each by name.
  const creators = createMemo(() => {
    const you = props.people.youId();
    const named = props.creators.map((key) => {
      const [kind, id = ""] = key.split(/:(.*)/s);
      if (kind === "agent") return { key, rank: 1, name: props.people.agent(id)?.name ?? "Unknown agent", id, kind };
      if (kind === "user") return id === you ? { key, rank: 0, name: "You", id, kind } : { key, rank: 2, name: props.people.personName(id), id, kind };
      return { key, rank: 3, name: "Automation", id, kind };
    });
    return named.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  });
  return (
    <Menu onOpenChange={props.onOpenChange}>
      <Menu.Trigger as={Button} classList={{ "tv-filter--on": count() > 0 }}>
        <ListFilter size={14} aria-hidden="true" />
        {count() > 0 ? `${count()} ${count() === 1 ? "filter" : "filters"}` : "Filter"}
      </Menu.Trigger>
      <Menu.Content label="Filter tasks" width={270}>
        <Menu.Group label="Show">
          <Menu.CheckboxItem
            icon={<RunningPill compact label="Live" />}
            checked={props.filters.liveOnly}
            onChange={() => props.onChange({ liveOnly: !props.filters.liveOnly })}
          >
            Running now
          </Menu.CheckboxItem>
          <Menu.CheckboxItem
            description="Made by an agent, a routine or a plan"
            checked={props.filters.hideAgentCreated}
            onChange={() => props.onChange({ hideAgentCreated: !props.filters.hideAgentCreated })}
          >
            Hide tasks agents created
          </Menu.CheckboxItem>
        </Menu.Group>
        <Menu.Separator />
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
        <Show when={creators().length > 0}>
          <Menu.Separator />
          <Menu.Group label="Created by">
            <For each={creators()}>
              {(entry) => (
                <Menu.CheckboxItem
                  icon={
                    <Switch fallback={<span class="pick-none" aria-hidden="true" />}>
                      <Match when={entry.kind === "agent" && props.people.agent(entry.id)}>
                        {(agent) => <AgentAvatar agent={agent()} size={20} />}
                      </Match>
                      <Match when={entry.kind === "user"}>
                        <InitialsDisc name={entry.name} seed={entry.id} size={20} you={entry.rank === 0} />
                      </Match>
                    </Switch>
                  }
                  {...creator(entry.key)}
                >
                  {entry.name}
                </Menu.CheckboxItem>
              )}
            </For>
          </Menu.Group>
        </Show>
        <Show when={props.projects.length > 0}>
          <Menu.Separator />
          <Menu.Group label="Project">
            <For each={props.projects}>
              {(project) => (
                <Menu.CheckboxItem
                  icon={<LabelDot color={project.id === "none" ? null : project.color} />}
                  checked={props.filters.projects.includes(project.id)}
                  onChange={() => props.onChange({ projects: toggled(props.filters.projects, project.id) })}
                >
                  {project.name}
                </Menu.CheckboxItem>
              )}
            </For>
          </Menu.Group>
        </Show>
        <Show when={props.workspaces.length > 0}>
          <Menu.Separator />
          <Menu.Group label="Workspace">
            <For each={props.workspaces}>
              {(workspace) => (
                <Menu.CheckboxItem
                  checked={props.filters.workspaces.includes(workspace.id)}
                  onChange={() => props.onChange({ workspaces: toggled(props.filters.workspaces, workspace.id) })}
                >
                  {workspace.name}
                </Menu.CheckboxItem>
              )}
            </For>
          </Menu.Group>
        </Show>
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
