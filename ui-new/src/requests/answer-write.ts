import { queryKeys } from "@/api/queryKeys";
import { newWrite } from "@/lib/offline/WriteQueueProvider";
import type { AnswerMatch, QueuedWrite } from "@/lib/offline/write-queue";

/*
 * Request answers and decisions as queued writes (U13), for when they can't reach the server.
 *
 * - An answer (accept, reject, respond) has no key the server dedupes by. When its result is lost,
 *   the task's requests are read again (`GET /issues/:id/interactions`): still open, it's sent
 *   again; settled with exactly this answer, it's done; settled otherwise, someone else answered.
 * - A decision carries its own `idempotencyKey`, and the server answers a known key with the
 *   decision it already made, so it's resent as is.
 */

const refreshFor = (companyId: string, taskId: string) => [
  [...queryKeys.issues.detail(taskId)],
  [...queryKeys.issues.list(companyId)],
  ["approvals", companyId],
  [...queryKeys.inbox.attention(companyId)],
  [...queryKeys.sidebarBadges(companyId)],
];

export function answerWrite(input: {
  userId: string;
  companyId: string;
  taskId: string;
  interactionId: string;
  /** The request's title, for the sync list. */
  title: string;
  match: AnswerMatch;
  body: Record<string, unknown>;
}): QueuedWrite {
  const action = input.match.action;
  return newWrite({
    userId: input.userId,
    companyId: input.companyId,
    kind: "answer",
    target: `interaction:${input.interactionId}`,
    label: `${action === "reject" ? "Declined" : action === "respond" ? "Answered" : "Accepted"}: ${input.title}`,
    request: { method: "POST", path: `/issues/${input.taskId}/interactions/${input.interactionId}/${action}`, body: input.body },
    idempotencyKey: `${input.interactionId}:${action}`,
    recovery: { kind: "answer", issueId: input.taskId, interactionId: input.interactionId, match: input.match },
    refresh: refreshFor(input.companyId, input.taskId),
  });
}

export function decisionWrite(input: {
  userId: string;
  companyId: string;
  decisionId: string;
  taskId: string;
  title: string;
  optionLabel: string;
  body: { optionId: string; inputValues: Record<string, string>; idempotencyKey: string };
  targetIds: readonly string[];
}): QueuedWrite {
  return newWrite({
    userId: input.userId,
    companyId: input.companyId,
    kind: "decision",
    target: `decision:${input.decisionId}`,
    label: `Decided: ${input.title}`,
    request: { method: "POST", path: `/decisions/${input.decisionId}/decide`, body: input.body },
    idempotencyKey: input.body.idempotencyKey,
    recovery: { kind: "resend" },
    refresh: [
      ...refreshFor(input.companyId, input.taskId),
      [...queryKeys.decisions.open(input.companyId)],
      ...input.targetIds.map((id) => [...queryKeys.issues.detail(id)]),
    ],
    store: [...queryKeys.decisions.detail(input.decisionId)],
    preview: { text: input.optionLabel },
  });
}
