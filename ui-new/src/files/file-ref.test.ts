import { describe, expect, it } from "vitest";
import { fileOpenFor, workspaceFileRef } from "./file-ref";

const ref = {
  kind: "workspace_file",
  workspaceKind: "execution_workspace",
  workspaceId: "w1",
  relativePath: "src/app.ts",
  displayPath: "src/app.ts",
  line: 12,
};

describe("workspace file references", () => {
  it("reads a work product's resourceRef", () => {
    expect(workspaceFileRef({ metadata: { resourceRef: ref } })?.relativePath).toBe("src/app.ts");
    expect(workspaceFileRef({ metadata: null })).toBeNull();
    expect(workspaceFileRef({ metadata: { resourceRef: { kind: "url", relativePath: "x" } } })).toBeNull();
    expect(workspaceFileRef({ metadata: { resourceRef: { ...ref, relativePath: "" } } })).toBeNull();
  });

  it("opens execution workspace files by path and line", () => {
    expect(fileOpenFor(ref as never)).toEqual({ path: "src/app.ts", line: 12, workspace: "execution", projectId: null, workspaceId: null });
  });

  it("names a project workspace by both ids", () => {
    const open = fileOpenFor({ ...ref, workspaceKind: "project_workspace", projectId: "p1", line: null } as never);
    expect(open).toEqual({ path: "src/app.ts", line: null, workspace: "project", projectId: "p1", workspaceId: "w1" });
  });
});
