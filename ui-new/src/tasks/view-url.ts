import type { IssueStatus } from "@paperclipai/shared";
import { GROUP_BY_OPTIONS, type GroupBy, type TaskFilters, type TaskViewState } from "./view-state";

/*
 * What a task list's URL says about the view, so a link reproduces it. The old list's parameters
 * (ui/src/pages/Issues.tsx):
 *
 * - `q`: the search term. The search box keeps it up to date as you type.
 * - `assignee`: an agent's id, as agent pages link to their tasks. `me` (or the old `__me`) is you,
 *   `none` (or `__unassigned`) is no one; `agent:<id>` and `user:<id>` work too.
 * - `workspace`: a workspace id, repeatable, as workspace pages link to their tasks.
 * - `participantAgentId`: tasks an agent took part in. The server filters those
 *   (`GET /api/companies/:companyId/issues?participantAgentId=`), so TasksView asks for them.
 * - `view`: the old Organization views, as status presets: `all`, `active`, `backlog`, `done`.
 * - `group`: a grouping, such as `case`, where the old case list's links land (routes/Legacy.tsx).
 *
 * The pre-filters (and the grouping) replace the view's own when the page opens with them. The open task
 * (`task`, `section`) also lives in the URL, but that's TasksView's.
 */

/** The old Organization views (ui/src/lib/task-views.ts), by their `?view=` keys. */
export const STATUS_PRESETS: Record<string, IssueStatus[]> = {
  all: [],
  active: ["todo", "in_progress", "in_review", "blocked"],
  backlog: ["backlog"],
  done: ["done", "cancelled"],
};

export type ListUrl = {
  search: string;
  /** Filters the URL sets, replacing the view's own for those fields. */
  filters: Partial<Pick<TaskFilters, "assignees" | "workspaces" | "statuses">>;
  participantAgentId: string | null;
  /** A grouping the URL asks for, replacing the view's. */
  groupBy: GroupBy | null;
};

function assigneeFrom(value: string, youId: string | null): string | null {
  if (value === "me" || value === "__me") return youId ? `user:${youId}` : null;
  if (value === "none" || value === "__unassigned") return "none";
  if (value.startsWith("agent:") || value.startsWith("user:")) return value;
  return `agent:${value}`;
}

export function parseListUrl(search: string | URLSearchParams, youId: string | null = null): ListUrl {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const filters: ListUrl["filters"] = {};
  const assignees = params
    .getAll("assignee")
    .filter(Boolean)
    .flatMap((value) => assigneeFrom(value, youId) ?? []);
  if (assignees.length > 0) filters.assignees = assignees;
  const workspaces = params.getAll("workspace").filter(Boolean);
  if (workspaces.length > 0) filters.workspaces = workspaces;
  const preset = STATUS_PRESETS[params.get("view") ?? ""];
  if (preset) filters.statuses = [...preset];
  return {
    search: params.get("q") ?? "",
    filters,
    participantAgentId: params.get("participantAgentId") || null,
    groupBy: GROUP_BY_OPTIONS.some((option) => option.value === params.get("group")) ? (params.get("group") as GroupBy) : null,
  };
}

/** The view with the URL's pre-filters and grouping in place of its own, or the view itself when there are none. */
export function withUrlFilters(state: TaskViewState, filters: ListUrl["filters"], groupBy: GroupBy | null = null): TaskViewState {
  if (Object.keys(filters).length === 0 && (!groupBy || groupBy === state.groupBy)) return state;
  return { ...state, ...(groupBy ? { groupBy } : {}), filters: { ...state.filters, ...filters } };
}

/** The pre-filter parameters, cleared, for "Clear filters" to leave the URL saying what the view shows. */
export const PREFILTER_PARAMS = { assignee: undefined, workspace: undefined, view: undefined } as const;
