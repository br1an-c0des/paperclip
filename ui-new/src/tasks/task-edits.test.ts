import { describe, expect, it } from "vitest";
import {
  billingCodeEdit,
  blockersEdit,
  canManagePrivacy,
  canMarkDone,
  descriptionEdit,
  nextStatus,
  runOverrides,
  runOverridesEdit,
  runSummary,
  taskLink,
  taskMarkdown,
  titleEdit,
  workspaceChoice,
  workspaceEdit,
  workspacePickerAvailable,
} from "./task-edits";

const claude = { adapterType: "claude_local", adapterConfig: { model: "claude-opus-5-5", effort: "medium" } };
const codex = { adapterType: "codex_local", adapterConfig: { model: "gpt-5.5" } };

describe("text edits", () => {
  it("trims a title and refuses an empty one", () => {
    expect(titleEdit("Old", "  New   title ")).toEqual({ title: "New title" });
    expect(titleEdit("Old", "   ")).toBeNull();
    expect(titleEdit("Old", "Old ")).toBeNull();
  });

  it("saves a description without trailing space, and clears an empty one", () => {
    expect(descriptionEdit("a", "a\n\n")).toBeNull();
    expect(descriptionEdit("a", "  b\n")).toEqual({ description: "  b" });
    expect(descriptionEdit("a", " \n")).toEqual({ description: null });
    expect(descriptionEdit(null, "")).toBeNull();
  });

  it("trims a billing code and clears an empty one", () => {
    expect(billingCodeEdit(null, " OPS-1 ")).toEqual({ billingCode: "OPS-1" });
    expect(billingCodeEdit("OPS-1", "")).toEqual({ billingCode: null });
    expect(billingCodeEdit("OPS-1", "OPS-1")).toBeNull();
  });
});

describe("status steps", () => {
  it("moves each open status on by one", () => {
    expect(nextStatus("todo")).toBe("in_progress");
    expect(nextStatus("in_progress")).toBe("in_review");
    expect(nextStatus("in_review")).toBe("done");
    expect(nextStatus("done")).toBeNull();
    expect(canMarkDone("in_progress")).toBe(true);
    expect(canMarkDone("cancelled")).toBe(false);
  });
});

describe("blockersEdit", () => {
  const task = { blockedBy: [{ id: "b1" } as never] };
  it("adds and removes one blocker, sending the whole list", () => {
    expect(blockersEdit(task, "b2", true)).toEqual({ blockedByIssueIds: ["b1", "b2"] });
    expect(blockersEdit(task, "b1", false)).toEqual({ blockedByIssueIds: [] });
    expect(blockersEdit(task, "b1", true)).toBeNull();
  });
});

describe("run overrides", () => {
  it("reads the model and whichever effort key the adapter uses", () => {
    expect(runOverrides({ assigneeAdapterOverrides: { adapterConfig: { model: "m", modelReasoningEffort: "high" } } })).toEqual({ model: "m", effort: "high" });
    expect(runOverrides({ assigneeAdapterOverrides: null })).toEqual({ model: null, effort: null });
  });

  it("sets a model, keeping other adapter options", () => {
    const task = { assigneeAdapterOverrides: { adapterConfig: { chrome: true }, useProjectWorkspace: false } };
    expect(runOverridesEdit(task, claude, { model: "claude-sonnet-5" })).toEqual({
      assigneeAdapterOverrides: { useProjectWorkspace: false, adapterConfig: { chrome: true, model: "claude-sonnet-5" } },
    });
  });

  it("writes the effort under the adapter's own key", () => {
    expect(runOverridesEdit({ assigneeAdapterOverrides: null }, codex, { effort: "high" })).toEqual({
      assigneeAdapterOverrides: { adapterConfig: { modelReasoningEffort: "high" } },
    });
    expect(runOverridesEdit({ assigneeAdapterOverrides: null }, claude, { effort: "low" })).toEqual({
      assigneeAdapterOverrides: { adapterConfig: { effort: "low" } },
    });
  });

  it("clears the overrides when both go back to the agent's default", () => {
    const task = { assigneeAdapterOverrides: { adapterConfig: { model: "m", effort: "low" } } };
    expect(runOverridesEdit({ assigneeAdapterOverrides: { adapterConfig: { model: "m" } } }, claude, { model: null })).toEqual({
      assigneeAdapterOverrides: null,
    });
    expect(runOverridesEdit(task, claude, { effort: null })).toEqual({ assigneeAdapterOverrides: { adapterConfig: { model: "m" } } });
  });

  it("drops a Codex effort the new model doesn't offer", () => {
    const task = { assigneeAdapterOverrides: { adapterConfig: { modelReasoningEffort: "minimal" } } };
    expect(runOverridesEdit(task, codex, { model: "gpt-6-luna" })).toEqual({ assigneeAdapterOverrides: { adapterConfig: { model: "gpt-6-luna" } } });
  });

  it("sends nothing for adapters without overrides, or when nothing changes", () => {
    expect(runOverridesEdit({ assigneeAdapterOverrides: null }, { adapterType: "http", adapterConfig: {} }, { model: "x" })).toBeNull();
    expect(runOverridesEdit({ assigneeAdapterOverrides: null }, claude, { model: null })).toBeNull();
  });

  it("sums the overrides up with the model's label", () => {
    const task = { assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5-5", effort: "high" } } };
    expect(runSummary(task, (id) => (id === "claude-opus-5-5" ? "Opus 5.5" : id))).toBe("Opus 5.5, high effort");
    expect(runSummary({ assigneeAdapterOverrides: null })).toBeNull();
  });
});

describe("workspace", () => {
  const none = { executionWorkspaceId: null, executionWorkspacePreference: null, executionWorkspaceSettings: null, currentExecutionWorkspace: null };

  it("tells which choice the task is on", () => {
    expect(workspaceChoice(none)).toBe("default");
    expect(workspaceChoice({ ...none, executionWorkspacePreference: "isolated_workspace" })).toBe("isolated");
    expect(workspaceChoice({ ...none, executionWorkspaceId: "w1", executionWorkspaceSettings: { mode: "isolated_workspace" } })).toBe("reuse");
  });

  it("builds each choice's fields", () => {
    expect(workspaceEdit("default")).toEqual({ executionWorkspacePreference: null, executionWorkspaceId: null, executionWorkspaceSettings: null });
    expect(workspaceEdit("isolated")).toEqual({
      executionWorkspacePreference: "isolated_workspace",
      executionWorkspaceId: null,
      executionWorkspaceSettings: { mode: "isolated_workspace", environmentId: null },
    });
    expect(workspaceEdit("reuse", { id: "w1", mode: "adapter_managed" })).toEqual({
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceId: "w1",
      executionWorkspaceSettings: { mode: "agent_default", environmentId: null },
    });
    expect(workspaceEdit("reuse")).toBeNull();
  });

  it("offers the picker only when the instance and the project have workspaces on", () => {
    const project = { executionWorkspacePolicy: { enabled: true } } as never;
    expect(workspacePickerAvailable(project, true)).toBe(true);
    expect(workspacePickerAvailable(project, false)).toBe(false);
    expect(workspacePickerAvailable(null, true)).toBe(false);
  });
});

describe("header actions", () => {
  it("copies the task as Markdown and as a link", () => {
    expect(taskMarkdown({ identifier: "TRA-41", title: "Pull data", description: "Body\n" })).toBe("# TRA-41: Pull data\n\nBody");
    expect(taskMarkdown({ identifier: null, title: "Pull data", description: null })).toBe("# Pull data");
    expect(taskLink("https://board.test", "TRA", { id: "uuid", identifier: "TRA-41" })).toBe("https://board.test/TRA/issues/TRA-41");
  });

  it("lets the task's people, admins and local boards change privacy", () => {
    const task = { companyId: "c1", responsibleUserId: null, createdByUserId: "u1", assigneeUserId: null };
    const member = { source: "session", isInstanceAdmin: false, companyIds: ["c1"], memberships: [{ companyId: "c1", status: "active", membershipRole: "member" }] };
    expect(canManagePrivacy(task, "u2", member, true)).toBe(true);
    expect(canManagePrivacy(task, "u1", member, false)).toBe(true);
    expect(canManagePrivacy(task, "u2", member, false)).toBe(false);
    expect(canManagePrivacy(task, "u2", { ...member, memberships: [{ companyId: "c1", status: "active", membershipRole: "admin" }] }, false)).toBe(true);
    expect(canManagePrivacy(task, "u2", null, false)).toBe(false);
  });
});
