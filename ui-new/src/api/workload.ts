import type { HeartbeatRun } from "@paperclipai/shared";
import { api } from "./client";

/*
 * What agent workload (boards 31–33) reads beyond the shared lists. There's no workload API, so the
 * views are worked out from the company's run history, its live runs and task assignments:
 *
 * - `runs`: the latest runs, newest first (`GET /companies/:id/heartbeat-runs?summary=true`), as the
 *   old UI's run lists read them. The endpoint takes an agent and a limit (at most 1000), but no
 *   date range or project, so the views ask for the most and say when the oldest days aren't loaded.
 * - `builtInAgentIds`: which agents are built in (`GET /companies/:id/built-in-agents`), for the
 *   company view's "Built in" group. The endpoint answers 404 while the instance has built-in agents
 *   turned off (`enableBuiltInAgents`), which means there are none.
 */

/** The run list's row with `summary=true`: the run without its log, usage or result. */
export type WorkloadRun = Pick<HeartbeatRun, "id" | "agentId" | "status" | "invocationSource"> & {
  issueId?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** From the run's result; the server sends a numeric string, or null when the harness reported none. */
  costUsd?: number | string | null;
};

/** The most runs the server returns in one list (`HEARTBEAT_RUN_LIST_MAX_LIMIT`). */
export const WORKLOAD_RUN_LIMIT = 1000;

type BuiltInAgentState = { agentId: string | null };

export const workloadApi = {
  runs: (companyId: string, signal?: AbortSignal) =>
    api.get<WorkloadRun[]>(
      `/companies/${encodeURIComponent(companyId)}/heartbeat-runs?${new URLSearchParams({ summary: "true", limit: String(WORKLOAD_RUN_LIMIT) })}`,
      { signal },
    ),
  builtInAgentIds: async (companyId: string, signal?: AbortSignal) => {
    try {
      const states = await api.get<BuiltInAgentState[]>(`/companies/${encodeURIComponent(companyId)}/built-in-agents`, { signal });
      return states.flatMap((state) => (state.agentId ? [state.agentId] : []));
    } catch (error) {
      if (signal?.aborted) throw error;
      return [];
    }
  },
};
