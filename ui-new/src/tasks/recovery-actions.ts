import { requiresExecutionReconciliation, type IssueRecoveryAction, type IssueRecoveryActionKind } from "@paperclipai/shared";
import { RETAINED_EXPORT_CAUSES } from "./recovery";
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
 *
 * Since the 2026-11-05 sync some causes read on their own: a saved workspace that couldn't be
 * restored into a new sandbox (#19207) names the failed step from its run (`restoreFailure`), and a
 * native export hold (#18848, #19208) says the files need recovering, with Recover saved files
 * under the card (recover-files.ts). When automatic recovery spends its attempts the server hands
 * the action to the board, and its next step says so.
 *
 * Since the 2026-11-07 sync: when a restart killed the server that was saving a run's files and the
 * next one can't prove it stopped (#19717, #19742), or a run's server was recorded before its host
 * was (`native_controller_host_unverified`), an owner or admin confirms it stopped, saying how they
 * checked (`previousServerStop`). A pending provider tool call (#19733) reads on its own and, as a
 * reconciliation cause, isn't offered "Try again".
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
 * Causes whose one way on is the board's confirmation that the previous server stopped (the old
 * UI's `isPreviousServerStopCause`): the card offers no other choice for them.
 */
export const PREVIOUS_SERVER_STOP_CAUSES = new Set(["native_workspace_finalization_owner_unverified", "native_controller_host_unverified"]);

/** Causes with words of their own, over the kind's. */
const CAUSES: Record<string, { label: string; headline: string }> = {
  native_workspace_finalization_owner_unverified: {
    label: "Previous server not confirmed stopped",
    headline: "The previous server stopped while it was saving this task's files, and Paperclip can't verify that it stopped. The agent's result is saved.",
  },
  native_controller_host_unverified: {
    label: "Previous server not confirmed stopped",
    headline:
      "This run's previous server was recorded before Paperclip stored which host it ran on, so Paperclip can't verify that it stopped. The run's saved state is kept.",
  },
  // Since the 2026-11-07 sync (#19733): a reconciliation cause, so no "Try again".
  native_provider_side_effect_pending: {
    label: "A tool call needs checking",
    headline:
      "The saved session has a tool call whose result never came back, so Paperclip didn't retry or replace the session. Check whether it ran and record the outcome; the saved session and workspace are unchanged.",
  },
  remote_workspace_restore_failed: {
    label: "Saved workspace couldn't be restored",
    headline: "The saved workspace couldn't be restored into a new sandbox. The saved version was kept.",
  },
  native_workspace_sync_out_retry_exhausted: {
    label: "Saved files need recovering",
    headline: "The last run's files weren't saved back from its sandbox. Work stays paused until they're recovered.",
  },
  native_workspace_sync_out_unrecoverable: {
    label: "Saved files need recovering",
    headline: "The last run's files couldn't be saved back from its sandbox. Work stays paused until they're recovered.",
  },
};

export type RecoveryCard = {
  state: RecoveryState;
  kindLabel: string;
  headline: string;
  /** The server's own account of what failed (a restore's step and reason), when it gives one. */
  detail: string | null;
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
  const cause = action.cause ? CAUSES[action.cause] : undefined;
  const headline =
    cause?.headline ??
    (state === "needed" && action.ownerType === "board" && (action.kind === "active_run_watchdog" || action.kind === "deliberate_wait_without_target")
      ? "Paperclip's own repairs didn't move this task on, so it needs a person. Look at what happened and choose the next step."
      : (KIND_HEADLINES[action.kind] ?? KIND_HEADLINES.missing_disposition));
  const restoreFailure = action.evidence?.restoreFailure;
  const outcomes =
    state !== "needed"
      ? []
      : OUTCOMES.filter((option) => {
          if (action.cause && PREVIOUS_SERVER_STOP_CAUSES.has(action.cause)) return false;
          if (action.cause === "native_workspace_sync_out_retry_exhausted" && !option.boardOnly) return false;
          // Causes that need the run's effects reconciled first (shared `EXECUTION_RECONCILIATION_CAUSES`).
          if (option.outcome === "todo" && requiresExecutionReconciliation(action.cause)) return false;
          return !option.boardOnly || options.board;
        });
  return {
    state,
    kindLabel: cause?.label ?? KIND_LABELS[action.kind] ?? action.kind.replace(/_/g, " "),
    headline,
    detail: typeof restoreFailure === "string" && restoreFailure.trim() ? restoreFailure.trim() : null,
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

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const OPEN = new Set(["active", "escalated"]);

/**
 * The confirmation an action waits for, after the old UI's WorkspaceExportRecovery.tsx, or null:
 *
 * - `owner`: the server saving the run's files was killed and can't report its stop. Confirmed
 *   with its recorded owner token (`POST …/recovery-actions/resume-workspace-finalization`), on a
 *   board-owned `native_workspace_finalization_owner_unverified` action, or on a retained-export
 *   recovery whose copy-back owner waits for an operator (`workspaceOwnerRecovery`, #19742).
 * - `controller`: a run's server recorded before its host was, which an ephemeral server can't
 *   judge by process id (`POST …/recovery-actions/confirm-controller-stopped`).
 *
 * Gone once the server has recorded a stop (`workspaceOwnerStop`, `controllerStop`) or resumes.
 */
export type PreviousServerStop = { kind: "owner"; runId: string; ownerToken: string } | { kind: "controller"; runId: string };

export function previousServerStop(
  action: IssueRecoveryAction | null | undefined,
  issueId: string,
  companyId: string,
): PreviousServerStop | null {
  if (!action || action.companyId !== companyId || action.sourceIssueId !== issueId || !OPEN.has(action.status)) return null;
  const runId = action.evidence.runId;
  if (typeof runId !== "string" || !runId) return null;
  const hold = obj(action.evidence.workspaceOwnerRecovery);
  if (action.cause && RETAINED_EXPORT_CAUSES.has(action.cause)) {
    const token = obj(hold.owner).token;
    return action.kind === "active_run_watchdog" &&
      (action.ownerType === "board" || action.ownerType === "system") &&
      hold.state === "operator_required" &&
      !action.evidence.workspaceOwnerStop &&
      typeof token === "string" &&
      token.length > 0
      ? { kind: "owner", runId, ownerToken: token }
      : null;
  }
  if (action.ownerType !== "board") return null;
  if (action.cause === "native_controller_host_unverified") return action.evidence.controllerStop ? null : { kind: "controller", runId };
  if (action.cause === "native_workspace_finalization_owner_unverified") {
    const token = obj(action.evidence.owner).token;
    return typeof token === "string" && !action.evidence.workspaceOwnerStop && hold.state !== "resuming" ? { kind: "owner", runId, ownerToken: token } : null;
  }
  return null;
}

/** The fewest characters the server takes for how the stop was checked (`stopEvidence`). */
export const STOP_EVIDENCE_MIN = 20;

/** What the confirmation sends, or null while `evidence` is too short. */
export function stopConfirmationBody(
  stop: PreviousServerStop,
  actionId: string,
  evidence: string,
):
  | { kind: "owner"; body: { actionId: string; runId: string; ownerToken: string; controllerAndCopybackStopped: true; stopEvidence: string } }
  | { kind: "controller"; body: { actionId: string; runId: string; stopEvidence: string } }
  | null {
  const stopEvidence = evidence.trim();
  if (stopEvidence.length < STOP_EVIDENCE_MIN) return null;
  return stop.kind === "owner"
    ? { kind: "owner", body: { actionId, runId: stop.runId, ownerToken: stop.ownerToken, controllerAndCopybackStopped: true, stopEvidence } }
    : { kind: "controller", body: { actionId, runId: stop.runId, stopEvidence } };
}

/**
 * Who may confirm that a previous server stopped, after the old UI's `canBoardConfirmOwnerStop`
 * (the server's `runtime:confirm_owner_stop`): a local trusted instance, instance admins, and the
 * company's owners and admins. The server checks again.
 */
export function canConfirmServerStop(companyId: string, access: BoardAccess | null | undefined, localTrusted: boolean) {
  if (localTrusted) return true;
  if (!access) return false;
  if (access.source === "local_implicit" || access.isInstanceAdmin) return true;
  const membership = access.memberships?.find((item) => item.companyId === companyId && item.status === "active");
  return membership?.membershipRole === "owner" || membership?.membershipRole === "admin";
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
