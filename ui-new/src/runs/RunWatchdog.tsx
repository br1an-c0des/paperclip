import type { HeartbeatRun } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { BellOff, TriangleAlert } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { heartbeatsApi, type WatchdogDecision } from "@/api/heartbeats";
import { issuePath } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { clockTime } from "./run-model";
import { silenceAlert, snoozedUntil, watchdogErrorMessage, watchdogInput } from "./watchdog";
import "./RunWatchdog.css";

/*
 * The output-silence warning on a run that has gone quiet (watchdog.ts), with the board's three
 * answers: keep watching, snooze it for an hour, or mark it a false positive. Shown in the run
 * modal and on the task's Runs section. A snoozed warning shows as one quiet line.
 */

export type WatchdogRun = { id: string; status: string; outputSilence?: HeartbeatRun["outputSilence"] | null };

const DECISIONS: { value: WatchdogDecision; label: string; done: string }[] = [
  { value: "continue", label: "Keep watching", done: "Watching the run" },
  { value: "snooze", label: "Snooze 1h", done: "Snoozed for an hour" },
  { value: "dismissed_false_positive", label: "False positive", done: "Marked a false positive" },
];

export function RunWatchdog(props: { run: WatchdogRun; taskId?: string | null; onNavigate?: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const alert = () => silenceAlert(props.run);
  const snoozed = () => snoozedUntil(props.run);
  const [error, setError] = createSignal<string | null>(null);

  const decide = createMutation(() => ({
    mutationFn: (decision: WatchdogDecision) => heartbeatsApi.recordWatchdogDecision(watchdogInput(props.run.id, alert()!, decision)),
    onMutate: () => setError(null),
    onSuccess: (_result, decision) => {
      pushToast({ tone: "success", title: DECISIONS.find((option) => option.value === decision)!.done });
      void client.invalidateQueries({ queryKey: queryKeys.runs.detail(props.run.id) });
      if (props.taskId) void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "runs") });
    },
    onError: (failure: Error) => setError(watchdogErrorMessage(failure)),
  }));

  return (
    <>
      <Show when={alert()}>
        {(found) => (
          <section class="rw" data-level={found().level} aria-label="Output silence">
            <TriangleAlert size={15} aria-hidden="true" class="rw-icon" />
            <div class="rw-main">
              <p class="rw-title">{found().level === "critical" ? "No output for a long while" : "The run has gone quiet"}</p>
              <p class="rw-body">
                No output for {found().age ?? "an unusually long time"}.
                <Show when={found().evaluationIssueIdentifier || found().evaluationIssueId}>
                  {" "}The watchdog is looking into it in{" "}
                  <A
                    class="rw-link mono"
                    href={issuePath(company().issuePrefix, { id: found().evaluationIssueId ?? "", identifier: found().evaluationIssueIdentifier })}
                    onClick={() => props.onNavigate?.()}
                  >
                    {found().evaluationIssueIdentifier ?? "its task"}
                  </A>
                  .
                </Show>{" "}
                Nothing is stopped or reassigned.
              </p>
              <div class="rw-actions">
                {DECISIONS.map((option) => (
                  <Button size="compact" disabled={decide.isPending} onClick={() => decide.mutate(option.value)}>
                    {decide.isPending && decide.variables === option.value ? "Saving…" : option.label}
                  </Button>
                ))}
              </div>
              <Show when={error()}>{(message) => <p class="rw-error" role="alert">{message()}</p>}</Show>
            </div>
          </section>
        )}
      </Show>
      <Show when={snoozed()}>
        {(until) => (
          <p class="rw-snoozed">
            <BellOff size={13} aria-hidden="true" />
            Silence warning snoozed until {clockTime(until())}
          </p>
        )}
      </Show>
    </>
  );
}
