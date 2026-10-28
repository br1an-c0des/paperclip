import type { FeedbackTargetType, FeedbackVote, FeedbackVoteValue } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Thumbs up and down on an agent's output in a task (`tasks/feedback`), as ui/src/api/issues.ts uses
 * them. Board users only. The list is your own votes on the task. A vote with `allowSharing` also
 * sends the voted output to Paperclip Labs; when the instance's sharing preference is still "Ask
 * each time", the server saves the answer as the new preference.
 */

export type FeedbackVoteInput = {
  targetType: FeedbackTargetType;
  targetId: string;
  vote: FeedbackVoteValue;
  reason?: string;
  allowSharing?: boolean;
};

export const feedbackVotesApi = {
  list: (taskId: string, signal?: AbortSignal) => api.get<FeedbackVote[]>(`/issues/${encodeURIComponent(taskId)}/feedback-votes`, { signal }),
  save: (taskId: string, input: FeedbackVoteInput) => api.post<FeedbackVote>(`/issues/${encodeURIComponent(taskId)}/feedback-votes`, input),
};
