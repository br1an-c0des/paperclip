import type { IssueContextUsage } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { compactState, contextLabel, contextLevel, contextPercent, contextRows, formatTokens } from "./context-usage";
import { compactionDetail, compactionRunIds, runCompactions, runsToRead } from "./thread-compactions";

const usage = (extra: Partial<IssueContextUsage> = {}): IssueContextUsage => ({
  runId: "r1",
  agentId: "a1",
  sessionId: "s1",
  usedTokens: 27_000,
  windowTokens: 258_000,
  observedAt: "2026-11-07T10:00:00Z",
  totals: { inputTokens: 77_000, cachedInputTokens: 49_000, outputTokens: 1_100 },
  costUsd: 0.4,
  compactions: 0,
  ...extra,
});

describe("the Context row", () => {
  it("reads as upstream's '10% of 258k'", () => {
    expect(contextLabel(usage())).toBe("10% of 258k");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_200)).toBe("1.2k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(contextPercent(usage({ usedTokens: 300_000 }))).toBe(100);
  });

  it("turns amber near full and red when nearly full", () => {
    expect(contextLevel(usage())).toBe("normal");
    expect(contextLevel(usage({ usedTokens: 210_000 }))).toBe("near");
    expect(contextLevel(usage({ usedTokens: 250_000 }))).toBe("full");
  });

  it("breaks down tokens, cost and compactions, leaving out what wasn't reported", () => {
    expect(contextRows(usage({ compactions: 2 }))).toEqual([
      { label: "Input", value: "77k · 49k cached" },
      { label: "Output", value: "1.1k" },
      { label: "Cost", value: "$0.40" },
      { label: "Compactions", value: "2", muted: true },
    ]);
    expect(contextRows(usage({ totals: null, costUsd: null }))).toEqual([]);
  });

  it("follows the server's Compact now state, pending while a request is out", () => {
    expect(compactState(undefined, false)).toBeNull();
    expect(compactState({ status: "available", reasonCode: null, reason: null }, false)?.status).toBe("available");
    expect(compactState({ status: "available", reasonCode: null, reason: null }, true)?.status).toBe("pending");
    expect(compactState({ status: "pending", reasonCode: null, reason: null, runId: "r9" }, false)?.note).toMatch(/under a minute/);
    expect(compactState({ status: "unavailable", reasonCode: "agent_busy", reason: "The agent is working on this task." }, false)).toEqual({
      status: "unavailable",
      note: "The agent is working on this task.",
    });
  });
});

const prp = (seq: number, eventType: string, payload: Record<string, unknown>) => ({
  seq,
  runId: "r1",
  eventType,
  createdAt: new Date(`2026-11-07T10:00:${String(seq).padStart(2, "0")}Z`),
  payload: { prpEvent: { schema: "paperclip.prp.event.v1", schemaVersion: 1, runId: "r1", eventType, payload } },
});
const reading = (seq: number, used: number) => prp(seq, "item.completed", { kind: "usage", usage: { context: { usedTokens: used, windowTokens: 258_000 } } });
const compacted = (seq: number, id: string, extra: Record<string, unknown> = {}) =>
  prp(seq, "context.compacted", { schema: "paperclip.context.compacted.v1", compactionId: id, ...extra });

describe("compaction dividers", () => {
  it("takes the sizes from the readings around a compaction, and counts a repeat once", () => {
    const found = runCompactions("r1", [reading(1, 230_000), compacted(2, "c1"), compacted(3, "c1"), reading(4, 38_000), reading(5, 60_000), compacted(6, "c2", { preTokens: 61_000, postTokens: 20_000 })]);
    expect(found.map((item) => [item.preTokens, item.postTokens])).toEqual([
      [230_000, 38_000],
      [61_000, 20_000],
    ]);
    expect(compactionDetail(found[0]!)).toBe("230k → 38k tokens");
    expect(compactionDetail({ preTokens: 230_000, postTokens: null })).toBe("from 230k tokens");
    expect(compactionDetail({ preTokens: null, postTokens: null })).toBeNull();
  });

  it("ignores events that aren't the runner's", () => {
    expect(runCompactions("r1", [{ seq: 1, runId: "r1", eventType: "context.compacted", createdAt: new Date(), payload: { compactionId: "x" } }])).toEqual([]);
  });

  it("reads finished runner runs: every one while the session has compacted, else those Compact now queued", () => {
    const runs = [
      { runId: "r1", status: "succeeded", adapterType: "paperclip_runner" },
      { runId: "r2", status: "running", adapterType: "paperclip_runner" },
      { runId: "r3", status: "failed", adapterType: "claude_local" },
      { runId: "r4", status: "succeeded", adapterType: "paperclip_runner" },
    ];
    expect(runsToRead(runs, { sessionCompacted: true, requested: new Set() })).toEqual(["r1", "r4"]);
    expect(runsToRead(runs, { sessionCompacted: false, requested: new Set(["r4"]) })).toEqual(["r4"]);
    expect([...compactionRunIds([{ action: "issue.context_compaction_requested", details: { compactionRunId: "r4" } }, { action: "issue.updated", details: {} }])]).toEqual(["r4"]);
  });
});
