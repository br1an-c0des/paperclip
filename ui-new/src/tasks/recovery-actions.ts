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
 *
 * Since the 2026-11-09 sync (#20067, #20084): a record saved before Paperclip stored which server
 * held it (`ownership_owner_unprovable`, eight kinds of record in `evidence.kind`) gets the same
 * confirmation, bound to the record and the version the board was shown, with words of its own for
 * each kind (the old UI's WorkspaceExportRecovery.tsx, `OWNER_GONE_RESOURCE`).
 *
 * Since the 2026-11-10 sync:
 * - The same confirmation, without a recovery action, for a Retry parked because the previous
 *   native run never recorded its process (#20310, `confirm_run_stopped` on the task's interruption;
 *   `POST …/recovery-actions/confirm-run-stopped`). It's drawn in the task's notices.
 * - Original-host containment (#19813): a board-owned watchdog on `native_restart_recovery_blocked`
 *   whose controller's process space couldn't be verified (`evidence.reason:
 *   "controller_process_space_unverified"`). The server refuses any other way out of it, so the
 *   card offers none; an owner or admin records that the controller and provider stopped, with the
 *   reviewed action outcome and evidence, bound to the server's authority digest. It doesn't retry.
 *
 * Since the 2026-11-13 sync (#21348): the card says what follows, from the action's wake policy, in
 * upstream's plainer words ("An agent is choosing the next step", "Waiting for you", "Needs a fix
 * before Retry"), as the old card's Follow-up row does.
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

/**
 * What follows the recovery, from its wake policy (`wakePolicy.type`), in the old UI's words since
 * #21348 (IssueRecoveryActionCard's `readWakePolicySummary`). Null without a policy.
 */
export function followUpLine(action: Pick<IssueRecoveryAction, "wakePolicy"> | null | undefined): string | null {
  const policy = action?.wakePolicy;
  const type = typeof policy?.type === "string" ? policy.type.trim() : "";
  if (!type) return null;
  switch (type) {
    case "wake_owner":
      return "An agent will be asked to choose the next step";
    case "bounded_owner_disposition_repair":
      return "Paperclip is retrying the original owner";
    case "bounded_recovery_owner":
      return "An agent is choosing the next step";
    case "board_escalation":
      return "Waiting for you";
    case "manual":
      return "Manual follow-up needed";
    case "manual_repair_required":
      return "Needs a fix before Retry";
    case "monitor": {
      const interval = typeof policy?.intervalLabel === "string" && policy.intervalLabel.trim() ? policy.intervalLabel.trim() : null;
      return interval ? `Check scheduled · ${interval}` : "Check scheduled";
    }
    default:
      return type.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
  }
}

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
export const PREVIOUS_SERVER_STOP_CAUSES = new Set([
  "native_workspace_finalization_owner_unverified",
  "native_controller_host_unverified",
  "ownership_owner_unprovable",
]);

/** A stuck record whose owner Paperclip can't judge, saved before owners were recorded (#20067). */
export const OWNER_UNPROVABLE_CAUSE = "ownership_owner_unprovable";

export type OwnerGoneResource = { what: string; releasing: string };

/** What the stuck record is, by `evidence.kind`, and what happens once it's confirmed (the old UI's words). */
export const OWNER_GONE_RESOURCE: Record<string, OwnerGoneResource> = {
  environment_run_lease_active: { what: "A sandbox lease from this task's earlier run", releasing: "Releasing the sandbox lease…" },
  legacy_controller_lease: { what: "This task's earlier run", releasing: "Recovering the run…" },
  environment_teardown_claim: { what: "A sandbox cleanup from this task's earlier run", releasing: "Resuming the sandbox cleanup…" },
  sandbox_creation_intent: { what: "A sandbox this task's earlier run was creating", releasing: "Reconciling the sandbox…" },
  workspace_runtime_control_operation: { what: "A workspace service change from this task's earlier run", releasing: "Releasing the workspace…" },
  native_workspace_finalize_attempt: { what: "A workspace save from this task's earlier run", releasing: "Releasing the workspace save…" },
  native_finalizer_lease: { what: "The result handling of this task's earlier run", releasing: "Resuming the result handling…" },
  native_cleanup_lease: { what: "The cleanup of this task's earlier run", releasing: "Resuming the cleanup…" },
};
const OWNER_GONE_DEFAULT: OwnerGoneResource = { what: "A resource from this task's earlier run", releasing: "Releasing the resource…" };

/** The words for an unprovable record's kind, or the general ones for a kind this UI doesn't know. */
export function ownerGoneResource(kind: unknown): OwnerGoneResource {
  return typeof kind === "string" && Object.hasOwn(OWNER_GONE_RESOURCE, kind) ? OWNER_GONE_RESOURCE[kind] : OWNER_GONE_DEFAULT;
}

/** The card's headline for an unprovable record: what it is, and that it stays reserved. */
export function ownerGoneHeadline(kind: unknown) {
  return `${ownerGoneResource(kind).what} was recorded before Paperclip stored which server held it, so Paperclip can't verify that the server stopped. It stays reserved until then.`;
}

/** The native restart hold that needs original-host containment, with its reason (#19813). */
const CONTAINMENT_CAUSE_KEY = "native_restart_recovery_blocked";
export const CONTAINMENT_CAUSE = CONTAINMENT_CAUSE_KEY;
export const CONTAINMENT_REASON = "controller_process_space_unverified";

/**
 * Whether the action is the original-host containment hold (the old UI's
 * NativeControllerContainmentRecovery gate, without the digest): the server refuses every outcome
 * but recorded containment for it, so the card offers none.
 */
export function isContainmentHold(action: Pick<IssueRecoveryAction, "kind" | "ownerType" | "cause" | "evidence" | "status"> | null | undefined) {
  return (
    !!action &&
    action.kind === "active_run_watchdog" &&
    action.ownerType === "board" &&
    action.cause === CONTAINMENT_CAUSE &&
    action.evidence?.reason === CONTAINMENT_REASON &&
    (action.status === "active" || action.status === "escalated")
  );
}

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
  // Since the 2026-11-10 sync (#19813): only with `evidence.reason` CONTAINMENT_REASON (see `recoveryCard`).
  [CONTAINMENT_CAUSE_KEY]: {
    label: "Original execution not confirmed stopped",
    headline:
      "Paperclip can't verify that this run's original controller and provider stopped, because it can't compare process IDs across hosts or kernel sessions. Work stays held until an owner or admin records that both stopped.",
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
  /** What follows, from the wake policy (`followUpLine`, #21348). */
  followUp: string | null;
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
  const ownerGone = action.cause === OWNER_UNPROVABLE_CAUSE;
  const containment = isContainmentHold(action);
  const cause = ownerGone
    ? { label: "Previous server not confirmed stopped", headline: ownerGoneHeadline(action.evidence?.kind) }
    : action.cause && (action.cause !== CONTAINMENT_CAUSE || containment)
      ? CAUSES[action.cause]
      : undefined;
  const headline =
    cause?.headline ??
    (state === "needed" && action.ownerType === "board" && (action.kind === "active_run_watchdog" || action.kind === "deliberate_wait_without_target")
      ? "Paperclip's own repairs didn't move this task on, so it needs a person. Look at what happened and choose the next step."
      : (KIND_HEADLINES[action.kind] ?? KIND_HEADLINES.missing_disposition));
  const restoreFailure = action.evidence?.restoreFailure;
  const outcomes =
    state !== "needed" || containment
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
    // An unprovable record's next step repeats the headline and the confirmation under it.
    nextAction: ownerGone ? null : action.nextAction?.trim() || null,
    attempts: action.attemptCount > 1 ? `Attempt ${action.attemptCount}${action.maxAttempts ? ` of ${action.maxAttempts}` : ""}` : null,
    followUp: followUpLine(action),
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
 * - `owner-gone`: a record saved before Paperclip stored which server held it
 *   (`ownership_owner_unprovable`, since the 2026-11-09 sync), confirmed for that record and the
 *   version the board was shown (`POST …/recovery-actions/confirm-owner-gone`). It needs no run.
 *
 * Gone once the server has recorded a stop (`workspaceOwnerStop`, `controllerStop`, `ownerGone`)
 * or resumes.
 */
export type PreviousServerStop =
  | { kind: "owner"; runId: string; ownerToken: string }
  | { kind: "controller"; runId: string }
  /** A run that never recorded its process (#20310): from the task's interruption, with no action. */
  | { kind: "run"; runId: string }
  | { kind: "owner-gone"; recordId: string; recordVersion: string | null; resource: OwnerGoneResource };

export function previousServerStop(
  action: IssueRecoveryAction | null | undefined,
  issueId: string,
  companyId: string,
): PreviousServerStop | null {
  if (!action || action.companyId !== companyId || action.sourceIssueId !== issueId || !OPEN.has(action.status)) return null;
  if (action.cause === OWNER_UNPROVABLE_CAUSE) {
    const { recordId, recordUpdatedAt } = action.evidence;
    if (action.ownerType !== "board" || typeof recordId !== "string" || !recordId || action.evidence.ownerGone) return null;
    return {
      kind: "owner-gone",
      recordId,
      recordVersion: typeof recordUpdatedAt === "string" && recordUpdatedAt ? recordUpdatedAt : null,
      resource: ownerGoneResource(action.evidence.kind),
    };
  }
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
  | { kind: "run"; body: { runId: string; stopEvidence: string } }
  | { kind: "owner-gone"; body: OwnerGoneBody }
  | null {
  const stopEvidence = evidence.trim();
  if (stopEvidence.length < STOP_EVIDENCE_MIN) return null;
  switch (stop.kind) {
    case "owner":
      return { kind: "owner", body: { actionId, runId: stop.runId, ownerToken: stop.ownerToken, controllerAndCopybackStopped: true, stopEvidence } };
    case "controller":
      return { kind: "controller", body: { actionId, runId: stop.runId, stopEvidence } };
    case "run":
      // `confirmRunStoppedSchema` takes the run and the evidence only.
      return { kind: "run", body: { runId: stop.runId, stopEvidence } };
    case "owner-gone":
      // The version shown here: a record refreshed since must be confirmed again (the server refuses a mismatch).
      return {
        kind: "owner-gone",
        body: { actionId, recordId: stop.recordId, stopEvidence, ...(stop.recordVersion ? { recordVersion: stop.recordVersion } : {}) },
      };
  }
}

/** What `confirm-owner-gone` takes (shared `confirmOwnerGoneSchema`). */
export type OwnerGoneBody = { actionId: string; recordId: string; stopEvidence: string; recordVersion?: string };

/**
 * What the confirmation form is keyed by: a new action, run, owner token, record or record version
 * starts a fresh form, so the board never confirms something it wasn't shown. A run's stop has no
 * action, so it's keyed by its task's id (the old UI keys it by task and run).
 */
export function stopFormKey(actionId: string, stop: PreviousServerStop) {
  switch (stop.kind) {
    case "run":
      return `${actionId}:${stop.runId}:run`;
    case "owner":
      return `${actionId}:${stop.runId}:${stop.ownerToken}`;
    case "controller":
      return `${actionId}:${stop.runId}:controller`;
    case "owner-gone":
      return `${actionId}:${stop.recordId}:${stop.recordVersion ?? ""}`;
  }
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

/*
 * Original-host containment (#19813; the old UI's NativeControllerContainmentRecovery in
 * IssueRecoveryActionCard.tsx).
 */

/** The run and the server's controller authority the containment is bound to. Never typed in. */
export type ControllerContainment = { runId: string; digest: string };

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * The containment the board can record for the task's action, or null: the hold itself
 * (`isContainmentHold`), for this task, with the run and a well-formed authority digest
 * (`evidence.controllerAuthority.digest`).
 */
export function controllerContainment(action: IssueRecoveryAction | null | undefined, issueId: string, companyId: string): ControllerContainment | null {
  if (!action || action.companyId !== companyId || action.sourceIssueId !== issueId || !isContainmentHold(action)) return null;
  const runId = action.evidence.runId;
  const digest = obj(action.evidence.controllerAuthority).digest;
  return typeof runId === "string" && runId && typeof digest === "string" && DIGEST.test(digest) ? { runId, digest } : null;
}

export type ContainmentOutcome = "completed" | "not_performed" | "mixed";

/** The reviewed outcomes of the run's external actions, in the old UI's words. */
export const CONTAINMENT_OUTCOMES: { value: ContainmentOutcome; label: string }[] = [
  { value: "completed", label: "All completed" },
  { value: "not_performed", label: "None performed" },
  { value: "mixed", label: "Some completed and some not performed" },
];

export type ContainmentDraft = { controllerStopped: boolean; providerStopped: boolean; actionOutcome: ContainmentOutcome | ""; evidence: string };

/** What `resolve` takes to record containment (shared `resolveIssueRecoveryActionSchema`). */
export type ContainmentBody = {
  actionId: string;
  outcome: "restored";
  sourceIssueStatus: string;
  executionReconciliation: {
    runId: string;
    controllerStopped: true;
    providerStopped: true;
    controllerAuthorityDigest: string;
    actionOutcome: ContainmentOutcome;
    outcomeEvidence: string;
  };
};

/**
 * What recording containment sends, or null until both stops are confirmed, the outcome is chosen
 * and the evidence has 20 characters. The task keeps its status: containment doesn't retry.
 */
export function containmentBody(containment: ControllerContainment, actionId: string, sourceIssueStatus: string, draft: ContainmentDraft): ContainmentBody | null {
  const outcomeEvidence = draft.evidence.trim();
  if (!draft.controllerStopped || !draft.providerStopped || !draft.actionOutcome || outcomeEvidence.length < STOP_EVIDENCE_MIN) return null;
  return {
    actionId,
    outcome: "restored",
    sourceIssueStatus,
    executionReconciliation: {
      runId: containment.runId,
      controllerStopped: true,
      providerStopped: true,
      controllerAuthorityDigest: containment.digest,
      actionOutcome: draft.actionOutcome,
      outcomeEvidence,
    },
  };
}

/** A new action, run or authority snapshot starts a fresh form, so old confirmations never carry over. */
export function containmentFormKey(actionId: string, containment: ControllerContainment) {
  return `${actionId}:${containment.runId}:${containment.digest}`;
}
