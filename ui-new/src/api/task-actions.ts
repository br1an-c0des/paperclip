import type {
  AgentProjectAccess,
  ExecutionWorkspace,
  IssueLabel,
  IssuePrivacyConstraints,
  IssueRetryNowResponse,
  IssueTreeControlMode,
  IssueTreeControlPreview,
  IssueTreeHold,
  IssueWatchdog,
  ReleaseIssueTreeHoldResponse,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The requests behind a task's header actions, health notices and execution properties, as
 * ui/src/api/issues.ts and ui/src/api/agents.ts make them: privacy, pausing and cancelling a task
 * tree, resuming a paused assignee, the agent's project access, the watchdog, the monitor's check,
 * a scheduled retry, new labels, and the workspaces a task can reuse. Kept apart from issues.ts so
 * the slices of M2 that add to that file don't collide.
 */

/** The task's active pause, if any (`GET /issues/:id/tree-control/state`). Typed in the old UI only. */
export type TreeControlState = {
  activePauseHold: {
    holdId: string;
    rootIssueId: string;
    issueId: string;
    isRoot: boolean;
    mode: "pause";
    reason: string | null;
    releasePolicy: { strategy: "manual" | "after_active_runs_finish"; note?: string | null } | null;
  } | null;
};

/** What a wake request says about why the agent woke, as the old UI's task page sends it. */
export type AgentWakeRequest = {
  source: "assignment" | "on_demand" | "timer" | "automation";
  reason?: string | null;
  triggerDetail?: string;
  payload?: Record<string, unknown> | null;
};

function withCompany(path: string, companyId?: string) {
  return companyId ? `${path}${path.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(companyId)}` : path;
}

export const taskActionsApi = {
  privacyConstraints: (id: string, signal?: AbortSignal) =>
    api.get<IssuePrivacyConstraints>(`/issues/${id}/privacy-constraints`, { signal }),

  treeControlState: (id: string, signal?: AbortSignal) => api.get<TreeControlState>(`/issues/${id}/tree-control/state`, { signal }),
  /** What pausing, resuming, cancelling or restoring the task's tree would touch. */
  previewTreeControl: (id: string, mode: IssueTreeControlMode, signal?: AbortSignal) =>
    api.post<IssueTreeControlPreview>(`/issues/${id}/tree-control/preview`, { mode, releasePolicy: { strategy: "manual" } }, { signal }),
  createTreeHold: (id: string, body: { mode: IssueTreeControlMode; releasePolicy?: Record<string, unknown> | null; metadata?: Record<string, unknown> | null }) =>
    api.post<{ hold: IssueTreeHold; preview: IssueTreeControlPreview }>(`/issues/${id}/tree-holds`, { reason: null, ...body }),
  listTreeHolds: (id: string, filters: { status?: "active" | "released"; mode?: IssueTreeControlMode }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.mode) params.set("mode", filters.mode);
    return api.get<IssueTreeHold[]>(`/issues/${id}/tree-holds?${params}`, { signal });
  },
  releaseTreeHold: (id: string, holdId: string, wakeAgents: boolean) =>
    api.post<ReleaseIssueTreeHoldResponse>(`/issues/${id}/tree-holds/${holdId}/release`, { reason: null, metadata: { wakeAgents } }),

  resumeAgent: (agentId: string, companyId: string) => api.post<unknown>(withCompany(`/agents/${encodeURIComponent(agentId)}/resume`, companyId), {}),
  wakeAgent: (agentId: string, companyId: string, body: AgentWakeRequest) =>
    api.post<unknown>(withCompany(`/agents/${encodeURIComponent(agentId)}/wakeup`, companyId), body),
  agentProjectAccess: (agentId: string, signal?: AbortSignal) =>
    api.get<AgentProjectAccess>(`/agents/${encodeURIComponent(agentId)}/project-access`, { signal }),

  /** The agent that watches a task and keeps it moving (`PUT|DELETE /issues/:id/watchdog`). */
  setWatchdog: (id: string, body: { agentId: string; instructions: string | null }) => api.put<IssueWatchdog>(`/issues/${id}/watchdog`, body),
  removeWatchdog: (id: string) => api.delete<{ ok: true }>(`/issues/${id}/watchdog`),
  /** Runs the task's monitor check now instead of at its scheduled time. */
  checkMonitorNow: (id: string) => api.post<{ ok: true }>(`/issues/${id}/monitor/check-now`, {}),
  /** Pulls a scheduled retry forward. */
  retryScheduledNow: (id: string) => api.post<IssueRetryNowResponse>(`/issues/${id}/scheduled-retry/retry-now`, {}),
  createLabel: (companyId: string, body: { name: string; color: string }) => api.post<IssueLabel>(`/companies/${companyId}/labels`, body),

  /** Workspaces in the project a task can be moved onto (`reuseEligible`). */
  reusableWorkspaces: (companyId: string, filters: { projectId: string; projectWorkspaceId?: string | null }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ projectId: filters.projectId, reuseEligible: "true" });
    if (filters.projectWorkspaceId) params.set("projectWorkspaceId", filters.projectWorkspaceId);
    return api.get<ExecutionWorkspace[]>(`/companies/${companyId}/execution-workspaces?${params}`, { signal });
  },
};
