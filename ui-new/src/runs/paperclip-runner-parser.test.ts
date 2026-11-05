import { describe, expect, it } from "vitest";
import { createPaperclipRunnerParser } from "./paperclip-runner-parser";
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

  describe("upstream's Nov 5 changes (U43)", () => {
    const parse = (eventType: string, payload: Record<string, unknown>) =>
      createPaperclipRunnerParser().parseLine(JSON.stringify({ type: "paperclip.prp.event", event: { eventType, payload } }), ts(1));

    it("reads a proposed plan as its own family, streaming while it's written", () => {
      expect(parse("plan.proposed", { schema: "paperclip.plan.proposed.v1", proposalId: "p1", status: "streaming", markdown: "# Fix" })[0]).toMatchObject({
        kind: "provider_activity",
        family: "plan_proposal",
        title: "Plan",
        status: "running",
      });
      expect(parse("plan.proposed", { schema: "paperclip.plan.proposed.v1", proposalId: "p1", status: "completed", markdown: "# Fix" })[0]).toMatchObject({
        family: "plan_proposal",
        status: "completed",
      });
      expect(parse("plan.updated", { planId: "turn-1", complete: false, steps: [] })[0]).toMatchObject({ family: "plan", status: "running" });
    });

    it("keeps a file's diffTruncated flag", () => {
      const [entry] = parse("workspace.change.updated", {
        schema: "paperclip.workspace.diff.v1",
        changeSetId: "c1",
        revision: 1,
        files: [
          { path: "a.ts", operation: "modify", additions: 900, deletions: 2, diff: "@@ -1 +1 @@", diffTruncated: true },
          { path: "b.ts", operation: "modify", additions: 1, deletions: 0, diff: "@@ -1 +1 @@" },
        ],
      });
      expect(entry).toMatchObject({ kind: "workspace_change" });
      const files = entry!.kind === "workspace_change" ? entry!.files : [];
      expect(files[0]).toMatchObject({ path: "a.ts", diffTruncated: true });
      expect(files[1]).not.toHaveProperty("diffTruncated");
    });

    it("keeps provider rate-limit notices in the run log only", () => {
      const notice = { schema: "paperclip.provider.notice.v1", noticeId: "n1", severity: "info", category: "provider.rate_limits", scope: "account", recoverable: true, userActionable: false, summary: "Rate limits" };
      expect(parse("provider.notice.recorded", notice)).toEqual([]);
      expect(parse("provider.notice.recorded", { ...notice, category: "provider_retry" })).toHaveLength(1);
    });
  });
});
