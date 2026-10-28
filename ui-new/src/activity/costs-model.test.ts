import type { BudgetPolicySummary, CostByAgent, CostByAgentModel } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { agentCostRows, barPercent, budgetRows, costRange, formatTokens, pricingNote, projectCostRows } from "./costs-model";

describe("cost ranges", () => {
  const now = new Date(2026, 9, 27, 15, 30);

  it("starts the month and year at the UTC boundary and rolling windows at local midnight", () => {
    expect(costRange("mtd", now)).toEqual({ from: "2026-10-01T00:00:00.000Z" });
    expect(costRange("ytd", now)).toEqual({ from: "2026-01-01T00:00:00.000Z" });
    expect(costRange("7d", now)).toEqual({ from: new Date(2026, 9, 20).toISOString() });
    expect(costRange("all", now)).toEqual({});
  });

  it("waits for both days of a custom range, and refuses one that ends before it starts", () => {
    expect(costRange("custom", now, { from: "2026-10-01" })).toBeNull();
    expect(costRange("custom", now, { from: "2026-10-05", to: "2026-10-01" })).toBeNull();
    expect(costRange("custom", now, { from: "2026-10-01", to: "2026-10-02" })).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 2, 23, 59, 59, 999).toISOString(),
    });
  });
});

const usage = { inputTokens: 100, cachedInputTokens: 1000, outputTokens: 50 };

describe("spend rows", () => {
  it("lists agents by spend then tokens, each with its models", () => {
    const agents = [
      { agentId: "a", agentName: "Bob", costCents: 0, eventCount: 6, apiRunCount: 0, subscriptionRunCount: 6, ...usage },
      { agentId: "b", agentName: "Quant", costCents: 250, eventCount: 2, apiRunCount: 2, subscriptionRunCount: 0, ...usage },
      { agentId: null, agentName: null, costCents: 0, eventCount: 1, apiRunCount: 0, subscriptionRunCount: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    ] as CostByAgent[];
    const models = [
      { agentId: "a", provider: "anthropic", billingType: "subscription_included", model: "claude-opus-5-5", costCents: 0, eventCount: 6, ...usage },
      { agentId: "b", provider: "unknown", billingType: "unknown", model: "unknown", costCents: 250, eventCount: 2, ...usage },
    ] as CostByAgentModel[];
    const rows = agentCostRows(agents, models);
    expect(rows.map((row) => row.name)).toEqual(["Quant", "Bob", "No agent"]);
    expect(rows[1]).toMatchObject({ tokens: 1150, subscriptionRuns: 6, models: [{ model: "claude-opus-5-5", provider: "Anthropic", billing: "Subscription", tokens: 1150 }] });
    expect(rows[0]!.models[0]).toMatchObject({ model: "Unknown model", provider: "Unknown provider", billing: "Unknown billing" });
  });

  it("lists projects by spend with work outside a project last", () => {
    const rows = projectCostRows([
      { projectId: null, projectName: null, costCents: 900, eventCount: 1, estimatedEventCount: 0, ...usage },
      { projectId: "p", projectName: "Site", costCents: 10, eventCount: 1, estimatedEventCount: 0, ...usage },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Site", "No project"]);
  });

  it("formats tokens and bars", () => {
    expect(formatTokens(1_345_236)).toBe("1.3M");
    expect(formatTokens(88_591)).toBe("88.6k");
    expect(formatTokens(312)).toBe("312");
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 0)).toBe(0);
    expect(barPercent(500, 1000)).toBe(50);
  });
});

describe("budgets", () => {
  const policy = (extra: Partial<BudgetPolicySummary>): BudgetPolicySummary =>
    ({
      policyId: "p",
      scopeType: "agent",
      scopeId: "a",
      scopeName: "Bob",
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 1000,
      observedAmount: 500,
      utilizationPercent: 50,
      status: "ok",
      paused: false,
      ...extra,
    }) as BudgetPolicySummary;

  it("keeps budgets with a limit, the company's first, fullest first", () => {
    const rows = budgetRows([
      policy({ policyId: "off", amount: 0 }),
      policy({ policyId: "p1", scopeType: "project", scopeName: "Site", windowKind: "lifetime", utilizationPercent: 90 }),
      policy({ policyId: "a1", utilizationPercent: 20 }),
      policy({ policyId: "a2", scopeName: "Quant", utilizationPercent: 120, status: "hard_stop", paused: true }),
      policy({ policyId: "c", scopeType: "company", scopeName: "Test Shell Co" }),
    ]);
    expect(rows.map((row) => row.policyId)).toEqual(["c", "a2", "a1", "p1"]);
    expect(rows[1]).toMatchObject({ percent: 100, paused: true, window: "Monthly" });
    expect(rows[3]!.window).toBe("Lifetime");
  });


  it("says when the numbers aren't complete", () => {
    expect(pricingNote({ unpricedEventCount: 9, pendingRunCount: 1, eventCount: 15 })).toBe("9 of 15 usage reports have no price; 1 run is still being counted.");
    expect(pricingNote({ unpricedEventCount: 0, pendingRunCount: 0, eventCount: 3 })).toBeNull();
  });
});
