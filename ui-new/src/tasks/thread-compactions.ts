import type { ActivityEvent, HeartbeatRunEvent } from "@paperclipai/shared";
import { createQueries } from "@tanstack/solid-query";
import { createMemo, type Accessor } from "solid-js";
import type { RunForIssue } from "@/api/issues";
import { runsApi } from "@/api/runs";
import { compactionDetail, contextSignal, createCompactionTracker, type ContextSizes } from "@/runs/compactions";

/*
 * Compaction dividers in the task thread (U58, upstream #19273, #19378): where a finished run's
 * agent compacted its context, a "Context compacted · 230k → 38k tokens" line divides the thread,
 * at the time it happened. The thread itself doesn't read run events, so the compactions come from
 * each finished runner run's conversation view (`GET /heartbeat-runs/:id/events?view=conversation`),
 * which since #19378 keeps `context.compacted` events and, for runs that compacted, the context
 * readings around them. A finished run's events don't change, so each run is read once.
 *
 * Reading every run would cost a request per run, and the API has no way to ask which runs
 * compacted. So the runs are read only while the task's context reading counts compactions in the
 * assignee's session, plus any run a Compact now request names (`issue.context_compaction_requested`
 * activity, `details.compactionRunId`). Compactions in an earlier session of a task whose reading no
 * longer counts any are missed.
 */

export type Compaction = ContextSizes & {
  /** Unique within the thread. */
  key: string;
  runId: string;
  at: Date;
};

export { compactionDetail };

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null);

/** Only runner runs report compactions. */
const RUNNER_ADAPTER = "paperclip_runner";

/** Events per page, the server's most; a run with more pages than this many is read no further. */
const PAGE = 1000;
const MAX_PAGES = 5;

/** A run's compactions, from its conversation events in order, sized by the shared tracker (runs/compactions.ts). */
export function runCompactions(runId: string, events: readonly Pick<HeartbeatRunEvent, "seq" | "runId" | "eventType" | "payload" | "createdAt">[]): Compaction[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const tracker = createCompactionTracker();
  const found: Compaction[] = [];
  for (const event of ordered) {
    const envelope = record(event.payload?.prpEvent);
    if (!envelope || envelope.eventType !== event.eventType) continue;
    const signal = contextSignal(envelope);
    if (!signal) continue;
    if (signal.kind === "reading") {
      tracker.reading(signal.usedTokens);
      continue;
    }
    const at = signal.emittedAt ? new Date(signal.emittedAt) : new Date(event.createdAt);
    const compaction = tracker.compacted(signal, {
      key: `compaction:${runId}:${event.seq}`,
      runId,
      at: Number.isNaN(at.getTime()) ? new Date(event.createdAt) : at,
    });
    if (compaction) found.push(compaction);
  }
  return found;
}

/** The runs Compact now queued for this task, from its activity. */
export function compactionRunIds(events: readonly Pick<ActivityEvent, "action" | "details">[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.action !== "issue.context_compaction_requested") continue;
    const runId = event.details?.compactionRunId;
    if (typeof runId === "string" && runId) ids.add(runId);
  }
  return ids;
}

const ACTIVE = new Set(["queued", "running", "scheduled_retry"]);

/** Which of the shown runs to read: finished runner runs, all of them while the session counts compactions. */
export function runsToRead(runs: readonly Pick<RunForIssue, "runId" | "status" | "adapterType">[], options: { sessionCompacted: boolean; requested: ReadonlySet<string> }) {
  return runs.filter((run) => !ACTIVE.has(run.status) && run.adapterType === RUNNER_ADAPTER && (options.sessionCompacted || options.requested.has(run.runId))).map((run) => run.runId);
}

async function readRun(runId: string, signal: AbortSignal) {
  const events: HeartbeatRunEvent[] = [];
  let after = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await runsApi.conversationEvents(runId, after, PAGE, { signal });
    events.push(...batch);
    if (batch.length < PAGE) break;
    after = batch[batch.length - 1]!.seq;
  }
  return runCompactions(runId, events);
}

/** The compactions of the given runs, each read once and kept. */
export function useRunCompactions(runIds: Accessor<readonly string[]>): Accessor<Compaction[]> {
  const queries = createQueries(() => ({
    queries: runIds().map((runId) => ({
      queryKey: ["runs", runId, "compactions"] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => readRun(runId, signal),
      staleTime: Infinity,
      retry: false,
    })),
  }));
  return createMemo(() => queries.flatMap((query) => query.data ?? []));
}
