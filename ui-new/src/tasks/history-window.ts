import type { ActivityEvent, IssueComment, IssueRecentComments } from "@paperclipai/shared";
import { createSignal } from "solid-js";
import type { RunForIssue } from "@/api/issues";
import { buildThread, type ThreadItem } from "./thread-model";

/*
 * The Activity section opens on small windows of a task's history, as the old UI does since the
 * 2026-10-26 sync (ui/src/hooks/useIssueHistoryWindow.ts and the activity and run queries in
 * ui/src/pages/IssueDetail.tsx), and reads the full history only when the reader asks for it:
 *
 * - Comments: `/recent-comments` answers the latest four, plus the latest from a person and the
 *   first instruction when the task has no description. Later refreshes catch up from the newest
 *   comment seen, a page at a time, so a burst of messages isn't lost between two refreshes.
 * - Activity: the latest 50 rows (`?view=recent`), and runs: the latest 2 (`?view=recent`). Both
 *   keep every row seen while the task is open.
 *
 * Each window knows the time from which it holds everything (`from`, null when it holds it all).
 * The thread shows changes and runs from the latest of those times on, with a gap ("Show earlier
 * activity") where the windows stop; comments from before it (the first instruction, the latest
 * from a person) stay above the gap.
 */

/** `/recent-comments` holds the latest this many comments in a row, and others picked out. */
export const RECENT_COMMENTS_IN_A_ROW = 4;
/** `/activity?view=recent` answers at most this many rows. */
export const RECENT_ACTIVITY_LIMIT = 50;
/** `/runs?view=recent` answers at most this many runs. */
export const RECENT_RUNS_LIMIT = 2;
/** Catching up reads comments in pages of this size. */
export const CATCH_UP_PAGE = 50;

export type CommentWindow = {
  /** Oldest first. */
  comments: IssueComment[];
  latestCommentId: string | null;
  /** Older comments exist than the window holds. */
  hasMore: boolean;
  /** From this time on the window holds every comment; null when it holds them all. */
  from: string | null;
};

export type ActivityWindow = { events: ActivityEvent[]; from: string | null };

export type RunWindow = { runs: RunForIssue[]; from: string | null };

const time = (value: string | Date) => new Date(value).getTime();

/** Comments from several windows, each once (the later window's copy wins), oldest first. */
export function mergeComments(...windows: readonly (readonly IssueComment[])[]): IssueComment[] {
  return [...new Map(windows.flat().map((comment) => [comment.id, comment] as const)).values()].sort(
    (a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Where a `/recent-comments` answer starts holding every comment: its fourth newest, when older ones exist. */
function snapshotFrom(snapshot: IssueRecentComments): string | null {
  if (!snapshot.hasMore) return null;
  const newest = [...snapshot.comments].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const edge = newest[Math.min(RECENT_COMMENTS_IN_A_ROW, newest.length) - 1];
  return edge ? new Date(edge.createdAt).toISOString() : null;
}

/**
 * The comment window after a `/recent-comments` answer. The first answer is the window. Later ones
 * catch up from the newest comment seen, reading `fetchAfter(cursor)` (oldest first, after the
 * cursor) until the answer's newest comment, and keep every comment seen. Cancelling a queued
 * message deletes its comment, which can be the cursor: then it tries again from the comment before,
 * then from the start, as the old UI does. Comments the answer proves deleted (newer than its run of
 * four, yet missing from it) are dropped.
 */
export async function catchUpComments(
  previous: CommentWindow | undefined,
  snapshot: IssueRecentComments,
  fetchAfter: (cursor: string | null) => Promise<IssueComment[]>,
  signal?: AbortSignal,
): Promise<CommentWindow> {
  const from = snapshotFrom(snapshot);
  if (!previous) {
    return { comments: mergeComments(snapshot.comments), latestCommentId: snapshot.latestCommentId, hasMore: snapshot.hasMore, from };
  }
  let cursor = previous.latestCommentId;
  const incoming: IssueComment[] = [];
  let before: string | null = null;
  for (const comment of previous.comments) if (comment.id !== cursor) before = comment.id;
  const anchors: (string | null)[] = [before, null];
  while (cursor !== snapshot.latestCommentId) {
    const page = await fetchAfter(cursor);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (page.length === 0) {
      if (cursor && anchors.length > 0) {
        cursor = anchors.shift() ?? null;
        continue;
      }
      break;
    }
    incoming.push(...page);
    const next = page[page.length - 1]!.id;
    if (next === cursor) break;
    cursor = next;
    if (page.length < CATCH_UP_PAGE || page.some((comment) => comment.id === snapshot.latestCommentId)) break;
  }
  const answered = new Set([...snapshot.comments, ...incoming].map((comment) => comment.id));
  const edge = from === null ? -Infinity : time(from);
  const kept = previous.comments.filter((comment) => answered.has(comment.id) || time(comment.createdAt) < edge);
  return {
    comments: mergeComments(kept, incoming, snapshot.comments),
    latestCommentId: incoming[incoming.length - 1]?.id ?? snapshot.latestCommentId,
    hasMore: previous.hasMore,
    from: previous.from,
  };
}

/** The activity window after a `?view=recent` answer (newest first): every row seen, from the first answer's oldest on. */
export function mergeActivity(previous: ActivityWindow | undefined, recent: readonly ActivityEvent[]): ActivityWindow {
  const oldest = recent[recent.length - 1];
  const from = previous ? previous.from : recent.length >= RECENT_ACTIVITY_LIMIT && oldest ? new Date(oldest.createdAt).toISOString() : null;
  const events = [...new Map([...(previous?.events ?? []), ...recent].map((event) => [event.id, event] as const)).values()];
  return { events, from };
}

/** Where a run sits in the thread: when it ended, else started, else was queued. */
export function runAt(run: Pick<RunForIssue, "finishedAt" | "startedAt" | "createdAt">) {
  return run.finishedAt ?? run.startedAt ?? run.createdAt;
}

const ACTIVE_RUN = new Set(["queued", "running", "scheduled_retry"]);

/**
 * The run window after a `?view=recent` answer (newest first): every run seen. A run that was going
 * and has dropped out of the latest two means several turns ended meanwhile (after a reconnect, say),
 * so the whole list is read once with `fetchAll`, as the old UI does.
 */
export async function mergeRuns(
  previous: RunWindow | undefined,
  recent: readonly RunForIssue[],
  fetchAll: () => Promise<RunForIssue[]>,
): Promise<RunWindow> {
  const seen = new Set(recent.map((run) => run.runId));
  if (previous?.runs.some((run) => ACTIVE_RUN.has(run.status) && !seen.has(run.runId))) {
    return { runs: await fetchAll(), from: null };
  }
  const oldest = recent[recent.length - 1];
  const from = previous ? previous.from : recent.length >= RECENT_RUNS_LIMIT && oldest ? new Date(runAt(oldest)).toISOString() : null;
  const runs = [...new Map([...(previous?.runs ?? []), ...recent].map((run) => [run.runId, run] as const)).values()];
  return { runs, from };
}

/** The latest of the windows' starting points, as a time, or null when every window holds it all. */
export function historyFrom(...froms: readonly (string | null | undefined)[]): number | null {
  const times = froms.filter((value): value is string => !!value).map(time);
  return times.length > 0 ? Math.max(...times) : null;
}

/** Where the loaded history stops, to load more. */
export type GapItem = { kind: "gap"; key: "gap" };

export type WindowItem = ThreadItem | GapItem;

const itemTime = (item: ThreadItem) => (item.kind === "lines" ? item.lines[0]!.at : item.at).getTime();

/**
 * The thread over windows of history (thread-model.ts's `buildThread`), with a gap where they stop:
 * changes, runs and settled requests from before `from` are held back, and comments from before it
 * show above the gap. With `from` null the history is whole and there's no gap.
 */
export function windowThread(input: Omit<Parameters<typeof buildThread>[0], "moreComments"> & { from: number | null }): WindowItem[] {
  const { from, ...rest } = input;
  if (from === null) return buildThread(rest);
  const items: WindowItem[] = buildThread({
    ...rest,
    events: rest.events.filter((event) => time(event.createdAt) >= from),
    runs: rest.runs.filter((run) => time(runAt(run)) >= from),
    requests: rest.requests?.filter((request) => request.state !== "settled" || request.createdAt.getTime() >= from),
  });
  const at = items.findIndex((item) => itemTime(item as ThreadItem) >= from);
  items.splice(at === -1 ? items.length : at, 0, { kind: "gap", key: "gap" });
  return items;
}

/*
 * Tasks whose full history the reader has asked for, kept for the session as the old UI keeps it,
 * so leaving the Activity section and coming back doesn't fold the history again.
 */
const [expandedTasks, setExpandedTasks] = createSignal<ReadonlySet<string>>(new Set());

export function historyExpanded(taskId: string) {
  return expandedTasks().has(taskId);
}

export function expandHistory(taskId: string) {
  if (!expandedTasks().has(taskId)) setExpandedTasks(new Set([...expandedTasks(), taskId]));
}
