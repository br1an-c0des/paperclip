/*
 * When the chat moves the reader to the newest message, as pure decisions (ChatView.tsx applies
 * them to the window).
 *
 * - The chat opens at the foot, and sending a message takes you there.
 * - Otherwise the thread follows what arrives (messages, the live reply growing, cards, the queue)
 *   only while the reader is already at the foot. Someone reading further up stays where they are,
 *   however often the chat's data refreshes underneath them.
 * - Paging back ("Load earlier messages") never moves the reader to the foot.
 */

/** How close to the foot still counts as reading the newest. */
export const NEAR_FOOT_PX = 160;

export type ScrollMetrics = {
  /** How far the page is scrolled (`window.scrollY`). */
  scrollY: number;
  /** The viewport's height (`window.innerHeight`). */
  viewHeight: number;
  /** The page's full height (`document.documentElement.scrollHeight`). */
  contentHeight: number;
};

/** Whether the reader is at (or near) the foot of the thread. */
export function atFoot(metrics: ScrollMetrics, slack = NEAR_FOOT_PX) {
  return metrics.viewHeight + metrics.scrollY >= metrics.contentHeight - slack;
}

/**
 * Why the thread might move to its foot:
 *
 * - `opened`: the conversation has just shown for the first time.
 * - `sent`: you sent a message.
 * - `grew`: something changed size: a new message or card, the live reply, an image loading, or a
 *   refetch drawing the same thread again.
 */
export type FollowCause = "opened" | "sent" | "grew";

/** Whether to move to the foot, given whether the reader was following the newest. */
export function shouldFollow(cause: FollowCause, following: boolean) {
  return cause === "grew" ? following : true;
}
