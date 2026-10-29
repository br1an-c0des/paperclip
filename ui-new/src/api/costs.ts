import type {
  CostByAgent,
  CostByAgentModel,
  CostByBiller,
  CostByProject,
  CostByProviderModel,
  CostByUserReport,
  CostDataQualityReport,
  CostSummary,
  CostWindowSpendRow,
  DecisionHistoryEntry,
  FastResponseHistoryEntry,
  FinanceByBiller,
  FinanceByKind,
  FinanceEvent,
  FinanceSummary,
  ProviderQuotaResult,
  SubscriptionCostReport,
  UpdateSubscriptionPrice,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Spend, as ui/src/api/costs.ts and subscriptions.ts read it. Without a range the server sums
 * everything (`period=all`); with one it counts ledger events from `from` up to `to`.
 *
 * Also the decision model's and fast responses' call history (ui/src/api/decision-models.ts and
 * fast-responses.ts), which the Costs tab lists; their settings are company settings → Connections
 * (ai-connections.ts).
 */

function rangeQuery(from?: string, to?: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  if (!from && !to) params.set("period", "all");
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `?${params.toString()}`;
}

const costs = (companyId: string, path: string) => `/companies/${encodeURIComponent(companyId)}/costs/${path}`;

export const costsApi = {
  /** The range's totals against the company's monthly budget (the Activity page's Costs header). */
  summary: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostSummary>(`${costs(companyId, "summary")}${rangeQuery(from, to)}`, { signal }),
  byProject: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByProject[]>(`${costs(companyId, "by-project")}${rangeQuery(from, to)}`, { signal }),
  /** Spend per agent. There's no agent filter, so an agent's page reads every agent's and picks its own. */
  byAgent: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByAgent[]>(`${costs(companyId, "by-agent")}${rangeQuery(from, to)}`, { signal }),
  /** Spend per agent and model, likewise for every agent. */
  byAgentModel: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByAgentModel[]>(`${costs(companyId, "by-agent-model")}${rangeQuery(from, to)}`, { signal }),
  /** Spend per person responsible for the work (runs started from their tasks). */
  byUser: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByUserReport>(`${costs(companyId, "by-user")}${rangeQuery(from, to)}`, { signal }),
  /** Spend per provider, model and billing type. */
  byProvider: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByProviderModel[]>(`${costs(companyId, "by-provider")}${rangeQuery(from, to)}`, { signal }),
  /** Spend per biller: who sends the bill, which can differ from the model's provider (OpenRouter). */
  byBiller: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByBiller[]>(`${costs(companyId, "by-biller")}${rangeQuery(from, to)}`, { signal }),
  /** Spend in the rolling 5-hour, 24-hour and 7-day windows, per provider. */
  windowSpend: (companyId: string, signal?: AbortSignal) => api.get<CostWindowSpendRow[]>(costs(companyId, "window-spend"), { signal }),
  /** Subscription quota windows as each provider reports them, per connected account. */
  quotaWindows: (companyId: string, signal?: AbortSignal) => api.get<ProviderQuotaResult[]>(costs(companyId, "quota-windows"), { signal }),
  /** The runs and usage reports whose cost couldn't be worked out, and why. */
  dataQuality: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostDataQualityReport>(`${costs(companyId, "data-quality")}${rangeQuery(from, to)}`, { signal }),
  /** Records a finished run's saved usage again. It doesn't rerun the agent. */
  retryAccounting: (companyId: string, runId: string) => api.post<{ accounted: boolean }>(costs(companyId, "retry-accounting"), { runId }),

  financeSummary: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<FinanceSummary>(`${costs(companyId, "finance-summary")}${rangeQuery(from, to)}`, { signal }),
  financeByBiller: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<FinanceByBiller[]>(`${costs(companyId, "finance-by-biller")}${rangeQuery(from, to)}`, { signal }),
  financeByKind: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<FinanceByKind[]>(`${costs(companyId, "finance-by-kind")}${rangeQuery(from, to)}`, { signal }),
  financeEvents: (companyId: string, from?: string, to?: string, limit = 50, signal?: AbortSignal) =>
    api.get<FinanceEvent[]>(`${costs(companyId, "finance-events")}${rangeQuery(from, to, { limit: String(limit) })}`, { signal }),

  /** Subscription accounts visible to you, their monthly fees, and the range's usage on each. */
  subscriptions: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<SubscriptionCostReport>(`${costs(companyId, "subscriptions")}${rangeQuery(from, to)}`, { signal }),
  /** Asks connected accounts which plan they're on (the old page does this once per visit). */
  refreshSubscriptions: (companyId: string) => api.post<{ status: string }>(costs(companyId, "subscriptions/refresh"), {}),
  updateSubscription: (companyId: string, subscriptionId: string, input: UpdateSubscriptionPrice) =>
    api.patch<unknown>(costs(companyId, `subscriptions/${encodeURIComponent(subscriptionId)}`), input),
  /** Counts two accounts as one subscription, keeping the target's price. */
  linkSubscriptions: (companyId: string, subscriptionId: string, targetId: string, expectedRevision: number, targetRevision: number) =>
    api.post<unknown>(costs(companyId, `subscriptions/${encodeURIComponent(subscriptionId)}/link`), { targetId, expectedRevision, targetRevision }),

  /** The decision model's recent calls (inputs aren't kept). */
  decisionHistory: (companyId: string, from?: string, to?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: "100" });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return api.get<DecisionHistoryEntry[]>(`/companies/${encodeURIComponent(companyId)}/decision-model/history?${params}`, { signal });
  },
  /** Fast responses' recent calls and whether each was posted. */
  fastResponseHistory: (companyId: string, from?: string, to?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return api.get<FastResponseHistoryEntry[]>(`/companies/${encodeURIComponent(companyId)}/fast-response/history?${params}`, { signal });
  },
};
