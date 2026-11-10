import type { LiveEvent } from "@paperclipai/shared";
import type { LiveRunStatus } from "@/api/heartbeats";
import { formatDuration } from "@/runs/run-model";

/*
 * What a live run is doing, in one quiet line (U107, upstream #20460), after the old task thread's
 * IssueChatLiveRunStatusLine: "Using <tool>", else the agent's latest words, else the run's status
 * message (which is how a storage outage shows: "Waiting for file storage before starting the run
 * log (45s so far)"), then how long since the run last showed a sign of life: "4s ago", or from 15
 * seconds "no output for 45s".
 *
 * The run reads carry the status as it was (`LiveRunStatus`); `heartbeat.run.progress` events carry
 * each change, and the run's log, event and activity signals move its last sign of life.
 */

/** From this long without a sign of life, the line says so. */
export const QUIET_AFTER_MS = 15_000;

/** The status a run read or an event carries, with times as milliseconds. */
export type RunStatusSnapshot = {
  message: string | null;
  toolName: string | null;
  snippet: string | null;
  /** When the status was set, to tell an older read from a newer event. */
  updatedAt: number | null;
  lastEventAt: number | null;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function time(value: unknown) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const latest = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** The status a run read carries. */
export function snapshotOfRun(run: { [K in keyof LiveRunStatus]?: unknown } | null | undefined): RunStatusSnapshot | null {
  if (!run) return null;
  return {
    message: text(run.currentStatusMessage),
    toolName: text(run.currentToolName),
    snippet: text(run.lastAssistantSnippet),
    updatedAt: time(run.currentStatusUpdatedAt),
    // The runtime's last event, or the last output the run stored when it has none.
    lastEventAt: latest(time(run.lastEventAt), time(run.lastOutputAt)),
  };
}

/**
 * The run's status after a live event, or null when the event isn't about its status. A progress
 * event replaces the status whole (no tool means the tool call ended); a log line, a run event or
 * an activity signal only moves the last sign of life, as in the old UI's LiveUpdatesProvider.
 */
export function applyRunEvent(current: RunStatusSnapshot | null, event: Pick<LiveEvent, "type" | "payload" | "createdAt">, runId: string): RunStatusSnapshot | null {
  const payload = event.payload ?? {};
  if (payload.runId !== runId) return null;
  const at = time(event.createdAt);
  const base: RunStatusSnapshot = current ?? { message: null, toolName: null, snippet: null, updatedAt: null, lastEventAt: null };
  switch (event.type) {
    case "heartbeat.run.progress": {
      const updatedAt = time(payload.updatedAt) ?? at;
      return {
        message: text(payload.message),
        toolName: text(payload.currentToolName),
        snippet: text(payload.lastAssistantSnippet),
        updatedAt,
        lastEventAt: latest(base.lastEventAt, time(payload.lastEventAt) ?? updatedAt),
      };
    }
    case "heartbeat.run.event": {
      // A partial patch: it moves what it names, and keeps the status's own time.
      return {
        ...base,
        message: text(payload.message) ?? base.message,
        toolName: text(payload.currentToolName) ?? base.toolName,
        snippet: text(payload.lastAssistantSnippet) ?? base.snippet,
        lastEventAt: latest(base.lastEventAt, time(payload.lastEventAt) ?? time(payload.updatedAt) ?? at),
      };
    }
    case "heartbeat.run.log":
    case "heartbeat.run.activity":
      return { ...base, lastEventAt: latest(base.lastEventAt, time(payload.ts) ?? time(payload.lastOutputAt) ?? at) };
    default:
      return null;
  }
}

/**
 * The run read's status and the live one together: the newer status wins (a read refetched after
 * an event may be newer than it), and the latest sign of life from either. Live signals that carry
 * no status of their own (a log line) leave the read's status in place.
 */
export function mergeStatus(read: RunStatusSnapshot | null, live: RunStatusSnapshot | null): RunStatusSnapshot | null {
  if (!read) return live;
  if (!live) return read;
  const liveWins = live.updatedAt !== null && (read.updatedAt === null || live.updatedAt >= read.updatedAt);
  const status = liveWins ? live : read;
  return { ...status, lastEventAt: latest(read.lastEventAt, live.lastEventAt) };
}

/**
 * "Using Bash · 4s ago", "Waiting for file storage… (45s so far) · no output for 20s"; on its own,
 * "Last output 4s ago" or "No output for 45s"; null with nothing to say.
 */
export function liveStatusLine(status: RunStatusSnapshot | null, now: number): string | null {
  if (!status) return null;
  const primary = status.toolName ? `Using ${status.toolName}` : (status.snippet ?? status.message);
  const age = status.lastEventAt === null ? null : Math.max(0, now - status.lastEventAt);
  if (age === null) return primary;
  const quiet = age >= QUIET_AFTER_MS;
  if (!primary) return quiet ? `No output for ${formatDuration(age)}` : `Last output ${formatDuration(age)} ago`;
  return `${primary} · ${quiet ? `no output for ${formatDuration(age)}` : `${formatDuration(age)} ago`}`;
}
