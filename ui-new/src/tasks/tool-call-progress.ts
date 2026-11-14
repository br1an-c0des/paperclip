import type { ToolCallProgressSnapshot } from "@paperclipai/shared";
import { formatDuration } from "@/runs/run-model";

/*
 * Live progress of a long connected-app tool call (U154, upstream #21449, doc/connections/MCP-PROGRESS.md).
 * The app reports MCP progress to Paperclip, which publishes it as `heartbeat.run.tool_progress` on
 * the run's live events (sent only to clients holding the run, `useRunInterest`) and saves the
 * latest on the call: `GET /issues/:id/tool-call-progress` reads it back for a page opened mid-call,
 * with calls that finished in the last hour marked `done`.
 *
 * Shown under the running tool: on the task thread's live run line and on the agent chat's live
 * reply step (ToolCallProgress.tsx). After ui/src/components/task-chat/tool-call-progress.tsx; the
 * shared package's checks are runtime code, so they're repeated here (ui-new imports types only).
 */

export const MESSAGE_MAX_LENGTH = 200;

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const isoTime = (value: unknown) => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null);

/** Plain, single-line text: control and direction characters removed, whitespace collapsed, bounded. */
export function boundMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const plain = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  return plain.length > MESSAGE_MAX_LENGTH ? `${plain.slice(0, MESSAGE_MAX_LENGTH - 1)}…` : plain;
}

/**
 * A live event payload or a read's row as a snapshot, or null when it isn't one. Everything in it is
 * the app's untrusted content: the progress must be finite and not negative, the total is kept only
 * when it's positive and at least the progress, and the message is bounded plain text.
 */
export function readProgress(payload: Record<string, unknown> | null | undefined): ToolCallProgressSnapshot | null {
  if (!payload) return null;
  const invocationId = typeof payload.invocationId === "string" && payload.invocationId ? payload.invocationId : null;
  const runId = typeof payload.runId === "string" && payload.runId ? payload.runId : null;
  const toolName = typeof payload.toolName === "string" && payload.toolName ? payload.toolName : null;
  const startedAt = isoTime(payload.startedAt);
  const progress = finite(payload.progress);
  if (!invocationId || !runId || !toolName || !startedAt || progress === null || progress < 0) return null;
  const total = finite(payload.total);
  return {
    invocationId,
    runId,
    toolName,
    nativeToolName: typeof payload.nativeToolName === "string" && payload.nativeToolName ? payload.nativeToolName : null,
    startedAt,
    updatedAt: isoTime(payload.updatedAt) ?? new Date().toISOString(),
    progress,
    total: total !== null && total > 0 && total >= progress ? total : null,
    message: boundMessage(payload.message),
    done: payload.done === true,
  };
}

/** Lowercase words joined by "_", so "mcp.kv-demo-1a:slow" and "mcp_kv_demo_1a_slow" compare equal. */
function comparable(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Whether a tool name the transcript shows ("mcp__paperclip__<gateway tool>") is the gateway tool a
 * call reported. Agents rewrite characters their tool names can't hold, so names are compared word
 * by word, as a whole suffix.
 */
export function toolNameMatches(shown: string | null | undefined, toolName: string | null | undefined): boolean {
  if (!shown || !toolName) return false;
  const row = comparable(shown);
  const tool = comparable(toolName);
  return !!tool && (row === tool || row.endsWith(`_${tool}`));
}

/** Runners without direct app tools call them through this wrapper, naming the tool in its input. */
const WRAPPED_APP_TOOL = "paperclip_call_assigned_tool";

/** The app tool a wrapper call runs (its input's `name`), or null for any other call. */
export function wrappedAppToolName(name: string | null | undefined, input: unknown): string | null {
  if (!name || !(name === WRAPPED_APP_TOOL || name.endsWith(`_${WRAPPED_APP_TOOL}`) || name.endsWith(`.${WRAPPED_APP_TOOL}`))) return null;
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tool = (value as Record<string, unknown>).name;
  return typeof tool === "string" && tool.trim() ? tool.trim() : null;
}

/** The tool a row shows: its names (the transcript's, a wrapper's app tool) and the gateway invocation id, when known. */
export type ToolRow = { names: readonly (string | null | undefined)[]; invocationId?: string | null };

/** Whether a row is this call: by invocation id, else by the gateway name or the native runner's name for it. */
export function rowShows(row: ToolRow, entry: Pick<ToolCallProgressSnapshot, "invocationId" | "toolName" | "nativeToolName">): boolean {
  if (row.invocationId && row.invocationId === entry.invocationId) return true;
  return row.names.some((name) => toolNameMatches(name, entry.toolName) || toolNameMatches(name, entry.nativeToolName));
}

/**
 * The progress a running row shows: the latest unfinished call of its tool in this run. A run that
 * calls the same tool twice at once shows the newer call on both rows, as upstream does.
 */
export function pickProgress(entries: Iterable<ToolCallProgressSnapshot>, row: ToolRow, runId: string): ToolCallProgressSnapshot | null {
  let best: ToolCallProgressSnapshot | null = null;
  for (const entry of entries) {
    if (entry.done || entry.runId !== runId || !rowShows(row, entry)) continue;
    if (!best || entry.startedAt > best.startedAt) best = entry;
  }
  return best;
}

/** The run's latest unfinished call, for a line that knows only that some tool is in use. */
export function latestProgress(entries: Iterable<ToolCallProgressSnapshot>, runId: string): ToolCallProgressSnapshot | null {
  let best: ToolCallProgressSnapshot | null = null;
  for (const entry of entries) {
    if (entry.done || entry.runId !== runId) continue;
    if (!best || entry.startedAt > best.startedAt) best = entry;
  }
  return best;
}

/** Running calls kept per view; the oldest are forgotten first. */
const MAX_TRACKED = 50;
/** Finished call ids remembered per view, so a delayed read can't revive one. */
const MAX_FINISHED = 500;

/**
 * The calls' latest progress. `put` keeps the newer update of each running call; a finished call is
 * removed and remembered, so a later "running" row for it (from a read that started before it
 * ended) never brings it back. A call missing from a read is never dropped: its first save may
 * still be on its way. Answers whether anything changed.
 */
export class ProgressEntries {
  private entries = new Map<string, ToolCallProgressSnapshot>();
  private finished = new Set<string>();

  values() {
    return this.entries.values();
  }

  put(snapshot: ToolCallProgressSnapshot): boolean {
    const id = snapshot.invocationId;
    if (this.finished.has(id)) return false;
    if (snapshot.done) {
      this.finished.add(id);
      while (this.finished.size > MAX_FINISHED) this.finished.delete(this.finished.values().next().value!);
      return this.entries.delete(id);
    }
    const previous = this.entries.get(id);
    if (previous && previous.updatedAt > snapshot.updatedAt) return false;
    this.entries.delete(id);
    this.entries.set(id, snapshot);
    while (this.entries.size > MAX_TRACKED) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }

  /** Forgets the running calls (their run's tool ended); finished ones stay remembered. */
  clear(): boolean {
    if (this.entries.size === 0) return false;
    this.entries.clear();
    return true;
  }
}

/** What the progress line shows: a fill when the total is known (else a sweep), the app's message, the percent and the time so far. */
export type ProgressView = { percent: number | null; message: string | null; elapsed: string };

export function progressView(progress: Pick<ToolCallProgressSnapshot, "progress" | "total" | "message" | "startedAt">, now: number): ProgressView {
  const percent = progress.total !== null && progress.total > 0 ? Math.round(Math.min(1, Math.max(0, progress.progress / progress.total)) * 100) : null;
  return {
    percent,
    message: boundMessage(progress.message),
    elapsed: formatDuration(Math.max(0, now - Date.parse(progress.startedAt))),
  };
}
