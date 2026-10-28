import type { BudgetIncident, BudgetOverview, BudgetPolicySummary, BudgetPolicyUpsertInput, BudgetWindowKind } from "@paperclipai/shared";
import { parseDollars } from "@/projects/settings/settings-model";

/*
 * Budgets (board 25): the organization's monthly budget, every agent and project budget in one
 * table, and the incidents when one was reached. Spend charts stay in Activity → Costs.
 *
 * A budget is a policy per scope, metric and window (`POST /budgets/policies`); a zero amount turns
 * it off. Only billed-cents policies are shown, as in the old UI's Budgets tab.
 */

export { parseDollars };

export type ScopeKind = "company" | "agent" | "project";

export type BudgetRowDraft = {
  /** Dollars, as typed. Empty or zero turns the budget off. */
  amount: string;
  warnPercent: number;
  hardStop: boolean;
};

export const ORG_WARN_OPTIONS = [50, 80, 90];

function billed(overview: BudgetOverview | undefined) {
  return (overview?.policies ?? []).filter((policy) => policy.metric === "billed_cents");
}

/** The organization's monthly policy, if it has one. */
export function companyPolicy(overview: BudgetOverview | undefined, companyId: string) {
  return billed(overview).find((policy) => policy.scopeType === "company" && policy.scopeId === companyId && policy.windowKind === "calendar_month_utc") ?? null;
}

/** Agent and project budgets that are set (an amount above zero), each group by name. */
export function scopeRows(overview: BudgetOverview | undefined) {
  const set = billed(overview).filter((policy) => policy.amount > 0 && (policy.scopeType === "agent" || policy.scopeType === "project"));
  const byName = (a: BudgetPolicySummary, b: BudgetPolicySummary) => a.scopeName.localeCompare(b.scopeName) || a.windowKind.localeCompare(b.windowKind);
  return {
    agents: set.filter((policy) => policy.scopeType === "agent").sort(byName),
    projects: set.filter((policy) => policy.scopeType === "project").sort(byName),
  };
}

export function rowDraft(policy: Pick<BudgetPolicySummary, "amount" | "warnPercent" | "hardStopEnabled"> | null): BudgetRowDraft {
  return {
    amount: policy && policy.amount > 0 ? (policy.amount / 100).toFixed(2).replace(/\.00$/, "") : "",
    warnPercent: policy?.warnPercent ?? 80,
    hardStop: policy?.hardStopEnabled ?? true,
  };
}

export function rowDirty(policy: Pick<BudgetPolicySummary, "amount" | "warnPercent" | "hardStopEnabled"> | null, draft: BudgetRowDraft) {
  const before = rowDraft(policy);
  const amount = parseDollars(draft.amount);
  return parseDollars(before.amount) !== amount || (amount !== 0 && (before.warnPercent !== draft.warnPercent || before.hardStop !== draft.hardStop));
}

/** The upsert that saves a draft for one scope and window, or null when the amount isn't a number. */
export function rowRequest(scope: { scopeType: ScopeKind; scopeId: string; windowKind: BudgetWindowKind }, draft: BudgetRowDraft): BudgetPolicyUpsertInput | null {
  const amount = parseDollars(draft.amount);
  if (amount === null) return null;
  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    metric: "billed_cents",
    windowKind: scope.windowKind,
    amount,
    ...(amount > 0 ? { warnPercent: draft.warnPercent, hardStopEnabled: draft.hardStop } : {}),
  };
}

/** "$187.00". */
export function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/** Whole dollars when the amount is round: "$500", "$12.50". */
export function shortDollars(cents: number) {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : dollars(cents);
}

/** How much of the budget is used, 0–100, or null with no budget. */
export function usedPercent(policy: Pick<BudgetPolicySummary, "amount" | "observedAmount"> | null) {
  if (!policy || policy.amount <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((policy.observedAmount / policy.amount) * 100)));
}

/** "Resets Nov 1". */
export function resetsLabel(windowEnd: Date | string | undefined, now = new Date()) {
  const end = windowEnd ? new Date(windowEnd) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (Number.isNaN(end.getTime())) return "";
  return `Resets ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/** "October", for the table's spend column. */
export function monthName(now = new Date()) {
  return now.toLocaleDateString("en-US", { month: "long" });
}

/** What happens at the limit, for a scope. */
export function limitAction(scope: ScopeKind, hardStop: boolean) {
  if (!hardStop) return "Only warn";
  return scope === "company" ? "Pause every agent" : scope === "agent" ? "Pause the agent" : "Pause the project";
}

/** "Strategy Engineer reached its $60 budget and was paused." */
export function incidentText(incident: BudgetIncident) {
  const limit = shortDollars(incident.amountLimit);
  const spent = shortDollars(incident.amountObserved);
  if (incident.thresholdType === "soft") return `${incident.scopeName} passed its warning point: ${spent} of ${limit}.`;
  return `${incident.scopeName} reached its ${limit} budget (${spent} spent) and was paused.`;
}

/** A raise worth suggesting when resolving an incident: the spend plus a fifth, rounded up to $10. */
export function suggestedRaise(incident: BudgetIncident) {
  const base = Math.max(incident.amountLimit, incident.amountObserved) * 1.2;
  return Math.ceil(base / 1000) * 1000;
}
