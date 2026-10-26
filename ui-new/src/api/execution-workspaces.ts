import type { ExecutionWorkspace, WorkspaceRuntimeControlTarget } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Execution workspaces, as ui/src/api/execution-workspaces.ts uses them: the workspace a task runs
 * in, and starting or stopping its runtime services.
 */

export const executionWorkspacesApi = {
  get: (id: string, signal?: AbortSignal) => api.get<ExecutionWorkspace>(`/execution-workspaces/${id}`, { signal }),
  controlRuntimeServices: (id: string, action: "start" | "stop" | "restart", target: WorkspaceRuntimeControlTarget = {}) =>
    api.post<{ workspace: ExecutionWorkspace }>(`/execution-workspaces/${id}/runtime-services/${action}`, target),
};
