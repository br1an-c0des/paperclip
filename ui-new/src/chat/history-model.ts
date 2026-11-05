import type { IssueComment, IssueRecentComments } from "@paperclipai/shared";

/*
 * The chat's message history, newest first, in pages (upstream #18358, as
 * ui/src/hooks/useConversationHistoryPages.ts reads it):
 *
 * - The first page is the chat's 20 newest messages, from `GET /issues/:id/recent-comments`. For a
 *   chat the server answers a contiguous window with `oldestCommentId` and `hasMore`.
 * - Each earlier page is 50 messages older than the oldest loaded
 *   (`GET /issues/:id/comments?order=desc&after=<oldest>`), read as the reader scrolls up.
 * - A server from before #18358 answers recent-comments with a task's cold-open window instead (a
 *   few latest messages plus the first instruction), which has gaps. Without `oldestCommentId` the
 *   first page is read as an ordinary page of 20.
 *
 * A refetch (a live event, the reconnect poll) rereads every page from the newest, each from the
 * oldest message of the page before it, so pages stay contiguous as new messages arrive.
 */

export const FIRST_PAGE = 20;
export const EARLIER_PAGE = 50;

export type HistoryPage = {
  /** Newest first, as the server returns them. */
  comments: IssueComment[];
  /** The oldest message on this page, to read earlier ones from; null when there are none. */
  next: string | null;
};

/** Whether recent-comments answered the chat's contiguous window (a server with #18358). */
export function isChatWindow(recent: IssueRecentComments) {
  return recent.oldestCommentId !== undefined;
}

/** The first page, from recent-comments. */
export function firstPage(recent: IssueRecentComments): HistoryPage {
  return { comments: recent.comments, next: recent.hasMore ? (recent.oldestCommentId ?? recent.comments.at(-1)?.id ?? null) : null };
}

/** A page from the comments list: a full page means there may be more. */
export function listPage(comments: IssueComment[], limit: number): HistoryPage {
  return { comments, next: comments.length < limit ? null : (comments.at(-1)?.id ?? null) };
}

/** Every loaded message, each once: a message that moved between pages mid-refetch isn't doubled. */
export function historyComments(pages: readonly HistoryPage[] | undefined): IssueComment[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: IssueComment[] = [];
  for (const page of pages) {
    for (const comment of page.comments) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
      out.push(comment);
    }
  }
  return out;
}

/** When the oldest loaded message was written, for the "before Oct 12" hint. */
export function oldestLoadedAt(pages: readonly HistoryPage[] | undefined): string | Date | null {
  const last = pages?.at(-1);
  return last?.comments.at(-1)?.createdAt ?? null;
}
