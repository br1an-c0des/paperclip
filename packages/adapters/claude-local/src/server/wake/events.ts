import type { PaperclipWakePayload } from "@paperclipai/adapter-utils/server-utils";

/**
 * Which events a wake holds (step 5 phase 2, fork/step-5-wake.md "Each kind of event"): one kind
 * per row of the spec's table, detected from the "When" column.
 */
export type ClaudeWakeEventKind =
  | "assigned" | "comment" | "mentioned" | "reopened" | "questions_answered" | "options_picked"
  | "plan_accepted" | "plan_rejected" | "approval" | "connection_review" | "review_requested"
  | "changes_requested" | "children_done" | "blocker_resolved" | "blocker_stalled"
  | "comment_edited" | "interrupted" | "retry_workspace" | "retry" | "run_stopped" | "recovery"
  | "run_only_planned" | "run_unfinished" | "review_comments" | "status_changed" | "monitor_due"
  | "watchdog" | "held" | "chat_message" | "other";

/** The spec's table order: events after the wake reason's own appear in this order. */
export const CLAUDE_WAKE_EVENT_ORDER: readonly ClaudeWakeEventKind[] = [
  "assigned", "comment", "mentioned", "reopened", "questions_answered", "options_picked",
  "plan_accepted", "plan_rejected", "approval", "connection_review", "review_requested",
  "changes_requested", "children_done", "blocker_resolved", "blocker_stalled", "comment_edited",
  "interrupted", "retry_workspace", "retry", "run_stopped", "recovery", "run_only_planned",
  "run_unfinished", "review_comments", "status_changed", "monitor_due", "watchdog", "held",
  "chat_message", "other",
];

export interface ClaudeWakeRenderOptions {
  /** The woken agent: splits the two recovery rows (the original assignee or someone else). */
  agentId: string;
  resumedSession: boolean;
  conversationMode: boolean;
  /** A fresh session whose handoff text is present (context.paperclipFreshSessionHandoffMarkdown). */
  handoffPresent: boolean;
}

/** A comment or continuation message, as the wake quotes it. */
export interface ClaudeWakeComment {
  id: string | null;
  body: string;
  bodyTruncated: boolean;
  createdAt: string | null;
  authorType: string | null;
  authorId: string | null;
  /** An earlier turn already read it. */
  seen: boolean;
}

export interface ClaudeWakeComments {
  /** New comments by others, oldest first: the wake's batch, plus a resumed session's new messages. */
  news: ClaudeWakeComment[];
  /** A resumed session's edited messages. */
  edited: ClaudeWakeComment[];
  /** A fresh session's earlier messages (the continuation record's), oldest first, news left out. */
  history: ClaudeWakeComment[];
}

type Continuation = NonNullable<PaperclipWakePayload["executionContinuation"]>;

/** The continuation record, when it's about the wake's task. */
export function wakeContinuation(payload: PaperclipWakePayload): Continuation | null {
  const continuation = payload.executionContinuation;
  if (!continuation) return null;
  if (payload.issue?.id && continuation.issueId !== payload.issue.id) return null;
  return continuation;
}

function byCreatedAt(left: ClaudeWakeComment, right: ClaudeWakeComment): number {
  if (!left.createdAt || !right.createdAt) return 0;
  return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0;
}

/**
 * Splits the wake's comments: what's new (the news), what was edited, and the history a fresh
 * session needs. The woken agent's own comments are never news.
 */
export function selectClaudeWakeComments(
  payload: PaperclipWakePayload,
  options: Pick<ClaudeWakeRenderOptions, "agentId" | "resumedSession">,
): ClaudeWakeComments {
  const own = (comment: { authorType: string | null; authorId: string | null }) =>
    comment.authorType === "agent" && comment.authorId === options.agentId;
  const news: ClaudeWakeComment[] = payload.comments
    .filter((comment) => !own(comment))
    .map((comment) => ({
      id: comment.id,
      body: comment.body,
      bodyTruncated: comment.bodyTruncated,
      createdAt: comment.createdAt,
      authorType: comment.authorType,
      authorId: comment.authorId,
      seen: comment.readByEarlierTurn,
    }));
  const batchIds = new Set(payload.comments.map((comment) => comment.id).filter(Boolean));
  const continuation = wakeContinuation(payload);
  const edited: ClaudeWakeComment[] = [];
  const history: ClaudeWakeComment[] = [];
  const fromMessage = (message: Continuation["messages"][number]): ClaudeWakeComment => ({
    id: message.id,
    body: message.body,
    bodyTruncated: false,
    createdAt: message.createdAt,
    authorType: message.authorType,
    authorId: message.authorId,
    seen: false,
  });
  if (options.resumedSession) {
    // Every new or edited message since the last run, not only this wake's batch.
    for (const message of continuation?.resumeDelta?.messages ?? []) {
      if (message.deleted || batchIds.has(message.id) || own({ authorType: message.authorType, authorId: message.authorId })) continue;
      if (message.updatedAt && message.createdAt && message.updatedAt !== message.createdAt) edited.push(fromMessage(message));
      else news.push(fromMessage(message));
    }
  } else {
    for (const message of continuation?.messages ?? []) {
      if (message.deleted || batchIds.has(message.id)) continue;
      history.push(fromMessage(message));
    }
  }
  return { news: news.sort(byCreatedAt), edited, history: history.sort(byCreatedAt) };
}

/** Events that quote the latest comment themselves; any other new comments follow them. */
export const COMMENT_OWNING_EVENTS: ReadonlySet<ClaudeWakeEventKind> = new Set([
  "mentioned", "reopened", "changes_requested",
]);

const REASON_EVENTS: Record<string, ClaudeWakeEventKind> = {
  issue_assigned: "assigned",
  issue_commented: "comment",
  issue_comment_mentioned: "mentioned",
  issue_reopened_via_comment: "reopened",
  approval_approved: "approval",
  approval_cancelled: "approval",
  approval_rejected: "approval",
  execution_review_requested: "review_requested",
  execution_approval_requested: "review_requested",
  execution_changes_requested: "changes_requested",
  issue_children_completed: "children_done",
  issue_blockers_resolved: "blocker_resolved",
  issue_blocker_stalled: "blocker_stalled",
  issue_status_changed: "status_changed",
  task_watchdog_stopped_subtree: "watchdog",
  run_liveness_continuation: "run_only_planned",
  issue_disposition_repair: "run_unfinished",
};

const RUN_STOPPED_REASONS = new Set(["issue_continuation_needed", "issue_recovery_action_restored"]);

export function isMonitorReason(reason: string | null): boolean {
  return Boolean(reason?.startsWith("issue_monitor_"));
}

/** The event the wake's reason names, if any. */
function reasonEvent(payload: PaperclipWakePayload, options: Pick<ClaudeWakeRenderOptions, "conversationMode">): ClaudeWakeEventKind | null {
  const reason = payload.reason;
  if (!reason) return null;
  if (reason === "issue_commented" && options.conversationMode) return "chat_message";
  if (isMonitorReason(reason)) return "monitor_due";
  return REASON_EVENTS[reason] ?? null;
}

/** Whether a recovery wake is the original assignee's own ("run_stopped") or someone else's. */
export function isOwnRecovery(payload: PaperclipWakePayload, agentId: string): boolean {
  const originalAssigneeId = payload.recovery?.originalAssignee?.id ?? null;
  if (originalAssigneeId) return originalAssigneeId === agentId;
  return Boolean(payload.issue?.assigneeAgentId) && payload.issue?.assigneeAgentId === agentId;
}

export function hasOpenReviewThreads(payload: PaperclipWakePayload): boolean {
  return (payload.planReviewContext?.threads.length ?? 0) > 0 ||
    (payload.documentReviewContext?.documents.some((document) => document.threads.length > 0) ?? false);
}

export function isPlanAccepted(payload: PaperclipWakePayload): boolean {
  const interaction = payload.planReviewContext?.interaction;
  if (interaction?.kind === "request_confirmation" && interaction.status === "accepted") return true;
  return payload.interactionKind === "request_confirmation" && payload.interactionStatus === "accepted" &&
    (payload.issue?.workMode === "planning" || Boolean(payload.planReviewContext));
}

export function isPlanRejected(payload: PaperclipWakePayload): boolean {
  return payload.planReviewContext?.interaction?.status === "rejected";
}

/**
 * The events a payload holds, in render order: the wake reason's own event first (the merge
 * keeps the latest reason), then each other event whose fields are present, in the spec's table
 * order. Never empty ("other" at least).
 */
export function detectClaudeWakeEvents(
  payload: PaperclipWakePayload,
  options: Partial<ClaudeWakeRenderOptions> = {},
): ClaudeWakeEventKind[] {
  const agentId = options.agentId ?? "";
  const conversationMode = options.conversationMode === true;
  const comments = selectClaudeWakeComments(payload, { agentId, resumedSession: options.resumedSession === true });
  const primary = reasonEvent(payload, { conversationMode });
  const found = new Set<ClaudeWakeEventKind>();
  const continuation = wakeContinuation(payload);
  const reason = payload.reason;

  if (reason === "issue_assigned") found.add("assigned");
  if (primary === "mentioned" || primary === "reopened") found.add(primary);
  if (comments.news.length > 0) {
    if (conversationMode) found.add("chat_message");
    else if (!(primary && COMMENT_OWNING_EVENTS.has(primary))) found.add("comment");
    else found.add(primary);
  }
  if (payload.questionResponse) found.add("questions_answered");
  if (payload.checkboxSelection) found.add("options_picked");
  if (isPlanAccepted(payload)) found.add("plan_accepted");
  if (isPlanRejected(payload)) found.add("plan_rejected");
  if (payload.approval || primary === "approval") found.add("approval");
  if (payload.agentMessage) found.add(payload.agentMessage.source === "tool_action_review" ? "connection_review" : "chat_message");
  const role = payload.executionStage?.wakeRole;
  if (role === "reviewer" || role === "approver" || primary === "review_requested") found.add("review_requested");
  if (role === "executor" || primary === "changes_requested") found.add("changes_requested");
  if (payload.childIssueSummaries.length > 0 || primary === "children_done") found.add("children_done");
  if (primary === "blocker_resolved") found.add("blocker_resolved");
  if (payload.blockerStall || primary === "blocker_stalled") found.add("blocker_stalled");
  if (comments.edited.length > 0) found.add("comment_edited");
  if (continuation?.interruptedRunId) found.add("interrupted");
  if (continuation?.priorWorkspace || (continuation?.recoveredFiles?.length ?? 0) > 0) found.add("retry_workspace");
  if (continuation?.trigger?.retriedReason) found.add("retry");
  if (payload.recovery || reason === "source_scoped_recovery_action") {
    found.add(payload.recovery && isOwnRecovery(payload, agentId) ? "run_stopped" : "recovery");
  } else if (reason && RUN_STOPPED_REASONS.has(reason) && !payload.livenessContinuation && !payload.dispositionRepair) {
    found.add("run_stopped");
  }
  if (payload.livenessContinuation) found.add("run_only_planned");
  if (payload.dispositionRepair) found.add("run_unfinished");
  if (hasOpenReviewThreads(payload)) found.add("review_comments");
  if (primary === "status_changed") found.add("status_changed");
  if (primary === "monitor_due") found.add("monitor_due");
  if (payload.taskWatchdog || primary === "watchdog") found.add("watchdog");
  if (payload.treeHoldInteraction || payload.dependencyBlockedInteraction) found.add("held");

  const ordered = CLAUDE_WAKE_EVENT_ORDER.filter((kind) => found.has(kind));
  if (primary && found.has(primary)) {
    ordered.splice(ordered.indexOf(primary), 1);
    ordered.unshift(primary);
  }
  return ordered.length > 0 ? ordered : ["other"];
}
