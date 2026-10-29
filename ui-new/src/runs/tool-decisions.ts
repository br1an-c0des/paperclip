import type { ToolRunDecision } from "@paperclipai/shared";
import type { ToolRefs } from "./transcript-model";

/*
 * The tool gateway's decisions on a run's tool calls (`GET /companies/:id/tools/runs/:runId/
 * decisions`), matched to the transcript's tool steps and put in a word, after the old run
 * transcript (ui/src/components/transcript/RunTranscriptView.tsx, `findToolDecision` and
 * `summarizeToolDecision`). A call is matched by its invocation id, else its action request id,
 * else its tool-use id read as either.
 */

export type DecisionLookup = (refs: ToolRefs) => ToolRunDecision | null;

export type DecisionSummary = { label: string; tone: "green" | "amber" | "red" | "neutral"; detail: string | null };

export function decisionLookup(decisions: readonly ToolRunDecision[] | undefined): DecisionLookup {
  const byInvocation = new Map<string, ToolRunDecision>();
  const byActionRequest = new Map<string, ToolRunDecision>();
  for (const decision of decisions ?? []) {
    byInvocation.set(decision.invocation.id, decision);
    if (decision.actionRequest?.id) byActionRequest.set(decision.actionRequest.id, decision);
    if (decision.latestAuditEvent?.actionRequestId) byActionRequest.set(decision.latestAuditEvent.actionRequestId, decision);
  }
  return (refs) => {
    if (byInvocation.size === 0) return null;
    if (refs.invocationId && byInvocation.has(refs.invocationId)) return byInvocation.get(refs.invocationId)!;
    if (refs.actionRequestId && byActionRequest.has(refs.actionRequestId)) return byActionRequest.get(refs.actionRequestId)!;
    if (refs.toolUseId) return byInvocation.get(refs.toolUseId) ?? byActionRequest.get(refs.toolUseId) ?? null;
    return null;
  };
}

const words = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");

/** What the gateway did with the call, in a word, with the reason when it held or refused it. */
export function summarizeDecision(decision: ToolRunDecision): DecisionSummary {
  const reason = decision.denialReason ?? decision.reasonCode ?? null;
  const { invocation, actionRequest, outcome } = decision;
  if (decision.pendingAction) {
    return { label: "Needs approval", tone: "amber", detail: `Action request ${decision.pendingAction.actionRequestId.slice(0, 8)}` };
  }
  if (decision.denialReason || invocation.status === "denied" || outcome === "denied") {
    return { label: "Denied", tone: "red", detail: reason };
  }
  if (invocation.status === "failed" || invocation.status === "timed_out" || outcome === "failure" || outcome === "timeout") {
    return { label: invocation.status === "timed_out" || outcome === "timeout" ? "Timed out" : "Failed", tone: "red", detail: reason };
  }
  if (actionRequest?.status === "approved") return { label: "Approved", tone: "green", detail: null };
  if (actionRequest?.status === "executed") return { label: "Executed", tone: "green", detail: null };
  if (decision.decision === "allow" || ["authorized", "executing", "succeeded"].includes(invocation.status)) {
    return { label: "Allowed", tone: "green", detail: null };
  }
  if (decision.decision === "require_approval" || invocation.approvalState === "pending") {
    return { label: "Needs approval", tone: "amber", detail: null };
  }
  return { label: words(invocation.status), tone: "neutral", detail: null };
}
