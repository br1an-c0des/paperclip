import type {
  ActivityEvent,
  Agent,
  AgentRuntimeSettingsPatch,
  AgentWakeupResponse,
  AiConnectionBinding,
  DashboardSummary,
  PrimaryAgentPreference,
} from "@paperclipai/shared";
import type { AdapterModel } from "./agents";
import { api } from "./client";

/*
 * The organization pages (boards 19 and 20): the reporting tree, the dashboard summary, recent
 * company activity and runs, built-in agents and your primary agent, and the agent requests that
 * Manage agents sends for one agent or many. Calls mirror ui/src/api/agents.ts, dashboard.ts,
 * activity.ts, heartbeats.ts, builtInAgents.ts and primaryAgent.ts.
 */

/** One node of `GET /companies/:id/org`: the server's lean tree, terminated agents left out. */
export type OrgNode = { id: string; name: string; role: string; status: string; reports: OrgNode[] };

/**
 * A row of `GET /companies/:id/heartbeat-runs?summary=true`. The server returns the whole run row;
 * these are the fields the org pages read.
 */
export type RunSummary = {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

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

/** How many recent runs the dashboard and roster count from: the server's maximum page. */
export const RECENT_RUN_LIMIT = 1000;

function agentPath(id: string, companyId: string, suffix = "") {
  return `/agents/${encodeURIComponent(id)}${suffix}?companyId=${encodeURIComponent(companyId)}`;
}

export const orgApi = {
  tree: (companyId: string, signal?: AbortSignal) =>
    api.get<OrgNode[]>(`/companies/${encodeURIComponent(companyId)}/org`, { signal }),
  dashboard: (companyId: string, signal?: AbortSignal) =>
    api.get<DashboardSummary>(`/companies/${encodeURIComponent(companyId)}/dashboard`, { signal }),
  activity: (companyId: string, limit: number, signal?: AbortSignal) =>
    api.get<ActivityEvent[]>(`/companies/${encodeURIComponent(companyId)}/activity?limit=${limit}`, { signal }),
  recentRuns: (companyId: string, signal?: AbortSignal) =>
    api.get<RunSummary[]>(`/companies/${encodeURIComponent(companyId)}/heartbeat-runs?summary=true&limit=${RECENT_RUN_LIMIT}`, { signal }),
  builtInAgents: (companyId: string, signal?: AbortSignal) =>
    api.get<BuiltInAgentState[]>(`/companies/${encodeURIComponent(companyId)}/built-in-agents`, { signal }),
  primaryAgent: (companyId: string, signal?: AbortSignal) =>
    api.get<PrimaryAgentPreference>(`/companies/${encodeURIComponent(companyId)}/primary-agent/me`, { signal }),

  // Move to api/agents.ts at merge: the general agent requests, as ui/src/api/agents.ts has them.
  get: (id: string, companyId: string) => api.get<Agent>(agentPath(id, companyId)),
  update: (id: string, data: { reportsTo?: string | null }, companyId: string) => api.patch<Agent>(agentPath(id, companyId), data),
  /** The roster's bulk edit: the server merges only these fields and rejects a stale preview. */
  updateRuntimeSettings: (id: string, runtimeSettings: AgentRuntimeSettingsPatch, companyId: string) =>
    api.patch<Agent>(agentPath(id, companyId), { runtimeSettings }),
  pause: (id: string, companyId: string) => api.post<Agent>(agentPath(id, companyId, "/pause"), {}),
  resume: (id: string, companyId: string) => api.post<Agent>(agentPath(id, companyId, "/resume"), {}),
  /** Wake now: an on-demand heartbeat, as the old UI's "Run now" sends it. */
  wakeup: (id: string, companyId: string) =>
    api.post<AgentWakeupResponse>(agentPath(id, companyId, "/wakeup"), { source: "on_demand", triggerDetail: "manual" }),
  /** The model catalog for one harness, with the options the bulk edit passes. */
  adapterModels: (
    companyId: string,
    type: string,
    options: { environmentId?: string | null; provider?: string; acpxAgent?: string; aiConnection?: AiConnectionBinding; agentId?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.provider) params.set("provider", options.provider);
    if (options.acpxAgent) params.set("acpxAgent", options.acpxAgent);
    if (options.aiConnection) params.set("aiConnection", JSON.stringify(options.aiConnection));
    if (options.agentId) params.set("agentId", options.agentId);
    if (options.environmentId) params.set("environmentId", options.environmentId);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return api.get<AdapterModel[]>(`/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(type)}/models${query}`);
  },
};
