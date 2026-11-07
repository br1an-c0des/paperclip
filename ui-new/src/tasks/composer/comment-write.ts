import type { Issue } from "@paperclipai/shared";
import { queryKeys } from "@/api/queryKeys";
import { newWrite } from "@/lib/offline/WriteQueueProvider";
import type { QueuedWrite } from "@/lib/offline/write-queue";
import type { SendPlan } from "./composer-model";

/*
 * A composer message as a queued write (U13), for when it can't reach the server. It keeps the
 * message's client request id, so a resend lands once:
 *
 * - A plain comment (`POST /issues/:id/comments`) is resent as is: the server answers a known id with
 *   the comment it already saved, before reopening, interrupting or waking anything.
 * - A comment inside `PATCH /issues/:id` (with a reassignment or run settings) isn't deduped as a
 *   whole, so a lost result is settled by looking for the comment in the thread first.
 * - A changed work mode goes first (`PATCH { workMode }`), which is harmless to repeat.
 *
 * Steering into a running turn needs the live run, so a queued message simply waits for the next
 * turn, as any comment does.
 */

export function commentWrite(input: {
  userId: string;
  companyId: string;
  task: Pick<Issue, "id" | "identifier">;
  plan: Extract<SendPlan, { ok: true }>;
  clientRequestId: string;
}): QueuedWrite {
  const { task, plan } = input;
  const text = plan.request.via === "post" ? plan.request.data.body : String(plan.request.data.comment ?? "");
  const request =
    plan.request.via === "post"
      ? { method: "POST" as const, path: `/issues/${task.id}/comments`, body: { ...plan.request.data } as Record<string, unknown> }
      : { method: "PATCH" as const, path: `/issues/${task.id}`, body: { ...plan.request.data } };
  return newWrite({
    userId: input.userId,
    companyId: input.companyId,
    kind: "comment",
    target: `issue:${task.id}`,
    label: `Comment on ${task.identifier ?? "a task"}`,
    before: plan.workMode ? [{ method: "PATCH", path: `/issues/${task.id}`, body: { workMode: plan.workMode } }] : undefined,
    request,
    idempotencyKey: input.clientRequestId,
    recovery: plan.request.via === "post" ? { kind: "resend" } : { kind: "comment", issueId: task.id, clientRequestId: input.clientRequestId },
    refresh: [[...queryKeys.issues.detail(task.id)], [...queryKeys.issues.list(input.companyId)], [...queryKeys.liveRuns(input.companyId)]],
    preview: { text },
  });
}
