import type { ToolCallProgressSnapshot } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { replyFromEvents, type ReplyEvent } from "@/chat/reply-model";
import {
  boundMessage,
  latestProgress,
  MESSAGE_MAX_LENGTH,
  pickProgress,
  ProgressEntries,
  progressView,
  readProgress,
  toolNameMatches,
  wrappedAppToolName,
} from "./tool-call-progress";

const T = Date.parse("2026-11-14T12:00:00Z");
const iso = (ms: number) => new Date(T + ms).toISOString();

const snapshot = (extra: Partial<ToolCallProgressSnapshot> = {}): ToolCallProgressSnapshot => ({
  invocationId: "inv-1",
  runId: "run-1",
  toolName: "kv_demo.slow_with_progress",
  nativeToolName: null,
  startedAt: iso(0),
  updatedAt: iso(1_000),
  progress: 2,
  total: 5,
  message: "Step 2 of 5",
  done: false,
  ...extra,
});

describe("reading tool call progress (U154, #21449)", () => {
  it("reads a live event's payload, keeping a total only when it's positive and at least the progress", () => {
    const payload = { ...snapshot(), issueId: "task-1" } as unknown as Record<string, unknown>;
    expect(readProgress(payload)).toEqual(snapshot());
    expect(readProgress({ ...payload, total: 1 })?.total).toBeNull();
    expect(readProgress({ ...payload, total: 0 })?.total).toBeNull();
    expect(readProgress({ ...payload, total: "5" })?.total).toBeNull();
    expect(readProgress({ ...payload, done: true })?.done).toBe(true);
  });

  it("refuses payloads that aren't a call's progress", () => {
    const payload = snapshot() as unknown as Record<string, unknown>;
    expect(readProgress(null)).toBeNull();
    expect(readProgress({ ...payload, progress: -1 })).toBeNull();
    expect(readProgress({ ...payload, progress: Number.NaN })).toBeNull();
    expect(readProgress({ ...payload, progress: "2" })).toBeNull();
    expect(readProgress({ ...payload, invocationId: "" })).toBeNull();
    expect(readProgress({ ...payload, startedAt: "not a time" })).toBeNull();
  });

  it("keeps the app's message as bounded, single-line plain text", () => {
    expect(boundMessage("  Exporting\n\trows‮ 3 ")).toBe("Exporting rows 3");
    expect(boundMessage("\u0000​ ")).toBeNull();
    expect(boundMessage(42)).toBeNull();
    const long = boundMessage("x".repeat(400))!;
    expect(long).toHaveLength(MESSAGE_MAX_LENGTH);
    expect(long.endsWith("…")).toBe(true);
    expect(readProgress({ ...(snapshot() as unknown as Record<string, unknown>), message: "<b>bold</b>\nnext" })?.message).toBe("<b>bold</b> next");
  });
});

describe("matching a call to its row", () => {
  it("compares names word by word, as a whole suffix", () => {
    expect(toolNameMatches("mcp__paperclip__kv_demo_slow_with_progress", "kv_demo.slow_with_progress")).toBe(true);
    expect(toolNameMatches("mcp.kv-demo-1a:slow", "mcp_kv_demo_1a_slow")).toBe(true);
    expect(toolNameMatches("mcp__paperclip__kv_demo_slow_with_progress", "with_progress")).toBe(true);
    expect(toolNameMatches("mcp__paperclip__notkv_demo_slow", "kv_demo_slow")).toBe(false);
    expect(toolNameMatches("Bash", "kv_demo.slow")).toBe(false);
    expect(toolNameMatches(null, "kv_demo.slow")).toBe(false);
    expect(toolNameMatches("Bash", "")).toBe(false);
  });

  it("reads the app tool a wrapper call runs, from its input object or JSON", () => {
    expect(wrappedAppToolName("paperclip_call_assigned_tool", { name: " kv_demo.slow " })).toBe("kv_demo.slow");
    expect(wrappedAppToolName("mcp__paperclip__paperclip_call_assigned_tool", '{"name":"kv_demo.slow"}')).toBe("kv_demo.slow");
    expect(wrappedAppToolName("paperclip_call_assigned_tool", "not json")).toBeNull();
    expect(wrappedAppToolName("Bash", { name: "kv_demo.slow" })).toBeNull();
  });

  it("picks the newest unfinished call of the row's tool in the run, by invocation id or name", () => {
    const older = snapshot({ invocationId: "a", startedAt: iso(0) });
    const newer = snapshot({ invocationId: "b", startedAt: iso(5_000) });
    const otherRun = snapshot({ invocationId: "c", runId: "run-2", startedAt: iso(9_000) });
    const finished = snapshot({ invocationId: "d", startedAt: iso(8_000), done: true });
    const row = { names: ["mcp__paperclip__kv_demo_slow_with_progress"] };
    expect(pickProgress([older, newer, otherRun, finished], row, "run-1")?.invocationId).toBe("b");
    expect(pickProgress([older, newer], { names: ["Bash"], invocationId: "a" }, "run-1")?.invocationId).toBe("a");
    expect(pickProgress([older], { names: ["Bash"] }, "run-1")).toBeNull();
    // The native runner's shortened name matches too.
    const native = snapshot({ invocationId: "e", nativeToolName: "kv_slow_1a2b" });
    expect(pickProgress([native], { names: ["mcp__paperclip__kv_slow_1a2b"] }, "run-1")?.invocationId).toBe("e");
    expect(latestProgress([older, newer, otherRun, finished], "run-1")?.invocationId).toBe("b");
  });

  it("gives a chat reply's tool steps their names and gateway id", () => {
    const event: ReplyEvent = {
      seq: 1,
      eventType: "tool.execution.started",
      payload: { prpEvent: { payload: { schema: "paperclip.tool.execution.v1", executionId: "x", name: "mcp__paperclip__kv_demo_slow_with_progress", status: "running" } } },
    };
    const [step] = replyFromEvents([event]).steps;
    expect(step!.state).toBe("running");
    expect(pickProgress([snapshot()], step!.tool!, "run-1")?.invocationId).toBe("inv-1");
  });
});

describe("keeping the latest progress", () => {
  it("keeps the newer update of a running call", () => {
    const entries = new ProgressEntries();
    expect(entries.put(snapshot({ updatedAt: iso(2_000), progress: 3 }))).toBe(true);
    expect(entries.put(snapshot({ updatedAt: iso(1_000), progress: 2 }))).toBe(false);
    expect([...entries.values()].map((entry) => entry.progress)).toEqual([3]);
  });

  it("drops a finished call and never lets a delayed read bring it back", () => {
    const entries = new ProgressEntries();
    entries.put(snapshot());
    expect(entries.put(snapshot({ done: true, updatedAt: iso(3_000) }))).toBe(true);
    expect(entries.put(snapshot({ updatedAt: iso(4_000) }))).toBe(false);
    expect([...entries.values()]).toEqual([]);
    // A finished call it never showed changes nothing.
    expect(entries.put(snapshot({ invocationId: "other", done: true }))).toBe(false);
  });

  it("forgets running calls when the run's tool ends, but still remembers finished ones", () => {
    const entries = new ProgressEntries();
    entries.put(snapshot({ invocationId: "a" }));
    entries.put(snapshot({ invocationId: "b", done: true }));
    expect(entries.clear()).toBe(true);
    expect(entries.clear()).toBe(false);
    expect(entries.put(snapshot({ invocationId: "b" }))).toBe(false);
    expect(entries.put(snapshot({ invocationId: "a" }))).toBe(true);
  });

  it("keeps at most 50 running calls, forgetting the oldest", () => {
    const entries = new ProgressEntries();
    for (let index = 0; index < 55; index += 1) entries.put(snapshot({ invocationId: `call-${index}` }));
    const ids = [...entries.values()].map((entry) => entry.invocationId);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe("call-5");
  });
});

describe("the progress line", () => {
  it("shows a percent with a known total, the message, and the time so far", () => {
    expect(progressView(snapshot(), T + 65_000)).toEqual({ percent: 40, message: "Step 2 of 5", elapsed: "1m 05s" });
  });

  it("shows no percent without a total, and never more than 100", () => {
    expect(progressView(snapshot({ total: null, message: null }), T)).toEqual({ percent: null, message: null, elapsed: "0s" });
    expect(progressView(snapshot({ progress: 9, total: 5 }), T).percent).toBe(100);
  });
});
