import type { ExecutionAgentQueue } from "@paperclipai/shared";
import type { RunForIssue } from "@/api/issues";
import { agentQueueOf } from "@/runs/queue-wait";

/*
 * What a task's run is waiting for, where the task shows its runs (the Runs section and the
 * activity thread). Since the 2026-11-05 sync (upstream #19246), while an agent's provider usage
 * limit is active its queued work waits for the reset: the queued run is cancelled with
 * `provider_limit_wait` (its reset in `resultJson.providerLimitWait`), and a retry of the same wake
 * is scheduled for the reset, which the execution projection labels "Waiting for usage limit reset".
 * Other scheduled waits the projection names (an AI subscription, a busy workspace) read the same way.
 *
 * Since the 2026-11-14 sync (U151, #21405, #21447): a queued run that never started and is held by
 * something the server names reads that hold too ("Waiting for Codie", "Waiting for TES-12 to
 * finish"), and while the agent's slots are full `queue` is its place in the agent's line, which
 * the Runs section shows with Configure in place of the next action (runs/QueueWait.tsx).
 */

export const USAGE_LIMIT_WAIT = "Waiting for usage limit reset";

/** `held`: the run was set aside for the wait, and a retry starts at `until` in its place. */
export type RunWait = { label: string; until: string | null; held: boolean; queue?: ExecutionAgentQueue | null };

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

export function runWait(
  run: Pick<RunForIssue, "status" | "errorCode" | "resultJson" | "execution" | "scheduledRetryAt"> & { startedAt?: string | null },
): RunWait | null {
  if (run.errorCode === "provider_limit_wait") {
    const wait = run.resultJson?.providerLimitWait as Record<string, unknown> | undefined;
    return { label: "Held for usage limit", until: text(wait?.resetAt) ?? text(run.resultJson?.retryAt), held: true };
  }
  const execution = run.execution;
  if ((run.status === "scheduled_retry" || run.status === "queued") && execution?.phase === "retry_scheduled" && execution.label) {
    return { label: execution.label, until: execution.retryAt ?? run.scheduledRetryAt ?? null, held: false };
  }
  if (run.status === "queued" && !run.startedAt && execution?.cause && execution.label) {
    return { label: execution.label, until: null, held: false, queue: agentQueueOf(execution) };
  }
  return null;
}
