import type { DecisionInput, DecisionOption } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Proposals (Decisions): an agent proposes options, each with the changes choosing it applies, and a
 * person picks one or dismisses it. As ui/src/api/decisions.ts calls them. The response shapes live
 * in the old UI, not in @paperclipai/shared (only the option, input and effect specs are shared), so
 * the fields ui-new reads are declared here.
 *
 * - One decision with its per-effect results (`GET /decisions/:id`).
 * - The open list, for which targets changed since the proposal (`targetChanged`): an effect marked
 *   strict is skipped when its target changed, so the card holds those options back.
 * - Decide with an option and the text inputs; dismiss runs nothing.
 */

export type DecisionStatus = "open" | "decided" | "expired" | "cancelled";
export type DecisionExecutionStatus = "running" | "succeeded" | "partial" | "failed";
export type DecisionEffectExecutionStatus = "claimed" | "executed" | "failed" | "skipped";

export type DecisionTargetSnapshot = {
  status: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  updatedAt: string;
  descendantCount?: number;
  descendantIds?: string[];
  /** Snapshots from before `descendantCount` was named. */
  childCount?: number;
};

export type Decision = {
  id: string;
  companyId: string;
  bundleId: string | null;
  originAgentId: string;
  originIssueId: string;
  originRunId: string;
  ruleKey: string | null;
  title: string;
  body: string;
  options: DecisionOption[];
  inputs: DecisionInput[] | null;
  status: DecisionStatus;
  executionStatus: DecisionExecutionStatus | null;
  chosenOptionId: string | null;
  inputValues: Record<string, string> | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  expiresAt: string;
  /** Keyed by task id; an archive proposal keys its feed items `attention:<kind>:<id>`. */
  targetSnapshots: Record<string, DecisionTargetSnapshot>;
  continuationPolicy: "none" | "wake_origin_agent";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DecisionEffectExecution = {
  id: string;
  decisionId: string;
  effectIndex: number;
  effectType: string;
  targetIssueId: string;
  status: DecisionEffectExecutionStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  activityLogId: string | null;
  executedAt: string | null;
};

/** One decision with what each of its effects did. */
export type DecisionOutcome = Decision & { executions: DecisionEffectExecution[] };

export type DecisionListItem = Decision & { targetChanged: Record<string, boolean> };

export const decisionsApi = {
  get: (id: string, signal?: AbortSignal) => api.get<DecisionOutcome>(`/decisions/${id}`, { signal }),
  open: (companyId: string, signal?: AbortSignal) => api.get<DecisionListItem[]>(`/companies/${companyId}/decisions?status=open`, { signal }),
  decide: (id: string, input: { optionId: string; inputValues?: Record<string, string>; idempotencyKey?: string | null }) =>
    api.post<DecisionOutcome>(`/decisions/${id}/decide`, input),
  dismiss: (id: string, reason?: string) => api.post<DecisionOutcome>(`/decisions/${id}/dismiss`, reason ? { reason } : {}),
};
