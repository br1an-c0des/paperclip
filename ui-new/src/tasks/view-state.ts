import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";

/*
 * How a task list is arranged: as a list or a board, what it's grouped by, filtered to and sorted
 * by, the board's display options, and which groups are collapsed. Each list (the company's, each
 * project's) keeps its own, in localStorage, after the old list's per-scope view state
 * (ui/src/components/IssuesList.tsx). Search is left out on purpose: it lives in the URL (`?q=`,
 * view-url.ts), so a link carries it.
 *
 * Assignees and creators are keyed `agent:<id>`, `user:<id>` or `none`; labels and projects by id,
 * or `none` for tasks without one; workspaces by the id workspaces.ts resolves, or `none` for tasks
 * on their project's default workspace.
 */

/** List (board 1) or board (board 4). */
export type TaskLayout = "list" | "board";

export const LAYOUT_OPTIONS: { value: TaskLayout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
];

export type GroupBy = "status" | "assignee" | "priority" | "label" | "project" | "workspace" | "parent" | "case" | "none";

/** Case is offered only while the instance has cases on (board C2); TasksView leaves it out otherwise. */
export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "label", label: "Label" },
  { value: "project", label: "Project" },
  { value: "workspace", label: "Workspace" },
  { value: "parent", label: "Parent task" },
  { value: "case", label: "Case" },
  { value: "none", label: "No grouping" },
];

export type TaskFilters = {
  statuses: IssueStatus[];
  priorities: IssuePriority[];
  assignees: string[];
  labels: string[];
  creators: string[];
  projects: string[];
  workspaces: string[];
  /**
   * External objects' states (external-objects.ts EXTERNAL_STATUS_FILTERS), offered only while the
   * enableExternalObjects experiment is on.
   */
  externalObjects: string[];
  /** Only tasks with a run going right now. */
  liveOnly: boolean;
  /** Leave out tasks agents created (isAgentCreated), which the old list hides by default. */
  hideAgentCreated: boolean;
  /** Only tasks in a case (board C1's "In a case"), offered while cases are on. */
  inCase: boolean;
};

/** The fields the old list sorts by (ui/src/components/IssuesList.tsx); task-sort.ts sorts. */
export type SortField = "updated" | "created" | "priority" | "status" | "title" | "workflow";

export type TaskSort = { field: SortField; dir: "asc" | "desc" };

/** Board 4's display options. */
export type BoardDisplay = {
  /** "Show subtasks on cards": a card lists its subtasks under its progress line. */
  subtasks: boolean;
  /** "Closed": the Done and Cancelled columns are on the board. */
  closed: boolean;
};

export type TaskViewState = {
  layout: TaskLayout;
  groupBy: GroupBy;
  filters: TaskFilters;
  sort: TaskSort;
  board: BoardDisplay;
  /** The saved view last picked (saved-views.ts), so the toolbar can name it and offer to update it. */
  savedViewId: string | null;
  /**
   * Groups the viewer opened or closed, keyed `<groupBy>:<group key>` on the list and
   * `board:<groupBy>:<group key>` on the board; others use the default.
   */
  collapsed: Record<string, boolean>;
};

export const EMPTY_FILTERS: TaskFilters = {
  statuses: [],
  priorities: [],
  assignees: [],
  labels: [],
  creators: [],
  projects: [],
  workspaces: [],
  externalObjects: [],
  liveOnly: false,
  hideAgentCreated: false,
  inCase: false,
};

/** The server's order: most recently updated first. */
export const DEFAULT_SORT: TaskSort = { field: "updated", dir: "desc" };

export const DEFAULT_BOARD_DISPLAY: BoardDisplay = { subtasks: false, closed: true };

export const DEFAULT_VIEW_STATE: TaskViewState = {
  layout: "list",
  groupBy: "status",
  filters: EMPTY_FILTERS,
  sort: DEFAULT_SORT,
  board: DEFAULT_BOARD_DISPLAY,
  savedViewId: null,
  collapsed: {},
};

export function viewStateKey(companyId: string, projectId?: string) {
  return `ui-new:tasks:view:${companyId}:${projectId ?? "all"}`;
}

const GROUP_BY_VALUES = new Set(GROUP_BY_OPTIONS.map((option) => option.value));
const SORT_FIELDS = new Set<SortField>(["updated", "created", "priority", "status", "title", "workflow"]);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function parseGroupBy(value: unknown): GroupBy {
  return GROUP_BY_VALUES.has(value as GroupBy) ? (value as GroupBy) : "status";
}

/** Filters from saved JSON, with anything missing or malformed left empty. */
export function parseFilters(value: unknown): TaskFilters {
  const filters = record(value);
  return {
    statuses: strings(filters.statuses) as IssueStatus[],
    priorities: strings(filters.priorities) as IssuePriority[],
    assignees: strings(filters.assignees),
    labels: strings(filters.labels),
    creators: strings(filters.creators),
    projects: strings(filters.projects),
    workspaces: strings(filters.workspaces),
    externalObjects: strings(filters.externalObjects),
    liveOnly: filters.liveOnly === true,
    hideAgentCreated: filters.hideAgentCreated === true,
    inCase: filters.inCase === true,
  };
}

export function parseSort(value: unknown): TaskSort {
  const sort = record(value);
  if (!SORT_FIELDS.has(sort.field as SortField)) return DEFAULT_SORT;
  return { field: sort.field as SortField, dir: sort.dir === "asc" ? "asc" : "desc" };
}

/** A saved state, with anything missing or malformed replaced by the default. */
export function parseViewState(raw: string | null): TaskViewState {
  if (!raw) return DEFAULT_VIEW_STATE;
  try {
    const value = record(JSON.parse(raw));
    const collapsed: Record<string, boolean> = {};
    for (const [key, closed] of Object.entries(record(value.collapsed))) if (typeof closed === "boolean") collapsed[key] = closed;
    const board = record(value.board);
    return {
      layout: value.layout === "board" ? "board" : "list",
      groupBy: parseGroupBy(value.groupBy),
      filters: parseFilters(value.filters),
      sort: parseSort(value.sort),
      board: { subtasks: board.subtasks === true, closed: board.closed !== false },
      savedViewId: typeof value.savedViewId === "string" ? value.savedViewId : null,
      collapsed,
    };
  } catch {
    return DEFAULT_VIEW_STATE;
  }
}

export function readViewState(key: string): TaskViewState {
  try {
    return parseViewState(localStorage.getItem(key));
  } catch {
    return DEFAULT_VIEW_STATE;
  }
}

export function writeViewState(key: string, state: TaskViewState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // The view lasts for this page only.
  }
}

export function assigneeKey(task: Pick<CompactIssue, "assigneeAgentId" | "assigneeUserId">) {
  if (task.assigneeAgentId) return `agent:${task.assigneeAgentId}`;
  if (task.assigneeUserId) return `user:${task.assigneeUserId}`;
  return "none";
}

/** Who created a task, keyed as assignees are. */
export function creatorKey(task: Pick<CompactIssue, "createdByAgentId" | "createdByUserId">) {
  if (task.createdByAgentId) return `agent:${task.createdByAgentId}`;
  if (task.createdByUserId) return `user:${task.createdByUserId}`;
  return "none";
}

/**
 * Whether an agent rather than a person created the task, as shared's `isAgentCreatedIssue` decides
 * (a value, which ui-new can't import from shared): an agent created it, no person did, or it came
 * from something other than a person's own task, such as a routine or a plan.
 */
export function isAgentCreated(task: Pick<CompactIssue, "createdByAgentId" | "createdByUserId" | "originKind">) {
  if (task.createdByAgentId || !task.createdByUserId) return true;
  return !["manual", "onboarding_first_task"].includes(task.originKind ?? "manual");
}

/** How many filters are on: each value ticked, and each switch. */
export function filterCount(filters: TaskFilters) {
  return (
    filters.statuses.length +
    filters.priorities.length +
    filters.assignees.length +
    filters.labels.length +
    filters.creators.length +
    filters.projects.length +
    filters.workspaces.length +
    filters.externalObjects.length +
    (filters.liveOnly ? 1 : 0) +
    (filters.hideAgentCreated ? 1 : 0) +
    (filters.inCase ? 1 : 0)
  );
}

/** Adds the value if it's missing, removes it if it's there. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function matchesSearch(task: CompactIssue, words: string[]) {
  const text = `${task.identifier ?? ""} ${task.title} ${task.description ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** What filtering needs besides the tasks: which have a run going, and each task's workspace. */
export type FilterContext = {
  liveIssueIds?: ReadonlySet<string>;
  workspaceOf?: (task: CompactIssue) => string | null;
  /** Whether a task's external objects match one external-object filter value; unset, that filter is off. */
  externalMatches?: (task: CompactIssue, value: string) => boolean;
  /** Whether a task is in a case; unset (cases off, or still loading), the In a case filter is off. */
  inCase?: (task: CompactIssue) => boolean;
};

/**
 * The tasks that pass the filters and search. Within one kind of filter any match counts; across
 * kinds every one must match. Search matches every word against the identifier, title and
 * description.
 */
export function applyFilters(
  tasks: readonly CompactIssue[],
  filters: TaskFilters,
  search = "",
  context: FilterContext = {},
): CompactIssue[] {
  const statuses = new Set<string>(filters.statuses);
  const priorities = new Set<string>(filters.priorities);
  const assignees = new Set(filters.assignees);
  const labels = new Set(filters.labels);
  const creators = new Set(filters.creators);
  const projects = new Set(filters.projects);
  const workspaces = new Set(filters.workspaces);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((task) => {
    if (filters.liveOnly && !context.liveIssueIds?.has(task.id)) return false;
    if (filters.hideAgentCreated && isAgentCreated(task)) return false;
    if (filters.inCase && context.inCase && !context.inCase(task)) return false;
    if (statuses.size > 0 && !statuses.has(task.status)) return false;
    if (priorities.size > 0 && !priorities.has(task.priority)) return false;
    if (assignees.size > 0 && !assignees.has(assigneeKey(task))) return false;
    if (labels.size > 0) {
      const ids = task.labelIds ?? task.labels?.map((label) => label.id) ?? [];
      if (!(ids.length === 0 ? labels.has("none") : ids.some((id) => labels.has(id)))) return false;
    }
    if (creators.size > 0 && !creators.has(creatorKey(task))) return false;
    if (projects.size > 0 && !projects.has(task.projectId ?? "none")) return false;
    if (workspaces.size > 0 && !workspaces.has(context.workspaceOf?.(task) ?? "none")) return false;
    if (filters.externalObjects.length > 0 && context.externalMatches) {
      const matches = context.externalMatches;
      if (!filters.externalObjects.some((value) => matches(task, value))) return false;
    }
    return words.length === 0 || matchesSearch(task, words);
  });
}
