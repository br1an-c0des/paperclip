import type { BudgetOverview, BudgetPolicySummary, BudgetPolicyUpsertInput } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Budget policies, as ui/src/api/budgets.ts uses them. The overview lists every policy in the
 * company with its spend; a project's settings pick out the project's own. Saving upserts the policy
 * for one scope, metric and window; a zero amount turns it off.
 */
export const budgetsApi = {
  overview: (companyId: string, signal?: AbortSignal) =>
    api.get<BudgetOverview>(`/companies/${encodeURIComponent(companyId)}/budgets/overview`, { signal }),
  upsertPolicy: (companyId: string, data: BudgetPolicyUpsertInput) =>
    api.post<BudgetPolicySummary>(`/companies/${encodeURIComponent(companyId)}/budgets/policies`, data),
};
