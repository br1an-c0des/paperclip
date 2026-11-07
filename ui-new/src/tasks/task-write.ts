import { queryKeys } from "@/api/queryKeys";
import { newWrite } from "@/lib/offline/WriteQueueProvider";
import type { QueuedWrite } from "@/lib/offline/write-queue";
import type { NewTaskDraft } from "./new-task";

/*
 * A new task as a queued write (U13), for when it can't reach the server. Its `idempotencyKey`
 * (new-task.ts `buildCreatePayload`) goes with it, and the server answers a known key with the task
 * it already made, so a resend after a lost answer makes one task. The case it goes into is linked
 * once it's made (WriteQueueProvider.tsx).
 */

export function taskWrite(input: {
  userId: string;
  companyId: string;
  issuePrefix: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  caseLink: NewTaskDraft["addToCase"];
}): QueuedWrite {
  const title = String(input.payload.title ?? "").trim() || "Untitled task";
  return newWrite({
    userId: input.userId,
    companyId: input.companyId,
    kind: "task",
    target: "new-task",
    label: `New task: ${title}`,
    request: { method: "POST", path: `/companies/${input.companyId}/issues`, body: input.payload },
    idempotencyKey: input.idempotencyKey,
    recovery: { kind: "resend" },
    refresh: [
      [...queryKeys.issues.list(input.companyId)],
      [...queryKeys.projects.all(input.companyId)],
      [...queryKeys.sidebarBadges(input.companyId)],
      ...(input.caseLink ? [[...queryKeys.cases.all(input.companyId)]] : []),
    ],
    preview: { title },
    after: { issuePrefix: input.issuePrefix, ...(input.caseLink ? { caseLink: { caseId: input.caseLink.caseId, role: input.caseLink.role } } : {}) },
  });
}
