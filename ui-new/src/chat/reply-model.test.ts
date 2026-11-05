import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "@/runs/transcript-model";
import { upgradeRunEvents } from "@/runs/fixtures/upgrade-run";
import { mergeEvents, pickReply, prpEventsFromOutput, recentSteps, replyFromEvents, replyFromTranscript, stepLabel, type ReplyEvent } from "./reply-model";

function delta(seq: number, text: string): ReplyEvent {
  return { seq, eventType: "item.delta", payload: { prpEvent: { payload: { kind: "agentMessage", text, update: { kind: "agentMessage", delta: text } } } } };
}

function tool(seq: number, eventType: string, name: string, extra: Record<string, unknown> = {}): ReplyEvent {
  const payload = { schema: "paperclip.tool.execution.v1", executionId: `x-${name}`, name, status: eventType.endsWith("started") ? "running" : "completed", ...extra };
  return { seq, eventType, payload: { prpEvent: { payload } } };
}

describe("replyFromEvents", () => {
  it("joins message deltas in sequence order", () => {
    const reply = replyFromEvents([delta(3, " is 4."), delta(2, "2+2")]);
    expect(reply.text).toBe("2+2 is 4.");
    expect(reply.steps).toEqual([]);
  });

  it("lists steps and starts the text over after each one", () => {
    const reply = replyFromEvents([
      delta(1, "Let me check."),
      tool(2, "tool.execution.started", "set_task_title", { target: "TES-11" }),
      tool(3, "tool.execution.started", "Terminal"),
      tool(4, "tool.execution.completed", "set_task_title"),
      delta(5, "Done: "),
      delta(6, "renamed it."),
    ]);
    expect(reply.text).toBe("Done: renamed it.");
    expect(reply.steps.map((step) => [step.label, step.detail, step.state])).toEqual([
      ["Set task title", "TES-11", "done"],
      ["Terminal", "", "running"],
    ]);
  });

  it("keeps the latest text while the next step runs", () => {
    const reply = replyFromEvents([delta(1, "Looking it up"), tool(2, "tool.execution.started", "WebSearch")]);
    expect(reply.text).toBe("Looking it up");
  });

  it("marks failed steps", () => {
    const reply = replyFromEvents([tool(1, "tool.execution.started", "Terminal"), tool(2, "tool.execution.completed", "Terminal", { status: "failed" })]);
    expect(reply.steps[0]!.state).toBe("error");
  });

  it("takes a completed message's whole text", () => {
    const reply = replyFromEvents([delta(1, "Partial"), { seq: 2, eventType: "item.completed", payload: { prpEvent: { payload: { kind: "agentMessage", text: "Partial and whole." } } } }]);
    expect(reply.text).toBe("Partial and whole.");
  });

  it("ignores other events", () => {
    expect(replyFromEvents([{ seq: 1, eventType: "lifecycle", payload: null }, { seq: 2, eventType: "item.completed", payload: { prpEvent: { payload: { kind: "usage" } } } }])).toMatchObject({
      text: "",
      steps: [],
      plan: null,
      headline: null,
      notice: null,
      health: [],
    });
  });
});

describe("the runner's upgraded steps (U42)", () => {
  const events = (upTo?: number): ReplyEvent[] =>
    upgradeRunEvents(upTo).map((event, index) => ({
      seq: index + 1,
      eventType: event.eventType,
      payload: { prpEvent: { eventType: event.eventType, ...(event.itemId ? { itemId: event.itemId } : {}), payload: event.payload } },
    }));

  it("says what each step ran and how it went", () => {
    const steps = replyFromEvents(events()).steps;
    const find = (label: string, detail?: string) => steps.find((step) => step.label === label && (detail === undefined || step.detail.startsWith(detail)));
    expect(find("Bash", "$ node --test")).toMatchObject({ state: "error", meta: "exit 1 · 2.3s" });
    expect(find("Bash", "$ git push")).toMatchObject({ state: "error", meta: "blocked" });
    expect(find("Edit")).toMatchObject({ detail: "server/src/export/worker.ts", meta: "+3 −1 · 300ms" });
    expect(find("Searched the web")).toMatchObject({ detail: "“Temporal.PlainDate.from ISO week date”", state: "done" });
    expect(find("Explore subagent")).toMatchObject({ detail: "Find the date parsing tests", meta: "2 steps", state: "done" });
    expect(find("PreToolUse hook blocked Bash")).toMatchObject({ state: "error" });
    expect(find("Check failed")).toMatchObject({ state: "error", meta: "2 errors in src/export/worker.ts" });
    expect(find("Proposed a plan")).toBeDefined();
  });

  it("carries the plan, the reasoning headline and the MCP failures", () => {
    const reply = replyFromEvents(events());
    expect(reply.plan?.steps).toHaveLength(5);
    expect(reply.headline).toBe("Looking up Temporal's week dates");
    expect(reply.health).toEqual([{ server: "github", reason: "needs re-authentication" }]);
    expect(reply.text).toMatch(/^Week-date strings/);
  });

  it("names a status notice only while it's still going", () => {
    const cut = upgradeRunEvents().findIndex((event) => event.payload.noticeId === "retry-1") + 1;
    expect(replyFromEvents(events(cut)).notice).toBe("Reconnecting (attempt 1 of 5)");
    expect(replyFromEvents(events()).notice).toBeNull();
  });
});

describe("mergeEvents", () => {
  it("adds new events by sequence and keeps the same array when nothing is new", () => {
    const first = mergeEvents([], [delta(2, "b"), delta(1, "a")]);
    expect(first.map((event) => event.seq)).toEqual([1, 2]);
    expect(mergeEvents(first, [delta(2, "b")])).toBe(first);
  });
});

describe("prpEventsFromOutput", () => {
  const line = (eventType: string, sourceSeq: number, payload: Record<string, unknown>) =>
    `${JSON.stringify({ type: "paperclip.prp.event", event: { eventType, sourceSeq, payload } })}\n`;

  it("reads the runner's event lines from stdout, across chunk boundaries", () => {
    const first = line("item.delta", 7, { kind: "agentMessage", update: { delta: "2+2 " } });
    const second = line("item.delta", 8, { kind: "agentMessage", update: { delta: "is 4." } });
    const chunks = [
      { stream: "stdout", chunk: "[paperclip] Using fallback workspace\n" },
      { stream: "stderr", chunk: "[paperclip-runner] connecting\n" },
      { stream: "stdout", chunk: first + second.slice(0, 20) },
      { stream: "stdout", chunk: second.slice(20) },
      { stream: "stdout", chunk: line("tool.execution.started", 9, { name: "Terminal" }).slice(0, 30) },
    ];
    const events = prpEventsFromOutput(chunks);
    expect(events.map((event) => [event.seq, event.eventType])).toEqual([
      [7, "item.delta"],
      [8, "item.delta"],
    ]);
    expect(replyFromEvents(events).text).toBe("2+2 is 4.");
  });
});

describe("replyFromTranscript", () => {
  it("reads tool calls and the assistant's latest text", () => {
    const items = [
      { kind: "message", key: "m1", ts: "", role: "assistant", text: "Checking", streaming: false },
      { kind: "tool", key: "t1", ts: "", endTs: null, name: "Read", step: "read", title: "README.md", input: "", output: null, status: "done", diff: null, added: 0, removed: 0 },
      { kind: "message", key: "m2", ts: "", role: "assistant", text: "It says hi", streaming: true },
    ] as TranscriptItem[];
    expect(replyFromTranscript(items)).toMatchObject({ text: "It says hi", steps: [{ key: "t1", label: "Read", detail: "README.md", state: "done" }] });
  });
});

describe("helpers", () => {
  it("names steps plainly", () => {
    expect(stepLabel("mcp__paperclip__get_issue")).toBe("Get issue");
    expect(stepLabel("WebFetch")).toBe("Web fetch");
  });

  it("prefers events when they have anything", () => {
    const events = { text: "", steps: [] };
    const transcript = { text: "from log", steps: [] };
    expect(pickReply(events, transcript)).toBe(transcript);
    expect(pickReply({ text: "x", steps: [] }, transcript).text).toBe("x");
  });

  it("keeps the last steps in view", () => {
    const steps = [1, 2, 3, 4, 5].map((n) => ({ key: String(n), label: "s", detail: "", state: "done" as const }));
    expect(recentSteps(steps, 3)).toEqual({ shown: steps.slice(2), hidden: 2 });
  });
});
