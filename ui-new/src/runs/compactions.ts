import { formatTokens } from "@/tasks/context-usage";

/*
 * Context compactions in a run (U58, upstream #19273, #19378, #19801): where the agent compacted its
 * context, and how big the context was before and after. Two places read them from the runner's
 * `paperclip.prp.event.v1` envelopes through the one tracker here: the task thread's dividers
 * (tasks/thread-compactions.ts, from a finished run's conversation events) and the run modal's
 * transcript (runner-entries.ts, from the run's log, live or finished).
 *
 * Ported from the old UI's projection (ui/src/components/transcript/native-run-events.ts): the
 * "before" size is the event's own or the last context reading; the "after" size is the event's own
 * or the next, smaller reading. The same compaction reported twice with no reading between (an
 * item's start and end) counts once.
 */

export type ContextSizes = { preTokens: number | null; postTokens: number | null };

/** What a runner event says about the context: a reading of its size, or a compaction. */
export type ContextSignal =
  | { kind: "reading"; usedTokens: number }
  | { kind: "compacted"; compactionId: unknown; preTokens: number | null; postTokens: number | null; emittedAt: string | null };

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null);
export const tokenCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** A runner event envelope as a context signal, or null for one that says nothing about the context. */
export function contextSignal(envelope: unknown): ContextSignal | null {
  const event = record(envelope);
  if (!event || event.schema !== "paperclip.prp.event.v1") return null;
  const payload = record(event.payload);
  if (!payload) return null;
  if (event.eventType === "item.completed" && payload.kind === "usage") {
    const context = record(record(payload.usage)?.context);
    const used = tokenCount(context?.usedTokens);
    const windowTokens = tokenCount(context?.windowTokens);
    return used === null || !windowTokens ? null : { kind: "reading", usedTokens: used };
  }
  if (event.eventType !== "context.compacted" || payload.schema !== "paperclip.context.compacted.v1") return null;
  return {
    kind: "compacted",
    compactionId: payload.compactionId,
    preTokens: tokenCount(payload.preTokens),
    postTokens: tokenCount(payload.postTokens),
    emittedAt: typeof event.emittedAt === "string" ? event.emittedAt : null,
  };
}

/**
 * Follows one run's signals in order. `compacted` gives the compaction `base` with its sizes, or null
 * for a repeat. An "after" size that only a later reading tells is filled in on the same object when
 * that reading arrives, so whoever holds it sees it once the run's events are all read.
 */
export function createCompactionTracker() {
  let latest: number | null = null;
  let awaiting: ContextSizes | null = null;
  let last: { id: unknown } | null = null;
  let readingSinceLast = false;
  return {
    reading(used: number) {
      readingSinceLast = true;
      if (awaiting && used < (latest ?? Infinity)) {
        awaiting.postTokens = used;
        awaiting = null;
      }
      latest = used;
    },
    compacted<T extends object>(signal: Extract<ContextSignal, { kind: "compacted" }>, base: T): (T & ContextSizes) | null {
      if (last && last.id === signal.compactionId && !readingSinceLast) return null;
      readingSinceLast = false;
      last = { id: signal.compactionId };
      const compaction = Object.assign(base, { preTokens: signal.preTokens ?? latest, postTokens: signal.postTokens });
      if (compaction.postTokens === null) awaiting = compaction;
      return compaction;
    },
  };
}

/** "230k → 38k tokens", "from 230k tokens", or nothing when neither size is known. */
export function compactionDetail(compaction: ContextSizes) {
  if (compaction.preTokens !== null && compaction.postTokens !== null) return `${formatTokens(compaction.preTokens)} → ${formatTokens(compaction.postTokens)} tokens`;
  if (compaction.preTokens !== null) return `from ${formatTokens(compaction.preTokens)} tokens`;
  return null;
}
