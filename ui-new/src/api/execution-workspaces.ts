import type { ExecutionWorkspace, ExecutionWorkspaceSummary, WorkspaceRuntimeControlTarget } from "@paperclipai/shared";
import { api } from "./client";
import type { WorkspaceOperationRow } from "./heartbeats";

/*
 * Execution workspaces, as ui/src/api/execution-workspaces.ts uses them: the workspace a task runs
 * in, its operations (setup, provisioning, the commands run in it, cleanup), controlling its
 * services, and the company's workspaces in brief (names and modes, for the task list's workspace
 * filter and grouping).
 *
 * Two ways to control services:
 * - `runtime-services/:action` acts on services that have run (a `runtimeServiceId`).
 * - `runtime-commands/:action` acts on the commands the workspace's runtime config defines (a
 *   `workspaceCommandId`), so it can start a service that has never run, and `run` runs a job once.
 *   The old UI's task properties and workspace page use this one.
 * Both start or stop processes on the machine running the workspace, and record an operation.
 */

export type RuntimeCommandAction = "start" | "stop" | "restart" | "run";

export type RuntimeControlResult = { workspace: ExecutionWorkspace; operation?: WorkspaceOperationRow };

/** The target fields the server reads; anything else is dropped, as the old UI does. */
function target(input: WorkspaceRuntimeControlTarget): WorkspaceRuntimeControlTarget {
  const picked: WorkspaceRuntimeControlTarget = {};
  if (input.workspaceCommandId) picked.workspaceCommandId = input.workspaceCommandId;
  if (input.runtimeServiceId) picked.runtimeServiceId = input.runtimeServiceId;
  if (input.serviceIndex !== undefined && input.serviceIndex !== null) picked.serviceIndex = input.serviceIndex;
  return picked;
}

export const executionWorkspacesApi = {
  get: (id: string, signal?: AbortSignal) => api.get<ExecutionWorkspace>(`/execution-workspaces/${id}`, { signal }),
  controlRuntimeServices: (id: string, action: "start" | "stop" | "restart", control: WorkspaceRuntimeControlTarget = {}) =>
    api.post<RuntimeControlResult>(`/execution-workspaces/${id}/runtime-services/${action}`, target(control)),
  controlRuntimeCommands: (id: string, action: RuntimeCommandAction, control: WorkspaceRuntimeControlTarget = {}) =>
    api.post<RuntimeControlResult>(`/execution-workspaces/${id}/runtime-commands/${action}`, target(control)),
  /** Everything done to the workspace, newest first. */
  operations: (id: string, signal?: AbortSignal) =>
    api.get<WorkspaceOperationRow[]>(`/execution-workspaces/${id}/workspace-operations`, { signal }),
  /** Every execution workspace in the company, in brief (`?summary=true`). */
  listSummaries: (companyId: string, signal?: AbortSignal) =>
    api.get<ExecutionWorkspaceSummary[]>(`/companies/${encodeURIComponent(companyId)}/execution-workspaces?summary=true`, { signal }),
};
