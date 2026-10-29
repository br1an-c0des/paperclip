import { describe, expect, it } from "vitest";
import { startWorkflowInput, type StartWorkflowDraft } from "./start-workflow";

const draft: StartWorkflowDraft = { workflowId: "w1", workflowText: "", agentId: "a1", phase: " Research ", instructions: "Find setups." };

describe("startWorkflowInput", () => {
  it("builds the hand-off for a case with no work yet", () => {
    expect(startWorkflowInput({ id: "c1", handoffVersion: 0 }, draft, "key")).toEqual({
      idempotencyKey: "key",
      case: { id: "c1" },
      toAgentId: "a1",
      phase: "Research",
      instructions: "Find setups.",
      expectedHandoffVersion: 0,
      workflowId: "w1",
    });
  });

  it("sends written workflow text instead of a template", () => {
    const built = startWorkflowInput({ id: "c1", handoffVersion: 2 }, { ...draft, workflowId: "", workflowText: "Do it." }, "key");
    expect(built).toMatchObject({ workflow_document_text: "Do it.", expectedHandoffVersion: 2 });
    expect(built).not.toHaveProperty("workflowId");
  });

  it("says what's missing", () => {
    expect(startWorkflowInput({ id: "c1", handoffVersion: 0 }, { ...draft, workflowId: "" }, "k")).toMatch(/workflow/);
    expect(startWorkflowInput({ id: "c1", handoffVersion: 0 }, { ...draft, phase: " " }, "k")).toMatch(/phase/);
    expect(startWorkflowInput({ id: "c1", handoffVersion: 0 }, { ...draft, agentId: "" }, "k")).toMatch(/agent/);
    expect(startWorkflowInput({ id: "c1", handoffVersion: 0 }, { ...draft, instructions: "" }, "k")).toMatch(/first phase should do/);
  });
});
