import type { ActivityEvent, IssueStatus } from "@paperclipai/shared";

/*
 * Activity events in words, for the task panel's Activity section (board 3). Ported from
 * ui/src/lib/activity-format.ts (`formatIssueActivityAction`), shortened to what a task's own
 * thread shows. A status change keeps its two statuses, so the thread can draw them as chips
 * ("moved status TODO → IN PROGRESS").
 */

export type ActivityNames = {
  agent: (id: string) => string | undefined;
  person: (id: string) => string;
  youId: () => string | null;
};

export type ActivityLine = {
  /** Who did it: an agent's or person's name, "You", or "Paperclip" for the system. */
  actor: string;
  text: string;
  status?: { from: IssueStatus | null; to: IssueStatus };
};

/**
 * Events the thread leaves out: comments show as cards (with what they did to the run, from
 * `commentInputs`), and reads are noise.
 */
const HIDDEN = new Set([
  "issue.comment_added",
  "issue.commented",
  "issue.queued_comment_steered",
  "issue.read_marked",
  "issue.read_unmarked",
  "issue.feedback_vote_saved",
]);

const LABELS: Record<string, string> = {
  "issue.created": "created this task",
  "issue.updated": "updated this task",
  "issue.checked_out": "checked out this task",
  "issue.released": "released this task",
  "issue.comment_cancelled": "cancelled a queued comment",
  "issue.queued_comment_edited": "edited a queued comment",
  "issue.queued_comments_reordered": "reordered queued comments",
  "issue.queued_comment_discarded": "discarded a queued comment",
  "issue.comment_deleted": "deleted a comment",
  "issue.attachment_added": "added an attachment",
  "issue.attachment_removed": "removed an attachment",
  "issue.document_created": "created a document",
  "issue.document_updated": "updated a document",
  "issue.document_locked": "locked a document",
  "issue.document_unlocked": "unlocked a document",
  "issue.document_deleted": "deleted a document",
  "issue.monitor_scheduled": "scheduled a monitor",
  "issue.monitor_triggered": "triggered a monitor",
  "issue.monitor_cleared": "cleared a monitor",
  "issue.monitor_skipped": "skipped a monitor",
  "issue.monitor_exhausted": "exhausted a monitor",
  "issue.monitor_escalated_to_board": "escalated a monitor to the board",
  "issue.successful_run_handoff_required": "finished a run without a clear next step",
  "issue.successful_run_handoff_resolved": "chose the next step",
  "issue.successful_run_handoff_escalated": "finished a run without a next step; recovery escalated",
  "issue.recovery_action_opened": "opened a recovery action",
  "issue.workspace_recovered": "recovered saved work",
  "issue.workspace_recovery_requested": "requested workspace recovery",
  "issue.recovery_action_resolved": "resolved the recovery action",
  "issue.recovery_action_escalated": "escalated the recovery action",
  "issue.accepted_plan_decomposition_updated": "updated the accepted plan's subtasks",
  "issue.thread_interaction_created": "asked for a decision",
  "issue.thread_interaction_accepted": "accepted the request",
  "issue.thread_interaction_rejected": "rejected the request",
  "issue.thread_interaction_answered": "answered the request",
  "issue.thread_interaction_withdrawn": "withdrew the request",
  "issue.thread_interaction_cancelled": "cancelled the request",
  "issue.thread_interaction_skipped": "skipped the request",
  "issue.thread_interaction_dismissed": "deferred the request",
  "issue.thread_interaction_expired": "let the request expire",
  "issue.thread_interaction_item_verdicts_submitted": "submitted verdicts on the request",
  "issue.stalled_review_decided": "recorded a review verdict",
  "heartbeat.invoked": "started a run",
  "heartbeat.cancelled": "stopped a run",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
};

const INTERACTION_ACCEPTED: Record<string, string> = {
  request_confirmation: "approved the request",
  request_checkbox_confirmation: "approved the request",
  suggest_tasks: "accepted the task suggestions",
  ask_user_questions: "accepted the answers",
};

const INTERACTION_REJECTED: Record<string, string> = {
  request_confirmation: "rejected the request",
  request_checkbox_confirmation: "rejected the request",
  suggest_tasks: "declined the task suggestions",
  ask_user_questions: "declined the questions",
};

const REVIEW_DECISIONS: Record<string, string> = {
  approve: "approved the review",
  request_changes: "requested changes on the review",
  send_back: "sent the review back to work",
};

type Details = Record<string, unknown>;

function record(value: unknown): Details | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Details) : null;
}

function words(value: unknown) {
  return typeof value === "string" ? value.replace(/_/g, " ") : String(value ?? "none");
}

function userName(id: string | null | undefined, names: ActivityNames) {
  if (!id) return "Board";
  if (id === names.youId()) return "You";
  return names.person(id);
}

function listOf(singular: string, plural: string, labels: string[]) {
  return labels.length === 1 ? `${singular} ${labels[0]}` : `${labels.length} ${plural}`;
}

function references(details: Details, key: string): string[] {
  const value = details[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const ref = record(item);
    if (!ref) return [];
    const label = (ref.identifier ?? ref.title ?? (typeof ref.id === "string" ? ref.id.slice(0, 8) : null)) as string | null;
    return label ? [label] : [];
  });
}

function participants(details: Details, key: string, names: ActivityNames): string[] {
  const value = details[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const who = record(item);
    if (!who) return [];
    if (who.type === "agent") return [names.agent(String(who.agentId ?? "")) ?? "an agent"];
    if (who.type === "user") return [userName(who.userId as string | null, names)];
    return [];
  });
}

function addedRemoved(added: string[], removed: string[], singular: string, plural: string) {
  if (added.length > 0 && removed.length === 0) return `added ${listOf(singular, plural, added)}`;
  if (removed.length > 0 && added.length === 0) return `removed ${listOf(singular, plural, removed)}`;
  return `updated ${plural}`;
}

/** The parts of an `issue.updated` event other than a status change, joined. */
function updateText(details: Details, names: ActivityNames) {
  const previous = record(details._previous) ?? {};
  const parts: string[] = [];
  if (details.priority !== undefined) {
    parts.push(
      previous.priority
        ? `changed the priority from ${words(previous.priority)} to ${words(details.priority)}`
        : `changed the priority to ${words(details.priority)}`,
    );
  }
  if (details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined) {
    const agentId = typeof details.assigneeAgentId === "string" ? details.assigneeAgentId : null;
    const userId = typeof details.assigneeUserId === "string" ? details.assigneeUserId : null;
    const who = agentId ? (names.agent(agentId) ?? "an agent") : userId ? userName(userId, names) : null;
    parts.push(who ? `assigned ${who}` : "unassigned the task");
  }
  if (details.reviewPolicy !== undefined) parts.push("changed who can approve");
  if (details.title !== undefined) parts.push("renamed the task");
  if (details.description !== undefined) parts.push("updated the description");
  if (details.labelIds !== undefined) parts.push("changed the labels");
  if (details.parentId !== undefined) parts.push("changed the parent task");
  if (details.projectId !== undefined) parts.push("moved the task to another project");
  return parts.join(", ");
}

/** Who did it, in words. */
export function actorName(event: Pick<ActivityEvent, "actorType" | "actorId" | "agentId">, names: ActivityNames) {
  if (event.actorType === "agent") return names.agent(event.agentId ?? event.actorId) ?? "An agent";
  if (event.actorType === "user") return userName(event.actorId, names);
  if (event.actorType === "plugin") return "A plugin";
  return "Paperclip";
}

/** The line for an event, or null when the thread leaves it out. */
export function activityLine(event: Pick<ActivityEvent, "action" | "details" | "actorType" | "actorId" | "agentId">, names: ActivityNames): ActivityLine | null {
  if (HIDDEN.has(event.action)) return null;
  const actor = actorName(event, names);
  const details = event.details ?? {};
  switch (event.action) {
    case "issue.updated": {
      const rest = updateText(details, names);
      if (details.status !== undefined) {
        const previous = record(details._previous) ?? {};
        const from = typeof previous.status === "string" ? (previous.status as IssueStatus) : null;
        return { actor, text: rest, status: { from, to: details.status as IssueStatus } };
      }
      // An update that changed nothing the thread shows (an internal field) is left out.
      return rest ? { actor, text: rest } : null;
    }
    case "issue.blockers_updated":
      return {
        actor,
        text: addedRemoved(references(details, "addedBlockedByIssues"), references(details, "removedBlockedByIssues"), "blocker", "blockers"),
      };
    case "issue.reviewers_updated":
    case "issue.approvers_updated": {
      const [singular, plural] = event.action === "issue.reviewers_updated" ? ["reviewer", "reviewers"] : ["approver", "approvers"];
      const added = participants(details, "addedParticipants", names);
      const removed = participants(details, "removedParticipants", names);
      return { actor, text: addedRemoved(added, removed, singular!, plural!) };
    }
    case "issue.thread_interaction_accepted":
    case "issue.thread_interaction_rejected": {
      const table = event.action === "issue.thread_interaction_accepted" ? INTERACTION_ACCEPTED : INTERACTION_REJECTED;
      const kind = typeof details.interactionKind === "string" ? details.interactionKind : "";
      return { actor, text: table[kind] ?? LABELS[event.action]! };
    }
    case "issue.stalled_review_decided": {
      const decision = typeof details.action === "string" ? details.action : "";
      return { actor, text: REVIEW_DECISIONS[decision] ?? LABELS[event.action]! };
    }
  }
  if (event.action.startsWith("issue.document_")) {
    const key = typeof details.key === "string" ? details.key : null;
    const title = typeof details.title === "string" && details.title ? details.title : null;
    const base = LABELS[event.action] ?? words(event.action.replace(/^issue\./, ""));
    return { actor, text: title ?? key ? `${base}: ${title ?? key}` : base };
  }
  if (event.action.startsWith("issue.monitor_")) {
    const service = typeof details.serviceName === "string" && details.serviceName.trim() ? ` for ${details.serviceName.trim()}` : "";
    return { actor, text: `${LABELS[event.action] ?? words(event.action.replace(/^issue\./, ""))}${service}` };
  }
  return { actor, text: LABELS[event.action] ?? words(event.action.replace(/^issue\./, "").replace(/\./g, " ")) };
}

/** What a comment did as it was sent: stopped a run, reopened the task, or steered a run in place. */
export type CommentInput = { interruptedRunId?: string; reopened?: boolean; steeredRunId?: string };

/**
 * What each comment did, by comment id, from its `issue.comment_added` and
 * `issue.queued_comment_steered` rows (the full activity, or `?view=comment-inputs` for the comments
 * shown). A replayed steer is marked `duplicate` and doesn't count.
 */
export function commentInputs(events: readonly Pick<ActivityEvent, "action" | "details">[]): Map<string, CommentInput> {
  const inputs = new Map<string, CommentInput>();
  for (const event of events) {
    const details = event.details ?? {};
    const commentId = typeof details.commentId === "string" ? details.commentId : null;
    if (!commentId) continue;
    const input = inputs.get(commentId) ?? {};
    if (event.action === "issue.comment_added") {
      if (typeof details.interruptedRunId === "string") input.interruptedRunId = details.interruptedRunId;
      if (details.reopened === true) input.reopened = true;
    } else if (event.action === "issue.queued_comment_steered") {
      if (details.duplicate === true || typeof details.targetRunId !== "string") continue;
      input.steeredRunId ??= details.targetRunId;
    } else {
      continue;
    }
    if (Object.keys(input).length > 0) inputs.set(commentId, input);
  }
  return inputs;
}
