import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { AUTO_STEER_DELAY_MS, autoSteerDeadline, autoSteerEligible, autoSteerKey, secondsLeft } from "./queue-model";

/*
 * The countdown that steers a queued follow-up into the live run on its own (U84, upstream #19970),
 * for every view that shows queued rows: the task's thread, agent chat and the run modal. The rules
 * live in queue-model.ts.
 *
 * What a view has cancelled, offered and tried is kept for the page, not per view, so two views of
 * the same queue (a task page with the run modal open over it) count down together, share a Cancel,
 * and never send the same revision twice.
 *
 * Opening a message for editing stops its countdown; leaving the editor without saving starts a
 * whole new window, and saving starts one for the new revision.
 */

const [cancelled, setCancelled] = createSignal<ReadonlySet<string>>(new Set());
const attempted = new Set<string>();
const [attempts, setAttempts] = createSignal(0);
/** When a view first offered each revision for automatic steering. */
const firstOffered = new Map<string, number>();

/** Forgets every countdown, Cancel and attempt; for tests. */
export function resetAutoSteer() {
  setCancelled(new Set<string>());
  attempted.clear();
  firstOffered.clear();
  setAttempts(0);
}

export interface AutoSteer {
  /** The seconds left before this message is sent, or null when it isn't counting down. */
  secondsLeft: (commentId: string) => number | null;
  /** Keeps this message in the queue: no automatic send while the page is open. */
  cancel: (commentId: string) => void;
  /** Whether any row is counting down. */
  counting: () => boolean;
}

export function createAutoSteer(options: {
  queue: () => IssueQueuedCommentQueue;
  /** The rows shown, without those already being delivered. */
  entries: () => readonly IssueQueuedCommentEntry[];
  editingId: () => string | null;
  /** True while another queue action is in flight; a due message waits for it. */
  busy: () => boolean;
  steer: (entry: IssueQueuedCommentEntry) => void;
  delayMs?: number;
}): AutoSteer {
  const delay = options.delayMs ?? AUTO_STEER_DELAY_MS;
  const [now, setNow] = createSignal(Date.now());

  const deadlines = createMemo(() => {
    attempts();
    const map = new Map<string, number>();
    const queue = options.queue();
    const editingId = options.editingId();
    for (const entry of options.entries()) {
      const key = autoSteerKey(entry);
      // Editing stops the countdown; it starts again in full once the editor closes.
      if (editingId === entry.comment.id) firstOffered.delete(key);
      if (!autoSteerEligible({ queue, entry, cancelledIds: cancelled(), attemptedKeys: attempted, editingId })) continue;
      if (!firstOffered.has(key)) firstOffered.set(key, Date.now());
      map.set(entry.comment.id, autoSteerDeadline(entry, firstOffered.get(key)!, delay));
    }
    return map;
  });
  const counting = createMemo(() => deadlines().size > 0);

  // The clock ticks only while a countdown shows, and starts from the present when one appears.
  createEffect(() => {
    if (!counting()) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    const at = now();
    const due = deadlines();
    if (options.busy()) return;
    const entry = options.entries().find((item) => {
      const deadline = due.get(item.comment.id);
      return deadline !== undefined && deadline <= at && !attempted.has(autoSteerKey(item));
    });
    if (!entry) return;
    attempted.add(autoSteerKey(entry));
    setAttempts((count) => count + 1);
    options.steer(entry);
  });

  return {
    secondsLeft: (commentId) => {
      const deadline = deadlines().get(commentId);
      return deadline === undefined ? null : secondsLeft(deadline, now());
    },
    cancel: (commentId) => setCancelled((current) => new Set(current).add(commentId)),
    counting,
  };
}
