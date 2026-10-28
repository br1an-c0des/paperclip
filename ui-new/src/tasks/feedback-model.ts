import type { FeedbackDataSharingPreference, FeedbackVote, FeedbackVoteValue } from "@paperclipai/shared";

/*
 * Feedback votes on agent output (`tasks/feedback`), after ui/src/components/AgentBubbleActionRow.tsx
 * (IssueChatFeedbackButtons) and IssueDetail's vote handling:
 *
 * - Thumbs up ("Helpful") or down ("Needs work") on an agent's comment; a down vote asks what could
 *   have been better, as an optional note saved with the vote.
 * - Every vote is kept on this instance. Whether it's also shared with Paperclip Labs follows the
 *   instance's AI feedback sharing setting (App settings → General): "Always allow" shares,
 *   "Don't allow" doesn't, and "Ask each time" asks on the next vote, whose answer becomes the
 *   setting (the server saves it).
 */

/** The terms the sharing question links to, as the old UI's VITE_FEEDBACK_TERMS_URL or its default. */
export const FEEDBACK_TERMS_URL: string = (import.meta.env.VITE_FEEDBACK_TERMS_URL as string | undefined)?.trim() || "https://paperclip.ing/tos";

/** Your vote on each comment, by comment id. */
export function votesByComment(votes: readonly FeedbackVote[] | undefined) {
  const map = new Map<string, FeedbackVote>();
  for (const vote of votes ?? []) if (vote.targetType === "issue_comment") map.set(vote.targetId, vote);
  return map;
}

/** What a vote does under the sharing setting: ask first, or save with sharing on or off. */
export function voteSharing(preference: FeedbackDataSharingPreference | undefined): "ask" | { allowSharing: boolean } {
  const value = preference ?? "prompt";
  if (value === "prompt") return "ask";
  return { allowSharing: value === "allowed" };
}

/** The toast after a vote is saved, as the old UI words it. */
export function savedVoteTitle(preferenceAtSubmit: FeedbackDataSharingPreference, allowSharing: boolean) {
  if (preferenceAtSubmit === "prompt") return allowSharing ? "Feedback saved. Future votes will share" : "Feedback saved. Future votes will stay local";
  return allowSharing ? "Feedback saved and sharing enabled" : "Feedback saved";
}

/** The list with your vote on one comment put in place (or added), to show it before the server answers. */
export function withVote(
  previous: readonly FeedbackVote[] | undefined,
  next: { taskId: string; commentId: string; vote: FeedbackVoteValue; reason?: string },
  youId: string | null,
): FeedbackVote[] {
  const votes = [...(previous ?? [])];
  const index = votes.findIndex((entry) => entry.targetType === "issue_comment" && entry.targetId === next.commentId && (!youId || entry.authorUserId === youId));
  const now = new Date();
  if (index >= 0) {
    const existing = votes[index]!;
    votes[index] = { ...existing, vote: next.vote, reason: next.reason !== undefined ? next.reason.trim() || null : existing.reason, updatedAt: now };
    return votes;
  }
  votes.push({
    id: `optimistic:${next.commentId}`,
    companyId: "",
    issueId: next.taskId,
    targetType: "issue_comment",
    targetId: next.commentId,
    authorUserId: youId ?? "local-board",
    vote: next.vote,
    reason: next.reason?.trim() || null,
    sharedWithLabs: false,
    sharedAt: null,
    consentVersion: null,
    redactionSummary: null,
    createdAt: now,
    updatedAt: now,
  });
  return votes;
}
