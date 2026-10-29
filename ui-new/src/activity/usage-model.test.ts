import type { CostByBiller, CostByProviderModel, CostDataQualityReport, CostWindowSpendRow, ProviderQuotaResult } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  accountPrice,
  billerCards,
  budgetShare,
  callFeature,
  callPerson,
  callStatus,
  centsToField,
  companyName,
  costsTab,
  entirelyUnpriced,
  estimateLabel,
  fieldToCents,
  financeEventLabel,
  historyBusy,
  money,
  overPace,
  providerCards,
  qualityGroups,
  qualityLine,
  quotaProblem,
  resetLabel,
  retainQuota,
  subscriptionTotals,
  weekRange,
} from "./usage-model";

const providerRow = (extra: Partial<CostByProviderModel>): CostByProviderModel => ({
  provider: "anthropic",
  biller: "anthropic",
  billingType: "metered_api",
  model: "claude-opus",
  costCents: 0,
  eventCount: 1,
  estimatedEventCount: 0,
  unpricedEventCount: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  apiRunCount: 0,
  subscriptionRunCount: 0,
  subscriptionCachedInputTokens: 0,
  subscriptionInputTokens: 0,
  subscriptionOutputTokens: 0,
  ...extra,
});

describe("views and ranges", () => {
  it("reads the old page's tab names", () => {
    expect(costsTab("providers")).toBe("providers");
    expect(costsTab("fast-responses")).toBe("fast-responses");
    expect(costsTab("budgets")).toBe("overview");
    expect(costsTab(undefined)).toBe("overview");
  });

  it("covers Monday to Sunday", () => {
    const week = weekRange(new Date(2026, 9, 29, 15)); // a Thursday
    expect(new Date(week.from).getDay()).toBe(1);
    expect(new Date(week.from).getDate()).toBe(26);
    expect(new Date(week.to).getDay()).toBe(0);
    const sunday = weekRange(new Date(2026, 10, 1, 9));
    expect(new Date(sunday.from).getDate()).toBe(26);
  });
});

describe("money and estimates", () => {
  it("formats dollars and other currencies", () => {
    expect(money(1999)).toBe("$19.99");
    expect(money("2000", "EUR")).toMatch(/EUR\s?20\.00/);
    expect(companyName("openrouter")).toBe("OpenRouter");
    expect(companyName("acme")).toBe("acme");
  });

  it("labels estimates and fully unpriced groups", () => {
    expect(estimateLabel({ eventCount: 3, estimatedEventCount: 3 })).toBe("Estimated");
    expect(estimateLabel({ eventCount: 3, estimatedEventCount: 1 })).toBe("Partly estimated");
    expect(estimateLabel({ eventCount: 3, estimatedEventCount: 0 })).toBeNull();
    expect(entirelyUnpriced({ costCents: 0, eventCount: 2, unpricedEventCount: 2 })).toBe(true);
    expect(entirelyUnpriced({ costCents: 0, eventCount: 2, unpricedEventCount: 1 })).toBe(false);
  });

  it("reads and writes price fields as exact cents", () => {
    expect(centsToField("2000.0000000")).toBe("20");
    expect(centsToField("1999")).toBe("19.99");
    expect(centsToField(null)).toBe("");
    expect(fieldToCents("19.99")).toBe("1999");
    expect(fieldToCents("20")).toBe("2000");
    expect(fieldToCents("20.5")).toBe("2050");
    expect(fieldToCents("")).toBeNull();
    expect(fieldToCents("twenty")).toBeUndefined();
    expect(fieldToCents("1.234")).toBeUndefined();
  });
});

describe("providers", () => {
  const rows = [
    providerRow({ model: "opus", costCents: 300, inputTokens: 100, outputTokens: 100, apiRunCount: 2 }),
    providerRow({ model: "haiku", billingType: "subscription_included", costCents: 100, inputTokens: 600, outputTokens: 200, subscriptionRunCount: 3, subscriptionInputTokens: 600, subscriptionOutputTokens: 200 }),
    providerRow({ provider: "openai", biller: "openrouter", model: "gpt", costCents: 50, inputTokens: 10 }),
  ];
  const windows: CostWindowSpendRow[] = [
    { provider: "anthropic", biller: "anthropic", window: "5h", windowHours: 5, costCents: 100, inputTokens: 10, cachedInputTokens: 0, outputTokens: 0 },
    { provider: "anthropic", biller: "anthropic", window: "7d", windowHours: 168, costCents: 400, inputTokens: 10, cachedInputTokens: 0, outputTokens: 0 },
  ];
  const quota: ProviderQuotaResult[] = [{ provider: "xai", ok: true, windows: [] }];

  it("totals each provider, most spend first, with its models and windows", () => {
    const cards = providerCards(rows, windows, [providerRow({ costCents: 70 })], quota);
    expect(cards.map((card) => card.provider)).toEqual(["anthropic", "openai", "xai"]);
    const anthropic = cards[0]!;
    expect(anthropic.costCents).toBe(400);
    expect(anthropic.tokens).toBe(1000);
    expect(anthropic.subscriptionShare).toBe(80);
    expect(anthropic.weekCents).toBe(70);
    expect(anthropic.windows.map((window) => [window.window, window.percent])).toEqual([
      ["5h", 25],
      ["7d", 100],
    ]);
    expect(anthropic.models.map((model) => [model.model, model.costShare, model.tokenShare])).toEqual([
      ["opus", 75, 20],
      ["haiku", 25, 80],
    ]);
    expect(cards[1]!.models[0]!.biller).toBe("OpenRouter");
    // A provider with quota but no usage still shows.
    expect(cards[2]!.costCents).toBe(0);
  });

  it("compares spend with the company budget and its pace", () => {
    expect(budgetShare(500, 100, 0)).toBeNull();
    expect(budgetShare(500, 100, 1000)).toEqual({ period: 50, week: 43, weeklyCents: 231 });
    expect(overPace(600, 1000, new Date(Date.UTC(2026, 9, 10)))).toBe(true);
    expect(overPace(100, 1000, new Date(Date.UTC(2026, 9, 10)))).toBe(false);
  });

  it("keeps the last quota through a passing failure, not through revoked credentials", () => {
    const good: ProviderQuotaResult = { provider: "anthropic", accountKey: "a", ok: true, windows: [{ label: "5h", usedPercent: 10, resetsAt: null, valueLabel: null }] };
    expect(retainQuota([good], [{ provider: "anthropic", accountKey: "a", ok: false, errorFamily: "timeout", windows: [] }])[0]!.windows).toHaveLength(1);
    expect(retainQuota([good], [{ provider: "anthropic", accountKey: "a", ok: false, errorFamily: "credentials_unavailable", windows: [] }])[0]!.windows).toHaveLength(0);
    expect(quotaProblem({ ok: false, errorFamily: "credentials_unavailable", windows: [] })).toMatch(/reconnect/);
    expect(quotaProblem({ ok: false, errorFamily: "permission_denied", windows: [] })).toMatch(/isn't reporting/);
    expect(quotaProblem({ ok: true, windows: [] })).toBeNull();
  });

  it("says when a quota window resets", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(resetLabel("2026-10-29T12:30:00Z", now)).toBe("resets in 30m");
    expect(resetLabel("2026-10-29T17:00:00Z", now)).toBe("resets in 5h");
    expect(resetLabel("2026-11-02T12:00:00Z", now)).toBe("resets in 4d");
    expect(resetLabel("2026-10-29T11:00:00Z", now)).toBe("resets soon");
  });
});

describe("billers", () => {
  it("breaks each biller down by provider and billing type", () => {
    const biller = (extra: Partial<CostByBiller>): CostByBiller =>
      ({ biller: "openrouter", costCents: 150, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, apiRunCount: 1, subscriptionRunCount: 0, providerCount: 2, modelCount: 2, ...extra }) as CostByBiller;
    const cards = billerCards(
      [biller({}), biller({ biller: "anthropic", costCents: 10 })],
      [providerRow({ biller: "openrouter", provider: "openai", costCents: 100 }), providerRow({ biller: "openrouter", provider: "google", costCents: 50, billingType: "credits" })],
      [biller({ costCents: 20 })],
    );
    expect(cards.map((card) => card.biller)).toEqual(["openrouter", "anthropic"]);
    expect(cards[0]!.providers.map((entry) => entry.name)).toEqual(["OpenAI", "Google"]);
    expect(cards[0]!.billing.map((entry) => entry.label)).toEqual(["API", "Credits"]);
    expect(cards[0]!.weekCents).toBe(20);
  });
});

describe("finance and subscriptions", () => {
  it("names provider cost reports", () => {
    expect(financeEventLabel({ eventKind: "inference_charge", metadataJson: { source: "provider_cost_report" } })).toBe("Provider cost report");
    expect(financeEventLabel({ eventKind: "byok_fee", metadataJson: null })).toBe("BYOK fee");
  });

  it("adds up fees per currency", () => {
    expect(subscriptionTotals(undefined)).toBeNull();
    expect(subscriptionTotals({ monthlyTotals: [{ currency: "USD", amountCents: "2000" }], activeCount: 1, accounts: [{}] })).toEqual(["$20.00/month"]);
    expect(subscriptionTotals({ monthlyTotals: [], activeCount: 0, accounts: [{}] })).toEqual(["$0.00/month"]);
    expect(subscriptionTotals({ monthlyTotals: [], activeCount: 1, accounts: [{}] })).toBeNull();
  });

  it("shows an account's price", () => {
    const price = { revision: 0, plan: "Max", amountCents: null, monthlyCents: null, currency: "USD", cadence: "month" as const, status: "active" as const, source: "unknown" as const, sourceUrl: null, effectiveAt: "" };
    expect(accountPrice({ price })).toBe("Price unknown");
    expect(accountPrice({ price: { ...price, monthlyCents: "10000" } })).toBe("$100.00/month");
    expect(accountPrice({ price: { ...price, status: "ended" } })).toBe("Ended");
  });
});

describe("data quality", () => {
  it("summarizes missing costs, then unknown billing", () => {
    expect(qualityLine({ unpricedEventCount: 2, pendingRunCount: 1, unknownBillingEventCount: 4 })).toBe("3 run costs missing");
    expect(qualityLine({ unpricedEventCount: 0, pendingRunCount: 0, unknownBillingEventCount: 1 })).toBe("1 run's billing unknown");
    expect(qualityLine({ unpricedEventCount: 0, pendingRunCount: 0 })).toBeNull();
  });

  it("groups events and runs by agent, newest first", () => {
    const item = (id: string, agentName: string | null, occurredAt: string) => ({ id, runId: id, agentId: agentName, agentName, occurredAt, provider: null, model: null, reason: "missing_price" as const });
    const report: CostDataQualityReport = {
      canRetry: true,
      events: [item("e1", "Zed", "2026-10-01T00:00:00Z"), item("e2", "Ann", "2026-10-01T00:00:00Z")],
      runs: [item("r1", "Ann", "2026-10-02T00:00:00Z"), item("r2", null, "2026-10-02T00:00:00Z")],
      hasMoreEvents: false,
      hasMoreRuns: false,
    };
    const groups = qualityGroups(report);
    expect(groups.map((group) => group.name)).toEqual(["Ann", "Paperclip itself", "Zed"]);
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["r1", "e2"]);
  });
});

describe("call history", () => {
  it("describes each call", () => {
    expect(callStatus("succeeded")).toBe("Done");
    expect(callStatus("timeout")).toBe("Failed");
    expect(callFeature("settings.test")).toBe("Setup test");
    expect(callFeature("issue.triage")).toBe("issue triage");
    expect(callPerson({ actorType: "system", userName: null, responsibleUserId: null })).toBe("Paperclip itself");
    expect(callPerson({ actorType: "user", userName: null, responsibleUserId: "local-board" })).toBe("Board");
  });

  it("polls while a call is running or being posted", () => {
    expect(historyBusy([{ status: "succeeded", publicationStatus: "streaming" } as never])).toBe(true);
    expect(historyBusy([{ status: "running" } as never])).toBe(true);
    expect(historyBusy([{ status: "succeeded", publicationStatus: "posted" } as never])).toBe(false);
    expect(historyBusy(undefined)).toBe(false);
  });
});
