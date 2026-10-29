import type { AskUserQuestionsAnswer, IssueThreadInteraction, RequestItemVerdictValue } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Requests an agent posts on a task (questions, confirmations, suggested tasks, verdicts), as
 * ui/src/api/issues.ts calls them. Answering goes through the action that fits the card: accept,
 * reject, respond (question forms) or verdicts. Dismiss sets a request aside without answering it;
 * it stays in the thread and can still be answered there. Cancel withdraws a question you asked
 * (the server cancels only question forms, and only for people).
 */

export type AcceptInteraction = {
  /** Suggested tasks to create, by their client keys. */
  selectedClientKeys?: string[];
  /** Checkbox confirmations: the options picked. */
  selectedOptionIds?: string[];
  /** Tool reviews: "Always allow", saving a standing rule for the scope. */
  rememberAction?: boolean;
};

export type ItemVerdict = { id: string; verdict: RequestItemVerdictValue; reason?: string | null };

const path = (issueId: string, interactionId: string, action: string) => `/issues/${issueId}/interactions/${interactionId}/${action}`;
const reasonBody = (reason?: string) => (reason ? { reason } : {});

export const interactionsApi = {
  list: (issueId: string, signal?: AbortSignal) => api.get<IssueThreadInteraction[]>(`/issues/${issueId}/interactions`, { signal }),
  accept: (issueId: string, interactionId: string, data: AcceptInteraction = {}) =>
    api.post<IssueThreadInteraction>(path(issueId, interactionId, "accept"), data),
  reject: (issueId: string, interactionId: string, reason?: string) =>
    api.post<IssueThreadInteraction>(path(issueId, interactionId, "reject"), reasonBody(reason)),
  respond: (issueId: string, interactionId: string, data: { answers: AskUserQuestionsAnswer[]; summaryMarkdown?: string | null }) =>
    api.post<IssueThreadInteraction>(path(issueId, interactionId, "respond"), data),
  verdicts: (issueId: string, interactionId: string, verdicts: ItemVerdict[]) =>
    api.post<IssueThreadInteraction>(path(issueId, interactionId, "verdicts"), { verdicts }),
  skip: (issueId: string, interactionId: string, reason?: string) =>
    api.post<IssueThreadInteraction>(path(issueId, interactionId, "skip"), reasonBody(reason)),
  dismiss: (issueId: string, interactionId: string) => api.post<IssueThreadInteraction>(path(issueId, interactionId, "dismiss"), {}),
  cancel: (issueId: string, interactionId: string, reason?: string) =>
    api.post<IssueThreadInteraction>(path(issueId, interactionId, "cancel"), reasonBody(reason)),
};
