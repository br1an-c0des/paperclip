import type { ExecutionProjection } from "@paperclipai/shared";
import { isActiveRun } from "@/runs/run-model";

/*
 * What a reply that's starting says while the server admits it (U120, since the 2026-11-10 sync,
 * upstream #20559). Ordinary admission reads as work already under way: the live reply says the
 * agent is replying and "Thinking…" from the moment the message is sent, with no "Queued" and no
 * time until the run has started. Only a hold the server names keeps its own words: a maintenance
 * drain, the agent's setup, a server restart, a previous run still stopping (a queued run's
 * execution projection with a `cause`), or a wait for the AI provider.
 *
 * The execution projection comes with `GET /heartbeat-runs/:id`; the company's live runs don't carry
 * it, so the lists that read those (the chat's Activity column, a task's live run line) just leave
 * "Queued" out.
 */

export type AdmissionRun = {
  status: string;
  execution?: Pick<ExecutionProjection, "phase" | "label" | "cause"> | null;
};

/** The hold a starting run is waiting on, in the server's words, or null for ordinary admission. */
export function admissionHold(run: AdmissionRun | null | undefined): string | null {
  if (!run || !isActiveRun(run.status)) return null;
  const execution = run.execution;
  const label = execution?.label?.trim();
  if (!label) return null;
  if (execution!.phase === "waiting_for_provider") return label;
  return run.status === "queued" && execution!.cause ? label : null;
}
