import { api } from "./client";
import type { RunSummary } from "./runs";

/*
 * What agent workload (boards 31–33) reads beyond the shared lists. There's no workload API, so the
 * views are worked out from the company's run history, its live runs and task assignments:
 *
 * - The run history is the company's latest runs, newest first (`runsApi.list` with `summary=true`
 *   and `WORKLOAD_RUN_LIMIT`), as the old UI's run lists read them. The endpoint takes an agent and
 *   a limit (at most 1000), but no date range or project, so the views ask for the most and say
 *   when the oldest days aren't loaded.
 * - `builtInAgentIds`: which agents are built in (`GET /companies/:id/built-in-agents`), for the
 *   company view's "Built in" group. The endpoint answers 404 while the instance has built-in agents
 *   turned off (`enableBuiltInAgents`), which means there are none.
 */

/** A run in the workload views: the run list's summary row (api/runs.ts). */
export type WorkloadRun = RunSummary;

/** The most runs the server returns in one list (`HEARTBEAT_RUN_LIST_MAX_LIMIT`). */
export const WORKLOAD_RUN_LIMIT = 1000;

type BuiltInAgentState = { agentId: string | null };

export const workloadApi = {
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
