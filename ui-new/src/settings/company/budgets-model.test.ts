import type { BudgetIncident, BudgetOverview, BudgetPolicySummary } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { companyPolicy, incidentText, limitAction, resetsLabel, rowDirty, rowDraft, rowRequest, scopeRows, shortDollars, suggestedRaise, usedPercent } from "./budgets-model";

function policy(overrides: Partial<BudgetPolicySummary>): BudgetPolicySummary {
  return {
    policyId: "p",
    companyId: "c",
    scopeType: "agent",
    scopeId: "a",
    scopeName: "Agent",
    metric: "billed_cents",
    windowKind: "calendar_month_utc",
    amount: 10000,
    observedAmount: 6130,
    unpricedEventCount: 0,
    pendingRunCount: 0,
    remainingAmount: 3870,
    utilizationPercent: 61,
    warnPercent: 80,
    hardStopEnabled: true,
    unpricedUsagePolicy: "block",
    notifyEnabled: true,
    isActive: true,
    status: "ok",
    paused: false,
    pauseReason: null,
    windowStart: new Date("2026-10-01T00:00:00Z"),
    windowEnd: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  };
}

function overview(policies: BudgetPolicySummary[]): BudgetOverview {
  return { companyId: "c", policies, activeIncidents: [], pausedAgentCount: 0, pausedProjectCount: 0, pendingApprovalCount: 0 };
}

describe("budget rows", () => {
  it("finds the organization's monthly policy", () => {
    const data = overview([policy({ scopeType: "company", scopeId: "c", policyId: "org" }), policy({ scopeType: "company", scopeId: "c", windowKind: "lifetime" })]);
    expect(companyPolicy(data, "c")?.policyId).toBe("org");
    expect(companyPolicy(overview([]), "c")).toBeNull();
  });

  it("lists set agent and project budgets by name", () => {
    const rows = scopeRows(
      overview([
        policy({ policyId: "z", scopeName: "Zed" }),
        policy({ policyId: "a", scopeName: "Ann" }),
        policy({ policyId: "off", scopeName: "Off", amount: 0 }),
        policy({ policyId: "tokens", metric: "tokens" as never }),
        policy({ policyId: "proj", scopeType: "project", scopeName: "Trading" }),
      ]),
    );
    expect(rows.agents.map((row) => row.policyId)).toEqual(["a", "z"]);
    expect(rows.projects.map((row) => row.policyId)).toEqual(["proj"]);
  });

  it("drafts, compares and saves a row", () => {
    const current = policy({});
    const draft = rowDraft(current);
    expect(draft).toEqual({ amount: "100", warnPercent: 80, hardStop: true });
    expect(rowDirty(current, draft)).toBe(false);
    expect(rowDirty(current, { ...draft, amount: "100.00" })).toBe(false);
    expect(rowDirty(current, { ...draft, warnPercent: 90 })).toBe(true);
    expect(rowRequest({ scopeType: "agent", scopeId: "a", windowKind: "calendar_month_utc" }, { ...draft, amount: "120" })).toEqual({
      scopeType: "agent",
      scopeId: "a",
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 12000,
      warnPercent: 80,
      hardStopEnabled: true,
    });
    expect(rowRequest({ scopeType: "agent", scopeId: "a", windowKind: "calendar_month_utc" }, { ...draft, amount: "" })).toEqual({
      scopeType: "agent",
      scopeId: "a",
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 0,
    });
    expect(rowRequest({ scopeType: "agent", scopeId: "a", windowKind: "calendar_month_utc" }, { ...draft, amount: "abc" })).toBeNull();
  });
});

describe("budget labels", () => {
  it("formats money, use and resets", () => {
    expect(shortDollars(50000)).toBe("$500");
    expect(shortDollars(1250)).toBe("$12.50");
    expect(usedPercent(policy({}))).toBe(61);
    expect(usedPercent(policy({ amount: 0 }))).toBeNull();
    expect(usedPercent(policy({ observedAmount: 99999 }))).toBe(100);
    expect(resetsLabel("2026-11-01T00:00:00Z")).toBe("Resets Nov 1");
    expect(limitAction("project", true)).toBe("Pause the project");
    expect(limitAction("agent", false)).toBe("Only warn");
  });

  it("describes an incident and suggests a raise", () => {
    const incident = { scopeName: "Strategy Engineer", amountLimit: 6000, amountObserved: 6040, thresholdType: "hard" } as BudgetIncident;
    expect(incidentText(incident)).toBe("Strategy Engineer reached its $60 budget ($60.40 spent) and was paused.");
    expect(suggestedRaise(incident)).toBe(8000);
  });
});
