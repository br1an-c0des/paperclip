import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "@/runs/transcript-model";
import { mergeEvents, pickReply, prpEventsFromOutput, recentSteps, replyFromEvents, replyFromTranscript, stepLabel, type ReplyEvent } from "./reply-model";

function delta(seq: number, text: string): ReplyEvent {
  return { seq, eventType: "item.delta", payload: { prpEvent: { payload: { kind: "agentMessage", text, update: { kind: "agentMessage", delta: text } } } } };
}

function tool(seq: number, eventType: string, name: string, extra: Record<string, unknown> = {}): ReplyEvent {
  return { seq, eventType, payload: { prpEvent: { payload: { name, status: eventType.endsWith("started") ? "running" : "completed", ...extra } } } };
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
    expect(replyFromEvents([{ seq: 1, eventType: "lifecycle", payload: null }, { seq: 2, eventType: "item.completed", payload: { prpEvent: { payload: { kind: "usage" } } } }])).toEqual({ text: "", steps: [] });
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
    expect(replyFromTranscript(items)).toEqual({ text: "It says hi", steps: [{ key: "t1", label: "Read", detail: "README.md", state: "done" }] });
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
