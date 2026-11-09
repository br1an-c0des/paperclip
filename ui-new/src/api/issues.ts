import type {
  AcceptedPlanDecompositionSummary,
  ActivityEvent,
  CompactIssue,
  ExternalObjectMentionGroup,
  ExternalObjectSummary,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueCostSummary,
  IssueDocument,
  IssueDisplayStatus,
  IssueDocumentSummary,
  IssueAccessGrant,
  IssueAccessGrantSubjectType,
  IssueLabel,
  IssueRecoveryAction,
  IssueRecentComments,
  IssueWorkProduct,
  ExecutionProjection,
  TaskInterruptionPresentation,
  WorkspaceSourceInspection,
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

/**
 * `status` filters by the stored status; `displayStatus` by what tasks show, which tells Monitoring
 * (an in-progress task waiting on its monitor) apart from In progress. Both take a comma list.
 */
export type IssueSearch = { q?: string; limit?: number; status?: string; displayStatus?: string };

function searchParams(filters: IssueSearch) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  if (filters.displayStatus) params.set("displayStatus", filters.displayStatus);
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
  /** Tasks made from this one that aren't its subtasks, such as an agent's follow-ups (`?createdFromIssueId=`). */
  createdFromIssueId?: string;
  /** What tasks show, comma separated: tells Monitoring apart from In progress (`?displayStatus=`). */
  displayStatus?: string;
  /**
   * The server's order, most recently updated first unless asked: `created` since the 2026-11-03
   * sync. Paging in an order that doesn't move (created) keeps pages from shifting while they load.
   */
  sortField?: "updated" | "created";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function listParams(filters: IssueListFilters) {
  const params = new URLSearchParams({ view: "compact", sortField: filters.sortField ?? "updated", sortDir: filters.sortDir ?? "desc" });
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.parentId) params.set("parentId", filters.parentId);
  if (filters.createdFromIssueId) params.set("createdFromIssueId", filters.createdFromIssueId);
  if (filters.displayStatus) params.set("displayStatus", filters.displayStatus);
  if (filters.participantAgentId) params.set("participantAgentId", filters.participantAgentId);
  if (filters.includeBlockedBy) params.set("includeBlockedBy", "true");
  if (filters.includeRoutineExecutions) params.set("includeRoutineExecutions", "true");
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  return params.toString();
}

/** A page of the compact list. Pages past this size are fetched on demand. */
export const ISSUE_LIST_PAGE_SIZE = 500;

function listPage(companyId: string, filters: IssueListFilters, signal?: AbortSignal) {
  return api.get<CompactIssue[]>(`/companies/${companyId}/issues?${listParams(filters)}`, { signal });
}

async function allPages(companyId: string, filters: Omit<IssueListFilters, "limit" | "offset">, signal?: AbortSignal) {
  const tasks: CompactIssue[] = [];
  for (let offset = 0; ; offset += ISSUE_LIST_PAGE_SIZE) {
    const page = await listPage(companyId, { ...filters, limit: ISSUE_LIST_PAGE_SIZE, offset }, signal);
    tasks.push(...page);
    if (page.length < ISSUE_LIST_PAGE_SIZE) return tasks;
  }
}

/**
 * The compact list leaves out `displayStatus` (the server's `toCompactIssue` doesn't copy it, though
 * `CompactIssue` has it), so what an in-progress task shows would never reach the task lists:
 * Monitoring, and since the 2026-11-07 sync (upstream #19453) Todo, Blocked or In review when no
 * run is going. Only in-progress tasks are projected (`shownStatus` reads it only for them), so a
 * list with any is checked against the same scope's in-progress tasks read in full
 * (`?status=in_progress`, without `view`), whose rows carry `displayStatus`, and marked. Lists with
 * no task in progress, or rows that carry the field, need no second request, and a list filtered to
 * one display status already knows it.
 */
async function withMonitoring<T extends Pick<CompactIssue, "id" | "status">>(
  companyId: string,
  filters: IssueListFilters,
  tasks: T[],
  signal?: AbortSignal,
): Promise<T[]> {
  if (!tasks.some((task) => task.status === "in_progress") || tasks.some((task) => "displayStatus" in task)) return tasks;
  const only = filters.displayStatus && !filters.displayStatus.includes(",") ? (filters.displayStatus as IssueDisplayStatus) : null;
  const { limit: _limit, offset: _offset, displayStatus: _displayStatus, ...scope } = filters;
  const shown = only ? null : await inProgressShown(companyId, scope, signal);
  return tasks.map((task) => {
    const displayStatus = task.status === "in_progress" ? (only ?? shown?.get(task.id)) : undefined;
    return displayStatus && displayStatus !== "in_progress" ? { ...task, displayStatus } : task;
  });
}

/** What each in-progress task of a scope shows, from its full rows. */
async function inProgressShown(companyId: string, scope: IssueListFilters, signal?: AbortSignal) {
  const shown = new Map<string, IssueDisplayStatus>();
  for (let offset = 0; ; offset += ISSUE_LIST_PAGE_SIZE) {
    const params = new URLSearchParams(listParams({ ...scope, limit: ISSUE_LIST_PAGE_SIZE, offset }));
    params.delete("view");
    params.set("status", "in_progress");
    const page = await api.get<Pick<Issue, "id" | "displayStatus">[]>(`/companies/${companyId}/issues?${params}`, { signal });
    for (const row of page) if (row.displayStatus) shown.set(row.id, row.displayStatus);
    if (page.length < ISSUE_LIST_PAGE_SIZE) return shown;
  }
}

/**
 * The same marking for compact rows read some other way, such as the inbox's `/inbox/mine`, which
 * compacts its rows the same way: checked against the company's in-progress tasks.
 */
export function markMonitoring<T extends Pick<CompactIssue, "id" | "status">>(companyId: string, tasks: T[], signal?: AbortSignal) {
  return withMonitoring(companyId, { includeRoutineExecutions: true }, tasks, signal);
}

/** `GET /issues/:id/runs?runIds=` takes at most this many ids. */
export const RUN_IDS_PER_REQUEST = 100;

export const issuesApi = {
  list: async (companyId: string, filters: IssueListFilters, signal?: AbortSignal) =>
    withMonitoring(companyId, filters, await listPage(companyId, filters, signal), signal),
  /** Every page of a list, for views that group the whole set. */
  listAll: async (companyId: string, filters: Omit<IssueListFilters, "limit" | "offset">, signal?: AbortSignal) =>
    withMonitoring(companyId, filters, await allPages(companyId, filters, signal), signal),
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
  /**
   * Some of a task's runs by id (`?runIds=`, since the 2026-11-01 sync), in one request per 100,
   * instead of the whole list. Runs that aren't the task's are left out.
   */
  runsByIds: async (id: string, runIds: readonly string[], signal?: AbortSignal) => {
    const ids = [...new Set(runIds)];
    const batches: Promise<RunForIssue[]>[] = [];
    for (let start = 0; start < ids.length; start += RUN_IDS_PER_REQUEST) {
      const params = new URLSearchParams({ runIds: ids.slice(start, start + RUN_IDS_PER_REQUEST).join(",") });
      batches.push(api.get<RunForIssue[]>(`/issues/${id}/runs?${params}`, { signal }));
    }
    return (await Promise.all(batches)).flat();
  },
  /** The latest 2 runs, newest first. */
  recentRuns: (id: string, signal?: AbortSignal) => api.get<RunForIssue[]>(`/issues/${id}/runs?view=recent`, { signal }),
  costSummary: (id: string, signal?: AbortSignal) => api.get<IssueCostSummary>(`/issues/${id}/cost-summary`, { signal }),
  listDocuments: (id: string, signal?: AbortSignal) => api.get<IssueDocumentSummary[]>(`/issues/${id}/documents`, { signal }),
  getDocument: (id: string, key: string, signal?: AbortSignal) =>
    api.get<IssueDocument>(`/issues/${id}/documents/${encodeURIComponent(key)}`, { signal }),
  listAttachments: (id: string, signal?: AbortSignal) => api.get<IssueAttachment[]>(`/issues/${id}/attachments`, { signal }),
  deleteAttachment: (attachmentId: string) => api.delete<{ ok: true }>(`/attachments/${encodeURIComponent(attachmentId)}`),
  listWorkProducts: (id: string, signal?: AbortSignal) => api.get<IssueWorkProduct[]>(`/issues/${id}/work-products`, { signal }),
  /**
   * Makes (or finds) the reviewable document for a Markdown file a run produced: the server copies
   * the attachment into an `artifact-review-<workProductId>` document, which then takes comments on
   * its text like any other. It answers 413, 415 or 422 when the file can't be read as Markdown.
   */
  ensureReviewDocument: (id: string, workProductId: string) =>
    api.post<IssueDocument>(`/issues/${id}/work-products/${encodeURIComponent(workProductId)}/review-document`, {}),
  /** The plan revisions that were accepted and turned into subtasks, with the subtasks they made. */
  acceptedPlanDecompositions: (id: string, signal?: AbortSignal) =>
    api.get<AcceptedPlanDecompositionSummary[]>(`/issues/${id}/accepted-plan-decompositions`, { signal }),
  /**
   * Settles the task's active recovery action (`activeRecoveryAction`): `restored` puts the task in
   * the status given, `false_positive` (board only) dismisses the action as raised in error.
   */
  resolveRecoveryAction: (
    id: string,
    data: { actionId: string; outcome: "restored" | "false_positive"; sourceIssueStatus: "todo" | "done" | "in_review"; resolutionNote?: string | null },
  ) => api.post<{ issue: Issue; recoveryAction: IssueRecoveryAction }>(`/issues/${id}/recovery-actions/resolve`, data),
  /**
   * The task's recovery actions, with the retained files of one failed run inspected
   * (`inspectSourceRunId`, `inspectSourceActionId`): whether its recorded source is still the one
   * the action names. Recover saved files reads it before and after asking (since the 2026-11-05
   * sync, upstream #18848).
   */
  recoveryActions: (id: string, source: { runId: string; actionId: string }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ inspectSourceRunId: source.runId, inspectSourceActionId: source.actionId });
    return api.get<RecoveryActionsInspection>(`/issues/${id}/recovery-actions?${query}`, { signal });
  },
  /**
   * Asks the server to preserve a failed run's retained files (202). The worker stops the run,
   * copies the files back and verifies them; this only queues it. `idempotencyKey` is saved before
   * the request and kept, so a lost answer resends the same one.
   */
  recoverWorkspace: (id: string, data: { actionId: string; runId: string; idempotencyKey: string }) =>
    api.post<{ actionId: string; status: string }>(`/issues/${id}/recovery-actions/recover-workspace`, data),

  // Who can see a private task (the share sheet).
  /**
   * Everyone with access and why: explicit grants, access through assignment or the project, and
   * access inherited from a private parent, each with the subject's name and avatar.
   */
  accessGrants: (id: string, signal?: AbortSignal) => api.get<IssueAccessGrant[]>(`/issues/${id}/access-grants`, { signal }),
  /** Shares the task, and its subtasks, with a person or an agent. */
  grantAccess: (id: string, subject: { subjectType: IssueAccessGrantSubjectType; subjectId: string }) =>
    api.post<IssueAccessGrant>(`/issues/${id}/access-grants`, subject),
  revokeAccess: (id: string, grantId: string) => api.post<IssueAccessGrant>(`/issues/${id}/access-grants/${encodeURIComponent(grantId)}/revoke`, {}),

  // External objects (`enableExternalObjects`): things outside Paperclip a task mentions, such as
  // pull requests and tickets, with their live status from the plugin that tracks them.
  externalObjects: (id: string, signal?: AbortSignal) => api.get<ExternalObjectMentionGroup[]>(`/issues/${id}/external-objects`, { signal }),
  /** Each task's external objects summed up, for the list's filter. The server takes 1,000 ids a request. */
  externalObjectSummaries: async (companyId: string, issueIds: readonly string[], signal?: AbortSignal) => {
    const batches: Promise<{ summaries: Record<string, ExternalObjectSummary> }>[] = [];
    for (let start = 0; start < issueIds.length; start += 1000) {
      batches.push(
        api.post<{ summaries: Record<string, ExternalObjectSummary> }>(
          `/companies/${companyId}/issues/external-object-summaries`,
          { issueIds: issueIds.slice(start, start + 1000) },
          { signal },
        ),
      );
    }
    return Object.assign({}, ...(await Promise.all(batches)).map((batch) => batch.summaries)) as Record<string, ExternalObjectSummary>;
  },
};

/** What `POST /issues/:id/retry` answers, as ui/src/api/issues.ts types it. */
/** `GET /issues/:id/recovery-actions` with a run's source inspected. */
export type RecoveryActionsInspection = {
  active: IssueRecoveryAction | null;
  actions: IssueRecoveryAction[];
  sourceInspection?: WorkspaceSourceInspection;
};

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
