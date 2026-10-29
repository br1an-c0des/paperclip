import type { HandoffCaseInput } from "@paperclipai/shared";
import type { CaseSummary } from "@/api/cases";

/*
 * The hand-off that starts a case with no work yet (StartWorkflow.tsx), checked here so the dialog
 * can say what's missing before the server does. The server's rules (`agentCaseHandoffSchema` in
 * packages/shared): an existing case needs its hand-off version; a case without a main task needs a
 * workflow, a company template or text, not both.
 */

export type StartWorkflowDraft = {
  workflowId: string;
  workflowText: string;
  agentId: string;
  phase: string;
  instructions: string;
};

/** The request, or what's missing. */
export function startWorkflowInput(kase: Pick<CaseSummary, "id" | "handoffVersion">, draft: StartWorkflowDraft, idempotencyKey: string): HandoffCaseInput | string {
  if (!draft.workflowId && !draft.workflowText.trim()) return "Pick a workflow template or write the workflow.";
  if (!draft.phase.trim()) return "Name the first phase.";
  if (!draft.agentId) return "Pick the agent who starts it.";
  if (!draft.instructions.trim()) return "Say what the first phase should do.";
  return {
    idempotencyKey,
    case: { id: kase.id },
    toAgentId: draft.agentId,
    phase: draft.phase.trim(),
    instructions: draft.instructions.trim(),
    expectedHandoffVersion: kase.handoffVersion,
    ...(draft.workflowId ? { workflowId: draft.workflowId } : { workflow_document_text: draft.workflowText }),
  };
}
