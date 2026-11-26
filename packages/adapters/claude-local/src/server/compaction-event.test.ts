import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { claudeCompactionEvent, createClaudeCompactionLog } from "./compaction-event.js";

// A real `compact_boundary` from Claude Code 2.1.325 (`--resume <id> "/compact"`), trimmed.
const fixture = readFileSync(new URL("./__fixtures__/compact-boundary.jsonl", import.meta.url), "utf8");
const lines = fixture.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
const byKind = (type: string, subtype?: string) =>
  lines.find((line) => line.type === type && (subtype === undefined || line.subtype === subtype))!;
const now = () => new Date("2026-11-25T12:00:00.000Z");

function envelope(event: ReturnType<typeof claudeCompactionEvent>) {
  return event?.payload?.prpEvent as Record<string, unknown> & { payload: Record<string, unknown> };
}

describe("claudeCompactionEvent", () => {
  it("turns the CLI's compact_boundary into one context.compacted event", () => {
    const boundary = byKind("system", "compact_boundary");
    const event = claudeCompactionEvent(boundary, "other-session", now);
    expect(event?.eventType).toBe("context.compacted");
    expect(envelope(event)).toMatchObject({
      schema: "paperclip.prp.event.v1",
      eventType: "context.compacted",
      sourceKind: "claude_local",
      normalizedSessionId: "10632812-510b-4a83-a708-a5031e2982d7",
      emittedAt: "2026-11-25T12:00:00.000Z",
    });
    expect(envelope(event).payload).toEqual({
      schema: "paperclip.context.compacted.v1",
      compactionId: "b1529e2c-c9de-468e-bb1e-89772abdfa45",
      reason: "manual",
      preTokens: 41981,
      postTokens: 10166,
      sameSession: true,
    });
  });

  it("falls back to the run's session and a time-based id when the line lacks them", () => {
    const event = claudeCompactionEvent({ type: "system", subtype: "compact_boundary" }, "s-1", now);
    expect(envelope(event).normalizedSessionId).toBe("s-1");
    expect(envelope(event).payload).toMatchObject({
      compactionId: "s-1:2026-11-25T12:00:00.000Z",
      reason: "provider",
    });
    expect(envelope(event).payload).not.toHaveProperty("preTokens");
    expect(envelope(event).payload).not.toHaveProperty("postTokens");
  });

  it("gives null for other lines", () => {
    expect(claudeCompactionEvent(byKind("system", "init"), null, now)).toBeNull();
    expect(claudeCompactionEvent(byKind("system", "status"), null, now)).toBeNull();
    expect(claudeCompactionEvent(byKind("result"), null, now)).toBeNull();
    expect(claudeCompactionEvent({ type: "assistant", message: { content: [] } }, null, now)).toBeNull();
  });
});

describe("the patched claude-agent-acp (ACP engine)", () => {
  // The installed, patched agent the ACP engine runs. Its `status` case handles `/compact`'s
  // "Compacting..." and `compact_result` banners; `compact_boundary` only fires when there was
  // something to compact. Only the boundary may carry the marker, so a `/compact` with nothing to
  // compact records nothing.
  const source = readFileSync(
    new URL("../../node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js", import.meta.url),
    "utf8",
  );
  const caseBlock = (label: string) => {
    const start = source.indexOf(`case "${label}": {`);
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf("\n                            case \"", start + 1);
    return source.slice(start, next);
  };

  it("marks the compact_boundary's usage_update, and nothing else", () => {
    expect(source.split("paperclip: {\n").length - 1).toBe(1);
    const boundary = caseBlock("compact_boundary");
    expect(boundary).toContain("sessionUpdate: \"usage_update\"");
    expect(boundary).toContain("trigger: message.compact_metadata?.trigger ?? null");
    expect(boundary).toContain("preTokens: message.compact_metadata?.pre_tokens ?? null");
    expect(boundary).toContain("postTokens: message.compact_metadata?.post_tokens ?? null");
    expect(boundary).toContain("compactionId: message.uuid");
    const status = caseBlock("status");
    expect(status).toContain("compact_result");
    expect(status).not.toContain("compacted");
  });
});

describe("createClaudeCompactionLog", () => {
  it("reports each boundary once, across chunk splits, and passes every chunk on", async () => {
    const onLog = vi.fn(async () => {});
    const onEvent = vi.fn(async () => {});
    const log = createClaudeCompactionLog(onLog, onEvent, { sessionId: null, now });
    const doubled = fixture + fixture.split("\n").find((line) => line.includes("compact_boundary")) + "\n";
    const cut = Math.floor(doubled.length / 2);
    await log("stdout", doubled.slice(0, cut));
    await log("stdout", doubled.slice(cut));
    await log("stderr", "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"x\"}\n");
    expect(onLog.mock.calls.map((call) => (call as unknown[])[1]).join("")).toBe(
      doubled + "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"uuid\":\"x\"}\n",
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the seen ids it is given, so a retried attempt doesn't report the same boundary again", async () => {
    const seen = new Set<string>();
    const onEvent = vi.fn(async () => {});
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const log = createClaudeCompactionLog(async () => {}, onEvent, { sessionId: null, now, seen });
      await log("stdout", fixture);
    }
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("doesn't let a failed event write stop the log", async () => {
    const onLog = vi.fn(async () => {});
    const log = createClaudeCompactionLog(onLog, async () => { throw new Error("db down"); }, { sessionId: null, now });
    await expect(log("stdout", fixture)).resolves.toBeUndefined();
    expect(onLog).toHaveBeenCalledWith("stdout", fixture);
  });
});
