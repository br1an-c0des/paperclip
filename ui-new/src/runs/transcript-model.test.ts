import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { describe, expect, it } from "vitest";
import { buildItems, editDiff, stepCount, stepKind, stepSummary, toolTitle, visibleItems, type TranscriptItem } from "./transcript-model";

const ts = (second: number) => `2026-10-26T10:00:${String(second).padStart(2, "0")}Z`;
const call = (id: string, name: string, input: unknown, second: number): TranscriptEntry => ({ kind: "tool_call", ts: ts(second), name, toolUseId: id, input });
const result = (id: string, content: string, second: number, isError = false): TranscriptEntry => ({
  kind: "tool_result",
  ts: ts(second),
  toolUseId: id,
  content,
  isError,
});

describe("buildItems", () => {
  it("pairs tool calls with their results and joins streamed text", () => {
    const items = buildItems(
      [
        { kind: "init", ts: ts(0), model: "claude-opus-5-5", sessionId: "s1" },
        { kind: "thinking", ts: ts(1), text: "Brian narrowed", delta: true },
        { kind: "thinking", ts: ts(2), text: " this to 4H", delta: true },
        { kind: "assistant", ts: ts(3), text: "Starting." },
        call("t1", "Bash", { command: "bash -lc 'python -m tools.backfill --tf 4h'" }, 4),
        result("t1", "wrote BTC_4h.parquet", 10),
      ],
      false,
    );
    expect(items.map((item) => item.kind)).toEqual(["started", "thinking", "message", "tool"]);
    expect(items[1]).toMatchObject({ text: "Brian narrowed\n this to 4H", ts: ts(1), endTs: ts(2) });
    expect(items[3]).toMatchObject({
      key: "tool:t1",
      step: "command",
      title: "python -m tools.backfill --tf 4h",
      output: "wrote BTC_4h.parquet",
      status: "done",
      endTs: ts(10),
    });
  });

  it("keeps a call running until its result, and marks failures", () => {
    const running = buildItems([call("t1", "Read", { file_path: "schema.py" }, 1)], true);
    expect(running[0]).toMatchObject({ status: "running", step: "read", title: "schema.py" });
    const failed = buildItems([call("t1", "Bash", { command: "pytest" }, 1), result("t1", "1 failed", 2, true)], false);
    expect(failed[0]).toMatchObject({ status: "error", output: "1 failed" });
  });

  it("folds a streamed re-send of the same call into one item", () => {
    const items = buildItems([call("t1", "Bash", {}, 1), call("t1", "Bash", { command: "ls -la" }, 2)], true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "ls -la" });
  });

  it("shows an edit's change as a diff with line counts", () => {
    const items = buildItems([call("t1", "Edit", { file_path: "a.py", old_string: "x = 1\ny = 2", new_string: "x = 3" }, 1)], false);
    expect(items[0]).toMatchObject({ step: "edit", added: 1, removed: 2 });
    expect((items[0] as Extract<TranscriptItem, { kind: "tool" }>).diff).toEqual([
      { type: "remove", text: "x = 1" },
      { type: "remove", text: "y = 2" },
      { type: "add", text: "x = 3" },
    ]);
  });

  it("groups stderr lines, attaches stdout to a running command, and records the finish", () => {
    const items = buildItems(
      [
        call("t1", "command_execution", { command: "make" }, 1),
        { kind: "stdout", ts: ts(2), text: "building…" },
        result("t1", "", 3),
        { kind: "stderr", ts: ts(4), text: "429 retrying" },
        { kind: "stderr", ts: ts(5), text: "429 retrying again" },
        { kind: "result", ts: ts(6), text: "", inputTokens: 10, outputTokens: 5, cachedTokens: 2, costUsd: 0.5, subtype: "success", isError: false, errors: [] },
      ],
      false,
    );
    expect(items.map((item) => item.kind)).toEqual(["tool", "note", "finished"]);
    expect(items[1]).toMatchObject({ tone: "warn", lines: ["429 retrying", "429 retrying again"] });
    expect(items[2]).toMatchObject({ costUsd: 0.5, isError: false });
  });

  it("turns the agent's run result into an outcome", () => {
    const [outcome] = buildItems(
      [
        {
          kind: "run_result",
          ts: ts(1),
          disposition: "yielded",
          summary: "Built the downloaders.",
          objectiveSatisfied: false,
          verification: [{ commandOrCheck: "pytest tests/derivatives", status: "passed", detail: "11 passed" }],
          remainingWork: [{ description: "Liquidations before March 2024", blocksCompletion: false }],
          blocker: null,
          artifacts: [{ kind: "commit", ref: "3e91c0a", title: "feat: downloaders" }],
        },
      ],
      false,
    );
    expect(outcome).toMatchObject({
      kind: "outcome",
      checks: [{ label: "pytest tests/derivatives · 11 passed", passed: true }],
      remaining: ["Liquidations before March 2024"],
      artifacts: ["feat: downloaders"],
    });
  });

  it("gives items started at the same moment different keys", () => {
    const items = buildItems(
      [
        { kind: "assistant", ts: ts(1), text: "a" },
        { kind: "stderr", ts: ts(1), text: "x" },
        { kind: "assistant", ts: ts(1), text: "b" },
      ],
      false,
    );
    expect(new Set(items.map((item) => item.key)).size).toBe(3);
  });
});

describe("tool names", () => {
  it("sorts tools into kinds of step", () => {
    expect(stepKind("Read", {})).toBe("read");
    expect(stepKind("Bash", {})).toBe("command");
    expect(stepKind("MultiEdit", {})).toBe("edit");
    expect(stepKind("apply_patch", {})).toBe("edit");
    expect(stepKind("Grep", {})).toBe("search");
    expect(stepKind("WebFetch", {})).toBe("web");
    expect(stepKind("mcp__paperclip__get_document", {})).toBe("other");
    expect(stepKind("custom", { cmd: "ls" })).toBe("command");
  });

  it("titles a tool by its command, file, pattern or query", () => {
    expect(toolTitle("Read", { file_path: "data/schema.py" })).toBe("data/schema.py");
    expect(toolTitle("Glob", { pattern: "downloader/**/*.py" })).toBe("downloader/**/*.py");
    expect(toolTitle("shell", { command: ["git", "status"] })).toBe("git status");
    expect(toolTitle("x", "  some   text ")).toBe("some text");
    expect(editDiff({ file_path: "a", content: "one\ntwo\n" })).toMatchObject({ added: 2, removed: 0 });
  });
});

describe("visibleItems", () => {
  const message = (second: number): TranscriptItem => ({ kind: "message", key: `m${second}`, ts: ts(second), role: "assistant", text: "hi", streaming: false });
  const tool = (second: number, name = "Read"): TranscriptItem => ({
    kind: "tool",
    key: `t${second}`,
    ts: ts(second),
    endTs: ts(second),
    name,
    step: stepKind(name, {}),
    title: "",
    input: "",
    output: null,
    status: "done",
    diff: null,
    added: 0,
    removed: 0,
  });
  const thinking = (second: number): TranscriptItem => ({ kind: "thinking", key: `k${second}`, ts: ts(second), endTs: ts(second), text: "hmm", streaming: false });

  const stretch = [message(0), tool(1), tool(2), tool(3, "Bash"), tool(4, "Edit"), tool(5), tool(6), tool(7), message(8)];

  it("folds a long stretch of steps between messages, keeping the last ones visible", () => {
    const shown = visibleItems(stretch, { thinking: true, tools: true, expanded: new Set() });
    expect(shown.map((item) => item.key)).toEqual(["m0", "fold:t1", "t6", "t7", "m8"]);
    const fold = shown[1]!;
    expect(fold.kind === "fold" && fold.items.length).toBe(5);
    expect(fold.kind === "fold" && fold.summary).toBe("Read 3 files · ran 1 command · edited 1 file");
  });

  it("opens a fold the reader expanded, and leaves short stretches alone", () => {
    expect(visibleItems(stretch, { thinking: true, tools: true, expanded: new Set(["fold:t1"]) })).toHaveLength(stretch.length);
    expect(visibleItems([message(0), tool(1), tool(2), message(3)], { thinking: true, tools: true, expanded: new Set() })).toHaveLength(4);
  });

  it("hides thinking and tool calls when their chips are off", () => {
    const items = [message(0), thinking(1), tool(2), message(3)];
    expect(visibleItems(items, { thinking: false, tools: true, expanded: new Set() }).map((item) => item.key)).toEqual(["m0", "t2", "m3"]);
    expect(visibleItems(items, { thinking: true, tools: false, expanded: new Set() }).map((item) => item.key)).toEqual(["m0", "k1", "m3"]);
  });

  it("counts steps and summarises notes too", () => {
    expect(stepCount(stretch)).toBe(9);
    expect(stepSummary([{ kind: "note", key: "n", ts: ts(0), tone: "info", label: "Paperclip", lines: ["x"] }])).toBe("1 note");
  });
});
