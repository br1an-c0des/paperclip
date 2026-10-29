import type { LiveEvent, StatusCard, StatusCardUpdate } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { keysForEvent } from "@/lib/live-events";
import {
  cardIsBusy,
  cardIsLive,
  cardLifecycle,
  changeKindLabel,
  defaultPolicy,
  dryRunMatches,
  estimateCost,
  formatCents,
  formatTokens,
  isSummarizerMissing,
  midSentence,
  policyLabel,
  rollupAll,
  rollupToday,
  setupRunning,
  summaryUpdates,
  withMode,
} from "./status-model";

type CardState = Pick<StatusCard, "state" | "archivedAt" | "generatingIssueId" | "pendingChangeCount">;
const card = (patch: Partial<CardState> = {}): CardState => ({ state: "active", archivedAt: null, generatingIssueId: null, pendingChangeCount: 0, ...patch });

const update = (patch: Partial<StatusCardUpdate>): StatusCardUpdate => ({
  id: "u",
  cardId: "c",
  kind: "incremental",
  trigger: "manual",
  generationIssueId: null,
  runId: null,
  changes: [],
  inputTokens: 100,
  outputTokens: 50,
  costCents: 1,
  model: null,
  queryVersion: 1,
  changeSummary: null,
  startedAt: "2026-10-29T10:00:00Z",
  finishedAt: "2026-10-29T10:01:00Z",
  status: "ok",
  error: null,
  ...patch,
});

describe("cardLifecycle", () => {
  it("ranks archived, setting up, error and paused above a running update", () => {
    expect(cardLifecycle(card({ archivedAt: "2026-10-29T00:00:00Z", state: "error" }))).toBe("archived");
    expect(cardLifecycle(card({ state: "compiling", generatingIssueId: "i1" }))).toBe("compiling");
    expect(cardLifecycle(card({ state: "error", generatingIssueId: "i1" }))).toBe("error");
    expect(cardLifecycle(card({ state: "paused_budget", pendingChangeCount: 2 }))).toBe("paused_budget");
    expect(cardLifecycle(card({ state: "paused_hours" }))).toBe("paused_hours");
    expect(cardLifecycle(card({ generatingIssueId: "i1", pendingChangeCount: 2 }))).toBe("updating");
    expect(cardLifecycle(card({ pendingChangeCount: 2 }))).toBe("stale");
    expect(cardLifecycle(card())).toBe("fresh");
  });

  it("tells a stalled setup from a running one", () => {
    expect(setupRunning(card({ state: "compiling", generatingIssueId: "i1" }))).toBe(true);
    expect(setupRunning(card({ state: "compiling" }))).toBe(false);
    expect(cardIsLive(card({ state: "compiling" }))).toBe(false);
    expect(cardIsLive(card({ state: "compiling", generatingIssueId: "i1" }))).toBe(true);
    expect(cardIsLive(card({ generatingIssueId: "i1" }))).toBe(true);
    // A stalled setup still polls: the server may pick it up again.
    expect(cardIsBusy(card({ state: "compiling" }))).toBe(true);
    expect(cardIsBusy(card({ pendingChangeCount: 3 }))).toBe(false);
  });
});

describe("labels", () => {
  it("formats tokens, cents and time labels", () => {
    expect(formatTokens(940)).toBe("940 tok");
    expect(formatTokens(1100)).toBe("1.1k tok");
    expect(formatTokens(undefined)).toBeNull();
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(0.6)).toBe("$0.006");
    expect(formatCents(42)).toBe("$0.42");
    expect(midSentence("Just now")).toBe("just now");
    expect(midSentence("Oct 26")).toBe("Oct 26");
  });

  it("describes refresh policies and changes", () => {
    expect(policyLabel(defaultPolicy())).toBe("Manual");
    expect(policyLabel(withMode(defaultPolicy(), "interval"))).toBe("Every 15 min if changed");
    expect(policyLabel(withMode(defaultPolicy(), "reactive"))).toBe("On change (60s)");
    expect(changeKindLabel("entered_query")).toBe("New match");
    expect(changeKindLabel("assignee_changed")).toBe("Assignee changed");
  });
});

describe("withMode", () => {
  it("fills what the server requires for each mode and keeps the rest", () => {
    const interval = withMode({ ...defaultPolicy(), dailyTokenCap: 5000 }, "interval");
    expect(interval).toMatchObject({ mode: "interval", intervalMinutes: 15, dailyTokenCap: 5000 });
    expect(withMode({ ...interval, intervalMinutes: 60 }, "interval").intervalMinutes).toBe(60);
    expect(withMode(defaultPolicy(), "reactive")).toMatchObject({ debounceSeconds: 60, maxUpdatesPerHour: 6 });
  });
});

describe("estimateCost", () => {
  it("prices a manual card per update", () => {
    expect(estimateCost(defaultPolicy()).cost).toBe("$0.030 · 4.5k tok per update");
  });

  it("counts updates a day from the cadence, active hours and the cap", () => {
    const hourly = { ...withMode(defaultPolicy(), "interval"), intervalMinutes: 60 };
    expect(estimateCost(hourly).detail).toContain("~24 updates a day");
    const daytime = { ...hourly, activeHours: { start: "09:00", end: "17:00", timezone: "UTC" } };
    expect(estimateCost(daytime).detail).toContain("~8 updates a day (every 60 min in active hours)");
    const capped = { ...withMode(defaultPolicy(), "interval"), intervalMinutes: 5, dailyTokenCap: 10_000 };
    expect(estimateCost(capped).detail).toContain("~5 updates a day");
    expect(estimateCost(capped).note).toContain("10.0k tok daily cap");
  });
});

describe("the updates ledger", () => {
  const ledger = [
    update({ id: "u3", startedAt: "2026-10-29T09:00:00Z" }),
    update({ id: "u2", status: "running", finishedAt: null, startedAt: "2026-10-29T08:00:00Z" }),
    update({ id: "u1", kind: "compile", startedAt: "2026-10-28T23:00:00Z", costCents: 2 }),
    update({ id: "u0", kind: "full", status: "failed", startedAt: "2026-10-28T22:00:00Z" }),
  ];

  it("rolls up today (UTC) and the whole ledger, not counting query builds as updates", () => {
    expect(rollupToday(ledger, new Date("2026-10-29T12:00:00Z"))).toEqual({ updateCount: 2, totalTokens: 300, totalCostCents: 2 });
    expect(rollupAll(ledger)).toEqual({ updateCount: 3, totalTokens: 600, totalCostCents: 5 });
  });

  it("keeps only finished updates that wrote a summary as revisions", () => {
    expect(summaryUpdates(ledger).map((entry) => entry.id)).toEqual(["u3"]);
  });
});

describe("dryRunMatches", () => {
  const issue = (id: string) => ({ id, identifier: id.toUpperCase(), title: id, status: "todo" as const, priority: "medium" as const, assigneeAgentId: null, assigneeUserId: null, projectId: null, updatedAt: "2026-10-29T10:00:00Z" });
  it("lists each match once and the summary's mentions that no query matched", () => {
    const result = (ids: string[]) => ({ results: ids.map((id) => ({ issue: issue(id) })) }) as never;
    const matches = dryRunMatches({ queries: [{ query: {} as never, result: result(["a", "b"]) }, { query: {} as never, result: result(["b", "c"]) }], mentionedIssues: [issue("c"), issue("d")] });
    expect(matches.matched.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(matches.mentioned.map((entry) => entry.id)).toEqual(["d"]);
    expect(dryRunMatches(undefined)).toEqual({ matched: [], mentioned: [] });
  });
});

describe("isSummarizerMissing", () => {
  it("reads the server's code from the error body", () => {
    expect(isSummarizerMissing(new ApiError("Summarizer built-in agent is not configured", 422, { error: "x", details: { code: "summarizer_not_configured" } }))).toBe(true);
    expect(isSummarizerMissing(new ApiError("Nope", 422, { error: "Nope" }))).toBe(false);
    expect(isSummarizerMissing(new Error("x"))).toBe(false);
  });
});

describe("live events", () => {
  it("refresh every status-card query on status_card activity", () => {
    const event = { id: 1, companyId: "c1", type: "activity.logged", createdAt: "", payload: { entityType: "status_card", entityId: "s1", action: "status_card.summary_written" } } as LiveEvent;
    expect(keysForEvent("c1", event)).toContainEqual(queryKeys.statusCards.all);
    expect(queryKeys.statusCards.detail("s1").slice(0, 1)).toEqual([...queryKeys.statusCards.all]);
    expect(queryKeys.statusCards.list("c1", true).slice(0, 1)).toEqual([...queryKeys.statusCards.all]);
  });
});
