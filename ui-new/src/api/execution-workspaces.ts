import type { ExecutionWorkspace, ExecutionWorkspaceSummary, WorkspaceRuntimeControlTarget } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Execution workspaces, as ui/src/api/execution-workspaces.ts uses them: the workspace a task runs
 * in, starting or stopping its runtime services, and the company's workspaces in brief (names and
 * modes, for the task list's workspace filter and grouping).
 */

export const executionWorkspacesApi = {
  get: (id: string, signal?: AbortSignal) => api.get<ExecutionWorkspace>(`/execution-workspaces/${id}`, { signal }),
  controlRuntimeServices: (id: string, action: "start" | "stop" | "restart", target: WorkspaceRuntimeControlTarget = {}) =>
    api.post<{ workspace: ExecutionWorkspace }>(`/execution-workspaces/${id}/runtime-services/${action}`, target),
  /** Every execution workspace in the company, in brief (`?summary=true`). */
  listSummaries: (companyId: string, signal?: AbortSignal) =>
    api.get<ExecutionWorkspaceSummary[]>(`/companies/${encodeURIComponent(companyId)}/execution-workspaces?summary=true`, { signal }),
};
