import type { CostByAgent, CostByAgentModel, CostByProject, CostSummary } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Spend, as ui/src/api/costs.ts reads it. Without a range the server sums everything
 * (`period=all`); with one it counts ledger events from `from` up to `to`.
 */

function rangeQuery(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (!from && !to) params.set("period", "all");
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `?${params.toString()}`;
}

export const costsApi = {
  /** The range's totals against the company's monthly budget (the Activity page's Costs header). */
  summary: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostSummary>(`/companies/${encodeURIComponent(companyId)}/costs/summary${rangeQuery(from, to)}`, { signal }),
  byProject: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByProject[]>(`/companies/${encodeURIComponent(companyId)}/costs/by-project${rangeQuery(from, to)}`, { signal }),
  /** Spend per agent. There's no agent filter, so an agent's page reads every agent's and picks its own. */
  byAgent: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByAgent[]>(`/companies/${encodeURIComponent(companyId)}/costs/by-agent${rangeQuery(from, to)}`, { signal }),
  /** Spend per agent and model, likewise for every agent. */
  byAgentModel: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByAgentModel[]>(`/companies/${encodeURIComponent(companyId)}/costs/by-agent-model${rangeQuery(from, to)}`, { signal }),
};
