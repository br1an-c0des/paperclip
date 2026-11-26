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
