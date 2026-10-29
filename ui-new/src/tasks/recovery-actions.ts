import type { IssueRecoveryAction, IssueRecoveryActionKind } from "@paperclipai/shared";
import type { BoardAccess } from "./task-edits";

/*
 * The recovery card (`tasks/thread`): what to show for a task's active recovery action
 * (`activeRecoveryAction`), and which ways out it offers through
 * `POST /issues/:id/recovery-actions/resolve`. A short form of the old UI's
 * IssueRecoveryActionCard and lib/recovery-display.ts.
 *
 * The server still raises these in many places (native runs that can't be finalised, workspaces
 * that fail validation, tasks left with no next step, review paths that stall), so the card stays.
 * Left out on purpose: the retry-lineage meter and the workspace re-issue, reconcile and
 * break-glass actions. The branch fixes live in the Workspace section (TaskBranch.tsx), and the
 * card points there for workspace actions.
 */

export type RecoveryState = "needed" | "in_progress" | "observing";

export type RecoveryOutcome = "todo" | "done" | "in_review" | "false_positive_done" | "false_positive_in_review";

const KIND_LABELS: Record<IssueRecoveryActionKind, string> = {
  missing_disposition: "No next step chosen",
  deliberate_wait_without_target: "Waiting on nothing",
  stranded_assigned_issue: "Stranded task",
  workspace_validation: "Workspace check failed",
  configuration_validation: "Missing configuration",
  active_run_watchdog: "Silent run",
  issue_graph_liveness: "No next step",
};

const KIND_HEADLINES: Record<IssueRecoveryActionKind, string> = {
  missing_disposition: "The run finished without choosing what happens next. Try again, mark the task done, or send it for review.",
  deliberate_wait_without_target:
    "The last run stopped to wait, but there's no reviewer, blocker, monitor or approval to wait for. Paperclip is repairing the next step; the task stays with its owner.",
  stranded_assigned_issue:
    "Paperclip retried the last run, and there's still no queued run, reviewer, blocker or next owner. Try again, mark the task done, or send it for review.",
  workspace_validation: "Paperclip stopped this run because the task's git workspace couldn't be validated. The Workspace section shows the branch and how to fix it.",
  configuration_validation: "Paperclip stopped before starting this run because required secrets or environment settings are missing.",
  active_run_watchdog: "The run has gone quiet. Paperclip is watching it without interrupting.",
  issue_graph_liveness: "Paperclip couldn't find a clear next step for this open task. Continue the work, send it for review, mark it done, or record what blocks it.",
};

export const OUTCOMES: { outcome: RecoveryOutcome; label: string; description: string; boardOnly?: boolean }[] = [
  { outcome: "todo", label: "Try again", description: "Close the recovery and put the task back in Todo." },
  { outcome: "done", label: "Mark the task done", description: "Record the work as complete." },
  { outcome: "in_review", label: "Send for review", description: "Hand it to a reviewer." },
  { outcome: "false_positive_done", label: "Raised in error: done", description: "Dismiss the recovery and mark the task done.", boardOnly: true },
  {
    outcome: "false_positive_in_review",
    label: "Raised in error: review",
    description: "Dismiss the recovery and send the task for review.",
    boardOnly: true,
  },
];

/**
 * Causes that need the run's effects reconciled first (shared `EXECUTION_RECONCILIATION_CAUSES`,
 * copied as decision 10 allows): "Try again" isn't offered for them.
 */
const RECONCILIATION_CAUSES = new Set([
  "uncertain_provider_action",
  "uncertain_external_action",
  "uncertain_control_plane_action",
  "completed_action_context_missing",
  "continuation_evidence_incomplete",
  "execution_finalization_deadline_exceeded",
  "execution_recovery_budget_exhausted",
  "provider_effect_inventory_unavailable",
  "provider_failure_meaning_unverified",
  "provider_ownership_unverified",
  "native_provider_terminal_failed",
  "native_event_replay_conflict",
  "native_session_cleanup_quarantined",
  "native_session_retry_exhausted",
  "native_restart_recovery_blocked",
  "native_continuation_requires_reconciliation",
  "legacy_execution_requires_reconciliation",
]);

export type RecoveryCard = {
  state: RecoveryState;
  kindLabel: string;
  headline: string;
  /** The server's own next step, when it gives one. */
  nextAction: string | null;
  attempts: string | null;
  outcomes: typeof OUTCOMES;
};

/**
 * The card for an action, or null once it's resolved. A board-owned watchdog action needs a person;
 * an agent-owned one, or a retry in flight, is shown calmly without choices.
 */
export function recoveryCard(action: IssueRecoveryAction | null | undefined, options: { board: boolean }): RecoveryCard | null {
  if (!action || action.status === "resolved" || action.status === "cancelled") return null;
  const state: RecoveryState =
    action.kind === "active_run_watchdog" && action.ownerType !== "board"
      ? "observing"
      : action.status === "escalated" || action.ownerType === "board"
        ? "needed"
        : "in_progress";
  const headline =
    state === "needed" && action.ownerType === "board" && (action.kind === "active_run_watchdog" || action.kind === "deliberate_wait_without_target")
      ? "Paperclip's own repairs didn't move this task on, so it needs a person. Look at what happened and choose the next step."
      : (KIND_HEADLINES[action.kind] ?? KIND_HEADLINES.missing_disposition);
  const outcomes =
    state !== "needed"
      ? []
      : OUTCOMES.filter((option) => {
          if (action.cause === "native_workspace_finalization_owner_unverified") return false;
          if (action.cause === "native_workspace_sync_out_retry_exhausted" && !option.boardOnly) return false;
          if (option.outcome === "todo" && action.cause && RECONCILIATION_CAUSES.has(action.cause)) return false;
          return !option.boardOnly || options.board;
        });
  return {
    state,
    kindLabel: KIND_LABELS[action.kind] ?? action.kind.replace(/_/g, " "),
    headline,
    nextAction: action.nextAction?.trim() || null,
    attempts: action.attemptCount > 1 ? `Attempt ${action.attemptCount}${action.maxAttempts ? ` of ${action.maxAttempts}` : ""}` : null,
    outcomes,
  };
}

/** What `resolve` takes for each choice. */
export function resolveBody(actionId: string, outcome: RecoveryOutcome) {
  const falsePositive = outcome.startsWith("false_positive_");
  const status = (falsePositive ? outcome.slice("false_positive_".length) : outcome) as "todo" | "done" | "in_review";
  return { actionId, outcome: falsePositive ? ("false_positive" as const) : ("restored" as const), sourceIssueStatus: status };
}

/**
 * Who may dismiss a recovery as raised in error, after the old task page's
 * `canBoardResolveRecoveryAction`: a local trusted instance, admins, and members who aren't viewers.
 */
export function canDismissRecovery(companyId: string, access: BoardAccess | null | undefined, localTrusted: boolean) {
  if (localTrusted) return true;
  if (!access) return false;
  if (access.source === "local_implicit" || access.isInstanceAdmin) return true;
  if (!access.memberships?.length) return access.companyIds.includes(companyId);
  const membership = access.memberships.find((item) => item.companyId === companyId && item.status === "active");
  return !!membership && membership.membershipRole !== "viewer" && membership.membershipRole != null;
}
