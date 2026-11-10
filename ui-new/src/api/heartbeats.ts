import type { PaperclipQuestionResponse } from "@paperclipai/adapter-utils";
import type { AgentAppearance, WorkspaceOperation } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Runs that are queued or running right now (`GET /companies/:id/live-runs`), for the nav's agent
 * states and the task panel, stopping a run, and what's done to a run while it goes, as
 * ui/src/api/heartbeats.ts calls them:
 *
 * - Watchdog decisions on a run that has gone quiet (`outputSilence` on the run): keep watching,
 *   snooze the warning, or mark it a false positive. The board, or the agent assigned the
 *   evaluation task, may record one; anyone else gets a 403.
 * - Runtime requests: a native run's harness asking for permission or input mid-turn, answered
 *   with one of its choices or with the fields it asked for. Answering resumes the run.
 * - Workspace operations: what Paperclip did to the run's workspace (worktree setup, provisioning,
 *   cleanup), each with a stored log.
 *
 * The live-runs response type lives in the old UI; these are the fields ui-new reads.
 */

export type LiveRun = {
  id: string;
  status: string;
  agentId: string;
  agentName: string;
  agentAppearance?: AgentAppearance | null;
  issueId?: string | null;
  startedAt: string | null;
  createdAt: string;
} & LiveRunStatus;

/**
 * What an active run says it's doing (U107, upstream #20460). The server keeps it in memory, not in
 * the database, and adds it to active runs on `GET /companies/:id/live-runs`, `/issues/:id/live-runs`,
 * `/issues/:id/active-run` and `GET /heartbeat-runs/:id`; `heartbeat.run.progress` events carry each
 * change. Gone when the run ends, the status expires, or the server restarts. A storage outage shows
 * here as phase `waiting_for_storage`: "Waiting for file storage before starting the run log (45s so
 * far)".
 */
export type LiveRunStatus = {
  currentStatusMessage?: string | null;
  currentStatusUpdatedAt?: string | null;
  currentToolName?: string | null;
  lastAssistantSnippet?: string | null;
  /** The run's last sign of life: a status, a log line, an event. */
  lastEventAt?: string | null;
  /** The last output stored for the run. */
  lastOutputAt?: string | null;
};

export type WatchdogDecision = "continue" | "snooze" | "dismissed_false_positive";

export type WatchdogDecisionInput = {
  runId: string;
  decision: WatchdogDecision;
  /** The watchdog's evaluation task, when it opened one. */
  evaluationIssueId?: string | null;
  reason?: string | null;
  /** Required for a snooze, and in the future. */
  snoozedUntil?: string | null;
};

/** What kind of request a harness raised, as the runner reports it. */
export type RuntimeRequestKind = "runtime" | "command_approval" | "file_approval" | "permission_approval" | "user_input" | "elicitation";

export type RuntimeRequestResolution =
  | { action: "accept" | "accept_for_session" | "decline" | "cancel" }
  | { action: "submit"; answers: Record<string, { answers: string[] }> }
  | { action: "submit"; content: Record<string, unknown> }
  | { action: "submit"; response: PaperclipQuestionResponse };

export type ResolveRuntimeRequestInput = {
  runId: string;
  requestId: string;
  turnId: string;
  requestKind: RuntimeRequestKind;
  resolution: RuntimeRequestResolution;
};

/** A slice of an operation's stored log: newline-delimited `{ ts, stream, chunk }` records. */
export type WorkspaceOperationLog = {
  operationId: string;
  store: string;
  logRef: string;
  content: string;
  nextOffset?: number;
};

/** A workspace operation as the API sends it, its dates as ISO strings. */
export type WorkspaceOperationRow = Omit<WorkspaceOperation, "startedAt" | "finishedAt" | "createdAt" | "updatedAt"> & {
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The run as Stop reads it and the cancel answers it: enough to check the Stop landed. */
export type StoppedRun = { id: string; companyId: string; status: string; resultJson: Record<string, unknown> | null };

/**
 * Whether the cancel's answer carries this Stop's intent, recorded and not yet sent to the native
 * session (`resultJson.nativeCancellation`), which a correlated Stop may settle later
 * (ui/src/api/heartbeats.ts `cancel`, upstream #18899).
 */
export function hasPendingNativeStop(run: StoppedRun | null, runId: string, cancellationRequestId: string) {
  const value = run?.resultJson?.nativeCancellation;
  const intent = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return (
    !!run &&
    run.id === runId &&
    intent?.schema === "paperclip.native-cancellation.v1" &&
    intent.runId === runId &&
    intent.companyId === run.companyId &&
    intent.intentId === `native-cancellation:${cancellationRequestId}` &&
    intent.scope === "run" &&
    intent.dispatchState === "pending" &&
    intent.dispatched === false &&
    typeof intent.intentAuditId === "string" &&
    intent.intentAuditId.length > 0
  );
}

export const heartbeatsApi = {
  liveRuns: (companyId: string) => api.get<LiveRun[]>(`/companies/${companyId}/live-runs`),
  /** One run, for Stop to read what it was asked before (`resultJson.startupCancellation`). */
  get: (runId: string, signal?: AbortSignal) => api.get<StoppedRun>(`/heartbeat-runs/${runId}`, { signal }),
  /**
   * Stops a queued or running run, or a failed native run that still owns a retry
   * (`execution.canStop`). A correlated Stop sends a `cancellationRequestId` the UI saved first
   * (tasks/run-stop.ts); its answer must be the cancelled run, or carry the Stop's pending intent,
   * or the Stop didn't land. A native session still starting answers 409 `native_stop_pending`: the
   * Stop is recorded and settles as cancelled when the session opens (upstream #19189).
   */
  cancel: async (runId: string, options?: { cancellationRequestId: string }) => {
    const run = await api.post<StoppedRun | null>(`/heartbeat-runs/${runId}/cancel`, options ?? {});
    if (options && run?.status !== "cancelled" && !hasPendingNativeStop(run, runId, options.cancellationRequestId)) {
      throw new Error("Stop wasn't accepted because the run changed.");
    }
    return run;
  },
  recordWatchdogDecision: (input: WatchdogDecisionInput) =>
    api.post<unknown>(`/heartbeat-runs/${input.runId}/watchdog-decisions`, {
      decision: input.decision,
      evaluationIssueId: input.evaluationIssueId ?? null,
      reason: input.reason ?? null,
      snoozedUntil: input.snoozedUntil ?? null,
    }),
  resolveRuntimeRequest: (input: ResolveRuntimeRequestInput) =>
    api.post<{ accepted: true; commandId: string }>(
      `/heartbeat-runs/${input.runId}/runtime-requests/${encodeURIComponent(input.requestId)}/resolve`,
      { turnId: input.turnId, requestKind: input.requestKind, resolution: input.resolution },
    ),
  /** What Paperclip did to the run's workspace. */
  runWorkspaceOperations: (runId: string, signal?: AbortSignal) =>
    api.get<WorkspaceOperationRow[]>(`/heartbeat-runs/${runId}/workspace-operations`, { signal }),
  workspaceOperationLog: (operationId: string, offset = 0, limitBytes = 256_000, signal?: AbortSignal) =>
    api.get<WorkspaceOperationLog>(`/workspace-operations/${operationId}/log?offset=${offset}&limitBytes=${limitBytes}`, { signal }),
};
