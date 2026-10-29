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

export const heartbeatsApi = {
  liveRuns: (companyId: string) => api.get<LiveRun[]>(`/companies/${companyId}/live-runs`),
  /** Stops a queued or running run. */
  cancel: (runId: string) => api.post<unknown>(`/heartbeat-runs/${runId}/cancel`, {}),
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
