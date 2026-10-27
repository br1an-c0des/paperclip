import type { CostByProject } from "@paperclipai/shared";
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
  byProject: (companyId: string, from?: string, to?: string, signal?: AbortSignal) =>
    api.get<CostByProject[]>(`/companies/${encodeURIComponent(companyId)}/costs/by-project${rangeQuery(from, to)}`, { signal }),
};
