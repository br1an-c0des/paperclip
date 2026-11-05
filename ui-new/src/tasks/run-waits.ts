import type { RunForIssue } from "@/api/issues";

/*
 * What a task's run is waiting for, where the task shows its runs (the Runs section and the
 * activity thread). Since the 2026-11-05 sync (upstream #19246), while an agent's provider usage
 * limit is active its queued work waits for the reset: the queued run is cancelled with
 * `provider_limit_wait` (its reset in `resultJson.providerLimitWait`), and a retry of the same wake
 * is scheduled for the reset, which the execution projection labels "Waiting for usage limit reset".
 * Other scheduled waits the projection names (an AI subscription, a busy workspace) read the same way.
 */

export const USAGE_LIMIT_WAIT = "Waiting for usage limit reset";

export type RunWait = { label: string; until: string | null };

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

export function runWait(run: Pick<RunForIssue, "status" | "errorCode" | "resultJson" | "execution" | "scheduledRetryAt">): RunWait | null {
  if (run.errorCode === "provider_limit_wait") {
    const wait = run.resultJson?.providerLimitWait as Record<string, unknown> | undefined;
    return { label: USAGE_LIMIT_WAIT, until: text(wait?.resetAt) ?? text(run.resultJson?.retryAt) };
  }
  const execution = run.execution;
  if ((run.status === "scheduled_retry" || run.status === "queued") && execution?.phase === "retry_scheduled" && execution.label) {
    return { label: execution.label, until: execution.retryAt ?? run.scheduledRetryAt ?? null };
  }
  return null;
}
