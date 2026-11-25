/**
 * Ids in the wake payload, put into plain words for the claude_local wake (step 5 phase 2,
 * fork/step-5-wake.md "Left to the builder"). An id with no entry falls back to the id with its
 * underscores turned into spaces, so a new id still reads as words.
 */

function fallback(id: string): string {
  return id.replace(/[_-]+/g, " ").trim();
}

/** Wake reasons as a noun phrase: "Paperclip woke you on TES-45 (a timer)". */
const REASONS: Record<string, string> = {
  issue_assigned: "an assignment",
  issue_commented: "a new comment",
  issue_comment_mentioned: "a mention",
  issue_reopened_via_comment: "a comment that reopened the task",
  issue_continuation_needed: "a continuation",
  issue_recovery_action_restored: "a restored recovery action",
  issue_assignment_recovery: "an assignment recovery",
  issue_tree_restored: "a restored subtree",
  issue_children_completed: "finished subtasks",
  issue_blockers_resolved: "resolved blockers",
  issue_blocker_stalled: "a stuck subtask",
  issue_status_changed: "a status change",
  issue_monitor_due: "a scheduled check",
  issue_monitor_fired: "a scheduled check",
  issue_monitor_recovery: "a scheduled check's recovery",
  approval_approved: "an approved request",
  approval_cancelled: "a cancelled request",
  approval_rejected: "a rejected request",
  execution_review_requested: "a review request",
  execution_approval_requested: "an approval request",
  execution_changes_requested: "a request for changes",
  task_watchdog_stopped_subtree: "a stopped subtree",
  run_liveness_continuation: "a liveness check",
  issue_disposition_repair: "an unfinished run",
  source_scoped_recovery_action: "a recovery action",
  transient_failure_retry: "a retry after a passing failure",
  heartbeat_timer: "a timer",
};

export function reasonWords(reason: string): string {
  return REASONS[reason] ?? fallback(reason);
}

/** Recovery causes, completing "stopped before finishing: …" or "is stuck: …". */
const RECOVERY_CAUSES: Record<string, string> = {
  process_lost: "its process was lost",
  provider_quota: "the model provider's usage limit was reached",
  codex_output_inactivity_monitor: "it produced no output for too long",
  workspace_validation_failed: "its workspace failed its checks",
  configuration_incomplete: "the agent's setup is incomplete",
  successful_run_missing_state: "the run ended without finishing, blocking or reporting progress",
  successful_run_missing_issue_disposition: "the run ended without finishing, blocking or reporting progress",
  stranded_assigned_issue: "the task was left with no run working on it",
  deliberate_wait_without_target: "it waited on nothing in particular",
  environment_provider_unavailable: "the environment provider was unavailable",
  execution_review_participant_recovery: "its review stage has no one to act on it",
  native_session_interrupted: "its session was interrupted",
  provider_transport_failed: "the connection to the model provider failed",
  legacy_execution_requires_reconciliation: "an older run needs checking before work goes on",
  interrupted: "it was interrupted",
};

export function recoveryCauseWords(cause: string): string {
  return RECOVERY_CAUSES[cause] ?? fallback(cause);
}

/** Task statuses: "in progress". */
const STATUSES: Record<string, string> = {
  backlog: "in the backlog",
  todo: "to do",
  in_progress: "in progress",
  in_review: "in review",
  blocked: "blocked",
  done: "done",
  cancelled: "cancelled",
};

export function statusWords(status: string): string {
  return STATUSES[status] ?? fallback(status);
}

/** Liveness states, completing "Your last run on TES-45 …". */
const LIVENESS_STATES: Record<string, string> = {
  plan_only: "described next steps but didn't take any",
  empty_response: "ended without a response",
  needs_followup: "ended with follow-up work left",
  failed: "failed",
  blocked: "ended blocked without saying why",
};

export function livenessWords(state: string | null): string {
  return (state && LIVENESS_STATES[state]) || "ended without concrete progress";
}

/** Approval types as a noun: "your permission request". */
const APPROVAL_TYPES: Record<string, string> = {
  hire_agent: "hiring request",
  approve_ceo_strategy: "strategy approval request",
  budget_override_required: "budget override request",
  request_board_approval: "approval request",
  permission_request: "permission request",
};

export function approvalTypeWords(type: string): string {
  return APPROVAL_TYPES[type] ?? `request (${fallback(type)})`;
}

/** Approval statuses as a past-tense verb: "Brian approved your …". */
const APPROVAL_DECISIONS: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  revision_requested: "asked for changes to",
};

export function approvalDecisionWords(status: string): string {
  return APPROVAL_DECISIONS[status] ?? `marked as ${fallback(status)}`;
}

/** Who a stalled recovery action waits on. */
export function ownerTypeWords(ownerType: string | null): string {
  if (ownerType === "agent") return "an agent";
  return "the user";
}
