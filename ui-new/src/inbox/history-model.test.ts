import type { DecisionHistoryItem } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { historyParams } from "@/api/attention";
import { decidedBy, filtersActive, historyItems, historyKey, historyQuery, NO_HISTORY_FILTERS, outcomeTone } from "./history-model";

function item(id: string, extra: Partial<DecisionHistoryItem> = {}): DecisionHistoryItem {
  return {
    id,
    sourceKind: "issue_thread_interaction",
    sourceId: id,
    issueId: "i1",
    issueIdentifier: "TES-1",
    issueTitle: "Task",
    agentId: null,
    agentName: null,
    projectId: null,
    projectName: null,
    title: "Question",
    outcome: "accepted",
    label: "Approved",
    resolvedAt: "2026-11-01T10:00:00.000Z",
    resolvedByUserId: null,
    resolvedByAgentId: null,
    href: "/TES/issues/TES-1",
    target: null,
    ...extra,
  };
}

describe("historyQuery", () => {
  it("sends only what's set, a page of 40, newest by default", () => {
    expect(historyQuery(NO_HISTORY_FILTERS)).toEqual({ limit: 40, scope: "mine" });
    expect(historyQuery({ search: "  tes-4 ", outcome: "rejected", agentId: "a1", projectId: "p1", sort: "oldest", scope: "all" }, "next")).toEqual({
      limit: 40,
      search: "tes-4",
      outcome: "rejected",
      agentId: "a1",
      projectId: "p1",
      sort: "oldest",
      cursor: "next",
    });
  });

  it("keys equal filters alike, without the page size", () => {
    expect(historyKey(NO_HISTORY_FILTERS)).toEqual({ scope: "mine" });
    expect(historyKey({ ...NO_HISTORY_FILTERS, search: " x " })).toEqual({ scope: "mine", search: "x" });
    expect(historyKey({ ...NO_HISTORY_FILTERS, scope: "all" })).toEqual({});
  });

  it("builds the request's query string", () => {
    expect(historyParams(historyQuery({ ...NO_HISTORY_FILTERS, outcome: "answered" }, "c 1"))).toBe("limit=40&scope=mine&outcome=answered&cursor=c+1");
  });

  it("sends Handled for me as its own flag, not an outcome (U133)", () => {
    expect(historyQuery({ ...NO_HISTORY_FILTERS, outcome: "handled_for_me" })).toEqual({ limit: 40, scope: "mine", handledForMe: true });
    expect(historyQuery({ ...NO_HISTORY_FILTERS, outcome: "withdrawn", scope: "all" })).toEqual({ limit: 40, outcome: "withdrawn" });
  });
});

describe("filtersActive", () => {
  it("is on for any filter or words", () => {
    expect(filtersActive(NO_HISTORY_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_HISTORY_FILTERS, sort: "oldest" })).toBe(false);
    expect(filtersActive({ ...NO_HISTORY_FILTERS, search: "x" })).toBe(true);
    expect(filtersActive({ ...NO_HISTORY_FILTERS, projectId: "p" })).toBe(true);
  });
});

describe("outcomeTone", () => {
  it("colours approvals, changes requested and answers; leaves the rest plain", () => {
    expect(outcomeTone(item("a"))).toBe("green");
    expect(outcomeTone(item("a", { outcome: "rejected" }))).toBe("amber");
    expect(outcomeTone(item("a", { outcome: "answered" }))).toBe("run");
    expect(outcomeTone(item("a", { outcome: "decided" }))).toBe("run");
    expect(outcomeTone(item("a", { outcome: "cancelled" }))).toBeNull();
    expect(outcomeTone(item("a", { outcome: "expired" }))).toBeNull();
  });
});

describe("historyItems", () => {
  it("joins the pages in order, dropping repeats", () => {
    expect(historyItems([{ items: [item("a"), item("b")] }, { items: [item("b"), item("c")] }]).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(historyItems(undefined)).toEqual([]);
  });
});

describe("decidedBy", () => {
  const names = { youId: "u1", person: (id: string) => `Person ${id}`, agent: (id: string) => (id === "a1" ? "Ada" : undefined) };
  it("names you, a person or an agent", () => {
    expect(decidedBy(item("a", { resolvedByUserId: "u1" }), names)).toBe("You");
    expect(decidedBy(item("a", { resolvedByUserId: "u2" }), names)).toBe("Person u2");
    expect(decidedBy(item("a", { resolvedByAgentId: "a1" }), names)).toBe("Ada");
    expect(decidedBy(item("a", { resolvedByAgentId: "a9" }), names)).toBe("An agent");
    expect(decidedBy(item("a"), names)).toBeNull();
  });
});
