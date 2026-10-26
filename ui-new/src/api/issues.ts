import type {
  ActivityEvent,
  CompactIssue,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueCostSummary,
  IssueDocument,
  IssueDocumentSummary,
  IssueLabel,
  IssueWorkProduct,
} from "@paperclipai/shared";
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
  /** Tasks that routine runs created, which the server leaves out unless asked. The old list asks. */
  includeRoutineExecutions?: boolean;
  limit?: number;
  offset?: number;
};

function listParams(filters: IssueListFilters) {
  const params = new URLSearchParams({ view: "compact", sortField: "updated", sortDir: "desc" });
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.parentId) params.set("parentId", filters.parentId);
  if (filters.includeBlockedBy) params.set("includeBlockedBy", "true");
  if (filters.includeRoutineExecutions) params.set("includeRoutineExecutions", "true");
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

  // The task panel's sections (boards 3 and 5, and the Runs and Workspace sections).
  /** A page of comments, newest first. `after` is the last comment of the previous page. */
  listComments: (id: string, page: { limit: number; after?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ order: "desc", limit: String(page.limit) });
    if (page.after) params.set("after", page.after);
    return api.get<IssueComment[]>(`/issues/${id}/comments?${params}`, { signal });
  },
  /** Posts a comment. The client request id makes a retried post land once. */
  addComment: (id: string, body: string, clientRequestId: string) =>
    api.post<IssueComment>(`/issues/${id}/comments`, { body, clientRequestId }),
  activity: (id: string, signal?: AbortSignal) => api.get<ActivityEvent[]>(`/issues/${id}/activity`, { signal }),
  runs: (id: string, signal?: AbortSignal) => api.get<RunForIssue[]>(`/issues/${id}/runs`, { signal }),
  costSummary: (id: string, signal?: AbortSignal) => api.get<IssueCostSummary>(`/issues/${id}/cost-summary`, { signal }),
  listDocuments: (id: string, signal?: AbortSignal) => api.get<IssueDocumentSummary[]>(`/issues/${id}/documents`, { signal }),
  getDocument: (id: string, key: string, signal?: AbortSignal) =>
    api.get<IssueDocument>(`/issues/${id}/documents/${encodeURIComponent(key)}`, { signal }),
  listAttachments: (id: string, signal?: AbortSignal) => api.get<IssueAttachment[]>(`/issues/${id}/attachments`, { signal }),
  listWorkProducts: (id: string, signal?: AbortSignal) => api.get<IssueWorkProduct[]>(`/issues/${id}/work-products`, { signal }),
};

/**
 * One of a task's runs (`GET /issues/:id/runs`). The full type lives in the old UI
 * (ui/src/api/activity.ts, `RunForIssue`); these are the fields ui-new reads.
 */
export type RunForIssue = {
  runId: string;
  status: string;
  agentId: string;
  adapterType: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  invocationSource: string;
  errorCode?: string | null;
  error?: string | null;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  retryOfRunId?: string | null;
  scheduledRetryAt?: string | null;
  livenessState?: string | null;
  livenessReason?: string | null;
  lastUsefulActionAt?: string | null;
};

/** The URL path of a task, under the company prefix. */
export function issuePath(prefix: string, issue: Pick<Issue, "id" | "identifier">) {
  return `/${prefix}/issues/${issue.identifier ?? issue.id}`;
}
