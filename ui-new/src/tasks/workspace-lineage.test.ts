import type { Issue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { inLineage, outsideLineage, taskLineage } from "./workspace-lineage";

const parent = {
  id: "parent",
  executionWorkspaceId: "ws-parent",
  currentExecutionWorkspace: { id: "ws-parent-current" },
  ancestors: [{ id: "grand" }, { id: "root" }],
} as unknown as Issue;

describe("workspace lineage (U61)", () => {
  it("collects the parent, its ancestors and the workspaces they're bound to", () => {
    const lineage = taskLineage(parent, [{ id: "grand", executionWorkspaceId: "ws-grand" } as Issue, null]);
    expect([...lineage.issueIds].sort()).toEqual(["grand", "parent", "root"]);
    expect([...lineage.workspaceIds].sort()).toEqual(["ws-grand", "ws-parent", "ws-parent-current"]);
  });

  it("leaves out workspaces an ancestor made or is bound to, and keeps the rest", () => {
    const lineage = taskLineage(parent, [{ id: "grand", executionWorkspaceId: "ws-grand" } as Issue]);
    const workspaces = [
      { id: "ws-parent", sourceIssueId: "elsewhere" },
      { id: "ws-grand", sourceIssueId: null },
      { id: "ws-made-by-root", sourceIssueId: "root" },
      { id: "ws-sibling", sourceIssueId: "sibling" },
      { id: "ws-loose", sourceIssueId: null },
    ];
    expect(outsideLineage(workspaces, lineage).map((workspace) => workspace.id)).toEqual(["ws-sibling", "ws-loose"]);
    expect(inLineage({ id: "ws-made-by-root", sourceIssueId: "root" }, lineage)).toBe(true);
  });

  it("filters nothing without a lineage (no parent)", () => {
    const workspaces = [{ id: "a", sourceIssueId: "x" }];
    expect(outsideLineage(workspaces, null)).toEqual(workspaces);
    expect(inLineage({ id: "a" }, undefined)).toBe(false);
  });
});
