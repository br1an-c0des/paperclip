import type { IssueWorkProduct, WorkspaceFileRef } from "@paperclipai/shared";
import type { WorkspaceFileQuery } from "@/api/file-resources";

/*
 * Pointers into a workspace from elsewhere: a work product whose `metadata.resourceRef` names a
 * workspace file opens that file in the viewer, at its line if it has one.
 */

export type FileOpen = WorkspaceFileQuery & { line?: number | null };

/** A work product's pointer into the workspace, if it has a usable one. */
export function workspaceFileRef(output: Pick<IssueWorkProduct, "metadata">): WorkspaceFileRef | null {
  const ref = (output.metadata as { resourceRef?: unknown } | null)?.resourceRef;
  if (!ref || typeof ref !== "object") return null;
  const candidate = ref as Partial<WorkspaceFileRef>;
  if (candidate.kind !== "workspace_file" || typeof candidate.relativePath !== "string" || !candidate.relativePath) return null;
  return candidate as WorkspaceFileRef;
}

/** Where the viewer opens for a reference: its execution workspace, or the named project workspace. */
export function fileOpenFor(ref: WorkspaceFileRef): FileOpen {
  const project = ref.workspaceKind === "project_workspace";
  return {
    path: ref.relativePath,
    line: ref.line ?? null,
    workspace: project ? "project" : "execution",
    projectId: project ? (ref.projectId ?? null) : null,
    workspaceId: project && ref.projectId ? ref.workspaceId : null,
  };
}
