import type { IssueQueuedCommentQueue } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Messages waiting for an agent's next turn (`/issues/:id/queued-comments`), as ui/src/api/issues.ts
 * calls them. Every change echoes the queue's id and opaque revision, so a stale tab can't overwrite
 * a newer queue; the server answers 409 when they've moved on. Each call returns the new queue.
 */

type Version = { queueId: string; revision: string };

export const queuedCommentsApi = {
  get: (issueId: string, signal?: AbortSignal) => api.get<IssueQueuedCommentQueue>(`/issues/${issueId}/queued-comments`, { signal }),
  edit: (issueId: string, commentId: string, data: Version & { body: string }) =>
    api.patch<IssueQueuedCommentQueue>(`/issues/${issueId}/queued-comments/${commentId}`, data),
  reorder: (issueId: string, data: Version & { orderedCommentIds: string[] }) =>
    api.put<IssueQueuedCommentQueue>(`/issues/${issueId}/queued-comments/order`, data),
  /** Sends one queued message into the run that's going now. */
  steer: (issueId: string, commentId: string, data: Version & { targetRunId: string }) =>
    api.post<IssueQueuedCommentQueue>(`/issues/${issueId}/queued-comments/${commentId}/steer`, data),
  /** Stops the current run; the queued messages start the next one. */
  interrupt: (issueId: string, data: Version & { targetRunId: string | null }) =>
    api.post<IssueQueuedCommentQueue>(`/issues/${issueId}/queued-comments/interrupt`, data),
  discard: (issueId: string, commentId: string, data: Version) =>
    api.delete<IssueQueuedCommentQueue>(`/issues/${issueId}/queued-comments/${commentId}`, data),
};
