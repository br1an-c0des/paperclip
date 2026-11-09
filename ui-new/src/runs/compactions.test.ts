import { describe, expect, it } from "vitest";
import { compactionDetail } from "./compactions";
import { itemText } from "./find-model";
import { buildTranscript } from "./parsers";
import type { RunLogChunk } from "./run-log";
import { buildItems, stepCount, visibleItems, type TranscriptItem } from "./transcript-model";

/*
 * The compaction divider in the run modal's transcript (U58): read from the run's log, sized by the
 * same tracker as the task thread's dividers (tasks/context-usage.test.ts covers those).
 */

const START = Date.parse("2026-11-09T10:00:00.000Z");

type Event = { eventType: string; payload: Record<string, unknown>; itemId?: string };

function log(events: Event[]): RunLogChunk[] {
  return events.map((event, index) => ({
    ts: new Date(START + (index + 1) * 1000).toISOString(),
    stream: "stdout" as const,
    chunk: `${JSON.stringify({ type: "paperclip.prp.event", event: { schema: "paperclip.prp.event.v1", sourceSeq: index + 1, ...event } })}\n`,
  }));
}

const reading = (used: number): Event => ({ eventType: "item.completed", payload: { kind: "usage", usage: { context: { usedTokens: used, windowTokens: 258_000 } } } });
const compacted = (id: string, extra: Record<string, unknown> = {}): Event => ({ eventType: "context.compacted", payload: { schema: "paperclip.context.compacted.v1", compactionId: id, ...extra } });
const message = (itemId: string, text: string): Event => ({ eventType: "item.completed", itemId, payload: { kind: "agentMessage", channel: "progress", text } });
const tool = (id: string): Event => ({
  eventType: "tool.execution.completed",
  payload: { schema: "paperclip.tool.execution.v1", executionId: id, transport: "builtin", operation: "read", status: "completed", name: "Read", target: `src/${id}.ts`, output: null, outputBytes: 0, outputTruncated: false, outputDigest: null },
});
const notice = (phase: string): Event => ({
  eventType: "provider.notice.recorded",
  itemId: "compact-1",
  payload: { schema: "paperclip.provider.notice.v1", noticeId: "compact-1", severity: "warning", category: "context_compaction", scope: "turn", recoverable: true, userActionable: false, summary: "Context compacted", details: [{ name: "Phase", value: phase }] },
});

const itemsOf = (events: Event[], live = false) => buildItems(buildTranscript(log(events), "paperclip_runner"), live);
const dividers = (items: TranscriptItem[]) => items.filter((item): item is Extract<TranscriptItem, { kind: "compaction" }> => item.kind === "compaction");

describe("the compaction divider in a run's transcript", () => {
  it("sits where the compaction happened, sized from the readings around it, and counts a repeat once", () => {
    const items = itemsOf([message("m1", "Reading the code."), reading(230_000), compacted("c1"), compacted("c1"), reading(38_000), message("m2", "Carrying on."), reading(60_000), compacted("c2", { preTokens: 61_000, postTokens: 20_000 })]);
    expect(items.map((item) => item.kind)).toEqual(["message", "compaction", "message", "compaction"]);
    expect(dividers(items).map((item) => compactionDetail(item))).toEqual(["230k → 38k tokens", "61k → 20k tokens"]);
    expect(dividers(items)[0]!.ts).toBe(new Date(START + 3000).toISOString());
  });

  it("says only the size before while the run hasn't reported the size after", () => {
    const [divider] = dividers(itemsOf([reading(230_000), compacted("c1")], true));
    expect(compactionDetail(divider!)).toBe("from 230k tokens");
    expect(dividers(itemsOf([compacted("c1")]))[0]).toMatchObject({ preTokens: null, postTokens: null });
  });

  it("divides a stretch of steps instead of folding into it, and isn't a step", () => {
    const items = itemsOf([...["a", "b", "c", "d", "e", "f"].map(tool), compacted("c1"), tool("g")]);
    const shown = visibleItems(items, { thinking: true, tools: true, expanded: new Set() });
    expect(shown.map((item) => item.kind)).toEqual(["fold", "tool", "tool", "compaction", "tool"]);
    expect(stepCount(items)).toBe(7);
    expect(itemText(dividers(items)[0]!)).toContain("Context compacted");
  });

  it("lets the divider stand for a harness's completed compaction notice, as the old task chat does", () => {
    expect(itemsOf([notice("completed"), compacted("c1")]).map((item) => item.kind)).toEqual(["compaction"]);
    // Without a divider the notice keeps its chip; a failed one keeps it either way.
    expect(itemsOf([notice("completed")]).map((item) => item.kind)).toEqual(["chip"]);
    expect(itemsOf([notice("failed"), compacted("c1")]).map((item) => item.kind)).toEqual(["chip", "compaction"]);
  });
});
