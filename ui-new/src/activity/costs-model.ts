import type { BudgetPolicySummary, CostByAgent, CostByAgentModel, CostByProject } from "@paperclipai/shared";

/*
 * The Costs tab's view model: the ranges (as the old UI's useDateRange offers them), spend and
 * tokens per agent with each agent's models, per project, and the budgets in force.
 *
 * Spend is in cents. Runs on a subscription cost nothing per run, so the tokens are often the
 * telling number; both are shown.
 */

export type RangePreset = "mtd" | "7d" | "30d" | "ytd" | "all" | "custom";

export const RANGE_PRESETS: readonly { value: RangePreset; label: string }[] = [
  { value: "mtd", label: "This month" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "ytd", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

export function isRangePreset(value: unknown): value is RangePreset {
  return RANGE_PRESETS.some((preset) => preset.value === value);
}

/** A range for the requests: ISO times, or none for all time. `to` is left open for "until now". */
export type CostRange = { from?: string; to?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The range a preset covers at `now`. Month and year start at the UTC boundary, as budgets count
 * them; the rolling windows start at local midnight, as the old UI's do. A custom range needs both
 * days (local, whole days) and returns null until it has them.
 */
export function costRange(preset: RangePreset, now: Date, custom: { from?: string; to?: string } = {}): CostRange | null {
  switch (preset) {
    case "mtd":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString() };
    case "ytd":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString() };
    case "7d":
    case "30d": {
      const days = preset === "7d" ? 7 : 30;
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).toISOString() };
    }
    case "all":
      return {};
    case "custom": {
      if (!custom.from || !custom.to || !DAY.test(custom.from) || !DAY.test(custom.to)) return null;
      const from = new Date(`${custom.from}T00:00:00`);
      const to = new Date(`${custom.to}T23:59:59.999`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
      return { from: from.toISOString(), to: to.toISOString() };
    }
  }
}

/** "1.4M", "88.6k", "312". */
export function formatTokens(count: number) {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`;
  return String(Math.round(count));
}

type Usage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

export function totalTokens(row: Usage) {
  return row.inputTokens + row.cachedInputTokens + row.outputTokens;
}

/** A share of the largest, 0–100, for the bars beside each row. */
export function barPercent(value: number, max: number) {
  return max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
}

export type ModelRow = { key: string; model: string; provider: string; billing: string; costCents: number; tokens: number; events: number };

export type AgentCostRow = {
  agentId: string | null;
  name: string;
  costCents: number;
  tokens: number;
  events: number;
  /** Runs billed per request and runs covered by a subscription. */
  apiRuns: number;
  subscriptionRuns: number;
  models: ModelRow[];
};

const BILLING: Record<string, string> = {
  metered_api: "API",
  subscription_included: "Subscription",
  subscription_overage: "Subscription overage",
  credits: "Credits",
  fixed: "Fixed",
  unknown: "Unknown billing",
};

export function billingLabel(type: string) {
  return BILLING[type] ?? type.replace(/_/g, " ");
}

/** "Anthropic", "OpenAI", or the provider's id as given. */
export function providerLabel(provider: string) {
  const known: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI", unknown: "Unknown provider" };
  return known[provider] ?? provider;
}

/** Spend per agent, most first (then most tokens), with each agent's models under it. */
export function agentCostRows(agents: readonly CostByAgent[] | undefined, models: readonly CostByAgentModel[] | undefined): AgentCostRow[] {
  const byAgent = new Map<string | null, ModelRow[]>();
  for (const row of models ?? []) {
    const list = byAgent.get(row.agentId) ?? [];
    list.push({
      key: `${row.provider}:${row.model}:${row.billingType}`,
      model: row.model === "unknown" ? "Unknown model" : row.model,
      provider: providerLabel(row.provider),
      billing: billingLabel(row.billingType),
      costCents: row.costCents,
      tokens: totalTokens(row),
      events: row.eventCount,
    });
    byAgent.set(row.agentId, list);
  }
  return [...(agents ?? [])]
    .map((row) => ({
      agentId: row.agentId,
      name: row.agentName ?? (row.agentId ? "An agent no longer here" : "No agent"),
      costCents: row.costCents,
      tokens: totalTokens(row),
      events: row.eventCount,
      apiRuns: row.apiRunCount,
      subscriptionRuns: row.subscriptionRunCount,
      models: (byAgent.get(row.agentId) ?? []).sort((a, b) => b.costCents - a.costCents || b.tokens - a.tokens),
    }))
    .sort((a, b) => b.costCents - a.costCents || b.tokens - a.tokens || a.name.localeCompare(b.name));
}

export type ProjectCostRow = { projectId: string | null; name: string; costCents: number; tokens: number; events: number };

/** Spend per project, most first; work outside any project last. */
export function projectCostRows(rows: readonly CostByProject[] | undefined): ProjectCostRow[] {
  return [...(rows ?? [])]
    .map((row) => ({ projectId: row.projectId, name: row.projectName ?? "No project", costCents: row.costCents, tokens: totalTokens(row), events: row.eventCount }))
    .sort((a, b) => Number(a.projectId === null) - Number(b.projectId === null) || b.costCents - a.costCents || b.tokens - a.tokens || a.name.localeCompare(b.name));
}

export type BudgetRow = {
  policyId: string;
  scope: BudgetPolicySummary["scopeType"];
  scopeId: string;
  name: string;
  window: string;
  limitCents: number;
  spentCents: number;
  percent: number;
  status: BudgetPolicySummary["status"];
  paused: boolean;
};

const WINDOWS: Record<string, string> = { calendar_month_utc: "Monthly", lifetime: "Lifetime" };

/**
 * The budgets in force: policies with a limit, the company's first, then agents and projects,
 * fullest first. Zero-amount policies are turned off and left out.
 */
export function budgetRows(policies: readonly BudgetPolicySummary[] | undefined): BudgetRow[] {
  const order = { company: 0, agent: 1, project: 2 } as Record<string, number>;
  return (policies ?? [])
    .filter((policy) => policy.amount > 0 && policy.metric === "billed_cents")
    .map((policy) => ({
      policyId: policy.policyId,
      scope: policy.scopeType,
      scopeId: policy.scopeId,
      name: policy.scopeName,
      window: WINDOWS[policy.windowKind] ?? policy.windowKind.replace(/_/g, " "),
      limitCents: policy.amount,
      spentCents: policy.observedAmount,
      percent: Math.min(100, Math.max(0, Math.round(policy.utilizationPercent))),
      status: policy.status,
      paused: policy.paused,
    }))
    .sort((a, b) => (order[a.scope] ?? 9) - (order[b.scope] ?? 9) || b.percent - a.percent || a.name.localeCompare(b.name));
}

/** Where a budget's scope is edited: the agent's or project's budget settings, or the company's. */
export function budgetHref(row: Pick<BudgetRow, "scope" | "scopeId">, agentKey: (id: string) => string | undefined) {
  if (row.scope === "agent") return `/agents/${agentKey(row.scopeId) ?? row.scopeId}/settings/budget`;
  if (row.scope === "project") return `/projects/${row.scopeId}/settings/budget`;
  return "/company/settings/budgets";
}

/** The note under the range's spend when the numbers aren't complete. */
export function pricingNote(summary: { unpricedEventCount: number; pendingRunCount: number; eventCount: number } | undefined) {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.unpricedEventCount > 0) parts.push(`${summary.unpricedEventCount} of ${summary.eventCount} usage reports have no price`);
  if (summary.pendingRunCount > 0) parts.push(`${summary.pendingRunCount} ${summary.pendingRunCount === 1 ? "run is" : "runs are"} still being counted`);
  return parts.length > 0 ? `${parts.join("; ")}.` : null;
}
