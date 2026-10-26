import { describe, expect, it } from "vitest";
import { buildTranscript, hasStructuredParser } from "./parsers";
import type { RunLogChunk } from "./run-log";

const out = (value: unknown, ts = "2026-10-26T10:00:00Z"): RunLogChunk => ({ ts, stream: "stdout", chunk: `${JSON.stringify(value)}\n` });

describe("buildTranscript", () => {
  it("reads Claude Code's stream-json through the adapter's own parser", () => {
    const entries = buildTranscript(
      [
        out({ type: "system", subtype: "init", session_id: "7f3a", model: "claude-opus-5-5" }),
        out({ type: "assistant", message: { content: [{ type: "text", text: "Starting with 4H only." }] } }),
        out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
        out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a.py" }] } }),
        { ts: "2026-10-26T10:00:01Z", stream: "system", chunk: "paperclip: workspace change" },
      ],
      "claude_local",
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["init", "assistant", "tool_call", "tool_result", "system"]);
  });

  it("joins a stdout line split across chunks", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } });
    const entries = buildTranscript(
      [
        { ts: "t1", stream: "stdout", chunk: line.slice(0, 20) },
        { ts: "t2", stream: "stdout", chunk: `${line.slice(20)}\n` },
      ],
      "claude_local",
    );
    expect(entries).toEqual([{ kind: "assistant", ts: "t2", text: "hello" }]);
  });

  it("shows harnesses it can't parse as plain lines", () => {
    expect(buildTranscript([{ ts: "t", stream: "stdout", chunk: "hello\nworld\n" }], "some_plugin_adapter")).toEqual([
      { kind: "stdout", ts: "t", text: "hello" },
      { kind: "stdout", ts: "t", text: "world" },
    ]);
    expect(hasStructuredParser("claude_local")).toBe(true);
    expect(hasStructuredParser("process")).toBe(false);
    expect(hasStructuredParser("paperclip_runner")).toBe(false);
  });

  it("masks the username in home paths when the instance asks for it", () => {
    const [entry] = buildTranscript([{ ts: "t", stream: "stderr", chunk: "error in /Users/brian/project" }], "claude_local", {
      censorUsername: true,
    });
    expect(entry).toMatchObject({ kind: "stderr" });
    expect((entry as { text: string }).text).not.toContain("brian");
  });
});
