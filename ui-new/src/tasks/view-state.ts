import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";

/*
 * How a task list is arranged: what it's grouped by, what it's filtered to, and which groups are
 * collapsed. Each list (the company's, each project's) keeps its own, in localStorage, after the old
 * list's per-scope view state (ui/src/components/IssuesList.tsx). Search is left out on purpose: it
 * lasts for the visit only.
 *
 * Assignees are keyed `agent:<id>`, `user:<id>` or `none`; labels by id, or `none` for tasks with no
 * label.
 */

export type GroupBy = "status" | "assignee" | "priority" | "label" | "parent" | "none";

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "label", label: "Label" },
  { value: "parent", label: "Parent task" },
  { value: "none", label: "No grouping" },
];

export type TaskFilters = {
  statuses: IssueStatus[];
  priorities: IssuePriority[];
  assignees: string[];
  labels: string[];
};

export type TaskViewState = {
  groupBy: GroupBy;
  filters: TaskFilters;
  /** Groups the viewer opened or closed, keyed `<groupBy>:<group key>`; others use the default. */
  collapsed: Record<string, boolean>;
};

export const EMPTY_FILTERS: TaskFilters = { statuses: [], priorities: [], assignees: [], labels: [] };

export const DEFAULT_VIEW_STATE: TaskViewState = { groupBy: "status", filters: EMPTY_FILTERS, collapsed: {} };

export function viewStateKey(companyId: string, projectId?: string) {
  return `ui-new:tasks:view:${companyId}:${projectId ?? "all"}`;
}

const GROUP_BY_VALUES = new Set(GROUP_BY_OPTIONS.map((option) => option.value));

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** A saved state, with anything missing or malformed replaced by the default. */
export function parseViewState(raw: string | null): TaskViewState {
  if (!raw) return DEFAULT_VIEW_STATE;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof TaskViewState, unknown>>;
    const filters = (value.filters ?? {}) as Partial<Record<keyof TaskFilters, unknown>>;
    const collapsed: Record<string, boolean> = {};
    if (value.collapsed && typeof value.collapsed === "object") {
      for (const [key, closed] of Object.entries(value.collapsed)) if (typeof closed === "boolean") collapsed[key] = closed;
    }
    return {
      groupBy: GROUP_BY_VALUES.has(value.groupBy as GroupBy) ? (value.groupBy as GroupBy) : "status",
      filters: {
        statuses: strings(filters.statuses) as IssueStatus[],
        priorities: strings(filters.priorities) as IssuePriority[],
        assignees: strings(filters.assignees),
        labels: strings(filters.labels),
      },
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

export function filterCount(filters: TaskFilters) {
  return filters.statuses.length + filters.priorities.length + filters.assignees.length + filters.labels.length;
}

/** Adds the value if it's missing, removes it if it's there. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function matchesSearch(task: CompactIssue, words: string[]) {
  const text = `${task.identifier ?? ""} ${task.title} ${task.description ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The tasks that pass the filters and search. Within one kind of filter any match counts; across
 * kinds every one must match. Search matches every word against the identifier, title and
 * description.
 */
export function applyFilters(tasks: readonly CompactIssue[], filters: TaskFilters, search = ""): CompactIssue[] {
  const statuses = new Set<string>(filters.statuses);
  const priorities = new Set<string>(filters.priorities);
  const assignees = new Set(filters.assignees);
  const labels = new Set(filters.labels);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((task) => {
    if (statuses.size > 0 && !statuses.has(task.status)) return false;
    if (priorities.size > 0 && !priorities.has(task.priority)) return false;
    if (assignees.size > 0 && !assignees.has(assigneeKey(task))) return false;
    if (labels.size > 0) {
      const ids = task.labelIds ?? task.labels?.map((label) => label.id) ?? [];
      if (!(ids.length === 0 ? labels.has("none") : ids.some((id) => labels.has(id)))) return false;
    }
    return words.length === 0 || matchesSearch(task, words);
  });
}
