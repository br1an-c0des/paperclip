import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { ApiError } from "@/api/client";

/*
 * Queued messages (steering/*): what each waiting message offers, after
 * ui/src/components/task-chat/TaskChatQueuedMessages.tsx.
 *
 * - While a run is going, a message can be steered into it, if the runner supports steering.
 *   Legacy runners, runners that can't steer now, and answers that need a fresh session, interrupt
 *   the run instead. Before a run starts, the queue can be sent.
 * - Messages the agent hasn't seen can be edited, moved and cancelled. Answers to a request card
 *   are fixed receipts: they can't be edited or moved, and while one waits the queue isn't
 *   reordered, as in the old UI. A receipt never hides the messages queued after it.
 * - Steering or interrupting takes messages out of the queue at once, before the server confirms,
 *   so a poll that still has them doesn't make them flicker back.
 */

export type QueueAction = "steer" | "interrupt" | "edit" | "discard" | "move";

/**
 * Whether a message's Cancel can be sent. Before the server acknowledges a queue (no queue id yet)
 * you can still cancel your own saved message: the comment-cancel route finds its queue and checks
 * the author and dispatch state in one go (U117, upstream #20553). A chat message held at the daily
 * limit comes with `canDiscard: false`, since the outbox owns it.
 */
export function canCancel(entry: IssueQueuedCommentEntry) {
  return entry.canDiscard && !entry.comment.id.startsWith("optimistic-");
}

/**
 * What a row offers: Steer into the run that's going, Interrupt it to start the next one with the
 * queue, or Send a queue that waits for a run that hasn't started (the same request as Interrupt,
 * with no run to stop).
 */
export type RowDelivery = { action: "steer" | "interrupt" | "send"; enabled: boolean; hint: string } | null;

const INTERRUPT_HINT = "Stop the current run and start the next one with the queued messages";

/**
 * Steer, Interrupt or Send for one message, after the old UI's TaskChatQueuedMessages.tsx; null
 * when there's nothing to reach.
 *
 * Since the 2026-11-07 sync: where a native run can't take a message mid-run (steering
 * `unsupported` or `temporarily_unavailable`), Interrupt takes the place of a disabled Steer
 * (#19450), and the server treats it as a hand-off, not a failed attempt (#19633). A queue deferred
 * behind a run that hasn't started (no run to steer, `state: "deferred"`) offers Send, which the
 * server now accepts, keeping the messages queued until that run is done (#19370).
 */
export function rowDelivery(queue: IssueQueuedCommentQueue, entry: IssueQueuedCommentEntry): RowDelivery {
  if (!queue.targetRunId) {
    // A chat message held in the outbox (the agent's daily limit, #20292) has no queue to send:
    // the outbox delivers it when work can resume, and the strip's head says why it waits.
    if (!queue.queueId) return null;
    return queue.state === "deferred" ? { action: "send", enabled: true, hint: "Send the queued messages now" } : null;
  }
  if (queue.protocol === "legacy" || entry.source?.requiresFreshSession) {
    return { action: "interrupt", enabled: !!queue.queueId, hint: INTERRUPT_HINT };
  }
  switch (queue.steeringDisposition) {
    case "available":
      return { action: "steer", enabled: !!queue.queueId, hint: "Send this message into the run that's going now" };
    case "unsupported":
      return { action: "interrupt", enabled: !!queue.queueId, hint: `This agent's runner can't take messages mid-run. ${INTERRUPT_HINT}` };
    default:
      return { action: "interrupt", enabled: !!queue.queueId, hint: `Steering isn't available right now. ${INTERRUPT_HINT}` };
  }
}

/**
 * What the strip says after a Send the server kept queued (`state: "deferred"`, #19370): the
 * queue's own wait when it names one, else the old UI's words.
 */
export function deferredMessage(queue: Pick<IssueQueuedCommentQueue, "executionWait">) {
  return queue.executionWait?.message || "Messages are still queued. They'll send when the task is ready.";
}

/*
 * Automatic steering (U84, upstream #19970, ui/src/components/task-chat/queued-message-auto-steer.ts).
 * Your own plain follow-up waits a few seconds, "Sending in Xs" with Edit and Cancel, and is then
 * steered into the run that's going. Only while the runner can take it (`paperclip_runner_v1` with
 * steering `available`: Codex and Pi), never an answer to a request card, a message that needs a
 * fresh session, someone else's message, one being edited, or one not yet saved. Each revision of a
 * message gets one attempt, so a saved edit starts a new countdown and a failure isn't retried.
 * Steer and Interrupt stay as buttons.
 */

/** How long a queued follow-up waits before it's steered in, so its author can still edit or cancel it. */
export const AUTO_STEER_DELAY_MS = 5_000;

function time(value: Date | string | null | undefined) {
  return value == null ? Number.NaN : Date.parse(String(value));
}

/** The revision of a message that one automatic attempt is limited to. */
export function autoSteerKey(entry: IssueQueuedCommentEntry) {
  return `${entry.comment.id}:${String(entry.comment.updatedAt ?? entry.comment.createdAt)}`;
}

/** Whether this message may be steered in on its own now, after upstream's rules. */
export function autoSteerEligible(input: {
  queue: IssueQueuedCommentQueue;
  entry: IssueQueuedCommentEntry;
  cancelledIds: ReadonlySet<string>;
  attemptedKeys: ReadonlySet<string>;
  editingId: string | null;
}) {
  const { queue, entry } = input;
  return (
    queue.steeringDisposition === "available" &&
    !!queue.queueId &&
    !!queue.targetRunId &&
    queue.protocol === "paperclip_runner_v1" &&
    entry.canEdit &&
    entry.source?.kind !== "interaction" &&
    !entry.source?.requiresFreshSession &&
    !entry.comment.id.startsWith("optimistic-") &&
    !input.cancelledIds.has(entry.comment.id) &&
    !input.attemptedKeys.has(autoSteerKey(entry)) &&
    input.editingId !== entry.comment.id
  );
}

/**
 * When the message may be sent: the delay after its last change, but never sooner than the delay
 * after this view first offered it, so a message that waited while steering was unavailable still
 * shows its whole countdown before it goes.
 */
export function autoSteerDeadline(entry: IssueQueuedCommentEntry, firstOfferedAt: number, delayMs = AUTO_STEER_DELAY_MS) {
  const changed = Math.max(time(entry.comment.createdAt), time(entry.comment.updatedAt ?? entry.comment.createdAt));
  return Math.max(Number.isFinite(changed) ? changed : 0, firstOfferedAt) + delayMs;
}

/** The whole seconds a countdown shows, never below zero. */
export function secondsLeft(deadline: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Fixed answers to a request card can't be edited or moved. */
export function isFixed(entry: IssueQueuedCommentEntry) {
  return entry.source?.kind === "interaction";
}

/*
 * Messages a starting run's first turn takes (U127, upstream #20822, ui/src/pages/IssueDetail.tsx):
 * the queue lists them in `firstTurnCommentIds` while the run boots (a sandbox, say) and after its
 * first turn sealed them. They're sent, not waiting for Steer or Interrupt, so the strip leaves them
 * out and the thread shows them at their send time. The server still orders its whole queue, so a
 * reorder keeps them, and anything else the strip hides, in their place.
 */

/** The messages the target run's first turn takes, which show as sent. */
export function firstTurnIds(queue: Pick<IssueQueuedCommentQueue, "targetRunId" | "firstTurnCommentIds"> | null | undefined): ReadonlySet<string> {
  return new Set(queue?.targetRunId ? (queue.firstTurnCommentIds ?? []) : []);
}

function byPosition(entries: readonly IssueQueuedCommentEntry[]) {
  return [...entries].sort((a, b) => a.position - b.position);
}

/** The entries still to show, without those being delivered or taken by a starting run's first turn. */
export function visibleEntries(queue: IssueQueuedCommentQueue | null | undefined, delivering: ReadonlySet<string>) {
  const taken = firstTurnIds(queue);
  return byPosition((queue?.entries ?? []).filter((entry) => !delivering.has(entry.comment.id) && !taken.has(entry.comment.id)));
}

/**
 * The whole queue's order for the server: the shown messages in their new order, and the ones the
 * strip hides (taken by a first turn, being delivered) kept in their place.
 */
export function fullOrder(queueEntries: readonly IssueQueuedCommentEntry[], shownOrder: readonly string[]) {
  const shown = new Set(shownOrder);
  let next = 0;
  return byPosition(queueEntries).map((entry) => (shown.has(entry.comment.id) ? shownOrder[next++]! : entry.comment.id));
}

/**
 * The queue's new order after moving one shown message up (-1) or down (+1), or null when it can't
 * move. `queueEntries` is the whole queue the server orders, when the strip shows only part of it.
 */
export function moveEntry(
  entries: readonly IssueQueuedCommentEntry[],
  commentId: string,
  delta: -1 | 1,
  queueEntries: readonly IssueQueuedCommentEntry[] = entries,
): string[] | null {
  if (entries.some(isFixed)) return null;
  const from = entries.findIndex((entry) => entry.comment.id === commentId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= entries.length) return null;
  const ids = entries.map((entry) => entry.comment.id);
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return fullOrder(queueEntries, ids);
}

/** "1 message queued", "3 messages queued". */
export function queuedSummary(count: number) {
  return `${count} message${count === 1 ? "" : "s"} queued`;
}

/**
 * The one line a row shows. A fixed answer shows its receipt's summary ("Declined: Slack
 * connection", #19331) or the first line of its body: the rest of the body is a JSON receipt for the
 * agent and never reaches a label or a hover.
 */
export function entryLabel(entry: IssueQueuedCommentEntry) {
  if (!isFixed(entry)) return preview(entry.comment.body);
  return entry.source?.summary?.trim() || preview(entry.comment.body) || "Saved response";
}

/*
 * A queued row's text and pictures (U100, upstream #20367, TaskChatQueuedMessages.tsx): the message
 * as compact Markdown, with images standing on their own lines taken out of the text and shown as
 * thumbnails after it, up to three and "+N" for the rest. Only Paperclip's own files are shown as
 * thumbnails (`/api/attachments/:id/content`, `/api/assets/:id/content`, as the composer inserts
 * them); an image woven into a sentence stays in the text, where the row leaves it out.
 */

const IMAGE_EMBED = /!\[((?:\\.|[^\]\\])*)\]\(([^()\s]+)\)/g;
const PAPERCLIP_IMAGE = /^\/api\/(?:attachments|assets)\/[^/?#\\]+\/content(?:\?[^#\\]*)?$/;
export const SHOWN_THUMBNAILS = 3;

export type QueuedImage = { name: string; url: string };

function isImageLine(line: string) {
  return line.trim().length > 0 && line.replace(IMAGE_EMBED, "").trim().length === 0;
}

/** Images on lines of their own, in order, once each, that are Paperclip's own files. */
export function queuedImages(body: string): QueuedImage[] {
  const seen = new Set<string>();
  const images: QueuedImage[] = [];
  for (const line of body.split("\n")) {
    if (!isImageLine(line)) continue;
    for (const [, name = "", url = ""] of line.matchAll(IMAGE_EMBED)) {
      if (seen.has(url) || !PAPERCLIP_IMAGE.test(url)) continue;
      seen.add(url);
      images.push({ name: name.replace(/\\([[\]])/g, "$1"), url });
    }
  }
  return images;
}

/** The message without its lines of images. */
export function withoutImageLines(body: string) {
  return body
    .split("\n")
    .filter((line) => !isImageLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What a row shows: Markdown text (empty when the message is only pictures) and its thumbnails,
 * with how many more there are. A fixed answer shows its receipt's one line, without pictures.
 */
export function queuedBody(entry: IssueQueuedCommentEntry): { text: string; images: QueuedImage[]; more: number } {
  if (isFixed(entry)) return { text: entryLabel(entry), images: [], more: 0 };
  const images = queuedImages(entry.comment.body);
  return { text: withoutImageLines(entry.comment.body), images: images.slice(0, SHOWN_THUMBNAILS), more: Math.max(0, images.length - SHOWN_THUMBNAILS) };
}

/** The row's plain words, for its tooltip and a control's name: "Images" for a message of pictures only. */
export function queuedPlain(entry: IssueQueuedCommentEntry) {
  if (isFixed(entry)) return entryLabel(entry);
  const text = withoutImageLines(entry.comment.body).replace(IMAGE_EMBED, "").replace(/\s+/g, " ").trim();
  return text || (queuedImages(entry.comment.body).length ? "Images" : "");
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

/**
 * Whether a failure means the message is gone (already sent or removed), so an edit's text can only
 * be queued as a new message (U118, upstream #20583).
 */
export function targetGone(error: unknown) {
  const code = errorCode(error);
  return code === "queued_comment_stale_target" || code === "queued_comment_not_pending";
}

/**
 * What to say when a queue action fails, after the old UI's messages (ui/src/api/errors.ts). A 409
 * on an edit says why it wasn't saved (U118, upstream #20583): the queue changed (save again), or the
 * message was already sent or removed (queue the text as new). The edit's text is kept either way.
 */
export function queueErrorMessage(error: unknown, action: QueueAction) {
  const code = errorCode(error);
  if (code === "queued_comment_already_dispatching") return "Too late: this message is already being sent.";
  const conflict = code === "queued_comment_revision_conflict" || code === "queued_comment_stale_queue" || (error instanceof ApiError && error.status === 409);
  if (action === "edit") {
    if (targetGone(error)) return "This queued message was already sent or removed. Your text is still here; you can queue it as a new message.";
    if (conflict) return "The queue changed in another session. Your edit is still here; save again to apply it to the latest queue.";
  }
  if (targetGone(error)) return "This message was already sent or removed. The queue has been refreshed.";
  if (conflict) return "The queue changed in another tab. It's been refreshed; try again.";
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
