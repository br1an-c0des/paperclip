import type {
  CostByBiller,
  CostByProviderModel,
  CostDataQualityItem,
  CostDataQualityReason,
  CostDataQualityReport,
  CostWindowSpendRow,
  DecisionHistoryEntry,
  FinanceEvent,
  ProviderQuotaResult,
  QuotaWindow,
  SubscriptionAccountReport,
  SubscriptionUsage,
} from "@paperclipai/shared";
import { billingLabel, totalTokens } from "./costs-model";

/*
 * The Costs tab's other reports, apart from the components so they can be tested: spend by
 * provider and by biller with the rolling windows and quota, the finance ledger, subscriptions,
 * the data-quality notice, and the decision-model and fast-response histories. Ported from the old
 * Costs page and its cards (ProviderQuotaCard, BillerSpendCard, Finance*Card, SubscriptionCostCard,
 * CostDataQualityNotice, DecisionHistory).
 */

// ---------------------------------------------------------------------------------------------
// The views

export type CostsTab = "overview" | "providers" | "billers" | "finance" | "decisions" | "fast-responses";

export const COSTS_TABS: readonly { value: CostsTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "providers", label: "Providers" },
  { value: "billers", label: "Billers" },
  { value: "finance", label: "Finance" },
  { value: "decisions", label: "Decisions" },
  { value: "fast-responses", label: "Fast responses" },
];

/** The old page's `?tab=` names; `budgets` lands on the overview, whose Budgets card replaces it. */
export function costsTab(value: string | undefined): CostsTab {
  return COSTS_TABS.some((tab) => tab.value === value) ? (value as CostsTab) : "overview";
}

/** Monday 00:00 to Sunday 23:59 local time, around `now` (the old page's "this week"). */
export function weekRange(now: Date) {
  const day = now.getDay();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Names

const PROVIDERS: Record<string, string> = {
  anthropic: "Anthropic",
  aws_bedrock: "AWS Bedrock",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  chatgpt: "ChatGPT",
  google: "Google",
  cursor: "Cursor",
  jetbrains: "JetBrains AI",
  xai: "xAI",
  unknown: "Unknown",
};

/** "Anthropic", "OpenRouter"…, or the id as given. Used for providers and billers alike. */
export function companyName(id: string) {
  return PROVIDERS[id.toLowerCase()] ?? id;
}

const QUOTA_SOURCES: Record<string, string> = {
  "anthropic-oauth": "Anthropic OAuth",
  "claude-cli": "Claude CLI",
  bedrock: "AWS Bedrock",
  "codex-rpc": "Codex app server",
  "codex-wham": "ChatGPT WHAM",
  "managed-connection": "AI connection",
};

export function quotaSourceLabel(source: string) {
  return QUOTA_SOURCES[source] ?? source;
}

const FINANCE_KINDS: Record<string, string> = {
  inference_charge: "Inference charge",
  platform_fee: "Platform fee",
  credit_purchase: "Credit purchase",
  credit_refund: "Credit refund",
  credit_expiry: "Credit expiry",
  byok_fee: "BYOK fee",
  gateway_overhead: "Gateway overhead",
  log_storage_charge: "Log storage",
  logpush_charge: "Logpush",
  provisioned_capacity_charge: "Provisioned capacity",
  training_charge: "Training",
  custom_model_import_charge: "Custom model import",
  custom_model_storage_charge: "Custom model storage",
  manual_adjustment: "Manual adjustment",
};

export function financeKindLabel(kind: string) {
  return FINANCE_KINDS[kind] ?? kind.replace(/_/g, " ");
}

/** "Provider cost report" for imported provider reports, otherwise the kind. */
export function financeEventLabel(event: Pick<FinanceEvent, "eventKind" | "metadataJson">) {
  return event.metadataJson?.source === "provider_cost_report" ? "Provider cost report" : financeKindLabel(event.eventKind);
}

/** Money in any currency; USD as dollars and cents, others with their code. */
export function money(cents: number | string, currency = "USD") {
  const value = Number(cents) / 100;
  if (currency === "USD") return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Sub-cent amounts as the API gives them, for single model calls: "$0.0042". */
export function preciseMoney(cents: string | number) {
  return (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

// ---------------------------------------------------------------------------------------------
// Estimates

/** "Estimated" when every report in a group was priced from token counts, "Partly estimated" when some were. */
export function estimateLabel(row: { eventCount?: number; estimatedEventCount?: number }) {
  if (!row.estimatedEventCount) return null;
  return row.estimatedEventCount === row.eventCount ? "Estimated" : "Partly estimated";
}

/** No price at all: every report in the group is unpriced. */
export function entirelyUnpriced(row: { costCents: number; eventCount?: number; unpricedEventCount?: number }) {
  return row.costCents === 0 && (row.eventCount ?? 0) > 0 && row.unpricedEventCount === row.eventCount;
}

// ---------------------------------------------------------------------------------------------
// Providers

const ROLLING = ["5h", "24h", "7d"] as const;

export type ProviderCard = {
  provider: string;
  name: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  eventCount: number;
  estimatedEventCount: number;
  unpricedEventCount: number;
  apiRuns: number;
  subscriptionRuns: number;
  subscriptionTokens: number;
  /** Share of the provider's tokens that ran on a subscription, 0–100. */
  subscriptionShare: number;
  weekCents: number;
  windows: { window: string; costCents: number; tokens: number; percent: number }[];
  models: { key: string; model: string; biller: string; billing: string; costCents: number; tokens: number; tokenShare: number; costShare: number }[];
  quota: ProviderQuotaResult[];
};

/** One card per provider: totals, models, the rolling windows, this week's spend and quota accounts. */
export function providerCards(
  rows: readonly CostByProviderModel[] | undefined,
  windows: readonly CostWindowSpendRow[] | undefined,
  week: readonly CostByProviderModel[] | undefined,
  quota: readonly ProviderQuotaResult[] | undefined,
): ProviderCard[] {
  const byProvider = new Map<string, CostByProviderModel[]>();
  for (const row of rows ?? []) byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row]);
  // A provider with quota but no usage in the range still gets a card, so its quota shows.
  for (const result of quota ?? []) if (!byProvider.has(result.provider)) byProvider.set(result.provider, []);
  return [...byProvider.entries()]
    .map(([provider, list]) => {
      const sum = (pick: (row: CostByProviderModel) => number) => list.reduce((total, row) => total + pick(row), 0);
      const tokens = sum(totalTokens);
      const costCents = sum((row) => row.costCents);
      const subscriptionTokens = sum((row) => row.subscriptionInputTokens + row.subscriptionCachedInputTokens + row.subscriptionOutputTokens);
      const windowRows = (windows ?? []).filter((row) => row.provider === provider);
      const windowCents = new Map<string, { costCents: number; tokens: number }>();
      for (const row of windowRows) {
        const current = windowCents.get(row.window) ?? { costCents: 0, tokens: 0 };
        windowCents.set(row.window, { costCents: current.costCents + row.costCents, tokens: current.tokens + totalTokens(row) });
      }
      const maxWindow = Math.max(0, ...[...windowCents.values()].map((entry) => entry.costCents));
      return {
        provider,
        name: companyName(provider),
        costCents,
        inputTokens: sum((row) => row.inputTokens + row.cachedInputTokens),
        outputTokens: sum((row) => row.outputTokens),
        tokens,
        eventCount: sum((row) => row.eventCount ?? 0),
        estimatedEventCount: sum((row) => row.estimatedEventCount ?? 0),
        unpricedEventCount: sum((row) => row.unpricedEventCount ?? 0),
        apiRuns: sum((row) => row.apiRunCount),
        subscriptionRuns: sum((row) => row.subscriptionRunCount),
        subscriptionTokens,
        subscriptionShare: tokens > 0 ? Math.round((subscriptionTokens / tokens) * 100) : 0,
        weekCents: (week ?? []).filter((row) => row.provider === provider).reduce((total, row) => total + row.costCents, 0),
        windows: ROLLING.flatMap((window) => {
          const entry = windowCents.get(window);
          return entry ? [{ window, ...entry, percent: maxWindow > 0 ? Math.round((entry.costCents / maxWindow) * 100) : 0 }] : [];
        }),
        models: [...list]
          .sort((a, b) => b.costCents - a.costCents || totalTokens(b) - totalTokens(a))
          .map((row) => ({
            key: `${row.biller}:${row.model}:${row.billingType}`,
            model: row.model === "unknown" ? "Unknown model" : row.model,
            biller: companyName(row.biller),
            billing: billingLabel(row.billingType),
            costCents: row.costCents,
            tokens: totalTokens(row),
            tokenShare: tokens > 0 ? Math.round((totalTokens(row) / tokens) * 100) : 0,
            costShare: costCents > 0 ? Math.round((row.costCents / costCents) * 100) : 0,
          })),
        quota: (quota ?? []).filter((result) => result.provider === provider),
      };
    })
    .sort((a, b) => b.costCents - a.costCents || b.tokens - a.tokens || a.name.localeCompare(b.name));
}

/** How far into the company's monthly budget a share of spend goes, 0–100, and a week's share (52 / 12 weeks a month). */
export function budgetShare(costCents: number, weekCents: number, budgetCents: number) {
  if (budgetCents <= 0) return null;
  const weekly = budgetCents / 4.33;
  return {
    period: Math.min(100, Math.round((costCents / budgetCents) * 100)),
    week: Math.min(100, Math.round((weekCents / weekly) * 100)),
    weeklyCents: Math.round(weekly),
  };
}

/**
 * Whether a provider's month-to-date spend, run on at its daily rate to the month's end, goes past
 * the company budget (the old cards' "deficit notch").
 */
export function overPace(costCents: number, budgetCents: number, now: Date) {
  if (budgetCents <= 0) return false;
  const elapsed = Math.max(now.getUTCDate(), 1);
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return costCents + (costCents / elapsed) * (days - elapsed) > budgetCents;
}

const STALE_CREDENTIALS = new Set(["credentials_unavailable", "authentication_required", "refresh_token_reused", "refresh_token_expired", "refresh_token_invalidated"]);

/** Keeps the last good quota windows through a passing failure, never through revoked credentials. */
export function retainQuota(previous: readonly ProviderQuotaResult[] | undefined, incoming: readonly ProviderQuotaResult[]): ProviderQuotaResult[] {
  return incoming.map((result) => {
    if (result.ok || (result.errorFamily && STALE_CREDENTIALS.has(result.errorFamily))) return result;
    const last = previous?.find((entry) => entry.provider === result.provider && entry.accountKey === result.accountKey);
    return last?.windows.length ? { ...result, windows: last.windows, source: last.source, capturedAt: last.capturedAt } : result;
  });
}

/** Why an account's quota isn't shown. Never the adapter's own error text. */
export function quotaProblem(account: Pick<ProviderQuotaResult, "ok" | "errorFamily" | "windows">) {
  if (account.ok) return null;
  if (account.errorFamily === "credentials_unavailable") return "Connect or reconnect the subscription under Apps → AI connections to see its quota.";
  return account.windows.length > 0 ? "Showing the last quota Paperclip saw. It updates on its own." : "The provider isn't reporting quota right now. Check usage with the provider.";
}

/** "resets in 3h", "resets in 2d", or "resets soon" once it's due. */
export function resetLabel(at: string, now: Date = new Date()) {
  const minutes = Math.round((new Date(at).getTime() - now.getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes <= 0) return "resets soon";
  if (minutes < 60) return `resets in ${minutes}m`;
  if (minutes < 48 * 60) return `resets in ${Math.round(minutes / 60)}h`;
  return `resets in ${Math.round(minutes / 1440)}d`;
}

/** A quota window's bar: percent used when reported, else its value label. */
export function quotaWindowLine(window: QuotaWindow) {
  return {
    percent: window.usedPercent,
    left: window.valueLabel ?? (window.usedPercent === null ? "Usage not reported" : `${window.usedPercent}% used`),
  };
}

// ---------------------------------------------------------------------------------------------
// Billers

export type BillerCard = {
  biller: string;
  name: string;
  costCents: number;
  eventCount: number;
  estimatedEventCount: number;
  unpricedEventCount: number;
  inputTokens: number;
  outputTokens: number;
  providerCount: number;
  modelCount: number;
  apiRuns: number;
  subscriptionRuns: number;
  weekCents: number;
  providers: { provider: string; name: string; costCents: number; tokens: number }[];
  billing: { type: string; label: string; costCents: number }[];
};

export function billerCards(billers: readonly CostByBiller[] | undefined, providerRows: readonly CostByProviderModel[] | undefined, week: readonly CostByBiller[] | undefined): BillerCard[] {
  return [...(billers ?? [])]
    .map((row) => {
      const rows = (providerRows ?? []).filter((entry) => entry.biller === row.biller);
      const providers = new Map<string, { costCents: number; tokens: number }>();
      const billing = new Map<string, number>();
      for (const entry of rows) {
        const current = providers.get(entry.provider) ?? { costCents: 0, tokens: 0 };
        providers.set(entry.provider, { costCents: current.costCents + entry.costCents, tokens: current.tokens + totalTokens(entry) });
        billing.set(entry.billingType, (billing.get(entry.billingType) ?? 0) + entry.costCents);
      }
      return {
        biller: row.biller,
        name: companyName(row.biller),
        costCents: row.costCents,
        eventCount: row.eventCount ?? 0,
        estimatedEventCount: row.estimatedEventCount ?? 0,
        unpricedEventCount: row.unpricedEventCount ?? 0,
        inputTokens: row.inputTokens + row.cachedInputTokens,
        outputTokens: row.outputTokens,
        providerCount: row.providerCount,
        modelCount: row.modelCount,
        apiRuns: row.apiRunCount,
        subscriptionRuns: row.subscriptionRunCount,
        weekCents: (week ?? []).filter((entry) => entry.biller === row.biller).reduce((total, entry) => total + entry.costCents, 0),
        providers: [...providers.entries()]
          .map(([provider, entry]) => ({ provider, name: companyName(provider), ...entry }))
          .sort((a, b) => b.costCents - a.costCents || b.tokens - a.tokens),
        billing: [...billing.entries()].map(([type, costCents]) => ({ type, label: billingLabel(type), costCents })).sort((a, b) => b.costCents - a.costCents),
      };
    })
    .sort((a, b) => b.costCents - a.costCents || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// Subscriptions

/** Copied from @paperclipai/shared's SUBSCRIPTION_CURRENCIES (a runtime value; decision 10). */
export const SUBSCRIPTION_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF"] as const;

/** "$20.00/month", per currency, or a word when there's nothing to add up. */
export function subscriptionTotals(report: { monthlyTotals: { currency: string; amountCents: string }[]; activeCount: number; accounts: unknown[] } | undefined) {
  if (!report) return null;
  if (report.monthlyTotals.length > 0) return report.monthlyTotals.map((total) => `${money(total.amountCents, total.currency)}/month`);
  if (report.activeCount === 0 && report.accounts.length > 0) return ["$0.00/month"];
  return null;
}

/** An account's monthly price line. */
export function accountPrice(account: Pick<SubscriptionAccountReport, "price">) {
  const price = account.price;
  if (price.status === "ended") return "Ended";
  if (price.status === "excluded") return "Not counted here";
  if (price.monthlyCents == null) return "Price unknown";
  return `${money(price.monthlyCents, price.currency)}/month`;
}

/** Where the price came from. */
export function priceSource(account: Pick<SubscriptionAccountReport, "price">) {
  const parts = [account.price.source === "catalog" ? "Estimated from list prices, before tax" : account.price.source === "user" ? "Entered by a person" : null];
  if (account.price.cadence === "year") parts.push("a year's price ÷ 12");
  return parts.filter(Boolean).join(" · ");
}

export function usageTokens(usage: Pick<SubscriptionUsage, "inputTokens" | "cachedInputTokens" | "outputTokens">) {
  return usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
}

/** Cents as the price field shows them: "20" for 2000, "19.99" for 1999, "" for none. */
export function centsToField(cents: string | null) {
  if (cents == null) return "";
  const value = Number(cents) / 100;
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : "";
}

/** A typed price as exact cents ("19.99" → "1999"), null when empty, undefined when it isn't a price. */
export function fieldToCents(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  return String(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

// ---------------------------------------------------------------------------------------------
// Data quality

export const QUALITY_REASONS: Record<CostDataQualityReason, { label: string; description: string }> = {
  unknown_billing: {
    label: "Billing unknown",
    description: "The run didn't say whether it was billed per request or on a subscription; any charges are still counted. Pick an AI connection in the agent's settings so later runs say.",
  },
  missing_model: {
    label: "Model not reported",
    description: "Tokens were counted without a model, so there's no price to apply. Pick a model in the agent's settings for later runs; this run's cost stays unknown.",
  },
  missing_price: {
    label: "No price",
    description: "The provider gave no reliable price for this usage. Nothing to do: new API runs with a known model are priced automatically.",
  },
  waiting_for_receipt: {
    label: "Waiting for usage",
    description: "The run has stopped and Paperclip is waiting for its final usage, which it records on its own. No need to rerun the agent.",
  },
  receipt_unavailable: {
    label: "Final usage missing",
    description: "The run stopped without final usage, so its cost stays open for budget checks. A late report is still recorded; rerunning won't recover it.",
  },
  retryable: {
    label: "Ready to record",
    description: "Its saved usage can be recorded. Paperclip retries on its own, or retry now; this records costs only and doesn't rerun the agent.",
  },
};

/** The notice's one-line summary, or null when nothing's missing. */
export function qualityLine(summary: { unpricedEventCount: number; pendingRunCount: number; unknownBillingEventCount?: number } | undefined) {
  if (!summary) return null;
  const missing = summary.unpricedEventCount + summary.pendingRunCount;
  if (missing > 0) return `${missing} run ${missing === 1 ? "cost" : "costs"} missing`;
  const unknown = summary.unknownBillingEventCount ?? 0;
  return unknown > 0 ? `${unknown} ${unknown === 1 ? "run's" : "runs'"} billing unknown` : null;
}

export type QualityGroup = { agentId: string | null; name: string; appearance: CostDataQualityItem["agentAppearance"]; items: (CostDataQualityItem & { source: "event" | "run" })[] };

/** The report's events and runs grouped by agent (by name), newest first in each. */
export function qualityGroups(report: CostDataQualityReport | undefined): QualityGroup[] {
  const groups = new Map<string | null, QualityGroup>();
  for (const [source, items] of [
    ["event", report?.events ?? []],
    ["run", report?.runs ?? []],
  ] as const) {
    for (const item of items) {
      const group = groups.get(item.agentId) ?? {
        agentId: item.agentId,
        name: item.agentName ?? (item.agentId ? "An agent no longer here" : "Paperclip itself"),
        appearance: item.agentAppearance,
        items: [],
      };
      group.items.push({ ...item, source });
      groups.set(item.agentId, group);
    }
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || (a.agentId ?? "").localeCompare(b.agentId ?? ""));
  for (const group of list) group.items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`));
  return list;
}

// ---------------------------------------------------------------------------------------------
// Decision-model and fast-response history

const CALL_STATUS: Record<string, string> = { succeeded: "Done", running: "Running", unknown: "Unresolved", skipped: "Skipped", pending: "Waiting" };

export function callStatus(status: string) {
  return CALL_STATUS[status] ?? "Failed";
}

/** "Setup test", or the feature that asked. */
export function callFeature(feature: string) {
  return feature === "settings.test" ? "Setup test" : feature.replace(/[._]/g, " ");
}

/** Who the call was for. */
export function callPerson(entry: Pick<DecisionHistoryEntry, "actorType" | "userName" | "responsibleUserId">) {
  if (entry.actorType === "system") return "Paperclip itself";
  if (entry.userName) return entry.userName;
  return entry.responsibleUserId === "local-board" ? "Board" : "A former member";
}

/** Keep polling while a call is still running or being posted. */
export function historyBusy(entries: readonly (DecisionHistoryEntry & { publicationStatus?: string })[] | undefined) {
  return (entries ?? []).some((entry) => ["pending", "running"].includes(entry.status) || ["pending", "streaming", "retry"].includes(entry.publicationStatus ?? ""));
}

export function durationLabel(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}
