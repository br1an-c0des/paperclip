import type { IssueRecoveryAction } from "@paperclipai/shared";
import type { RecoveryActionsInspection } from "@/api/issues";
import { RETAINED_EXPORT_CAUSES } from "./recovery";

/*
 * Recover saved files (`tasks/recovery`, since the 2026-11-05 sync, upstream #18848), after the old
 * UI's WorkspaceExportRecovery.tsx (RetainedFilesRecovery). A native run that failed while its files
 * were still in its sandbox leaves an export hold: no other attempt starts until those files are
 * saved back. A board member asks for that (`POST …/recovery-actions/recover-workspace`); the
 * server's worker stops the run, copies the files and verifies them, so a request being accepted
 * never means the files are saved.
 *
 * - Before asking, the task's recovery actions are read again with the failed run's source
 *   inspected. A changed, retired or unverified source, or one not waiting to be recovered, is
 *   refused here.
 * - One request key is saved before the request and kept, so a lost answer or a reload sends the
 *   same one again. A new key needs an explicit click and a freshly confirmed exhausted attempt
 *   ("Try file recovery again", which spent export repairs handed to the board offer, #19208).
 * - Queued, recovering, failed and verified states read apart. Nothing is resent by itself.
 * - Since the 2026-11-07 sync (#19840): a source that can't be verified says why, and the task's
 *   Retry stays offered beside it, since Retry renews and re-verifies the recovery. Only a
 *   verified source makes Recover saved files the way on, which hides Retry.
 */

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});

/** A retained-export recovery action on this task, which Recover saved files applies to. */
export function isRetainedExport(action: IssueRecoveryAction | null | undefined, issueId: string, companyId: string): action is IssueRecoveryAction {
  return (
    !!action &&
    action.companyId === companyId &&
    action.sourceIssueId === issueId &&
    action.kind === "active_run_watchdog" &&
    (action.status === "active" || action.status === "escalated") &&
    (action.ownerType === "board" || action.ownerType === "system") &&
    !!action.cause &&
    RETAINED_EXPORT_CAUSES.has(action.cause) &&
    typeof action.evidence.runId === "string" &&
    action.evidence.runId.length > 0
  );
}

/**
 * The action as the inspection read it, while it still names the same run. The recovery record is
 * bound by its own identity; whether its source verified (`sourceVerified`) gates only the ask.
 */
export function boundAction(
  data: RecoveryActionsInspection | undefined,
  action: Pick<IssueRecoveryAction, "id">,
  runId: string,
  issueId: string,
  companyId: string,
): IssueRecoveryAction | null {
  const current = data?.actions.find((item) => item.id === action.id);
  const inspected = data?.sourceInspection;
  const state = obj(current?.evidence.workspaceRecovery);
  return isRetainedExport(current, issueId, companyId) &&
    current.evidence.runId === runId &&
    state.runId === runId &&
    state.schema === "paperclip.workspace-recovery.v1" &&
    inspected?.actionId === action.id &&
    inspected.runId === runId
    ? current
    : null;
}

/** Whether the inspection verified the recorded source, so the files may be recovered from it. */
export function sourceVerified(data: RecoveryActionsInspection | undefined) {
  return data?.sourceInspection?.status === "verified";
}

/**
 * Why a source didn't verify, in plain words (the old UI's `unverifiedSourceText`), the code kept
 * for support. Empty for a verified or missing inspection.
 */
export function unverifiedSourceText(inspected: RecoveryActionsInspection["sourceInspection"]) {
  if (!inspected || inspected.status === "verified") return "";
  if (inspected.status === "not_inspected") return "Paperclip can't check the saved files' source here, because the run recorded too many sources.";
  const code = inspected.sourceVerification?.reason ?? inspected.failureCode;
  return code === "allocation_ownership_ambiguous"
    ? "Paperclip can't confirm that this run alone used the sandbox that holds the saved files."
    : `Paperclip can't verify the saved files' recorded source (${code}).`;
}

export type FileRecoveryView = {
  /** What's happening, in a sentence. */
  message: string;
  /** The ask, when one may be sent now: "recover", or "again" after a confirmed failed attempt. */
  offer: "recover" | "again" | null;
  /** Whether to offer Check file recovery status. */
  check: boolean;
  /** Something to warn about, if anything. */
  alert: string | null;
  /** Why the source didn't verify, when that's what keeps the ask back; Retry stays the way on. */
  unverified: string | null;
  /**
   * Whether this offers the way on itself (a verified source, files not yet saved), so the task's
   * Retry gives way (#19840). Otherwise Retry renews the recovery, so a hold never dead-ends.
   */
  ownsRetry: boolean;
};

/**
 * What the recovery shows, from the inspected action (`current`, null when the source changed),
 * the saved request's key, and what this view has seen: an accepted ask, or a check that found the
 * saved request unconfirmed.
 */
export function fileRecoveryView(input: {
  current: IssueRecoveryAction | null;
  /** Whether the inspection has answered (or failed). */
  inspected: boolean;
  inspectionFailed: boolean;
  /** Whether the inspection verified the recorded source (`sourceVerified`). */
  verified: boolean;
  /** Why it didn't (`unverifiedSourceText`). */
  unverifiedText?: string;
  pendingKey: string | null;
  acknowledged: boolean;
  checkedUnconfirmed: boolean;
}): FileRecoveryView {
  const recovery = obj(input.current?.evidence.workspaceRecovery);
  const system = obj(input.current?.evidence.systemRecovery);
  const requestIds = Array.isArray(recovery.requestIds) ? recovery.requestIds : [];
  const serverAcknowledged = !!input.pendingKey && requestIds.includes(input.pendingKey);
  const restoring = recovery.status === "queued" || recovery.status === "recovering";
  const preserved = Array.isArray(system.preservationOperationIds) ? system.preservationOperationIds : [];
  const saved =
    recovery.status === "recovered" && system.state === "complete" && preserved.length > 0 && preserved.every((id) => typeof id === "string" && id.length > 0);
  const retryable = recovery.status === "blocked" && recovery.retryable === true;
  const failedReceipt = serverAcknowledged && recovery.status === "blocked";
  const confirmedFailedAttempt = failedReceipt && retryable && system.state === "exhausted";
  const waiting = !failedReceipt && !saved && (restoring || input.acknowledged || serverAcknowledged);
  const unconfirmed = !!input.pendingKey && !input.acknowledged && !serverAcknowledged;
  const sourceChanged = input.inspected && !input.inspectionFailed && !input.current;

  const message = saved
    ? "Saved files recovered. Task recovery is still being checked."
    : failedReceipt
      ? "File recovery hasn't finished. The saved files stay protected."
      : restoring
        ? "Recovering saved files. Work stays paused until they're verified."
        : waiting
          ? "File recovery is queued. Waiting for the saved files to be verified."
          : "The saved files need recovering before work can go on.";
  const verified = !!input.current && input.verified;
  const canAsk = verified && retryable && !waiting && (!input.pendingKey || (unconfirmed && input.checkedUnconfirmed) || confirmedFailedAttempt);
  const alert = sourceChanged
    ? "The recorded files are unavailable or have changed. Look at the recovery before going on."
    : input.current && recovery.status === "blocked" && (serverAcknowledged || recovery.retryable !== true)
      ? "File recovery hasn't finished and needs service help. The saved files stay protected."
      : null;
  return {
    message,
    offer: canAsk ? (confirmedFailedAttempt ? "again" : "recover") : null,
    check: waiting || unconfirmed || failedReceipt || input.inspectionFailed || sourceChanged,
    alert,
    // Shown after a failed attempt too; hidden only while recovery runs.
    unverified:
      input.current && !verified && !saved && !waiting
        ? `${input.unverifiedText || "Paperclip can't verify the saved files' recorded source."} Paperclip doesn't apply files it can't verify. Retry renews the recovery.`
        : null,
    ownsRetry: !input.inspected || (verified && !saved),
  };
}

/** Why an ask can't be sent, after reading the action again, or null when it can. */
export function askRefusal(fresh: IssueRecoveryAction | null, restart: boolean, previousKey: string | null): string | null {
  const state = obj(fresh?.evidence.workspaceRecovery);
  if (!fresh || state.status !== "blocked" || state.retryable !== true) return "File recovery changed. Check its status before asking again.";
  if (restart) {
    const ids = Array.isArray(state.requestIds) ? state.requestIds : [];
    if (!previousKey || !ids.includes(previousKey) || obj(fresh.evidence.systemRecovery).state !== "exhausted") {
      return "The failed recovery isn't confirmed. Check its status before trying again.";
    }
  }
  return null;
}

// The saved request, per signed-in person, in localStorage.

export type SavedRecoveryRequest = { idempotencyKey: string; actionId: string; runId: string; createdAt: number };

export function requestStorageKey(companyId: string, issueId: string, actionId: string, runId: string, owner: string) {
  return `ui-new:workspace-file-recovery:${companyId}:${issueId}:${actionId}:${runId}:${owner}`;
}

export function readSavedRequest(storage: Pick<Storage, "getItem"> | null, key: string, actionId: string, runId: string): SavedRecoveryRequest | null {
  try {
    const value = obj(JSON.parse(storage?.getItem(key) ?? "null"));
    return typeof value.idempotencyKey === "string" && value.actionId === actionId && value.runId === runId
      ? { idempotencyKey: value.idempotencyKey, actionId, runId, createdAt: typeof value.createdAt === "number" ? value.createdAt : 0 }
      : null;
  } catch {
    return null;
  }
}

/** Saves the request before it's sent; false when the browser won't keep it, so nothing is sent. */
export function saveRequest(storage: Pick<Storage, "setItem"> | null, key: string, request: SavedRecoveryRequest) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}
