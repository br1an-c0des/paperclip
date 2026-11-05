import type { Plan } from "@/runs/activity-model";
import { toolDuration } from "@/runs/activity-model";
import { latestReasoningHeadline } from "@/runs/reasoning-summary";
import { createRunnerTranscriptParser } from "@/runs/runner-entries";
import { buildItems, latestPlan, runHealth, type TranscriptItem } from "@/runs/transcript-model";

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
 *
 * The steps are read as the run modal reads them (U42): runner events go through the same parser
 * and transcript model, so a step says what ran and how it went ("$ npm test", "exit 1 · 2.3s"),
 * and web searches, model switches, waits, checks, hook and auto-review decisions, subagents and a
 * proposed plan are steps too. The reply also carries the agent's native plan (docked above the
 * composer), its latest reasoning headline (the status while it thinks), a status notice that's
 * still going (a retry, a compaction), and MCP servers that failed to start.
 */

export type ReplyStep = {
  key: string;
  label: string;
  detail: string;
  state: "running" | "done" | "error";
  /** How it went, after the detail: "exit 1 · 2.3s", "blocked", "2 steps". */
  meta?: string;
};

export type LiveReply = {
  text: string;
  steps: ReplyStep[];
  /** The agent's latest native plan in the run. */
  plan?: Plan | null;
  /** The latest headline of a reasoning summary, while the agent thinks. */
  headline?: string | null;
  /** A harness status notice that's still going, such as "Reconnecting (attempt 2 of 5)". */
  notice?: string | null;
  /** MCP servers that failed to start. */
  health?: { server: string; reason: string | null }[];
  /** A runtime request (permission or input) is waiting, so the plan card shrinks to its header. */
  asking?: boolean;
};

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
  let text = "";
  /** Text written since the last step; a step starts a new paragraph. */
  let fresh = true;
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of sorted) {
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
    if (STEP_START.test(event.eventType)) fresh = true;
  }
  return { text, ...replyDetails(itemsFromEvents(sorted)) };
}

/** Events that start a step, after which the agent's text starts over. */
const STEP_START = /^(tool\.execution|research|delegation|wait|hook|safety\.review)\.started$/;

/** The runner's events read as the run modal reads its log: through the runner's parser. */
export function itemsFromEvents(events: readonly ReplyEvent[]): TranscriptItem[] {
  const parser = createRunnerTranscriptParser();
  const entries = events.flatMap((event) => {
    const prp = record(record(event.payload)?.prpEvent);
    if (!prp) return [];
    const ts = str(prp.emittedAt) ?? "";
    return parser.parseLine(JSON.stringify({ type: "paperclip.prp.event", event: { eventType: event.eventType, ...prp } }), ts);
  });
  return buildItems(entries, true);
}

/** The same, from transcript items (local harnesses' output). */
export function replyFromTranscript(items: readonly TranscriptItem[]): LiveReply {
  let text = "";
  let fresh = true;
  for (const item of items) {
    if (item.kind === "tool" || item.kind === "activity" || item.kind === "subagents") {
      fresh = true;
    } else if (item.kind === "message" && item.role === "assistant") {
      text = fresh ? item.text : `${text}\n\n${item.text}`;
      fresh = false;
    }
  }
  return { text, ...replyDetails(items) };
}

/** "exit 1 · 2.3s", "blocked", "Auto-approved": how a tool call went, in a few words. */
function toolMeta(tool: Extract<TranscriptItem, { kind: "tool" }>) {
  if (tool.blocked) return "blocked";
  const exit = tool.status !== "running" && typeof tool.exitCode === "number" && (tool.exitCode !== 0 || tool.step === "command") ? `exit ${tool.exitCode}` : null;
  const took = tool.status !== "running" && tool.durationMs ? toolDuration(tool.durationMs) : null;
  const diff = tool.diff && (tool.added || tool.removed) ? [tool.added ? `+${tool.added}` : "", tool.removed ? `−${tool.removed}` : ""].filter(Boolean).join(" ") : null;
  return [exit, diff, took].filter(Boolean).join(" · ") || undefined;
}

function toolStep(tool: Extract<TranscriptItem, { kind: "tool" }>): ReplyStep {
  const meta = toolMeta(tool);
  return {
    key: tool.key,
    label: stepLabel(tool.name),
    detail: short(tool.step === "command" && tool.title ? `$ ${tool.title}` : tool.title),
    state: tool.blocked ? "error" : tool.status,
    ...(meta ? { meta } : {}),
  };
}

/** The steps, plan, headline, notice and MCP failures of a run's items. */
function replyDetails(items: readonly TranscriptItem[]): Omit<LiveReply, "text"> {
  const steps: ReplyStep[] = [];
  let headline: string | null = null;
  let notice: string | null = null;
  let asking = false;
  for (const item of items) {
    switch (item.kind) {
      case "tool":
        steps.push(toolStep(item));
        break;
      case "activity":
        steps.push({
          key: item.key,
          label: item.row.label,
          detail: short(item.row.detail),
          state: item.row.tone === "blocked" || item.row.tone === "failed" ? "error" : item.row.status,
          ...(item.row.note && item.row.icon === "check" ? { meta: item.row.note } : {}),
        });
        break;
      case "subagents":
        for (const agent of item.agents) {
          steps.push({
            key: `${item.key}:${agent.id}`,
            label: `${agent.role} subagent`,
            detail: short(agent.status === "running" && agent.progress ? agent.progress : agent.description),
            state: agent.status === "error" ? "error" : agent.status === "running" ? "running" : "done",
            ...(agent.tools.length ? { meta: `${agent.tools.length} ${agent.tools.length === 1 ? "step" : "steps"}` } : {}),
          });
        }
        break;
      case "proposal":
        steps.push({ key: item.key, label: item.streaming ? "Writing a plan" : "Proposed a plan", detail: "", state: item.streaming ? "running" : "done" });
        break;
      case "thinking":
        if (item.summary) headline = latestReasoningHeadline(item.text) ?? headline;
        break;
      case "chip":
        // Only a notice that's still going says something about now; the transcript keeps the rest.
        notice = item.chip.active || item.chip.fatal ? `${item.chip.label}${item.chip.fatal && item.chip.detail ? `: ${item.chip.detail}` : ""}` : null;
        break;
      case "request":
        asking = item.request.status === "pending";
        break;
    }
  }
  const health = runHealth(items);
  return { steps, plan: latestPlan(items), headline, notice, health, asking };
}

/** The first source that has anything. */
export function pickReply(...sources: LiveReply[]): LiveReply {
  return sources.find((reply) => reply.text || reply.steps.length > 0 || reply.plan || reply.headline || reply.health?.length) ?? EMPTY_REPLY;
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
