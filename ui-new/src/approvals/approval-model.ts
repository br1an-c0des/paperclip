import type { Approval } from "@paperclipai/shared";
import type { Gradient } from "@/ui/status-meta";

/*
 * The approval page's rules (after ui/src/pages/ApprovalDetail.tsx and Approvals.tsx), kept apart
 * from the components so they can be tested: what an approval's status reads as, which follow-ups
 * it offers, where "what next" after approving leads, and the history list's order.
 */

export const APPROVAL_STATUS: Record<string, { label: string; gradient: Gradient }> = {
  pending: { label: "Waiting on you", gradient: "ember" },
  revision_requested: { label: "Changes requested", gradient: "orchid" },
  approved: { label: "Approved", gradient: "lagoon" },
  rejected: { label: "Rejected", gradient: "flare" },
  cancelled: { label: "Cancelled", gradient: "ash" },
};

export function approvalStatus(status: string) {
  return APPROVAL_STATUS[status] ?? { label: status.replaceAll("_", " "), gradient: "ash" as Gradient };
}

export function isOpenApproval(approval: Pick<Approval, "status">) {
  return approval.status === "pending" || approval.status === "revision_requested";
}

/** The agent a hire request created, which waits in `pending_approval` until it's decided. */
export function hiredAgentId(approval: Pick<Approval, "payload">): string | null {
  const id = approval.payload?.agentId;
  return typeof id === "string" && id ? id : null;
}

/**
 * The follow-ups the request card doesn't offer: marking a request that was sent back as resubmitted
 * (the board can do it for an agent that's slow to), deleting the agent a rejected hire left behind,
 * and, for a budget stop, the budget controls that resolve it.
 */
export function approvalFollowUps(approval: Pick<Approval, "status" | "type" | "payload">) {
  return {
    resubmit: approval.status === "revision_requested",
    removeHire: approval.status === "rejected" && approval.type === "hire_agent" && hiredAgentId(approval) !== null,
    budget: approval.type === "budget_override_required" && isOpenApproval(approval),
  };
}

type LinkedTask = { id: string; identifier: string | null };

/**
 * After approving: review the linked task (or tasks), open the hired agent, or go back to the Inbox.
 * Paths are relative to `/:prefix/`.
 */
export function afterApproval(approval: Pick<Approval, "type" | "payload">, tasks: readonly LinkedTask[], agentKey?: string | null) {
  const first = tasks[0];
  if (first) return { label: tasks.length > 1 ? "Review the linked tasks" : "Review the linked task", href: `issues/${encodeURIComponent(first.identifier ?? first.id)}` };
  const agentId = hiredAgentId(approval);
  if (approval.type === "hire_agent" && agentId) return { label: "Open the new agent", href: `agents/${encodeURIComponent(agentKey ?? agentId)}` };
  return { label: "Back to the Inbox", href: "inbox" };
}

/** The history list: open ones first, then newest first. */
export function sortApprovals<T extends Pick<Approval, "status" | "createdAt">>(approvals: readonly T[]): T[] {
  return [...approvals].sort((a, b) => {
    const open = Number(isOpenApproval(b)) - Number(isOpenApproval(a));
    return open || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
