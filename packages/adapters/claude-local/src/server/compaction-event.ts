import { contextCompactedRunEvent, type AdapterRuntimeEvent } from "@paperclipai/adapter-utils";
import { asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

/*
 * Compactions in a CLI run (bug 96). When Claude compacts its session (on its own, or for
 * `/compact`), its stream-json output has a `{"type":"system","subtype":"compact_boundary",
 * "compact_metadata":{"trigger","pre_tokens",…}}` line. The run records it as a
 * `context.compacted` run event, which the next run's task facts read (`compactedSinceLastRun`)
 * and the compaction dividers show. A `/compact` with nothing to compact prints no boundary, so
 * it records nothing. The ACP engine reports the same event from the patched
 * `claude-agent-acp`'s marker (adapter-utils `acpx-engine/execute.ts`).
 */

const finiteCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** The run event for a stream-json line, or null for any line other than a compaction boundary. */
export function claudeCompactionEvent(
  line: Record<string, unknown>,
  sessionId: string | null,
  now: () => Date,
): AdapterRuntimeEvent | null {
  if (line.type !== "system" || line.subtype !== "compact_boundary") return null;
  const metadata = parseObject(line.compact_metadata);
  const emittedAt = now().toISOString();
  const session = asString(line.session_id, "") || sessionId;
  return contextCompactedRunEvent({
    compactionId: asString(line.uuid, "") || `${session}:${emittedAt}`,
    trigger: asString(metadata.trigger, "") || null,
    preTokens: finiteCount(metadata.pre_tokens),
    sessionId: session,
    emittedAt,
    sourceKind: "claude_local",
  });
}

/** A boundary line is a few hundred bytes; longer partial lines are tool output, not kept. */
const MAX_KEPT_LINE = 64 * 1024;

/**
 * Wraps a run's `onLog` so each compaction boundary in its stdout calls `onEvent` once, by
 * `compactionId`. Pass one `seen` set to every attempt of a run, so a retry doesn't report a
 * boundary again. Every chunk reaches `onLog` unchanged, and a failed event write doesn't stop it.
 */
export function createClaudeCompactionLog(
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
  onEvent: ((event: AdapterRuntimeEvent) => Promise<void>) | undefined,
  options: { sessionId: string | null; now?: () => Date; seen?: Set<string> },
) {
  const now = options.now ?? (() => new Date());
  const seen = options.seen ?? new Set<string>();
  let remainder = "";
  let skipping = false;

  async function report(line: string) {
    if (!line.includes("compact_boundary")) return;
    const parsed = parseJson(line.trim());
    if (!parsed) return;
    const event = claudeCompactionEvent(parsed, options.sessionId, now);
    if (!event || !onEvent) return;
    const envelope = parseObject(event.payload?.prpEvent);
    const compactionId = asString(parseObject(envelope.payload).compactionId, "");
    if (seen.has(compactionId)) return;
    seen.add(compactionId);
    try {
      await onEvent(event);
    } catch {
      // The run goes on without the record; the boundary is still in its log.
    }
  }

  return async (stream: "stdout" | "stderr", chunk: string) => {
    if (stream === "stdout" && onEvent) {
      const parts = (remainder + chunk).split("\n");
      remainder = parts.pop() ?? "";
      for (const [index, part] of parts.entries()) {
        // The first part ends a line that was too long to keep.
        if (index === 0 && skipping) { skipping = false; continue; }
        await report(part);
      }
      if (remainder.length > MAX_KEPT_LINE) { remainder = ""; skipping = true; }
    }
    await onLog(stream, chunk);
  };
}
