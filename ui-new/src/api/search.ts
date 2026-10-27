import type { CompanySearchResponse, CompanySearchScope, CompanySearchSort, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Company search, as ui/src/api/search.ts uses it: one request returns the ranked results for a
 * scope, the counts per kind (`countsByType`), the task facet counts (`filterOptionCounts`) and,
 * when filters empty the page, the ways to loosen them (`zeroResults`).
 *
 * The task filters narrow every task-shaped kind (tasks, comments, documents, files). Status and
 * priority take several values; assignee, project, label and the updated window take one. The
 * server allows 60 searches a minute per person, a limit of at most 50 and an offset of at most 200.
 */

export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_MAX_OFFSET = 200;

export type SearchRequest = {
  q: string;
  scope?: CompanySearchScope;
  limit?: number;
  offset?: number;
  status?: readonly IssueStatus[];
  priority?: readonly IssuePriority[];
  /** An agent's id, or null for unassigned tasks. */
  assigneeAgentId?: string | null;
  assigneeUserId?: string;
  projectId?: string;
  labelId?: string;
  /** "24h", "7d", "30d" or "90d" (the server also takes any `<n>h|d|w|m`). */
  updatedWithin?: string;
  sort?: CompanySearchSort;
};

export function searchQueryString(request: SearchRequest) {
  const params = new URLSearchParams();
  params.set("q", request.q);
  if (request.scope && request.scope !== "all") params.set("scope", request.scope);
  if (request.limit !== undefined) params.set("limit", String(request.limit));
  if (request.offset) params.set("offset", String(request.offset));
  for (const status of request.status ?? []) params.append("status", status);
  for (const priority of request.priority ?? []) params.append("priority", priority);
  if (request.assigneeAgentId !== undefined) params.set("assigneeAgentId", request.assigneeAgentId ?? "null");
  if (request.assigneeUserId) params.set("assigneeUserId", request.assigneeUserId);
  if (request.projectId) params.set("projectId", request.projectId);
  if (request.labelId) params.set("labelId", request.labelId);
  if (request.updatedWithin) params.set("updatedWithin", request.updatedWithin);
  if (request.sort && request.sort !== "relevance") params.set("sort", request.sort);
  return params.toString();
}

export const searchApi = {
  search: (companyId: string, request: SearchRequest, signal?: AbortSignal) =>
    api.get<CompanySearchResponse>(`/companies/${encodeURIComponent(companyId)}/search?${searchQueryString(request)}`, {
      signal,
    }),
};
