import type { ActivityEvent, DashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

/*
 * What the organization pages (boards 19 and 20) read beyond the shared lists: the reporting tree,
 * the dashboard summary, recent company activity and the built-in agents. Calls mirror
 * ui/src/api/agents.ts (`org`), dashboard.ts, activity.ts and builtInAgents.ts. The agent requests
 * (pause, resume, run now, edits, catalogs, your primary agent) are `agentsApi`'s, and the run
 * history is `runsApi.list`, the request workload reads.
 */

/** One node of `GET /companies/:id/org`: the server's lean tree, terminated agents left out. */
export type OrgNode = { id: string; name: string; role: string; status: string; reports: OrgNode[] };

/**
 * One entry of `GET /companies/:id/built-in-agents` (only when the instance turns on
 * `enableBuiltInAgents`; the server answers 404 otherwise). The type lives in the old UI
 * (ui/src/api/builtInAgents.ts); these are the fields read here.
 */
export type BuiltInAgentState = {
  definition: { key: string; displayName: string; shortPurpose: string };
  status: "not_provisioned" | "pending_approval" | "needs_setup" | "ready" | "paused";
  agentId: string | null;
};

export const orgApi = {
  tree: (companyId: string, signal?: AbortSignal) =>
    api.get<OrgNode[]>(`/companies/${encodeURIComponent(companyId)}/org`, { signal }),
  dashboard: (companyId: string, signal?: AbortSignal) =>
    api.get<DashboardSummary>(`/companies/${encodeURIComponent(companyId)}/dashboard`, { signal }),
  activity: (companyId: string, limit: number, signal?: AbortSignal) =>
    api.get<ActivityEvent[]>(`/companies/${encodeURIComponent(companyId)}/activity?limit=${limit}`, { signal }),
  builtInAgents: (companyId: string, signal?: AbortSignal) =>
    api.get<BuiltInAgentState[]>(`/companies/${encodeURIComponent(companyId)}/built-in-agents`, { signal }),
};
