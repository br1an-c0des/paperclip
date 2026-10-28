import type { BudgetIncident, BudgetIncidentResolutionInput, BudgetOverview, BudgetPolicySummary, BudgetPolicyUpsertInput } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Budget policies, as ui/src/api/budgets.ts uses them. The overview lists every policy in the
 * company with its spend, and the open incidents; a project's settings pick out the project's own,
 * and company settings → Budgets (board 25) shows them all. Saving upserts the policy for one scope,
 * metric and window; a zero amount turns it off. An incident is resolved by raising the budget and
 * resuming, or by keeping the scope paused.
 */
export const budgetsApi = {
  overview: (companyId: string, signal?: AbortSignal) =>
    api.get<BudgetOverview>(`/companies/${encodeURIComponent(companyId)}/budgets/overview`, { signal }),
  upsertPolicy: (companyId: string, data: BudgetPolicyUpsertInput) =>
    api.post<BudgetPolicySummary>(`/companies/${encodeURIComponent(companyId)}/budgets/policies`, data),
  resolveIncident: (companyId: string, incidentId: string, data: BudgetIncidentResolutionInput) =>
    api.post<BudgetIncident>(`/companies/${encodeURIComponent(companyId)}/budget-incidents/${encodeURIComponent(incidentId)}/resolve`, data),
};
