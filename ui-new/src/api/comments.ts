import type { Issue, IssueComment } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Posting from the composer, as ui/src/pages/IssueDetail.tsx does it:
 *
 * - A plain message is `POST /issues/:id/comments`. While the agent is running it waits in the
 *   queue for the next turn, unless `interrupt` stops the run.
 * - A message that also reassigns the task or changes its run settings goes through
 *   `PATCH /issues/:id` with `comment`, so both land in one step.
 *
 * The client request id makes a retried post land once.
 */

export type CommentPost = {
  body: string;
  clientRequestId: string;
  attachmentIds?: string[];
  /** Reopens a closed task. */
  reopen?: boolean;
  /** Stops the agent's current run and starts a new one with this message. */
  interrupt?: boolean;
};

export const commentsApi = {
  /** One comment on the task, or 404 when it isn't one of the task's (a `#comment-<id>` link checks first). */
  get: (issueId: string, commentId: string, signal?: AbortSignal) =>
    api.get<IssueComment>(`/issues/${issueId}/comments/${encodeURIComponent(commentId)}`, { signal }),
  post: (issueId: string, data: CommentPost) => api.post<IssueComment>(`/issues/${issueId}/comments`, data),
  /** `PATCH /issues/:id` with a comment; the response is the task with the comment it made. */
  updateWithComment: (issueId: string, data: Record<string, unknown>) =>
    api.patch<Issue & { comment?: IssueComment | null }>(`/issues/${issueId}`, data),
  /** Deletes your own comment; the thread keeps a "deleted" marker. */
  remove: (issueId: string, commentId: string) => api.delete<IssueComment>(`/issues/${issueId}/comments/${commentId}`),
};
