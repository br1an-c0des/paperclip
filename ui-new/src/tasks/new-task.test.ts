import { afterEach, describe, expect, it } from "vitest";
import {
  buildCreatePayload,
  clearDraft,
  draftProblem,
  effortOptions,
  emptyDraft,
  loadDraft,
  saveDraft,
  type PayloadContext,
} from "./new-task";

const context: PayloadContext = { adapterType: null, project: null, isolatedWorkspacesEnabled: false, idempotencyKey: "key-1" };

describe("buildCreatePayload", () => {
  it("sends the basics with a duplicate allowance and the idempotency key", () => {
    const payload = buildCreatePayload(emptyDraft({ title: "  Fix login  ", projectId: "p1" }), context);
    expect(payload).toMatchObject({ title: "Fix login", projectId: "p1", status: "todo", allowDuplicate: true, idempotencyKey: "key-1" });
    expect(payload).not.toHaveProperty("executionPolicy");
    expect(payload).not.toHaveProperty("reviewPolicy");
  });

  it("sends extra fields only while they're shown", () => {
    const draft = emptyDraft({ title: "T", parentId: "parent", billingCode: "OPS", private: true, extras: ["billing"] });
    const payload = buildCreatePayload(draft, context);
    expect(payload.billingCode).toBe("OPS");
    expect(payload).not.toHaveProperty("parentId");
    expect(payload).not.toHaveProperty("visibility");
  });

  it("puts model and effort overrides under the adapter's own key", () => {
    const draft = emptyDraft({ title: "T", assignee: { kind: "agent", id: "a1" }, model: "gpt-6-sol", effort: "ultra" });
    const codex = buildCreatePayload(draft, { ...context, adapterType: "codex_local" });
    expect(codex.assigneeAgentId).toBe("a1");
    expect(codex.assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "ultra" } });
    const other = buildCreatePayload(draft, { ...context, adapterType: "http" });
    expect(other).not.toHaveProperty("assigneeAdapterOverrides");
  });

  it("turns the reviewer and approver into execution stages", () => {
    const draft = emptyDraft({
      title: "T",
      reviewer: { kind: "user", id: "u1" },
      approver: { kind: "agent", id: "a2" },
      extras: ["approver"],
    });
    const policy = buildCreatePayload(draft, context).executionPolicy as { stages: { type: string; participants: unknown[] }[] };
    expect(policy.stages.map((stage) => stage.type)).toEqual(["review", "approval"]);
    expect(policy.stages[0]!.participants[0]).toMatchObject({ type: "user", userId: "u1", agentId: null });
    expect(policy.stages[1]!.participants[0]).toMatchObject({ type: "agent", agentId: "a2", userId: null });
  });

  it("sends the workspace only when the project and instance allow it", () => {
    const project = {
      id: "p1",
      executionWorkspacePolicy: { enabled: true, defaultMode: "isolated_workspace" },
      workspaces: [{ id: "w1", isPrimary: true }],
    } as unknown as PayloadContext["project"];
    const draft = emptyDraft({ title: "T", workspace: "isolated_workspace" });
    expect(buildCreatePayload(draft, { ...context, project })).not.toHaveProperty("executionWorkspacePreference");
    expect(buildCreatePayload(draft, { ...context, project, isolatedWorkspacesEnabled: true })).toMatchObject({
      executionWorkspacePreference: "isolated_workspace",
      executionWorkspaceSettings: { mode: "isolated_workspace" },
      projectWorkspaceId: "w1",
    });
  });
});

describe("effortOptions", () => {
  it("follows the adapter, and for Codex the model", () => {
    expect(effortOptions("claude_local", null).map((option) => option.value)).toEqual(["low", "medium", "high"]);
    expect(effortOptions("codex_local", "gpt-6-sol").map((option) => option.value)).toContain("ultra");
    expect(effortOptions("codex_local", "unknown").map((option) => option.value)).toContain("minimal");
  });
});

describe("drafts", () => {
  afterEach(() => clearDraft("c1"));

  it("needs a title or a description, and a watchdog once the role is added", () => {
    expect(draftProblem(emptyDraft())).not.toBeNull();
    expect(draftProblem(emptyDraft({ description: "Context" }))).toBeNull();
    expect(draftProblem(emptyDraft({ title: "T", extras: ["watchdog"] }))).toMatch(/watchdog/);
  });

  it("keeps a draft with content and forgets an empty one", () => {
    saveDraft("c1", emptyDraft({ title: "Half written" }));
    expect(loadDraft("c1")?.title).toBe("Half written");
    saveDraft("c1", emptyDraft());
    expect(loadDraft("c1")).toBeNull();
  });
});
