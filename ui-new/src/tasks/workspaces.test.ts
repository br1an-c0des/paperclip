import type { CompactIssue, Project } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { workspaceLookup, type WorkspaceSummary } from "./workspaces";

const projects = [
  {
    id: "p1",
    name: "Trading",
    executionWorkspacePolicy: null,
    primaryWorkspace: { id: "pw-main" },
    workspaces: [
      { id: "pw-main", name: "main" },
      { id: "pw-docs", name: "" },
    ],
  },
] as unknown as Project[];

const executions: WorkspaceSummary[] = [
  { id: "ew-shared", name: "Shared main", mode: "shared_workspace", projectWorkspaceId: "pw-main" },
  { id: "ew-branch", name: "feature/login", mode: "isolated_workspace", projectWorkspaceId: "pw-main" },
];

function task(extra: Partial<CompactIssue>) {
  return { executionWorkspaceId: null, projectWorkspaceId: null, projectId: "p1", ...extra } as CompactIssue;
}

describe("workspaceLookup", () => {
  const lookup = workspaceLookup(projects, executions);

  it("counts the project's default workspace, and a shared one over it, as no workspace of its own", () => {
    expect(lookup.of(task({}))).toBeNull();
    expect(lookup.of(task({ projectWorkspaceId: "pw-main" }))).toBeNull();
    expect(lookup.of(task({ executionWorkspaceId: "ew-shared" }))).toBeNull();
    expect(lookup.of(task({ projectId: null }))).toBeNull();
  });

  it("gives an isolated workspace, or another project workspace, as the task's own", () => {
    expect(lookup.of(task({ executionWorkspaceId: "ew-branch", projectWorkspaceId: "pw-main" }))).toBe("ew-branch");
    expect(lookup.of(task({ projectWorkspaceId: "pw-docs" }))).toBe("pw-docs");
  });

  it("names workspaces, falling back to the project's name", () => {
    expect(lookup.name("ew-branch")).toBe("feature/login");
    expect(lookup.name("pw-docs")).toBe("Trading");
    expect(lookup.name("missing")).toBeUndefined();
  });

  it("starts tasks added to a workspace's group in that workspace", () => {
    expect(lookup.defaults("ew-branch")).toEqual({
      executionWorkspaceId: "ew-branch",
      executionWorkspaceMode: "reuse_existing",
      projectWorkspaceId: "pw-main",
      projectId: "p1",
    });
    expect(lookup.defaults("pw-docs")).toEqual({ projectWorkspaceId: "pw-docs", projectId: "p1" });
    expect(lookup.defaults("missing")).toEqual({});
  });
});
