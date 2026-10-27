import type { CompactIssue, ExecutionWorkspaceSummary, Project } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";

/*
 * Which workspace a task works in, for the task list's workspace filter and grouping, after the old
 * list (ui/src/lib/issue-filters.ts, `resolveIssueFilterWorkspaceId`). A task on its project's
 * default workspace, or on a shared execution workspace over it, counts as having no workspace of its
 * own (`null`); otherwise it's its execution workspace, or the project workspace it picked.
 *
 * Names come from the projects list (project workspaces) and the company's execution workspace
 * summaries (`GET /api/companies/:companyId/execution-workspaces?summary=true`), which the old list
 * also reads.
 */

export type WorkspaceSummary = Pick<ExecutionWorkspaceSummary, "id" | "name" | "mode" | "projectWorkspaceId">;

export type WorkspaceLookup = {
  /** The task's own workspace, or null when it runs in its project's default one (or has none). */
  of: (task: Pick<CompactIssue, "executionWorkspaceId" | "projectId" | "projectWorkspaceId">) => string | null;
  name: (id: string) => string | undefined;
  /** What a task added to the workspace's group starts with. */
  defaults: (id: string) => Record<string, unknown>;
};

export function workspaceLookup(projects: readonly Project[], executions: readonly WorkspaceSummary[]): WorkspaceLookup {
  const defaultFor = new Map<string, string>();
  const projectWorkspaces = new Map<string, { name: string; projectId: string }>();
  for (const project of projects) {
    const id = project.executionWorkspacePolicy?.defaultProjectWorkspaceId ?? project.primaryWorkspace?.id ?? null;
    if (id) defaultFor.set(project.id, id);
    for (const workspace of project.workspaces ?? []) {
      projectWorkspaces.set(workspace.id, { name: workspace.name || project.name, projectId: project.id });
    }
  }
  const executionById = new Map(executions.map((workspace) => [workspace.id, workspace] as const));

  return {
    of: (task) => {
      const projectDefault = task.projectId ? (defaultFor.get(task.projectId) ?? null) : null;
      if (task.executionWorkspaceId) {
        const execution = executionById.get(task.executionWorkspaceId);
        const over = execution?.projectWorkspaceId ?? task.projectWorkspaceId ?? null;
        if (execution?.mode === "shared_workspace" && over !== null && over === projectDefault) return null;
        return task.executionWorkspaceId;
      }
      if (task.projectWorkspaceId && task.projectWorkspaceId !== projectDefault) return task.projectWorkspaceId;
      return null;
    },
    name: (id) => executionById.get(id)?.name ?? projectWorkspaces.get(id)?.name,
    defaults: (id) => {
      const execution = executionById.get(id);
      if (execution) {
        const over = execution.projectWorkspaceId ? projectWorkspaces.get(execution.projectWorkspaceId) : undefined;
        return {
          executionWorkspaceId: id,
          executionWorkspaceMode: "reuse_existing",
          ...(execution.projectWorkspaceId ? { projectWorkspaceId: execution.projectWorkspaceId } : {}),
          ...(over ? { projectId: over.projectId } : {}),
        };
      }
      const workspace = projectWorkspaces.get(id);
      return workspace ? { projectWorkspaceId: id, projectId: workspace.projectId } : {};
    },
  };
}

/** The company's execution workspaces, in brief. Waits until `enabled`, as only some views need them. */
export function useWorkspaceSummaries(enabled: () => boolean) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.executionWorkspaces.summaryList(company().id),
    queryFn: ({ signal }) => executionWorkspacesApi.listSummaries(company().id, signal),
    enabled: enabled(),
    staleTime: 60_000,
  }));
}
