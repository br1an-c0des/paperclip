import type { Issue } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";

/*
 * A subtask never shares a workspace with its parent or any other ancestor (U61, upstream #19860).
 * The server drops an ancestor's `executionWorkspaceId` on create without a word
 * (server/src/services/task-workspace-lineage.ts, `isAncestorExecutionWorkspace`), and releases an
 * existing task bound to one at its next run. So the "reuse another task's workspace" lists leave
 * out every workspace that belongs to the task's lineage: one an ancestor created
 * (`sourceIssueId`), or one an ancestor is bound to (`executionWorkspaceId`).
 */

export type TaskLineage = { issueIds: ReadonlySet<string>; workspaceIds: ReadonlySet<string> };

type LineageIssue = Pick<Issue, "id" | "executionWorkspaceId"> & Partial<Pick<Issue, "currentExecutionWorkspace">>;

/** The lineage from a task's parent (the full read, with its `ancestors`) and the ancestors' own rows. */
export function taskLineage(parent: LineageIssue & Pick<Issue, "ancestors">, ancestorRows: readonly (LineageIssue | null | undefined)[] = []): TaskLineage {
  const issueIds = new Set([parent.id, ...(parent.ancestors ?? []).map((ancestor) => ancestor.id)]);
  const workspaceIds = new Set<string>();
  for (const row of [parent, ...ancestorRows]) {
    if (!row) continue;
    issueIds.add(row.id);
    if (row.executionWorkspaceId) workspaceIds.add(row.executionWorkspaceId);
    if (row.currentExecutionWorkspace?.id) workspaceIds.add(row.currentExecutionWorkspace.id);
  }
  return { issueIds, workspaceIds };
}

/** Whether a workspace belongs to the lineage: an ancestor made it or is bound to it. */
export function inLineage(workspace: { id: string; sourceIssueId?: string | null }, lineage: TaskLineage | null | undefined) {
  if (!lineage) return false;
  return lineage.workspaceIds.has(workspace.id) || (!!workspace.sourceIssueId && lineage.issueIds.has(workspace.sourceIssueId));
}

/** The workspaces a task under this lineage may reuse. */
export function outsideLineage<T extends { id: string; sourceIssueId?: string | null }>(workspaces: readonly T[], lineage: TaskLineage | null | undefined): T[] {
  return lineage ? workspaces.filter((workspace) => !inLineage(workspace, lineage)) : [...workspaces];
}

/**
 * The lineage above a parent task: the parent's full read (`GET /issues/:id`, which lists its
 * ancestors) and each ancestor's row (`?view=core`) for the workspace it's bound to. An ancestor that
 * can't be read still counts by its id.
 */
export function useTaskLineage(parentId: () => string | null | undefined, enabled: () => boolean = () => true) {
  return createQuery(() => ({
    queryKey: [...queryKeys.issues.section(parentId() ?? "", "workspace-lineage")],
    queryFn: async ({ signal }): Promise<TaskLineage> => {
      const parent = await issuesApi.get(parentId()!, signal);
      const ancestors = await Promise.allSettled((parent.ancestors ?? []).map((ancestor) => issuesApi.getCore(ancestor.id, signal)));
      return taskLineage(
        parent,
        ancestors.map((result) => (result.status === "fulfilled" ? result.value : null)),
      );
    },
    enabled: !!parentId() && enabled(),
    staleTime: 30_000,
  }));
}
