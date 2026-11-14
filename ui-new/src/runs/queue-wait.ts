import type { ExecutionAgentQueue, ExecutionProjection } from "@paperclipai/shared";
import { admissionHold } from "@/chat/admission";

/*
 * A run that's waiting rather than working (U151, since the 2026-11-14 sync; upstream #21405,
 * #21447, #21564). A queued run that never started isn't live: nothing is working on its task yet.
 *
 * - Waiting for an agent's slot: while the agent runs `maxConcurrentRuns` at once, the server adds
 *   `execution.agentQueue` to the queued run, with cause `agent_at_capacity`: "Waiting for Codie ·
 *   20 slots max · 41 of 295 in line · Configure". The place in line is the server's dispatch order.
 * - Another named hold: maintenance, agent setup, a previous run stopping, or since #21447 another
 *   open task of the same routine (`routine_execution_in_progress`, "Waiting for TES-12 to finish").
 *   These come through admission.ts as the server words them.
 * - Waiting to start: a queued run with no named hold still reads as starting work for 30 seconds
 *   (U120, #20559). After that it says "Waiting to start", with no spinner or running time.
 *
 * Task rows and the task's header show a quiet "Waiting" in place of the running pill when every
 * live run of the task hasn't started; the full sentence is its tooltip. The company's live runs
 * (`GET /companies/:id/live-runs`) carry each run's execution projection, so this needs no extra
 * read. Live counts in the nav already count running runs only (lib/agent-state.ts).
 */

/** How long a queued run with no named hold keeps reading as starting (upstream `QUEUED_START_GRACE_MS`). */
export const QUEUED_START_GRACE_MS = 30_000;
export const WAITING_TO_START = "Waiting to start";

type Time = string | Date | null | undefined;

export type QueueRun = {
  status: string;
  startedAt?: Time;
  createdAt?: Time;
  execution?: Pick<ExecutionProjection, "phase" | "label" | "cause" | "agentQueue"> | null;
};

/** What a waiting run is waiting for: an agent's slot, a hold the server names, or just to start. */
export type QueueWait =
  | { kind: "agent"; queue: ExecutionAgentQueue; label: string }
  | { kind: "hold"; label: string }
  | { kind: "start"; label: string };

/** A run the server accepted but never started: it waits, it isn't working. */
export function isWaitingToStart(run: Pick<QueueRun, "status" | "startedAt">): boolean {
  return run.status === "queued" && !run.startedAt;
}

/** The agent's line a queued run waits in, when the server says its slots are full. */
export function agentQueueOf(execution: QueueRun["execution"]): ExecutionAgentQueue | null {
  return execution?.cause === "agent_at_capacity" && execution.agentQueue ? execution.agentQueue : null;
}

/** "Waiting for Codie", "20 slots max", "41 of 295 in line". */
export function agentQueueParts(queue: ExecutionAgentQueue): [string, string, string] {
  return [
    `Waiting for ${queue.agentName}`,
    `${queue.maxConcurrentRuns} ${queue.maxConcurrentRuns === 1 ? "slot" : "slots"} max`,
    `${queue.position} of ${queue.queuedCount} in line`,
  ];
}

const ms = (time: Time) => (time ? new Date(time).getTime() : Number.NaN);

/** Whether a queued run with no named hold is past its startup grace at `now`. */
export function pastStartGrace(run: Pick<QueueRun, "status" | "startedAt" | "createdAt">, now: number): boolean {
  const since = ms(run.createdAt);
  return isWaitingToStart(run) && Number.isFinite(since) && now - since >= QUEUED_START_GRACE_MS;
}

/** When a queued run's startup grace ends, or null when it isn't waiting to start. */
export function startGraceEndsAt(run: Pick<QueueRun, "status" | "startedAt" | "createdAt">): number | null {
  const since = ms(run.createdAt);
  return isWaitingToStart(run) && Number.isFinite(since) ? since + QUEUED_START_GRACE_MS : null;
}

/**
 * What a live run is waiting for at `now`, or null while it works (or is still in its startup
 * grace with no named hold). The agent's line wins over the other holds, as upstream's pill does.
 */
export function queueWait(run: QueueRun | null | undefined, now: number): QueueWait | null {
  if (!run) return null;
  const queue = run.status === "queued" ? agentQueueOf(run.execution) : null;
  if (queue) return { kind: "agent", queue, label: agentQueueParts(queue).join(" · ") };
  const hold = admissionHold(run);
  if (hold) return { kind: "hold", label: hold };
  return pastStartGrace(run, now) ? { kind: "start", label: WAITING_TO_START } : null;
}

/** A task whose live runs all haven't started; `label` is the whole sentence, for a tooltip. */
export type TaskWaiting = { queue: ExecutionAgentQueue | null; label: string };

type TaskRun = QueueRun & { issueId?: string | null };

/**
 * The tasks whose every live run is still waiting to start, from the company's live runs. A task
 * with one started run is working, whatever else waits. The agent's line is kept when any of the
 * task's waiting runs reports one.
 */
export function waitingTasks(runs: readonly TaskRun[] | null | undefined): Map<string, TaskWaiting> {
  const started = new Set<string>();
  const waiting = new Map<string, TaskWaiting>();
  for (const run of runs ?? []) {
    if (!run.issueId) continue;
    if (!isWaitingToStart(run)) {
      started.add(run.issueId);
      continue;
    }
    if (waiting.get(run.issueId)?.queue) continue;
    const queue = agentQueueOf(run.execution);
    const label = queue ? agentQueueParts(queue).join(" · ") : (admissionHold(run) ?? WAITING_TO_START);
    waiting.set(run.issueId, { queue, label });
  }
  for (const id of started) waiting.delete(id);
  return waiting;
}

/** The run a task's header shows: one that has started, else the first. */
export function shownTaskRun<T extends TaskRun>(runs: readonly T[] | null | undefined, taskId: string): T | undefined {
  const mine = (runs ?? []).filter((run) => run.issueId === taskId);
  return mine.find((run) => !isWaitingToStart(run)) ?? mine[0];
}

/** Runs that have started, for "N running" counts: a queued run only waits for its turn. */
export function startedRuns<T extends Pick<QueueRun, "status" | "startedAt">>(runs: readonly T[] | null | undefined): T[] {
  return (runs ?? []).filter((run) => !isWaitingToStart(run));
}
