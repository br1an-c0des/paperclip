import type { Issue, IssueReviewPolicy } from "@paperclipai/shared";

/*
 * Where a task came from and who asked for it, for the Details section's About rows (the old UI's
 * "Originating", "Routine" and "Depth" rows in ui/src/components/issue-properties/), and the
 * review-policy badge.
 */

/**
 * Who asked for the task, as shared's `deriveOriginatingActor` decides (copied, as a value ui-new
 * doesn't import): the person who created it; or, when an agent did, the person it was working for,
 * "via" that agent; or the agent alone.
 */
export type Requester = { kind: "user"; id: string; viaAgentId?: string } | { kind: "agent"; id: string };

export function requester(task: Pick<Issue, "createdByUserId" | "createdByAgentId" | "responsibleUserId">): Requester | null {
  if (task.createdByUserId) return { kind: "user", id: task.createdByUserId };
  if (task.createdByAgentId) {
    return task.responsibleUserId ? { kind: "user", id: task.responsibleUserId, viaAgentId: task.createdByAgentId } : { kind: "agent", id: task.createdByAgentId };
  }
  return task.responsibleUserId ? { kind: "user", id: task.responsibleUserId } : null;
}

/**
 * Origins whose `originId` is another task: the one Paperclip raised this task for. Recovery
 * (server/src/services/recovery/origins.ts) and the watchdog's follow-ups set it to the source task.
 */
const TASK_ORIGINS: Record<string, string> = {
  stranded_issue_recovery: "Recovery for",
  stale_active_run_evaluation: "Checks the run on",
  harness_liveness_escalation: "Next step for",
  issue_productivity_review: "Review of",
  task_watchdog: "Watches",
  task_watchdog_product_bug: "Bug found on",
};

/** What the task was made for, when Paperclip made it for another task: a verb phrase and the task's id. */
export function originTask(task: Pick<Issue, "originKind" | "originId">): { label: string; taskId: string } | null {
  const label = task.originKind ? TASK_ORIGINS[task.originKind] : undefined;
  return label && task.originId ? { label, taskId: task.originId } : null;
}

/** The recurring task (routine) that made this occurrence, if one did. */
export function originRoutineId(task: Pick<Issue, "originKind" | "originId">) {
  return task.originKind === "routine_execution" && task.originId ? task.originId : null;
}

/** Where a task came from in words, for origins with nothing to link to. Manual tasks say nothing. */
export function originText(originKind: string | null | undefined): string | null {
  if (!originKind || originKind === "manual" || originKind === "routine_execution" || TASK_ORIGINS[originKind]) return null;
  if (originKind === "onboarding_first_task") return "Onboarding";
  if (originKind === "chat_channel") return "A chat channel";
  if (originKind.startsWith("plugin:")) return `Plugin ${originKind.slice("plugin:".length)}`;
  return originKind.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
}

/**
 * The review policy, shown only when it narrows who may approve (ui/src/lib/review-policy.ts).
 * "anyone", or none, is the default every task has, and shows nothing.
 */
export function reviewPolicyBadge(policy: IssueReviewPolicy | null | undefined): { label: string; description: string } | null {
  if (policy === "not_creator") return { label: "Anyone else", description: "Anyone except whoever asked for the review can approve it." };
  if (policy === "human_only") return { label: "Human only", description: "Only a person can approve this review. Agents can't give the verdict." };
  return null;
}
