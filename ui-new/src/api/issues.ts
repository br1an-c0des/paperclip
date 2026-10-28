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
  IssueRecentComments,
  IssueWorkProduct,
  ExecutionProjection,
  TaskInterruptionPresentation,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Tasks (issues), as ui/src/api/issues.ts uses them: the compact list behind the task views, one
 * task's full record, creating and updating tasks, retrying an interrupted one, attachments, labels,
 * and a small search for the palette and the new-task pickers.
 *
 * Opening a task reads small windows first, as the old UI does since the 2026-10-26 sync: the task
 * row alone (`?view=core`), the latest comments (`/recent-comments`), the latest 50 activity rows
 * and the latest 2 runs (`?view=recent`), and the facts behind the comments shown
 * (`?view=comment-inputs`). The full history is read when the reader asks for it.
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
  /** Only the tasks this agent took part in, as agent pages link to them (`?participantAgentId=`). */
  participantAgentId?: string;
  limit?: number;
  offset?: number;
};

function listParams(filters: IssueListFilters) {
  const params = new URLSearchParams({ view: "compact", sortField: "updated", sortDir: "desc" });
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.parentId) params.set("parentId", filters.parentId);
  if (filters.participantAgentId) params.set("participantAgentId", filters.participantAgentId);
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
  /**
   * The task row alone, without the project, goal, relations, documents and recovery state the full
   * read joins in. Enough for the thread and the composer, and much quicker to answer.
   */
  getCore: (ref: string, signal?: AbortSignal) => api.get<Issue>(`/issues/${encodeURIComponent(ref)}?view=core`, { signal }),
  update: (id: string, data: Record<string, unknown>) => api.patch<Issue>(`/issues/${id}`, data),
  /**
   * Asks for another attempt at an interrupted task (`POST /issues/:id/retry`). The idempotency key
   * makes a resent request land once; `observedRunId` is the run the viewer saw fail, and the server
   * answers `stale` when the task has moved on since.
   */
  retry: (id: string, body: { idempotencyKey: string; observedRunId: string | null }) =>
    api.post<TaskRetryReceipt>(`/issues/${id}/retry`, body),
  /**
   * Task search for pickers and the command palette (`?q=`). Chats are hidden tasks the search still
   * returns (decision 8); they're left out here, by the `conversationAgentId` full responses carry,
   * so a picker can't offer one as a task. The Search page shows them as chats.
   */
  search: async (companyId: string, filters: IssueSearch, signal?: AbortSignal) => {
    const qs = searchParams(filters);
    const found = await api.get<Issue[]>(`/companies/${companyId}/issues${qs ? `?${qs}` : ""}`, { signal });
    return found.filter((task) => !task.conversationAgentId);
  },
  create: (companyId: string, data: Record<string, unknown>) => api.post<Issue>(`/companies/${companyId}/issues`, data),
  uploadAttachment: (companyId: string, issueId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<IssueAttachment>(`/companies/${companyId}/issues/${issueId}/attachments`, form);
  },
  listLabels: (companyId: string) => api.get<IssueLabel[]>(`/companies/${companyId}/labels`),

  // The task panel's sections (boards 3 and 5, and the Runs and Workspace sections).
  /**
   * A page of comments, newest first (or oldest first with `order: "asc"`). `after` is the last
   * comment of the previous page.
   */
  listComments: (id: string, page: { limit: number; after?: string; order?: "asc" | "desc" }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ order: page.order ?? "desc", limit: String(page.limit) });
    if (page.after) params.set("after", page.after);
    return api.get<IssueComment[]>(`/issues/${id}/comments?${params}`, { signal });
  },
  /** Posts a comment. The client request id makes a retried post land once. */
  addComment: (id: string, body: string, clientRequestId: string) =>
    api.post<IssueComment>(`/issues/${id}/comments`, { body, clientRequestId }),
  /**
   * The cold-open window of comments: the latest four, plus the latest from a person and, when the
   * task has no description, the first instruction. `hasMore` says older comments exist.
   */
  recentComments: (id: string, signal?: AbortSignal) => api.get<IssueRecentComments>(`/issues/${id}/recent-comments`, { signal }),
  activity: (id: string, signal?: AbortSignal) => api.get<ActivityEvent[]>(`/issues/${id}/activity`, { signal }),
  /** The latest 50 activity rows, newest first. */
  recentActivity: (id: string, signal?: AbortSignal) => api.get<ActivityEvent[]>(`/issues/${id}/activity?view=recent`, { signal }),
  /**
   * What happened to some comments as they were sent (`issue.comment_added` and
   * `issue.queued_comment_steered` rows: stopped a run, reopened the task, steered a run), however
   * old. The server takes 100 ids a request.
   */
  commentInputs: async (id: string, commentIds: readonly string[], signal?: AbortSignal) => {
    const batches: Promise<ActivityEvent[]>[] = [];
    for (let start = 0; start < commentIds.length; start += 100) {
      const params = new URLSearchParams({ view: "comment-inputs", commentIds: commentIds.slice(start, start + 100).join(",") });
      batches.push(api.get<ActivityEvent[]>(`/issues/${id}/activity?${params}`, { signal }));
    }
    return (await Promise.all(batches)).flat();
  },
  runs: (id: string, signal?: AbortSignal) => api.get<RunForIssue[]>(`/issues/${id}/runs`, { signal }),
  /** The latest 2 runs, newest first. */
  recentRuns: (id: string, signal?: AbortSignal) => api.get<RunForIssue[]>(`/issues/${id}/runs?view=recent`, { signal }),
  costSummary: (id: string, signal?: AbortSignal) => api.get<IssueCostSummary>(`/issues/${id}/cost-summary`, { signal }),
  listDocuments: (id: string, signal?: AbortSignal) => api.get<IssueDocumentSummary[]>(`/issues/${id}/documents`, { signal }),
  getDocument: (id: string, key: string, signal?: AbortSignal) =>
    api.get<IssueDocument>(`/issues/${id}/documents/${encodeURIComponent(key)}`, { signal }),
  listAttachments: (id: string, signal?: AbortSignal) => api.get<IssueAttachment[]>(`/issues/${id}/attachments`, { signal }),
  deleteAttachment: (attachmentId: string) => api.delete<{ ok: true }>(`/attachments/${encodeURIComponent(attachmentId)}`),
  listWorkProducts: (id: string, signal?: AbortSignal) => api.get<IssueWorkProduct[]>(`/issues/${id}/work-products`, { signal }),
};

/** What `POST /issues/:id/retry` answers, as ui/src/api/issues.ts types it. */
export type TaskRetryReceipt = {
  requestId: string | null;
  accepted: boolean;
  stale: boolean;
  presentation: TaskInterruptionPresentation | null;
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
  /** What the run is doing or waiting on now. Its `nextAction` replaces the run's own when present. */
  execution?: ExecutionProjection | null;
  nextAction?: string | null;
};

/** The URL path of a task, under the company prefix. */
export function issuePath(prefix: string, issue: Pick<Issue, "id" | "identifier">) {
  return `/${prefix}/issues/${issue.identifier ?? issue.id}`;
}
