import type {
  Approval,
  AttentionFeed,
  AttentionSourceKind,
  CompactIssue,
  InboxDismissal,
  Issue,
  StalledReviewDecisionAction,
  StalledReviewDecisionResponse,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The Inbox (board 14), as ui/src/api/attention.ts, inboxDismissals.ts, approvals.ts and issues.ts
 * call it:
 *
 * - The attention feed (`GET /companies/:id/attention`): every kind of request and alert as one
 *   ranked item shape. The Inbox reads it whole (`all`) with your cleared and snoozed items
 *   (`includeDismissed`), and sorts it into tabs itself.
 * - Clearing and snoozing are per person (`/companies/:id/inbox-dismissals`), keyed by the item's
 *   `dismissalKey`. Restoring deletes the entry.
 * - Keep (`/companies/:id/decision-retention/:sourceKind/:sourceId`): brings an item that went
 *   quiet past its retention days back from the aging shelf, and keeps it from being archived.
 * - One approval by id, for its request card, and the tasks it's linked to.
 * - A stalled review, one nobody can review: approve, request changes or send it back, as a person
 *   (`POST /issues/:id/stalled-review-decision`).
 * - Updates: the tasks you took part in, as the old Inbox's Mine tab lists them, with read state and
 *   the per-person inbox archive.
 */

/** Statuses the old Inbox's Mine tab lists (`INBOX_MINE_ISSUE_STATUSES` in the shared package). */
export const INBOX_TASK_STATUSES = "backlog,todo,in_progress,in_review,blocked,done";

/** How many of your tasks Updates reads, as the old Inbox's `INBOX_ISSUE_LIST_LIMIT`. */
export const INBOX_TASK_LIMIT = 200;

function taskParams(archived: boolean) {
  const params = new URLSearchParams({
    view: "compact",
    touchedByUserId: "me",
    status: INBOX_TASK_STATUSES,
    sortField: "updated",
    sortDir: "desc",
    includeRoutineExecutions: "true",
    limit: String(INBOX_TASK_LIMIT),
  });
  // Leaving the archive filter off lists archived tasks too; the Inbox diffs the two lists.
  if (!archived) params.set("inboxArchivedByUserId", "me");
  return params.toString();
}

export const inboxApi = {
  feed: (companyId: string, signal?: AbortSignal) =>
    api.get<AttentionFeed>(`/companies/${companyId}/attention?includeDismissed=true&all=true`, { signal }),

  clear: (companyId: string, itemKey: string) => api.post<InboxDismissal>(`/companies/${companyId}/inbox-dismissals`, { itemKey }),
  snooze: (companyId: string, itemKey: string, snoozedUntil: string) =>
    api.post<InboxDismissal>(`/companies/${companyId}/inbox-dismissals`, { itemKey, kind: "snooze", snoozedUntil }),
  restore: (companyId: string, itemKey: string) =>
    api.delete<void>(`/companies/${companyId}/inbox-dismissals/${encodeURIComponent(itemKey)}`),

  keep: (companyId: string, sourceKind: AttentionSourceKind, sourceId: string, keep: boolean) =>
    api.patch<{ keep: boolean }>(
      `/companies/${companyId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`,
      { keep },
    ),

  approval: (approvalId: string, signal?: AbortSignal) => api.get<Approval>(`/approvals/${approvalId}`, { signal }),
  /** The tasks an approval is linked to; the feed doesn't carry them. */
  approvalIssues: (approvalId: string, signal?: AbortSignal) => api.get<Issue[]>(`/approvals/${approvalId}/issues`, { signal }),

  decideStalledReview: (issueId: string, action: StalledReviewDecisionAction, note?: string) =>
    api.post<StalledReviewDecisionResponse>(`/issues/${issueId}/stalled-review-decision`, note ? { action, note } : { action }),

  /** Your tasks, minus the ones you archived from the inbox. */
  tasks: (companyId: string, signal?: AbortSignal) => api.get<CompactIssue[]>(`/companies/${companyId}/issues?${taskParams(false)}`, { signal }),
  /** Your tasks, archived ones included. */
  tasksWithArchived: (companyId: string, signal?: AbortSignal) =>
    api.get<CompactIssue[]>(`/companies/${companyId}/issues?${taskParams(true)}`, { signal }),
  markRead: (issueId: string) => api.post<{ id: string; lastReadAt: string }>(`/issues/${issueId}/read`, {}),
  markUnread: (issueId: string) => api.delete<{ id: string; removed: boolean }>(`/issues/${issueId}/read`),
  archive: (issueId: string) => api.post<{ id: string; archivedAt: string }>(`/issues/${issueId}/inbox-archive`, {}),
  unarchive: (issueId: string) => api.delete<unknown>(`/issues/${issueId}/inbox-archive`),
};
