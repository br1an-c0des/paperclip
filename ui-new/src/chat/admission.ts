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
 * it. So the places that read those (the chat's Activity column, a task's live run line) read the
 * run detail for each run that's still queued there, under the key the reply card and the run modal
 * read, and stop once it starts or leaves the list (decision 50; the hook is admission-hold.ts).
 * With no named hold they keep "Starting" and "is working".
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

/** How often a queued run's detail is read again when no live event has refreshed it. */
export const QUEUED_HOLD_REFRESH_MS = 15_000;

/** Whether a live-runs row reads its run detail for a hold: only while it's queued. */
export function readsHold(live: { status: string } | null | undefined): boolean {
  return live?.status === "queued";
}

/**
 * The hold a live-runs row names, from its run detail once that's read. A row that has started
 * names none (the list's own wording takes over), and neither does one whose detail isn't read yet.
 */
export function liveRunHold(live: { status: string } | null | undefined, detail: AdmissionRun | null | undefined): string | null {
  if (!readsHold(live) || !detail) return null;
  return admissionHold(detail);
}

/** The fallback refresh while the detail still says queued (or isn't read yet); none after. */
export function holdRefreshInterval(detail: { status: string } | null | undefined): number | false {
  return !detail || detail.status === "queued" ? QUEUED_HOLD_REFRESH_MS : false;
}
