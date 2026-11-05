import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Square, TriangleAlert } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { runsApi } from "@/api/runs";
import { useNow } from "@/lib/clock";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useLiveEvent, useRunInterest } from "@/lib/live-events";
import { buildTranscript, hasStructuredParser } from "@/runs/parsers";
import { createRunLog } from "@/runs/run-log-source";
import { costLabel, elapsedLabel, isActiveRun, runUsage } from "@/runs/run-model";
import { buildItems } from "@/runs/transcript-model";
import type { Plan } from "@/runs/activity-model";
import { stopLabel, stopRun } from "@/tasks/run-stop";
import { AgentAvatar } from "@/ui/Avatar";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { renderMarkdown } from "@/ui/Markdown";
import type { ReplyTurn } from "./chat-model";
import { EMPTY_REPLY, mergeEvents, pickReply, prpEventsFromOutput, recentSteps, replyFromEvents, replyFromTranscript, type ReplyEvent } from "./reply-model";

/*
 * The agent's reply while it's being written (board 13): a blue card with "Bob is replying", the
 * time and cost so far, Transcript (the run modal) and Stop; the latest steps, ✓ done and › going;
 * and the text so far with a caret. It reads the run's output (stored, then streamed over the
 * socket) and its stored events (read again on each event signal); reply-model.ts says which wins.
 * Once the run ends the card stays, without the caret, until the agent's message takes its place
 * (chat-model.ts, `shownReplies`).
 *
 * Each step says how it went (U42): "$ npm test · exit 1 · 2.3s", a blocked call, a subagent's
 * progress, a web search. While the agent thinks, its latest reasoning headline stands in for
 * "Thinking…"; a status notice that's still going (a retry, a compaction) shows under the steps;
 * an MCP server that failed to start is a warning at the top. The agent's native plan goes to the
 * chat (`onPlan`), which docks it above the composer (ChatPlanDock.tsx).
 */

/** A burst of event signals costs one read. */
const SIGNAL_DELAY_MS = 150;

/** The run's stored events: read once, then again from the last one seen whenever the socket signals a new one. */
function useStoredEvents(runId: () => string) {
  const [events, setEvents] = createSignal<ReplyEvent[]>([]);
  let controller: AbortController | null = null;
  let reading = false;
  let again = false;
  const read = async () => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    const id = untrack(runId);
    const mine = (controller = new AbortController());
    try {
      for (let page = 0; page < 10; page += 1) {
        const after = untrack(events).reduce((max, event) => Math.max(max, event.seq), 0);
        const batch = await runsApi.events(id, after, 1000, { signal: mine.signal }).catch(() => null);
        if (!batch || mine.signal.aborted || id !== untrack(runId)) return;
        setEvents((previous) => mergeEvents(previous, batch.map((event) => ({ seq: event.seq, eventType: event.eventType, payload: event.payload }))));
        if (batch.length < 1000) break;
      }
    } finally {
      reading = false;
      if (again && !mine.signal.aborted) {
        again = false;
        void read();
      }
    }
  };
  createEffect(
    on(runId, () => {
      controller?.abort();
      reading = false;
      again = false;
      setEvents([]);
      void read();
    }),
  );
  let timer: number | undefined;
  useLiveEvent(["heartbeat.run.event"], (event) => {
    if (event.payload?.runId !== untrack(runId)) return;
    timer ??= window.setTimeout(() => {
      timer = undefined;
      void read();
    }, SIGNAL_DELAY_MS);
  });
  onCleanup(() => {
    controller?.abort();
    window.clearTimeout(timer);
  });
  return events;
}

export function LiveReply(props: {
  turn: ReplyTurn;
  agent: AgentDetail;
  censorUsername?: boolean;
  /** The agent's plan while the reply runs, and whether a runtime request is waiting; null once it ends. */
  onPlan?: (runId: string, plan: { plan: Plan; asking: boolean } | null) => void;
}) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const run = createQuery(() => ({
    queryKey: queryKeys.runs.detail(props.turn.runId),
    queryFn: ({ signal }) => runsApi.get(props.turn.runId, signal),
  }));
  const active = () => isActiveRun(props.turn.status) && (!run.data || isActiveRun(run.data.status));
  const queued = () => (run.data?.status ?? props.turn.status) === "queued";
  const now = useNow(active);

  // The reply streams the run's output and event signals, so the socket asks for its transcript.
  useRunInterest(() => [props.turn.runId]);
  const log = createRunLog(() => props.turn.runId, () => run.data);
  const stored = useStoredEvents(() => props.turn.runId);
  const fromOutputEvents = createMemo(() => replyFromEvents(prpEventsFromOutput(log.chunks())));
  const fromStoredEvents = createMemo(() => replyFromEvents(stored()));
  // Local harnesses' own stream, through the run modal's parsers.
  const fromTranscript = createMemo(() => {
    if (!hasStructuredParser(props.agent.adapterType)) return EMPTY_REPLY;
    const entries = buildTranscript(log.chunks(), props.agent.adapterType, { censorUsername: props.censorUsername });
    return replyFromTranscript(buildItems(entries, active()));
  });
  const reply = createMemo(() => pickReply(fromOutputEvents(), fromStoredEvents(), fromTranscript()));
  const steps = createMemo(() => recentSteps(reply().steps));
  const html = createMemo(() => (reply().text ? renderMarkdown(reply().text) : ""));
  const health = () => reply().health ?? [];

  // The plan is docked only while the reply runs (upstream #19252 hides it once the run ends).
  const docked = createMemo(() => {
    const plan = reply().plan;
    return active() && plan && plan.steps.length > 0 ? { plan, asking: !!reply().asking } : null;
  });
  createEffect(on(docked, (plan) => props.onPlan?.(props.turn.runId, plan)));
  onCleanup(() => props.onPlan?.(untrack(() => props.turn.runId), null));

  const elapsed = () => {
    const started = run.data?.startedAt;
    if (!started) return null;
    const end = run.data?.finishedAt ? new Date(run.data.finishedAt).getTime() : now();
    return elapsedLabel(end - new Date(started).getTime());
  };
  const cost = () => {
    if (!run.data) return null;
    const usage = runUsage(run.data);
    return usage.costUsd ? costLabel(usage.costUsd) : null;
  };

  // A native session still starting records the Stop and settles later (409 `native_stop_pending`,
  // tasks/run-stop.ts): that reads "Stopping…" until the run ends, not as a failure.
  const [stopping, setStopping] = createSignal(false);
  const stop = async () => {
    if (stopping()) return;
    setStopping(true);
    let settling = false;
    try {
      settling = (await stopRun({ runId: props.turn.runId, status: run.data?.status ?? props.turn.status }, company().id)) === "pending";
      if (settling) pushToast({ tone: "info", title: "Stopping the reply", body: "The Stop is recorded. The reply ends once its session opens." });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't stop the reply", body: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!settling) setStopping(false);
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
    }
  };

  return (
    <article class="ch-msg" aria-label="Live reply">
      <span class="ch-av">
        <AgentAvatar agent={props.agent} size={32} ring={active()} />
      </span>
      <div class="ch-live" classList={{ "ch-live--done": !active() }}>
        <div class="ch-live-head">
          <Capsule gradient="ion" size="tiny" live={active()} />
          <span class="ch-live-who">
            {queued() ? `${props.agent.name} is about to reply` : active() ? `${props.agent.name} is replying` : `${props.agent.name} replied`}
          </span>
          <span class="ch-muted">{[elapsed(), cost()].filter(Boolean).join(" · ")}</span>
          <div class="ch-live-actions">
            <button type="button" class="ch-pill-btn" onClick={() => commands.openRunModal(props.turn.runId)}>
              Transcript
            </button>
            <Show when={active()}>
              <button type="button" class="ch-pill-btn ch-pill-btn--stop" disabled={stopping()} onClick={() => void stop()}>
                <Square size={11} aria-hidden="true" />
                {stopLabel(run.data?.status ?? props.turn.status, stopping())}
              </button>
            </Show>
          </div>
        </div>
        <Show when={health().length > 0}>
          <p class="ch-live-health" role="status">
            <TriangleAlert size={13} aria-hidden="true" />
            <span>
              <b>{health().map((failure) => failure.server).join(", ")}</b> {health().length === 1 ? "MCP server" : "MCP servers"} failed to start
              <Show when={health().length === 1 && health()[0]!.reason}>: {health()[0]!.reason}</Show>. The agent is working without{" "}
              {health().length === 1 ? "its tools" : "their tools"}.
            </span>
          </p>
        </Show>
        <Show when={steps().shown.length > 0}>
          <ul class="ch-steps mono" aria-label="Steps">
            <Show when={steps().hidden > 0}>
              <li class="ch-step ch-step--more">
                <span aria-hidden="true">…</span>
                {steps().hidden} earlier {steps().hidden === 1 ? "step" : "steps"}
              </li>
            </Show>
            <For each={steps().shown}>
              {(step) => (
                <li class="ch-step" data-state={step.state}>
                  <span class="ch-step-mark" aria-hidden="true">
                    {step.state === "done" ? "✓" : step.state === "error" ? "✕" : "›"}
                  </span>
                  <span class="ch-step-label">{step.label}</span>
                  <span class="ch-step-detail">{step.detail}</span>
                  <Show when={step.meta}>
                    <span class="ch-step-meta">{step.meta}</span>
                  </Show>
                  <span class="sr-only">{step.state === "running" ? "(going)" : step.state === "error" ? "(failed)" : "(done)"}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={active() && reply().notice}>
          {(notice) => (
            <p class="ch-live-notice" role="status">
              <span class="ch-live-dot" aria-hidden="true" />
              {notice()}
            </p>
          )}
        </Show>
        <Show
          when={html()}
          fallback={
            <Show
              when={active() && reply().headline}
              fallback={
                <Show when={steps().shown.length === 0}>
                  <p class="ch-muted">{queued() ? "Waiting to start…" : active() ? "Thinking…" : "Finishing up…"}</p>
                </Show>
              }
            >
              {(headline) => <p class="ch-muted ch-live-headline">{headline()}…</p>}
            </Show>
          }
        >
          <div class="md msg ch-live-text" classList={{ "ch-live-text--caret": active() }} innerHTML={html()} />
        </Show>
      </div>
    </article>
  );
}
