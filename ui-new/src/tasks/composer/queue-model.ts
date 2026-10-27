import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { ApiError } from "@/api/client";

/*
 * Queued messages (steering/*): what each waiting message offers, after
 * ui/src/components/task-chat/TaskChatQueuedMessages.tsx.
 *
 * - While a run is going, a message can be steered into it, if the runner supports steering.
 *   Legacy runners, and answers that need a fresh session, interrupt the run instead.
 * - Messages the agent hasn't seen can be edited, moved and cancelled. Answers to a request card
 *   are fixed: they can't be edited or moved.
 * - Steering or interrupting takes messages out of the queue at once, before the server confirms,
 *   so a poll that still has them doesn't make them flicker back.
 */

export type QueueAction = "steer" | "interrupt" | "edit" | "discard" | "move";

export type RowDelivery = { action: "steer" | "interrupt"; enabled: boolean; hint: string } | null;

/** Steer or Interrupt for one message, while a run is going; null when there's no run to reach. */
export function rowDelivery(queue: IssueQueuedCommentQueue, entry: IssueQueuedCommentEntry): RowDelivery {
  if (!queue.targetRunId) return null;
  if (queue.protocol === "legacy" || entry.source?.requiresFreshSession) {
    return { action: "interrupt", enabled: !!queue.queueId, hint: "Stop the current run and start the next one with the queued messages" };
  }
  switch (queue.steeringDisposition) {
    case "available":
      return { action: "steer", enabled: !!queue.queueId, hint: "Send this message into the run that's going now" };
    case "unsupported":
      return { action: "steer", enabled: false, hint: "This agent's runner can't take messages mid-run" };
    default:
      return { action: "steer", enabled: false, hint: "Steering isn't available right now. Try again in a moment" };
  }
}

/** Fixed answers to a request card can't be edited or moved. */
export function isFixed(entry: IssueQueuedCommentEntry) {
  return entry.source?.kind === "interaction";
}

/** The entries still to show, without those already being delivered. */
export function visibleEntries(queue: IssueQueuedCommentQueue | null | undefined, delivering: ReadonlySet<string>) {
  return (queue?.entries ?? []).filter((entry) => !delivering.has(entry.comment.id)).sort((a, b) => a.position - b.position);
}

/** The new order after moving one message up (-1) or down (+1), or null when it can't move. */
export function moveEntry(entries: readonly IssueQueuedCommentEntry[], commentId: string, delta: -1 | 1): string[] | null {
  if (entries.some(isFixed)) return null;
  const from = entries.findIndex((entry) => entry.comment.id === commentId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= entries.length) return null;
  const ids = entries.map((entry) => entry.comment.id);
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return ids;
}

/** "1 message queued", "3 messages queued". */
export function queuedSummary(count: number) {
  return `${count} message${count === 1 ? "" : "s"} queued`;
}

/** The first line of a message, for the queue row. */
export function preview(body: string, max = 140) {
  const line = body.split("\n").find((part) => part.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || typeof error.body !== "object" || error.body === null) return null;
  const body = error.body as { code?: unknown; details?: { code?: unknown } };
  if (typeof body.code === "string") return body.code;
  return typeof body.details?.code === "string" ? body.details.code : null;
}

/** What to say when a queue action fails, after the old UI's messages. */
export function queueErrorMessage(error: unknown, action: QueueAction) {
  const code = errorCode(error);
  if (code === "queued_comment_already_dispatching") return "Too late: this message is already being sent.";
  if (code === "queued_comment_revision_conflict" || (error instanceof ApiError && error.status === 409)) {
    return "The queue changed in another tab. It's been refreshed; try again.";
  }
  switch (action) {
    case "steer":
      return "Couldn't steer. The message is still queued.";
    case "interrupt":
      return "Couldn't interrupt. The messages are still queued.";
    case "edit":
      return "Couldn't save the edit. The message is unchanged.";
    case "move":
      return "Couldn't move it. The previous order is back.";
    default:
      return "Couldn't cancel. The message is still queued.";
  }
}
