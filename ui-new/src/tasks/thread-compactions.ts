import type { ActivityEvent, HeartbeatRunEvent } from "@paperclipai/shared";
import { createQueries } from "@tanstack/solid-query";
import { createMemo, type Accessor } from "solid-js";
import type { RunForIssue } from "@/api/issues";
import { runsApi } from "@/api/runs";
import { formatTokens } from "./context-usage";

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

export type Compaction = {
  /** Unique within the thread. */
  key: string;
  runId: string;
  at: Date;
  preTokens: number | null;
  postTokens: number | null;
};

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** Only runner runs report compactions. */
const RUNNER_ADAPTER = "paperclip_runner";

/** Events per page, the server's most; a run with more pages than this many is read no further. */
const PAGE = 1000;
const MAX_PAGES = 5;

/**
 * A run's compactions, from its conversation events in order. Ported from the old UI's projection
 * (ui/src/components/transcript/native-run-events.ts): the "before" size is the event's own or the
 * last context reading; the "after" size is the event's own or the next, smaller reading. The same
 * compaction reported twice with no reading between (an item's start and end) counts once.
 */
export function runCompactions(runId: string, events: readonly Pick<HeartbeatRunEvent, "seq" | "runId" | "eventType" | "payload" | "createdAt">[]): Compaction[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const found: Compaction[] = [];
  let latest: number | null = null;
  let awaiting: Compaction | null = null;
  let last: { id: unknown } | null = null;
  let readingSinceLast = false;
  for (const event of ordered) {
    const envelope = record(event.payload?.prpEvent);
    if (!envelope || envelope.schema !== "paperclip.prp.event.v1") continue;
    if (envelope.eventType !== event.eventType) continue;
    const payload = record(envelope.payload);
    if (!payload) continue;
    if (event.eventType === "item.completed" && payload.kind === "usage") {
      const context = record(record(payload.usage)?.context);
      const used = count(context?.usedTokens);
      const windowTokens = count(context?.windowTokens);
      if (used === null || !windowTokens) continue;
      readingSinceLast = true;
      if (awaiting && used < (latest ?? Infinity)) {
        awaiting.postTokens = used;
        awaiting = null;
      }
      latest = used;
      continue;
    }
    if (event.eventType !== "context.compacted" || payload.schema !== "paperclip.context.compacted.v1") continue;
    if (last && last.id === payload.compactionId && !readingSinceLast) continue;
    readingSinceLast = false;
    last = { id: payload.compactionId };
    const at = typeof envelope.emittedAt === "string" ? new Date(envelope.emittedAt) : new Date(event.createdAt);
    const compaction: Compaction = {
      key: `compaction:${runId}:${event.seq}`,
      runId,
      at: Number.isNaN(at.getTime()) ? new Date(event.createdAt) : at,
      preTokens: count(payload.preTokens) ?? latest,
      postTokens: count(payload.postTokens),
    };
    if (compaction.postTokens === null) awaiting = compaction;
    found.push(compaction);
  }
  return found;
}

/** "230k → 38k tokens", "from 230k tokens", or nothing when neither size is known. */
export function compactionDetail(compaction: Pick<Compaction, "preTokens" | "postTokens">) {
  if (compaction.preTokens !== null && compaction.postTokens !== null) return `${formatTokens(compaction.preTokens)} → ${formatTokens(compaction.postTokens)} tokens`;
  if (compaction.preTokens !== null) return `from ${formatTokens(compaction.preTokens)} tokens`;
  return null;
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
