import { describe, expect, it } from "vitest";
import { buildTranscript, showsPlainLines } from "./parsers";
import type { RunLogChunk } from "./run-log";
import { buildItems } from "./transcript-model";

/*
 * The runner's event envelopes, as a native run's log carries them (Bob's runs on the test
 * instance are this shape), read into transcript steps.
 */

const ts = (second: number) => `2026-10-28T04:07:${String(second).padStart(2, "0")}.000Z`;
const prp = (second: number, eventType: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): RunLogChunk => ({
  ts: ts(second),
  stream: "stdout",
  chunk: `${JSON.stringify({ type: "paperclip.prp.event", event: { eventType, payload, runId: "r1", turnId: "turn-1", ...extra } })}\n`,
});
const execution = (second: number, phase: "started" | "progressed" | "completed", fields: Record<string, unknown>) =>
  prp(second, `tool.execution.${phase}`, { executionId: "toolu_1", name: "Terminal", output: "null", ...fields });

describe("the Paperclip runner's transcript", () => {
  it("reads native runs as structured, not plain lines", () => {
    expect(showsPlainLines("paperclip_runner")).toBe(false);
    expect(showsPlainLines("claude_local", "native")).toBe(false);
    expect(showsPlainLines("some_plugin_adapter")).toBe(true);
  });

  it("folds a tool's started, progressed and completed events into one step", () => {
    const entries = buildTranscript(
      [
        execution(1, "started", { progress: "Terminal (pending)" }),
        execution(2, "progressed", { progress: "Terminal: npm test" }),
        execution(4, "completed", { output: "14 passed", exitCode: 0 }),
      ],
      "paperclip_runner",
    );
    const items = buildItems(entries, false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "tool", name: "Terminal", step: "command", title: "npm test", status: "done", output: "exit_code: 0\n14 passed", endTs: ts(4) });
  });

  it("fills an MCP execution with the call that follows it rather than adding a second step", () => {
    const entries = buildTranscript(
      [
        prp(1, "tool.execution.started", { executionId: "toolu_2", name: "write_document", progress: "mcp__paperclip__write_document (pending)", output: "null" }),
        prp(2, "item.started", { item: { type: "dynamicToolCall", id: "7", tool: "write_document", arguments: { title: "Notes" } } }, { itemId: "7" }),
        prp(3, "item.completed", { item: { type: "dynamicToolCall", id: "7", tool: "write_document", result: "saved" } }, { itemId: "7" }),
        prp(4, "tool.execution.completed", { executionId: "toolu_2", name: "write_document", output: "saved" }),
      ],
      "paperclip_runner",
    );
    const tools = buildItems(entries, false).filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "write_document", title: "Notes", status: "done", refs: { toolUseId: "7" } });
  });

  it("leaves out the runner's running usage totals", () => {
    const entries = buildTranscript([prp(1, "item.completed", { kind: "usage", usage: { total: { inputTokens: 10, outputTokens: 2 } } })], "paperclip_runner");
    expect(entries.map((entry) => entry.kind)).toEqual(["result"]);
    expect(buildItems(entries, false)).toEqual([]);
  });

  it("keeps one item per runtime request, updated as it's answered", () => {
    const request = (second: number, status: string, action?: string) =>
      prp(second, `runtime_request.${status === "pending" ? "opened" : status}`, {
        request: { requestId: "q1", requestKind: "command_approval", type: "permission", status, prompt: "Run rm -rf build?", ...(action ? { action } : {}) },
      });
    const items = buildItems(buildTranscript([request(1, "pending"), request(5, "resolved", "accept")], "paperclip_runner"), true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "request",
      key: "request:q1",
      request: { requestId: "q1", turnId: "turn-1", requestKind: "command_approval", requestType: "permission", status: "resolved", resolvedAction: "accept" },
    });
  });

  it("passes lines that aren't envelopes to the Codex parser", () => {
    const entries = buildTranscript([{ ts: ts(1), stream: "stdout", chunk: "plain words\n" }], "paperclip_runner");
    expect(entries).toEqual([{ kind: "stdout", ts: ts(1), text: "plain words" }]);
  });
});
