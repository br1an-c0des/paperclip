import type {
  ExecutionWorkspace,
  ExecutionWorkspaceCloseReadiness,
  ExecutionWorkspaceStatus,
  WorkspaceOverviewResponse,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's workspaces (`workspaces/overview`, the Workspaces tab) and what's done to one, as
 * ui/src/api/execution-workspaces.ts uses them:
 *
 * - The overview: every execution workspace in pages, with its path, branch, status, services and
 *   linked tasks. The server leaves archived (closed) workspaces out unless `status` asks for them.
 * - Close readiness: whether a workspace can be closed now and what closing does, with its git state
 *   (branch, base, ahead/behind, uncommitted files), which the task's Workspace section also shows.
 * - Closing (`PATCH { status: "archived" }`), which the server refuses (409) while it's blocked.
 * - Branch reconcile (`workspaces/files-git`): point the recorded branch at the live one. `forward`
 *   is the ancestry-proven path (the server re-checks); `override` is the audited break-glass with
 *   a reason; `quarantine_restore` moves uncommitted changes to a rescue branch and restores the
 *   recorded one. Each can put the task back to work, which wakes its agent.
 *
 * Starting and stopping a workspace's services is `executionWorkspacesApi.controlRuntimeServices`.
 */

export type ReconcileBranchInput = { mode: "forward" } | { mode: "override"; reason: string } | { mode: "quarantine_restore" };

export const workspacesApi = {
  overview: (companyId: string, options: { offset?: number; status?: readonly ExecutionWorkspaceStatus[] } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options.status?.length) params.set("status", options.status.join(","));
    if (options.offset) params.set("offset", String(options.offset));
    const query = params.toString();
    return api.get<WorkspaceOverviewResponse>(`/companies/${encodeURIComponent(companyId)}/workspace-overview${query ? `?${query}` : ""}`, { signal });
  },
  closeReadiness: (workspaceId: string, signal?: AbortSignal) =>
    api.get<ExecutionWorkspaceCloseReadiness>(`/execution-workspaces/${encodeURIComponent(workspaceId)}/close-readiness`, { signal }),
  close: (workspaceId: string) => api.patch<ExecutionWorkspace>(`/execution-workspaces/${encodeURIComponent(workspaceId)}`, { status: "archived" }),
  reconcileBranch: (workspaceId: string, input: ReconcileBranchInput) =>
    api.post<unknown>(`/execution-workspaces/${encodeURIComponent(workspaceId)}/reconcile-branch`, input),
};
