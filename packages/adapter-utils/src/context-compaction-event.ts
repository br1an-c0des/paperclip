import type { AdapterRuntimeEvent } from "./types.js";

/**
 * A `context.compacted` run event for an adapter that runs Claude itself (`claude_local`, bug 96).
 *
 * It uses the Runner's `paperclip.prp.event.v1` envelope so the existing readers take it unchanged:
 * the transcript and task-thread dividers, `issue-context-usage.ts`'s compaction count, the
 * `heartbeat_run_events_compaction_session_idx` index (on `prpEvent.normalizedSessionId`), and the
 * run task facts' `compactedSinceLastRun`. `schemaVersion: 1` keeps the event type through the
 * server's log redaction. Claude reports the size before a compaction only, so `postTokens` is null.
 */
export function contextCompactedRunEvent(input: {
  compactionId: string;
  trigger: string | null;
  preTokens: number | null;
  sessionId: string | null;
  emittedAt: string;
  sourceKind: "claude_local";
}): AdapterRuntimeEvent {
  return {
    eventType: "context.compacted",
    stream: "system",
    level: "info",
    message: "Context compacted",
    payload: {
      prpEvent: {
        schema: "paperclip.prp.event.v1",
        schemaVersion: 1,
        eventType: "context.compacted",
        sourceKind: input.sourceKind,
        normalizedSessionId: input.sessionId,
        emittedAt: input.emittedAt,
        payload: {
          schema: "paperclip.context.compacted.v1",
          compactionId: input.compactionId,
          reason: input.trigger ?? "provider",
          preTokens: input.preTokens,
          postTokens: null,
          sameSession: true,
        },
      },
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The run event for an ACP `usage_update`'s `_meta`, or null when it has no compaction marker.
 * Only Paperclip's patch of `claude-agent-acp` sends the marker, at a `compact_boundary`:
 * `_meta.paperclip.compacted = { trigger, preTokens, compactionId }`. `_meta` is the agent's own,
 * so each field is checked and bounded.
 */
export function acpCompactionMarkerEvent(
  meta: unknown,
  sessionId: string | null,
  now: () => Date,
): AdapterRuntimeEvent | null {
  const paperclip = isRecord(meta) ? meta.paperclip : null;
  const marker = isRecord(paperclip) ? paperclip.compacted : null;
  if (!isRecord(marker)) return null;
  const emittedAt = now().toISOString();
  const compactionId = typeof marker.compactionId === "string" && marker.compactionId ? marker.compactionId.slice(0, 200) : `${sessionId}:${emittedAt}`;
  const trigger = typeof marker.trigger === "string" && marker.trigger ? marker.trigger.slice(0, 64) : null;
  const preTokens = typeof marker.preTokens === "number" && Number.isFinite(marker.preTokens) && marker.preTokens >= 0 ? marker.preTokens : null;
  return contextCompactedRunEvent({ compactionId, trigger, preTokens, sessionId, emittedAt, sourceKind: "claude_local" });
}
