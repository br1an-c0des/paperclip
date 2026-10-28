import type { TranscriptItem } from "@/runs/transcript-model";

/*
 * The live reply (board 13): while the agent's run is going, the chat shows the steps it has taken
 * (✓ done, › going) and the text it's writing, with a caret. Three sources, depending on the harness:
 *
 * - Runner events in the run's output. The Paperclip Runner writes each of its structured events
 *   to stdout as a `paperclip.prp.event` line, so they stream over the socket with the log
 *   (`heartbeat.run.log`): `item.delta` with an `agentMessage` carries the text as it's written,
 *   and `tool.execution.started` / `.completed` the tool calls.
 * - Stored run events (`GET /heartbeat-runs/:id/events`). Native runs only report there; the socket
 *   sends a bare signal (`heartbeat.run.event` with a sequence number and no payload) for some
 *   event types, and never for `item.delta`, so the reply is read again on each signal and the text
 *   arrives a message at a time.
 * - The run's output, parsed. Local harnesses (Claude Code, Codex…) write their own stream to the
 *   log, which the run modal's parsers turn into transcript items.
 *
 * The first source with something wins. The text shown is what the agent wrote after its latest
 * step (kept while the next step runs), since that's the part that becomes the reply; earlier text
 * is thinking out loud, which the transcript keeps.
 */

export type ReplyStep = { key: string; label: string; detail: string; state: "running" | "done" | "error" };

export type LiveReply = { text: string; steps: ReplyStep[] };

export const EMPTY_REPLY: LiveReply = { text: "", steps: [] };

/** The fields of a run event the reply reads, from the API or the socket. */
export type ReplyEvent = { seq: number; eventType: string; payload: Record<string, unknown> | null | undefined };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const str = (value: unknown) => (typeof value === "string" ? value : null);

/** "set_task_title" → "Set task title"; "mcp__paperclip__get_issue" → "Get issue". */
export function stepLabel(name: string) {
  const bare = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp__/, "");
  const words = bare.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : name;
}

const MAX_DETAIL = 90;

function short(value: string) {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line;
}

/** Merges events by sequence number, keeping the first copy of each. */
export function mergeEvents(previous: readonly ReplyEvent[], incoming: readonly ReplyEvent[]): ReplyEvent[] {
  if (incoming.length === 0) return previous as ReplyEvent[];
  const bySeq = new Map(previous.map((event) => [event.seq, event] as const));
  let changed = false;
  for (const event of incoming) {
    if (bySeq.has(event.seq)) continue;
    bySeq.set(event.seq, event);
    changed = true;
  }
  return changed ? [...bySeq.values()].sort((a, b) => a.seq - b.seq) : (previous as ReplyEvent[]);
}

export function replyFromEvents(events: readonly ReplyEvent[]): LiveReply {
  const steps: ReplyStep[] = [];
  let text = "";
  /** Text written since the last step; a step starts a new paragraph. */
  let fresh = true;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const prp = record(record(event.payload)?.prpEvent);
    const body = record(prp?.payload);
    if (!body) continue;
    if (event.eventType === "item.delta" || event.eventType === "item.completed") {
      const kind = (str(body.kind) ?? str(record(body.item)?.type) ?? "").replace(/_/g, "").toLowerCase();
      if (kind !== "agentmessage" && kind !== "assistantmessage") continue;
      if (event.eventType === "item.delta") {
        const delta = str(record(body.update)?.delta) ?? str(body.delta) ?? str(body.text) ?? "";
        text = fresh ? delta : text + delta;
        fresh = false;
      } else {
        // A completed message carries its whole text; it replaces the deltas of the same stretch.
        const whole = str(body.text) ?? str(record(body.item)?.text);
        if (whole !== null && whole.trim()) {
          text = whole;
          fresh = false;
        }
      }
      continue;
    }
    if (event.eventType === "tool.execution.started") {
      const name = str(body.name) ?? "Tool";
      const detail = str(body.target) ?? str(body.title) ?? "";
      steps.push({ key: `step:${event.seq}`, label: stepLabel(name), detail: short(detail), state: "running" });
      fresh = true;
      continue;
    }
    if (event.eventType === "tool.execution.completed" || event.eventType === "tool.execution.failed") {
      const name = stepLabel(str(body.name) ?? "Tool");
      const open = steps.find((step) => step.state === "running" && step.label === name) ?? steps.find((step) => step.state === "running");
      const failed = event.eventType === "tool.execution.failed" || /fail|error/.test(str(body.status) ?? "") || body.isError === true;
      if (open) open.state = failed ? "error" : "done";
    }
  }
  return { text, steps };
}

/** The same, from transcript items (local harnesses' output). */
export function replyFromTranscript(items: readonly TranscriptItem[]): LiveReply {
  const steps: ReplyStep[] = [];
  let text = "";
  let fresh = true;
  for (const item of items) {
    if (item.kind === "tool") {
      steps.push({ key: item.key, label: stepLabel(item.name), detail: short(item.title), state: item.status });
      fresh = true;
    } else if (item.kind === "message" && item.role === "assistant") {
      text = fresh ? item.text : `${text}\n\n${item.text}`;
      fresh = false;
    }
  }
  return { text, steps };
}

/** The first source that has anything. */
export function pickReply(...sources: LiveReply[]): LiveReply {
  return sources.find((reply) => reply.text || reply.steps.length > 0) ?? EMPTY_REPLY;
}

/**
 * The runner's events from its stdout: each `{"type":"paperclip.prp.event","event":{…}}` line,
 * shaped like a stored event (`payload.prpEvent`), in the runner's own order. Chunks can split a
 * line; the unfinished tail waits for the next chunk.
 */
export function prpEventsFromOutput(chunks: readonly { stream: string; chunk: string }[]): ReplyEvent[] {
  const events: ReplyEvent[] = [];
  let buffer = "";
  for (const chunk of chunks) {
    if (chunk.stream !== "stdout") continue;
    buffer += chunk.chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.includes("paperclip.prp.event")) continue;
      try {
        const parsed = JSON.parse(line) as { type?: unknown; event?: unknown };
        const event = record(parsed.event);
        if (parsed.type !== "paperclip.prp.event" || !event || typeof event.eventType !== "string") continue;
        const seq = typeof event.sourceSeq === "number" ? event.sourceSeq : events.length;
        events.push({ seq, eventType: event.eventType, payload: { prpEvent: event } });
      } catch {
        // A partial or malformed line.
      }
    }
  }
  return events;
}

/** The last few steps, as the board shows them: the latest work stays in view. */
export function recentSteps(steps: readonly ReplyStep[], count = 4) {
  return { shown: steps.slice(-count), hidden: Math.max(0, steps.length - count) };
}
