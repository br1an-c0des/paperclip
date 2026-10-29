import type { HeartbeatRun } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import type { WatchdogDecision, WatchdogDecisionInput } from "@/api/heartbeats";

/*
 * The output-silence watchdog on a run that's going (`outputSilence` on `GET /heartbeat-runs/:id`),
 * after the old task run ledger (ui/src/components/IssueRunLedger.tsx). The server marks a run
 * suspicious, then critical, the longer it goes without output; the board answers it by continuing
 * to watch, snoozing the warning for an hour, or calling it a false positive. The watchdog may
 * have opened an evaluation task, which the decision names. The signal only informs: nothing is
 * stopped or reassigned by it.
 */

export type SilenceAlert = {
  level: "suspicious" | "critical";
  /** "12 minutes", "1h 5m", or null when the server didn't say. */
  age: string | null;
  evaluationIssueId: string | null;
  evaluationIssueIdentifier: string | null;
};

const ACTIVE = new Set(["queued", "running"]);

/** "under 1 minute", "12 minutes", "2 hours", "1h 5m". */
export function silenceAge(ms: number | null | undefined) {
  if (!ms || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under 1 minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours}h ${rest}m`;
}

/** The warning to show for a run, or null when it's quiet for no reason worth raising. */
export function silenceAlert(run: { status: string; outputSilence?: HeartbeatRun["outputSilence"] | null }): SilenceAlert | null {
  const silence = run.outputSilence;
  if (!ACTIVE.has(run.status) || !silence) return null;
  if (silence.level !== "suspicious" && silence.level !== "critical") return null;
  return {
    level: silence.level,
    age: silenceAge(silence.silenceAgeMs),
    evaluationIssueId: silence.evaluationIssueId,
    evaluationIssueIdentifier: silence.evaluationIssueIdentifier,
  };
}

/** Until when a snoozed warning stays quiet, if it's snoozed. */
export function snoozedUntil(run: { status: string; outputSilence?: HeartbeatRun["outputSilence"] | null }): Date | null {
  const silence = run.outputSilence;
  if (!ACTIVE.has(run.status) || silence?.level !== "snoozed" || !silence.snoozedUntil) return null;
  return new Date(silence.snoozedUntil);
}

export const SNOOZE_MS = 60 * 60 * 1000;

/** The request body for a decision on a run's warning. */
export function watchdogInput(runId: string, alert: SilenceAlert, decision: WatchdogDecision, now = Date.now()): WatchdogDecisionInput {
  return {
    runId,
    decision,
    evaluationIssueId: alert.evaluationIssueId,
    ...(decision === "snooze" ? { snoozedUntil: new Date(now + SNOOZE_MS).toISOString(), reason: "Snoozed from the run" } : {}),
    ...(decision === "dismissed_false_positive" ? { reason: "Dismissed from the run" } : {}),
  };
}

export function watchdogErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return "Only the board or the agent assigned the recovery can record watchdog decisions.";
  return error instanceof Error && error.message.trim() ? error.message : "The watchdog decision couldn't be recorded.";
}
