import { describe, expect, it } from "vitest";
import { auditQuery } from "@/api/activity";
import { actorAgentId, commentaryFilters, dayEnd, dayStart, filtersKey, hasFilters, legacyActivityHref, logFilters, needsFullTier, pageRange } from "./log-model";

describe("log filters", () => {
  it("asks for everyone's activity by default", () => {
    expect(logFilters({})).toEqual({
      actorScope: "all",
      actorType: undefined,
      agentId: undefined,
      runId: undefined,
      responsibleUserId: undefined,
      entityType: undefined,
      entityId: undefined,
      action: undefined,
      from: undefined,
      to: undefined,
    });
    expect(auditQuery(logFilters({}), { limit: 50 })).toBe("actorScope=all&limit=50");
    expect(hasFilters({ all: "1" })).toBe(false);
  });

  it("reads who acted: a kind, or one agent (also from the old agent link)", () => {
    expect(logFilters({ actor: "people" }).actorType).toBe("user");
    expect(logFilters({ actor: "paperclip" }).actorType).toBe("system");
    expect(logFilters({ actor: "agent-1" })).toMatchObject({ actorType: undefined, agentId: "agent-1" });
    expect(actorAgentId({ mode: "agents", agentId: "agent-2" })).toBe("agent-2");
    expect(logFilters({ mode: "agents", agentId: "agent-2" })).toMatchObject({ actorScope: "agents", agentId: "agent-2" });
  });

  it("only sends an entity id with an entity type, trimmed (a case's identifier works)", () => {
    expect(logFilters({ entityType: "case", entityId: " CAS-C1 " })).toMatchObject({ entityType: "case", entityId: "CAS-C1" });
    expect(logFilters({ entityId: "x" }).entityId).toBeUndefined();
    expect(hasFilters({ entityType: "case" })).toBe(true);
  });

  it("turns days into the start and end of the local day", () => {
    expect(dayStart("2026-10-01")).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).toISOString());
    expect(dayEnd("2026-10-01")).toBe(new Date(2026, 9, 1, 23, 59, 59, 999).toISOString());
    expect(dayStart("Oct 1")).toBeUndefined();
    expect(logFilters({ from: "2026-10-01", to: "2026-10-02" })).toMatchObject({ from: dayStart("2026-10-01"), to: dayEnd("2026-10-02") });
  });

  it("knows which filters need the full tier, and keys filters stably", () => {
    expect(needsFullTier(logFilters({ actor: "people" }))).toBe(false);
    expect(needsFullTier(logFilters({ actor: "agent-1" }))).toBe(true);
    expect(needsFullTier(logFilters({ runId: "r" }))).toBe(true);
    expect(filtersKey(logFilters({ action: "issue." }))).toBe(filtersKey({ actorScope: "all", action: "issue." }));
  });
});

describe("commentary filters", () => {
  it("reads the kind, agent, search and page", () => {
    expect(commentaryFilters({ kind: "complaint", q: " slow ", offset: "50" })).toEqual({ q: "slow", agentId: undefined, kind: "complaint", offset: 50, limit: 50 });
    expect(commentaryFilters({ kind: "rant", offset: "-3" })).toMatchObject({ kind: undefined, offset: 0 });
    expect(pageRange(50, 20, 70)).toBe("51–70 of 70");
    expect(pageRange(0, 0, 0)).toBe("0 of 0");
  });
});

describe("old addresses", () => {
  it("sends the old audit, runs, costs and budgets pages to the Activity tabs", () => {
    expect(legacyActivityHref("audit", "")).toBe("activity?mode=agents");
    expect(legacyActivityHref("audit/activity", "?agentId=a1")).toBe("activity?agentId=a1&mode=agents");
    expect(legacyActivityHref("runs", "?agentId=a1")).toBe("activity/runs?agentId=a1");
    expect(legacyActivityHref("costs", "")).toBe("activity/costs");
    expect(legacyActivityHref("audit/budgets/", "")).toBe("company/settings/budgets");
    expect(legacyActivityHref("activity/timeline", "")).toBe("workload");
    expect(legacyActivityHref("activity", "")).toBeNull();
  });
});
