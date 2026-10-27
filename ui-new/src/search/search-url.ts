import type { CompanySearchScope, CompanySearchSort, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { EMPTY_FILTERS, type SearchFilters } from "./filters";

/*
 * The Search page's state lives in its URL (`/:prefix/search`), so links, reloads and Back work:
 * the query as typed (`q`, typed filters included), the kind (`scope`), the filters and the sort.
 * The parameter names and values are the old UI's (ui/src/pages/Search.tsx), which are also the
 * API's: `scope=issues`, repeated `status=`, `assigneeAgentId=` (`null` for unassigned),
 * `assigneeUserId=`, `projectId=`, `labelId=`, `updatedWithin=`, `sort=`. Defaults are left out.
 */

export type SearchState = {
  q: string;
  scope: CompanySearchScope;
  filters: SearchFilters;
  sort: CompanySearchSort;
};

export const SEARCH_SCOPES: readonly CompanySearchScope[] = ["all", "issues", "comments", "documents", "artifacts", "agents", "projects"];
export const SEARCH_SORTS: readonly CompanySearchSort[] = ["relevance", "updated", "created", "priority"];

export const SORT_LABELS: Record<CompanySearchSort, string> = {
  relevance: "Relevance",
  updated: "Recently updated",
  created: "Newest",
  priority: "Priority",
};

const WINDOW = /^[1-9]\d{0,2}(h|d|w|m)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_SEARCH_STATE: SearchState = { q: "", scope: "all", filters: EMPTY_FILTERS, sort: "relevance" };

export function isSearchScope(value: string | null | undefined): value is CompanySearchScope {
  return !!value && (SEARCH_SCOPES as readonly string[]).includes(value);
}

function listOf<T extends string>(params: URLSearchParams, key: string, allowed: readonly string[]): T[] {
  const values = params.getAll(key).flatMap((value) => value.split(","));
  return [...new Set(values.filter((value) => allowed.includes(value)))] as T[];
}

export function readSearchState(search: string | URLSearchParams): SearchState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const scope = params.get("scope");
  const sort = params.get("sort");
  const agent = params.get("assigneeAgentId");
  const user = params.get("assigneeUserId");
  const projectId = params.get("projectId");
  const labelId = params.get("labelId");
  const updated = params.get("updatedWithin");
  return {
    q: params.get("q") ?? "",
    scope: isSearchScope(scope) ? scope : "all",
    sort: sort && (SEARCH_SORTS as readonly string[]).includes(sort) ? (sort as CompanySearchSort) : "relevance",
    filters: {
      status: listOf<IssueStatus>(params, "status", Object.keys(STATUS_META)),
      priority: listOf<IssuePriority>(params, "priority", Object.keys(PRIORITY_META)),
      assignee: agent === "null" ? "none" : agent ? `agent:${agent}` : user ? `user:${user}` : null,
      projectId: projectId && UUID.test(projectId) ? projectId : null,
      labelId: labelId && UUID.test(labelId) ? labelId : null,
      updated: updated && WINDOW.test(updated) ? updated : null,
    },
  };
}

/** The query string for a state, without the `?`; empty for the defaults. */
export function searchQuery(state: Partial<SearchState>): string {
  const params = new URLSearchParams();
  const filters = state.filters ?? EMPTY_FILTERS;
  if (state.q) params.set("q", state.q);
  if (state.scope && state.scope !== "all") params.set("scope", state.scope);
  for (const status of filters.status) params.append("status", status);
  for (const priority of filters.priority) params.append("priority", priority);
  const assignee = filters.assignee;
  if (assignee === "none") params.set("assigneeAgentId", "null");
  else if (assignee?.startsWith("agent:")) params.set("assigneeAgentId", assignee.slice(6));
  else if (assignee?.startsWith("user:")) params.set("assigneeUserId", assignee.slice(5));
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.labelId) params.set("labelId", filters.labelId);
  if (filters.updated) params.set("updatedWithin", filters.updated);
  if (state.sort && state.sort !== "relevance") params.set("sort", state.sort);
  return params.toString();
}

/** The Search page for a company, such as `/TES/search?q=login`. */
export function searchPath(prefix: string, state: Partial<SearchState> = {}) {
  const query = searchQuery(state);
  return `/${prefix}/search${query ? `?${query}` : ""}`;
}
