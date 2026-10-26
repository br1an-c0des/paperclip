import type { CompactIssue, Issue, IssueAttachment, IssueLabel } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Tasks (issues), as ui/src/api/issues.ts uses them: the compact list behind the task views, one
 * task's full record, creating and updating tasks, attachments, labels, and a small search for the
 * palette and the new-task pickers.
 */

export type IssueSearch = { q?: string; limit?: number; status?: string };

function searchParams(filters: IssueSearch) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

/** The list filters the task views use, a subset of the old UI's `IssueListFilters`. */
export type IssueListFilters = {
  projectId?: string;
  parentId?: string;
  includeBlockedBy?: boolean;
  limit?: number;
  offset?: number;
};

function listParams(filters: IssueListFilters) {
  const params = new URLSearchParams({ view: "compact", sortField: "updated", sortDir: "desc" });
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.parentId) params.set("parentId", filters.parentId);
  if (filters.includeBlockedBy) params.set("includeBlockedBy", "true");
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  return params.toString();
}

/** A page of the compact list. Pages past this size are fetched on demand. */
export const ISSUE_LIST_PAGE_SIZE = 500;

export const issuesApi = {
  list: (companyId: string, filters: IssueListFilters, signal?: AbortSignal) =>
    api.get<CompactIssue[]>(`/companies/${companyId}/issues?${listParams(filters)}`, { signal }),
  /** Every page of a list, for views that group the whole set. */
  listAll: async (companyId: string, filters: Omit<IssueListFilters, "limit" | "offset">, signal?: AbortSignal) => {
    const tasks: CompactIssue[] = [];
    for (let offset = 0; ; offset += ISSUE_LIST_PAGE_SIZE) {
      const page = await issuesApi.list(companyId, { ...filters, limit: ISSUE_LIST_PAGE_SIZE, offset }, signal);
      tasks.push(...page);
      if (page.length < ISSUE_LIST_PAGE_SIZE) return tasks;
    }
  },
  /** One task by id or identifier (`TRA-41`), with its project, goal, relations and documents. */
  get: (ref: string, signal?: AbortSignal) => api.get<Issue>(`/issues/${encodeURIComponent(ref)}`, { signal }),
  update: (id: string, data: Record<string, unknown>) => api.patch<Issue>(`/issues/${id}`, data),
  search: (companyId: string, filters: IssueSearch, signal?: AbortSignal) => {
    const qs = searchParams(filters);
    return api.get<Issue[]>(`/companies/${companyId}/issues${qs ? `?${qs}` : ""}`, { signal });
  },
  create: (companyId: string, data: Record<string, unknown>) => api.post<Issue>(`/companies/${companyId}/issues`, data),
  uploadAttachment: (companyId: string, issueId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<IssueAttachment>(`/companies/${companyId}/issues/${issueId}/attachments`, form);
  },
  listLabels: (companyId: string) => api.get<IssueLabel[]>(`/companies/${companyId}/labels`),
};

/** The URL path of a task, under the company prefix. */
export function issuePath(prefix: string, issue: Pick<Issue, "id" | "identifier">) {
  return `/${prefix}/issues/${issue.identifier ?? issue.id}`;
}
