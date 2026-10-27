import type {
  CompanySearchIssueFilterKey,
  CompanySearchZeroResults,
  IssuePriority,
  IssueStatus,
} from "@paperclipai/shared";
import type { SearchRequest } from "@/api/search";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";

/*
 * The task filters on the Search page (boards S1–S3): status, priority, assignee, project, label and
 * the updated window, as the search API takes them. They narrow every task-shaped kind (tasks,
 * comments, docs, files); agents and projects drop out while any is set, as the server does.
 *
 * Status and priority take several values. The API takes one assignee, one project, one label and
 * one window, so those filters are single picks: choosing another replaces it (where the boards
 * tick two assignees, the API can't, and filtering a page of results client-side would make the
 * counts lie).
 *
 * The assignee is one token, as the task list writes it: `agent:<id>`, `user:<id>` or `none`.
 */

export type SearchFilters = {
  status: IssueStatus[];
  priority: IssuePriority[];
  assignee: string | null;
  projectId: string | null;
  labelId: string | null;
  updated: string | null;
};

export type FilterDimension = "status" | "priority" | "assignee" | "project" | "label" | "updated";

export const EMPTY_FILTERS: SearchFilters = {
  status: [],
  priority: [],
  assignee: null,
  projectId: null,
  labelId: null,
  updated: null,
};

/** The updated windows the API counts (`filterOptionCounts.updatedWithin`), shortest first. */
export const UPDATED_WINDOWS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

export function updatedLabel(value: string) {
  const known = UPDATED_WINDOWS.find((window) => window.value === value);
  if (known) return known.label;
  const match = /^(\d+)(h|d|w|m)$/.exec(value);
  if (!match) return value;
  const unit = { h: "hour", d: "day", w: "week", m: "month" }[match[2] as "h" | "d" | "w" | "m"];
  return `Last ${match[1]} ${unit}${match[1] === "1" ? "" : "s"}`;
}

/** How many filters are set, counting each dimension once. */
export function filterCount(filters: SearchFilters) {
  return (
    (filters.status.length > 0 ? 1 : 0) +
    (filters.priority.length > 0 ? 1 : 0) +
    (filters.assignee ? 1 : 0) +
    (filters.projectId ? 1 : 0) +
    (filters.labelId ? 1 : 0) +
    (filters.updated ? 1 : 0)
  );
}

export function hasFilters(filters: SearchFilters) {
  return filterCount(filters) > 0;
}

function union<T>(a: readonly T[], b: readonly T[]) {
  return [...new Set([...a, ...b])];
}

/** Filters from the URL with those typed into the query: lists join, a typed single pick wins. */
export function mergeFilters(base: SearchFilters, typed: Partial<SearchFilters>): SearchFilters {
  return {
    status: union(base.status, typed.status ?? []),
    priority: union(base.priority, typed.priority ?? []),
    assignee: typed.assignee ?? base.assignee,
    projectId: typed.projectId ?? base.projectId,
    labelId: typed.labelId ?? base.labelId,
    updated: typed.updated ?? base.updated,
  };
}

/** The request fields for a set of filters. */
export function filterRequest(filters: SearchFilters): Partial<SearchRequest> {
  const request: Partial<SearchRequest> = {};
  if (filters.status.length) request.status = filters.status;
  if (filters.priority.length) request.priority = filters.priority;
  const assignee = filters.assignee;
  if (assignee === "none") request.assigneeAgentId = null;
  else if (assignee?.startsWith("agent:")) request.assigneeAgentId = assignee.slice("agent:".length);
  else if (assignee?.startsWith("user:")) request.assigneeUserId = assignee.slice("user:".length);
  if (filters.projectId) request.projectId = filters.projectId;
  if (filters.labelId) request.labelId = filters.labelId;
  if (filters.updated) request.updatedWithin = filters.updated;
  return request;
}

function toggledIn<T>(list: readonly T[], value: T) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** Ticks or unticks one value: lists toggle it, single picks take it or let it go. */
export function toggleFilter(filters: SearchFilters, dimension: FilterDimension, value: string): SearchFilters {
  const pick = (current: string | null) => (current === value ? null : value);
  switch (dimension) {
    case "status":
      return { ...filters, status: toggledIn(filters.status, value as IssueStatus) };
    case "priority":
      return { ...filters, priority: toggledIn(filters.priority, value as IssuePriority) };
    case "assignee":
      return { ...filters, assignee: pick(filters.assignee) };
    case "project":
      return { ...filters, projectId: pick(filters.projectId) };
    case "label":
      return { ...filters, labelId: pick(filters.labelId) };
    case "updated":
      return { ...filters, updated: pick(filters.updated) };
  }
}

export function isFilterOn(filters: SearchFilters, dimension: FilterDimension, value: string) {
  switch (dimension) {
    case "status":
      return filters.status.includes(value as IssueStatus);
    case "priority":
      return filters.priority.includes(value as IssuePriority);
    case "assignee":
      return filters.assignee === value;
    case "project":
      return filters.projectId === value;
    case "label":
      return filters.labelId === value;
    case "updated":
      return filters.updated === value;
  }
}

export function clearDimension(filters: SearchFilters, dimension: FilterDimension): SearchFilters {
  switch (dimension) {
    case "status":
      return { ...filters, status: [] };
    case "priority":
      return { ...filters, priority: [] };
    case "assignee":
      return { ...filters, assignee: null };
    case "project":
      return { ...filters, projectId: null };
    case "label":
      return { ...filters, labelId: null };
    case "updated":
      return { ...filters, updated: null };
  }
}

/** The dimension behind one of the API's filter keys, as `zeroResults` names them. */
export function dimensionOf(key: CompanySearchIssueFilterKey): FilterDimension {
  switch (key) {
    case "status":
      return "status";
    case "priority":
      return "priority";
    case "assigneeAgentId":
    case "assigneeUserId":
      return "assignee";
    case "projectId":
      return "project";
    case "labelId":
      return "label";
    case "updatedWithin":
    case "updatedAfter":
      return "updated";
  }
}

/** Names for the ids filters hold. Unknown ids fall back to something short. */
export type FilterNames = {
  agent: (id: string) => string | undefined;
  person: (id: string) => string | undefined;
  project: (id: string) => string | undefined;
  label: (id: string) => string | undefined;
  youId: string | null;
};

export function assigneeName(token: string, names: FilterNames) {
  if (token === "none") return "Unassigned";
  if (token.startsWith("agent:")) return names.agent(token.slice(6)) ?? "Unknown agent";
  const id = token.startsWith("user:") ? token.slice(5) : token;
  if (id === names.youId) return "You";
  return names.person(id) ?? "Someone";
}

export const DIMENSION_LABELS: Record<FilterDimension, string> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  project: "Project",
  label: "Label",
  updated: "Updated",
};

export type FilterChip = { dimension: FilterDimension; label: string; value: string };

/** One removable chip per dimension that's set, in the Filter menu's order (board S1). */
export function filterChips(filters: SearchFilters, names: FilterNames): FilterChip[] {
  const chips: FilterChip[] = [];
  const chip = (dimension: FilterDimension, value: string) => chips.push({ dimension, label: DIMENSION_LABELS[dimension], value });
  if (filters.status.length) chip("status", filters.status.map((status) => STATUS_META[status].label).join(", "));
  if (filters.priority.length) chip("priority", filters.priority.map((priority) => PRIORITY_META[priority].label).join(", "));
  if (filters.assignee) chip("assignee", assigneeName(filters.assignee, names));
  if (filters.projectId) chip("project", names.project(filters.projectId) ?? "Unknown project");
  if (filters.labelId) chip("label", names.label(filters.labelId) ?? "Unknown label");
  if (filters.updated) chip("updated", updatedLabel(filters.updated));
  return chips;
}

export type LoosenOption = {
  /** The dimension to drop, or null to clear every filter. */
  dimension: FilterDimension | null;
  label: string;
  /** How many results the search would have without it. */
  count: number;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function resultsLabel(count: number) {
  return plural(count, "result");
}

/**
 * Ways out of an empty, filtered search (board S3), from the response's `zeroResults`: drop one
 * filter, most results first, leaving out drops that find nothing; then clear every filter, when
 * that's more than dropping the only one. Nothing, when the query finds nothing even unfiltered.
 */
export function loosenOptions(zero: CompanySearchZeroResults, filters: SearchFilters, names: FilterNames): LoosenOption[] {
  if (zero.unfilteredTotal <= 0) return [];
  const chips = new Map(filterChips(filters, names).map((chip) => [chip.dimension, chip] as const));
  const seen = new Set<FilterDimension>();
  const options: LoosenOption[] = [];
  for (const suggestion of [...zero.loosenSuggestions].sort((a, b) => b.resultCount - a.resultCount)) {
    const dimension = dimensionOf(suggestion.filter);
    if (seen.has(dimension) || suggestion.resultCount <= 0) continue;
    seen.add(dimension);
    const chip = chips.get(dimension);
    options.push({
      dimension,
      label: `Remove ${chip ? `${chip.label}: ${chip.value}` : DIMENSION_LABELS[dimension]}`,
      count: suggestion.resultCount,
    });
  }
  if (filterCount(filters) > 1 || options.length === 0) {
    options.push({ dimension: null, label: "Clear every filter", count: zero.unfilteredTotal });
  }
  return options;
}
