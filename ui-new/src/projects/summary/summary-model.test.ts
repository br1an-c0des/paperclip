import type { GetSummarySlotResponse, SummarySlotRevision } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { BuiltInAgentSummary } from "./summary-api";
import { briefView, generatedAgo, isGenerating, summarizerState } from "./summary-model";

const slot = (over: Partial<NonNullable<GetSummarySlotResponse["slot"]>> = {}): NonNullable<GetSummarySlotResponse["slot"]> => ({
  id: "slot-1",
  companyId: "co",
  scopeKind: "project",
  scopeId: "p1",
  slotKey: "header",
  documentId: "doc-1",
  status: "idle",
  failureReason: null,
  generatingIssueId: null,
  lastGeneratedAt: null,
  lastGeneratedByAgentId: null,
  lastModel: null,
  createdAt: "2026-10-20T10:00:00Z",
  updatedAt: "2026-10-20T10:00:00Z",
  ...over,
});

const response = (over: Partial<GetSummarySlotResponse> = {}): GetSummarySlotResponse => ({
  slot: slot(),
  document: {
    id: "doc-1",
    companyId: "co",
    title: null,
    format: "markdown",
    body: "Latest brief",
    latestRevisionId: "r3",
    latestRevisionNumber: 3,
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-22T10:00:00Z",
  },
  generatingIssue: null,
  ...over,
});

const revision = (number: number, body: string): SummarySlotRevision => ({
  id: `r${number}`,
  companyId: "co",
  documentId: "doc-1",
  revisionNumber: number,
  title: null,
  format: "markdown",
  body,
  changeSummary: null,
  createdByAgentId: null,
  createdByUserId: null,
  createdByRunId: null,
  createdAt: `2026-10-2${number}T09:00:00Z`,
});

const builtIn = (status: BuiltInAgentSummary["status"], agentId: string | null = null): BuiltInAgentSummary => ({
  definition: { key: "summarizer", displayName: "Summarizer" },
  status,
  agentId,
  agent: agentId ? { id: agentId, name: "Summarizer", urlKey: "summarizer" } : null,
});

describe("summarizerState", () => {
  it("is unknown without the built-in agents list or a Summarizer in it", () => {
    expect(summarizerState(undefined)).toEqual({ kind: "unknown" });
    expect(summarizerState([{ ...builtIn("ready"), definition: { key: "briefs", displayName: "Briefs" } }])).toEqual({ kind: "unknown" });
  });

  it("asks for setup, waits on approval, offers resume when paused, and is ready otherwise", () => {
    expect(summarizerState([builtIn("not_provisioned")])).toMatchObject({ kind: "setup" });
    expect(summarizerState([builtIn("needs_setup", "a1")])).toMatchObject({ kind: "setup" });
    expect(summarizerState([builtIn("pending_approval", "a1")])).toMatchObject({ kind: "pending" });
    expect(summarizerState([builtIn("paused", "a1")])).toEqual({ kind: "paused", name: "Summarizer", agentId: "a1" });
    expect(summarizerState([builtIn("ready", "a1")])).toEqual({ kind: "ready" });
  });
});

describe("isGenerating", () => {
  const issue = { id: "i1", identifier: "TES-9", title: "Summarize", status: "in_progress" as const };
  it("needs a generating slot with an open task", () => {
    expect(isGenerating(undefined)).toBe(false);
    expect(isGenerating(response({ slot: slot({ status: "generating" }), generatingIssue: issue }))).toBe(true);
    expect(isGenerating(response({ slot: slot({ status: "generating" }), generatingIssue: { ...issue, status: "done" } }))).toBe(false);
    expect(isGenerating(response({ slot: slot({ status: "generating" }) }))).toBe(false);
  });
});

describe("briefView", () => {
  const revisions = [revision(1, "First"), revision(3, "Latest brief"), revision(2, "Second")];

  it("is null with no summary yet", () => {
    expect(briefView(response({ document: null }), [], null)).toBeNull();
  });

  it("shows the latest, with earlier revisions newest first", () => {
    const view = briefView(response(), revisions, null)!;
    expect(view.body).toBe("Latest brief");
    expect(view.historical).toBe(false);
    expect(view.shown?.number).toBe(3);
    expect(view.earlier.map((entry) => entry.number)).toEqual([2, 1]);
  });

  it("shows a picked earlier revision, and falls back to the latest for an unknown pick", () => {
    expect(briefView(response(), revisions, "r1")).toMatchObject({ body: "First", historical: true, shown: { number: 1 } });
    expect(briefView(response(), revisions, "r3")).toMatchObject({ body: "Latest brief", historical: false });
    expect(briefView(response(), revisions, "gone")).toMatchObject({ body: "Latest brief", historical: false });
  });

  it("uses the document's time before the revisions load", () => {
    expect(briefView(response(), undefined, null)).toMatchObject({ shown: null, at: "2026-10-22T10:00:00.000Z", latestNumber: 3, earlier: [] });
  });
});

describe("generatedAgo", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  it("counts minutes, hours and days, then names the date", () => {
    expect(generatedAgo("2026-10-29T11:59:40Z", now)).toBe("just now");
    expect(generatedAgo("2026-10-29T11:48:00Z", now)).toBe("12m ago");
    expect(generatedAgo("2026-10-29T09:00:00Z", now)).toBe("3h ago");
    expect(generatedAgo("2026-10-27T12:00:00Z", now)).toBe("2d ago");
    expect(generatedAgo("2026-10-12T12:00:00Z", now)).toMatch(/Oct 12/);
  });
});
