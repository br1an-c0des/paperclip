import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { RotateCcw, Square } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { heartbeatsApi } from "@/api/heartbeats";
import { issuesApi, type RunForIssue } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { runsApi } from "@/api/runs";
import { useNow } from "@/lib/clock";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { canResumeRun, canRetryRun, resumePayload, retryOutcome } from "@/runs/run-model";
import { RunWatchdog } from "@/runs/RunWatchdog";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople } from "./people";
import { duration, stampLabel } from "./thread-model";
import "./TaskRuns.css";

/*
 * The task panel's Runs section: what the task's runs cost in all, then each run, newest first, with
 * its agent, how it started, how long it took, how it ended, and Stop while it's going. "View run"
 * opens its transcript in the run modal.
 *
 * A failed or timed-out run offers Retry (the same request again as a new run), and a run whose
 * process was lost offers Resume, by the run modal's rules (run-model.ts). A going run that has
 * gone quiet shows the watchdog's warning with its answers (RunWatchdog.tsx).
 */

const ACTIVE = new Set(["queued", "running", "scheduled_retry"]);

const STATUS_TONE: Record<string, string> = {
  queued: "neutral",
  running: "run",
  scheduled_retry: "amber",
  succeeded: "green",
  failed: "red",
  timed_out: "red",
  cancelled: "neutral",
};

const SOURCES: Record<string, string> = {
  timer: "On a schedule",
  assignment: "On assignment",
  on_demand: "On demand",
  automation: "By an automation",
};

const words = (value: string) => value.replace(/_/g, " ");

export function costLabel(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "1.2M", "48k", "312". */
export function tokenCount(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

/**
 * What the run says comes next. A run with an execution projection speaks through it, even when it
 * has no next action; the run's own `nextAction` is for runs without one (as the old UI's run
 * ledger reads them since upstream f0877a9c7).
 */
export function runNextAction(run: Pick<RunForIssue, "execution" | "nextAction">) {
  return (run.execution ? run.execution.nextAction : run.nextAction) ?? null;
}

/** A running run's watchdog warning: the run's own detail carries the output-silence state. */
function QuietRun(props: { runId: string; taskId: string }) {
  const run = createQuery(() => ({
    queryKey: queryKeys.runs.detail(props.runId),
    queryFn: ({ signal }) => runsApi.get(props.runId, signal),
    refetchInterval: 30_000,
  }));
  return <Show when={run.data}>{(found) => <RunWatchdog run={found()} taskId={props.taskId} />}</Show>;
}

export function TaskRuns(props: { taskId: string }) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const people = useTaskPeople();
  const runs = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "runs"),
    queryFn: ({ signal }) => issuesApi.runs(props.taskId, signal),
  }));
  const cost = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "cost"),
    queryFn: ({ signal }) => issuesApi.costSummary(props.taskId, signal),
  }));
  const ordered = createMemo(() =>
    [...(runs.data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  );
  // Ticks the running times while a run is going.
  const now = useNow(() => ordered().some((run) => ACTIVE.has(run.status)));

  const stop = async (run: RunForIssue) => {
    try {
      await heartbeatsApi.cancel(run.runId);
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "runs") });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't stop the run", body: error instanceof Error ? error.message : String(error) });
    }
  };

  // Retry and Resume, as the run modal offers them; one at a time.
  const [rerunning, setRerunning] = createSignal<string | null>(null);
  const afterRerun = () => {
    void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
    void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "runs") });
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
  };
  const rerun = async (run: RunForIssue, how: "retry" | "resume") => {
    setRerunning(run.runId);
    const target = { id: run.runId, agentId: run.agentId, companyId: company().id };
    try {
      if (how === "resume") {
        const result = await runsApi.resume(target, resumePayload({ id: run.runId, contextSnapshot: { issueId: props.taskId } }));
        if (!("id" in result)) throw new Error(result.message ?? "The resume request was skipped.");
        pushToast({ tone: "success", title: "Resuming the run" });
      } else {
        const outcome = retryOutcome(await runsApi.retry(target));
        if ("error" in outcome) throw new Error(outcome.error);
        pushToast(
          outcome.runId
            ? { tone: "success", title: "Retrying the run" }
            : { tone: "success", title: "Retry queued", body: "The same request will retry when the task is ready." },
        );
      }
      afterRerun();
    } catch (error) {
      pushToast({ tone: "error", title: how === "resume" ? "Couldn't resume the run" : "Couldn't retry the run", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setRerunning(null);
    }
  };

  return (
    <section class="tr" aria-label="Runs">
      <div class="tsec-head">
        <h2 class="disp">Runs</h2>
      </div>
      <div class="tsec-scroll">
        <Show when={cost.data}>
          {(summary) => (
            <dl class="tr-totals">
              <div>
                <dt>Cost</dt>
                <dd>{costLabel(summary().costCents)}</dd>
              </div>
              <div>
                <dt>Runs</dt>
                <dd>{summary().runCount}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{duration(new Date(0), new Date(summary().runtimeMs)) || "0s"}</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>
                  {tokenCount(summary().inputTokens + summary().cachedInputTokens)} in · {tokenCount(summary().outputTokens)} out
                </dd>
              </div>
            </dl>
          )}
        </Show>
        <Show when={cost.data && cost.data.issueCount > 1}>
          <p class="tsec-muted">Totals include this task's {cost.data!.issueCount - 1} subtasks.</p>
        </Show>
        <Switch>
          <Match when={runs.isPending}>
            <p class="tsec-muted">Loading…</p>
          </Match>
          <Match when={runs.isError}>
            <p class="tsec-muted">This task's runs couldn't be loaded: {(runs.error as Error).message}</p>
          </Match>
          <Match when={ordered().length === 0}>
            <p class="tsec-muted">No runs yet. Assigning the task to an agent starts one.</p>
          </Match>
          <Match when={true}>
            <ol class="card tr-list">
              <For each={ordered()}>
                {(run) => {
                  const agent = () => people.agent(run.agentId);
                  const active = () => ACTIVE.has(run.status);
                  const rerunnable = () => ({ status: run.status, errorCode: run.errorCode ?? null, execution: run.execution });
                  const resumable = () => canResumeRun(rerunnable());
                  const retryable = () => canRetryRun(rerunnable());
                  return (
                    <li class="tr-run">
                      <Show when={agent()} fallback={<span class="tr-avatar-gap" aria-hidden="true" />}>
                        {(found) => <AgentAvatar agent={found()} size={24} />}
                      </Show>
                      <div class="tr-run-main">
                        <div class="tr-run-top">
                          <span class="tr-agent">{agent()?.name ?? "An agent"}</span>
                          <span class="tr-status" data-tone={STATUS_TONE[run.status] ?? "neutral"}>
                            {words(run.status)}
                          </span>
                          <Show when={run.retryOfRunId}>
                            <span class="tsec-muted">retry</span>
                          </Show>
                        </div>
                        <span class="tsec-muted">
                          {SOURCES[run.invocationSource] ?? words(run.invocationSource)} · {stampLabel(run.startedAt ?? run.createdAt)}
                          <Show when={duration(run.startedAt, run.finishedAt ?? (active() ? new Date(now()) : null))}>
                            {(took) => <> · {took()}</>}
                          </Show>
                          <Show when={!active() && run.livenessState && run.livenessState !== "completed"}>
                            {" "}· <span title={run.livenessReason ?? undefined}>{words(run.livenessState!)}</span>
                          </Show>
                        </span>
                        <Show when={run.error}>{(error) => <p class="tr-error">{error()}</p>}</Show>
                        <Show when={run.scheduledRetryAt}>
                          {(at) => <p class="tsec-muted">Retries {stampLabel(at())}</p>}
                        </Show>
                        <Show when={runNextAction(run)}>
                          {(next) => (
                            <p class="tr-next">
                              <b>Next action:</b> {next()}
                            </p>
                          )}
                        </Show>
                        <Show when={run.status === "running"}>
                          <QuietRun runId={run.runId} taskId={props.taskId} />
                        </Show>
                      </div>
                      <div class="tr-actions">
                        <Button size="compact" onClick={() => commands.openRunModal(run.runId)}>
                          View run
                        </Button>
                        <Show when={active()}>
                          <Button size="compact" onClick={() => void stop(run)}>
                            <Square size={12} aria-hidden="true" />
                            Stop
                          </Button>
                        </Show>
                        <Show when={resumable() || retryable()}>
                          <Button
                            size="compact"
                            disabled={rerunning() !== null}
                            title={resumable() ? "The process was lost. Pick up from where this run stopped." : "Send the same request again as a new run."}
                            onClick={() => void rerun(run, resumable() ? "resume" : "retry")}
                          >
                            <RotateCcw size={12} aria-hidden="true" />
                            {rerunning() === run.runId ? "Starting…" : resumable() ? "Resume" : "Retry"}
                          </Button>
                        </Show>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ol>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
