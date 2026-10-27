import { Tabs } from "@kobalte/core/tabs";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronLeft, ChevronRight, Download, Square } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { accessApi } from "@/api/access";
import { heartbeatsApi } from "@/api/heartbeats";
import { instanceSettingsApi } from "@/api/instance-settings";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { runsApi } from "@/api/runs";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Composer } from "@/tasks/composer/Composer";
import { QueuedMessages, useQueuedComments } from "@/tasks/composer/QueuedMessages";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { findInvokeEvent, promptSize, readInvocation } from "./invocation";
import { buildTranscript, showsPlainLines } from "./parsers";
import { RunInput } from "./RunInput";
import { logAsText } from "./run-log";
import { createRunLog } from "./run-log-source";
import {
  agoLabel,
  capitalize,
  clockTime,
  costLabel,
  dayLabel,
  formatBytes,
  formatDuration,
  harnessName,
  isActiveRun,
  plural,
  runDurationMs,
  runPosition,
  runStatusLabel,
  runStatusMeta,
  runUsage,
  shortId,
  supportsProviderTrace,
  tokenCount,
  triggerLabel,
} from "./run-model";
import { RunRawOutput } from "./RunRawOutput";
import { RunTrace } from "./RunTrace";
import { RunTranscript } from "./RunTranscript";
import { traceMetaLine, traceReadable } from "./trace-model";
import { buildItems, stepCount } from "./transcript-model";
import "./RunModal.css";

/*
 * The run modal (boards 16–18): one run, opened from anywhere through `openRunModal(runId)`.
 *
 * - The header names the agent, the task and why the run started, with its status, a Stop button
 *   while it's going, and the task's other runs either side.
 * - Six stats: model, start, duration, tokens, cost, and the session or exit.
 * - Four views: the transcript (live while the run is going), what the agent was sent, the raw
 *   output, and the provider trace (instance admins only, decision 4).
 * - While the run is going, a footer says the transcript is following new output, and holds the
 *   task's queued messages and the composer, to queue, steer or interrupt.
 *
 * The dialog goes through ui/Dialog, so it turns into a full-screen sheet on a phone.
 */

type View = "transcript" | "input" | "raw" | "trace";

export function RunModal() {
  const commands = useCommands();
  return (
    <Dialog
      open={commands.runModal() !== null}
      onOpenChange={(open) => !open && commands.closeRunModal()}
      title={`Run ${commands.runModal()?.slice(0, 8) ?? ""}`}
      titleHidden
      width={1120}
      class="rm"
    >
      <Show when={commands.runModal()}>{(runId) => <RunView runId={runId()} />}</Show>
    </Dialog>
  );
}

function RunView(props: { runId: string }) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const [view, setView] = createSignal<View>("transcript");
  const [showThinking, setShowThinking] = createSignal(true);
  const [showTools, setShowTools] = createSignal(true);
  const [following, setFollowing] = createSignal(true);
  const [now, setNow] = createSignal(new Date());
  let body: HTMLDivElement | undefined;

  const run = createQuery(() => ({
    queryKey: queryKeys.runs.detail(props.runId),
    queryFn: ({ signal }) => runsApi.get(props.runId, signal),
    refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data.status) ? 5_000 : false),
  }));
  const active = () => !!run.data && isActiveRun(run.data.status);
  const agent = () => agents.data?.find((candidate) => candidate.id === run.data?.agentId);
  const issueId = () => run.data?.issueId ?? null;
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(issueId() ?? ""),
    queryFn: ({ signal }) => issuesApi.get(issueId()!, signal),
    enabled: !!issueId(),
  }));
  const queue = useQueuedComments(() => issueId() ?? "", () => active() && !!issueId());
  const taskRuns = createQuery(() => ({
    queryKey: queryKeys.issues.section(issueId() ?? "", "runs"),
    queryFn: ({ signal }) => issuesApi.runs(issueId()!, signal),
    enabled: !!issueId(),
  }));
  const events = createQuery(() => ({
    queryKey: queryKeys.runs.events(props.runId),
    queryFn: () => runsApi.events(props.runId, 0, 200),
    // Until the harness starts, there's nothing about what it was sent.
    refetchInterval: (query) => (active() && !findInvokeEvent(query.state.data) ? 3_000 : false),
  }));
  const settings = createQuery(() => ({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: instanceSettingsApi.general,
    staleTime: 60_000,
  }));
  const access = createQuery(() => ({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: accessApi.currentBoardAccess,
    retry: false,
    staleTime: 60_000,
  }));
  // The old UI's rule: a local board, or an instance admin, can use provider traces.
  const isAdmin = () => access.data?.source === "local_implicit" || access.data?.isInstanceAdmin === true;
  const traceMeta = createQuery(() => ({
    queryKey: queryKeys.runs.providerTraceMetadata(company().id, props.runId),
    queryFn: ({ signal }) => runsApi.providerTraceMetadata(company().id, [props.runId], signal),
    enabled: isAdmin(),
    retry: false,
    refetchInterval: active() ? 5_000 : false,
  }));

  const censorUsername = () => settings.data?.censorUsernameInLogs === true;
  const invocation = createMemo(() => readInvocation(findInvokeEvent(events.data)?.payload, { censorUsername: censorUsername() }));
  const adapterType = () => invocation()?.adapterType ?? agent()?.adapterType ?? null;
  const harness = () => harnessName(adapterType());

  const log = createRunLog(() => props.runId, () => run.data);
  const entries = createMemo(() => buildTranscript(log.chunks(), adapterType(), { censorUsername: censorUsername() }));
  const items = createMemo(() => buildItems(entries(), active()));

  const position = createMemo(() => runPosition(props.runId, taskRuns.data));
  const usage = createMemo(() => (run.data ? runUsage(run.data) : null));
  const trace = () => traceMeta.data?.[0] ?? null;

  // A clock for durations and "last output 2s ago", ticking only while the run is going.
  createEffect(() => {
    if (!active()) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  // Another run starts at the transcript, following.
  createEffect(
    on(
      () => props.runId,
      () => {
        setFollowing(true);
        if (view() === "trace" && !isAdmin()) setView("transcript");
      },
      { defer: true },
    ),
  );

  const stop = createMutation(() => ({
    mutationFn: () => heartbeatsApi.cancel(props.runId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.runs.detail(props.runId) });
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
      if (issueId()) void client.invalidateQueries({ queryKey: queryKeys.issues.section(issueId()!, "runs") });
    },
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't stop the run", body: error.message }),
  }));

  const rerun = createMutation(() => ({
    mutationFn: () => runsApi.rerunWithProviderTrace(run.data!),
    onSuccess: (result) => {
      if ("id" in result) {
        pushToast({ tone: "success", title: "Rerunning with a provider trace" });
        commands.openRunModal(result.id);
      } else {
        pushToast({ tone: "error", title: "The rerun didn't start", body: result.message ?? result.reason });
      }
    },
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't rerun with a trace", body: error.message }),
  }));

  const download = () => {
    const blob = new Blob([logAsText(log.chunks())], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `run-${props.runId}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Following: new output scrolls into view until the reader scrolls up.
  const atBottom = () => !body || body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  const toBottom = () => queueMicrotask(() => body?.scrollTo({ top: body.scrollHeight }));
  createEffect(on(() => [items().length, log.chunks().length, view()], () => following() && (view() === "transcript" || view() === "raw") && toBottom()));
  const onScroll = () => {
    if (!active()) return;
    const bottom = atBottom();
    if (bottom !== following()) setFollowing(bottom);
  };

  const stats = createMemo(() => {
    const current = run.data;
    if (!current) return [];
    const spent = usage();
    const took = runDurationMs(current, now());
    const model = spent?.model ?? (typeof agent()?.adapterConfig?.model === "string" ? (agent()!.adapterConfig.model as string) : null);
    const last = log.lastOutputAt() ?? current.lastOutputAt;
    return [
      { label: "Model", value: model ?? "—", sub: capitalize(harness()) },
      {
        label: "Started",
        value: current.startedAt ? clockTime(current.startedAt) : "Not yet",
        sub: current.startedAt ? dayLabel(current.startedAt, now()) : `Queued ${agoLabel(current.createdAt, now())}`,
      },
      {
        label: "Duration",
        value: took === null ? "—" : formatDuration(took),
        sub: active()
          ? last
            ? `Last output ${agoLabel(last, now())}`
            : "No output yet"
          : current.finishedAt
            ? `Ended ${clockTime(current.finishedAt)}`
            : "",
      },
      {
        label: "Tokens",
        value: spent?.available ? `${tokenCount(spent.input)} in · ${tokenCount(spent.output)} out` : "Not reported",
        sub: spent?.available && spent.cached ? `${tokenCount(spent.cached)} read from cache` : "",
      },
      {
        label: "Cost",
        value: spent?.costUsd === null || spent?.costUsd === undefined ? "Not reported" : costLabel(spent.costUsd),
        sub: spent?.subscription ? "Covered by a subscription" : "",
      },
      active()
        ? {
            label: "Session",
            value: current.sessionIdBefore ? shortId(current.sessionIdBefore) : "New",
            sub: current.sessionIdBefore ? "Resumed" : "Fresh session",
          }
        : {
            label: "Exit",
            value: `${current.exitCode ?? "—"} · ${runStatusMeta(current.status).label.toLowerCase()}`,
            sub: current.sessionIdAfter ? `Session ${shortId(current.sessionIdAfter)}` : current.signal ? `Signal ${current.signal}` : "",
          },
    ];
  });

  const tabs = createMemo(() => {
    const list: { value: View; label: string; note: string }[] = [
      { value: "transcript", label: "Transcript", note: plural(stepCount(items()), "step") },
      { value: "input", label: "Input", note: promptSize(invocation()?.prompt ?? null)?.replace(" characters", " chars") ?? "" },
      { value: "raw", label: "Raw output", note: run.data?.logBytes ? formatBytes(run.data.logBytes) : `${log.chunks().length} lines` },
    ];
    if (isAdmin()) {
      const meta = trace();
      list.push({ value: "trace", label: "Provider trace", note: traceReadable(meta) ? `${meta!.frameCount} frames` : "Off" });
    }
    return list;
  });

  return (
    <div class="rm-shell">
      <Show
        when={run.data}
        fallback={
          <div class="rm-empty">
            <p>{run.isError ? `This run couldn't be loaded: ${(run.error as Error).message}` : "Loading the run…"}</p>
          </div>
        }
      >
        {(current) => {
          const status = () => runStatusMeta(current().status);
          return (
            <>
              <header class="rm-head">
                <span class="rm-av" classList={{ "rm-av--live": status().live }}>
                  <Show when={agent()} fallback={<span class="rm-av-gap" aria-hidden="true" />}>
                    {(found) => <AgentAvatar agent={found()} size={40} />}
                  </Show>
                </span>
                <div class="rm-hmain">
                  <div class="rm-hrow">
                    <p class="rm-title disp" aria-hidden="true">
                      {position().title}
                    </p>
                    <span class="rm-pill" data-tone={status().tone} role="status">
                      <Capsule gradient={status().gradient} size="tiny" live={status().live} />
                      {runStatusLabel(current(), now())}
                    </span>
                  </div>
                  <p class="rm-sub">
                    <b>{agent()?.name ?? "An agent"}</b>
                    <Show when={task.data}>
                      {(found) => (
                        <>
                          {" "}on{" "}
                          <A class="rm-task" href={issuePath(company().issuePrefix, found())} onClick={() => commands.closeRunModal()}>
                            <span class="mono">{found().identifier}</span>
                            <span class="rm-task-title">{found().title}</span>
                          </A>
                        </>
                      )}
                    </Show>
                    <span aria-hidden="true">·</span>
                    <span>
                      {triggerLabel(current())}
                      <Show when={current().startedAt ?? current().createdAt}>{(at) => <> at {clockTime(at()).replace(/:\d\d (am|pm)$/, " $1")}</>}</Show>
                    </span>
                  </p>
                </div>
                <div class="rm-hacts">
                  <Show when={position().position}>{(text) => <span class="rm-pos">{text()}</span>}</Show>
                  <Show when={position().position}>
                    <button
                      type="button"
                      class="btn btn--icon btn--ghost btn--compact"
                      aria-label="Previous run"
                      disabled={!position().previousId}
                      onClick={() => position().previousId && commands.openRunModal(position().previousId!)}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="btn btn--icon btn--ghost btn--compact"
                      aria-label="Next run"
                      disabled={!position().nextId}
                      onClick={() => position().nextId && commands.openRunModal(position().nextId!)}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                    <span class="rm-sep" aria-hidden="true" />
                  </Show>
                  <Show when={active()}>
                    <Button variant="danger" size="compact" disabled={stop.isPending} onClick={() => stop.mutate()}>
                      <Square size={12} aria-hidden="true" />
                      {stop.isPending ? "Stopping…" : "Stop run"}
                    </Button>
                  </Show>
                  <button
                    type="button"
                    class="btn btn--icon btn--ghost btn--compact"
                    aria-label="Download the loaded log"
                    title="Download the loaded log"
                    disabled={log.chunks().length === 0}
                    onClick={download}
                  >
                    <Download size={15} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <dl class="rm-stats">
                <For each={stats()}>
                  {(stat) => (
                    <div>
                      <dt>{stat.label}</dt>
                      <dd class="disp">{stat.value}</dd>
                      <Show when={stat.sub}>
                        <span class="rm-ss">{stat.sub}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </dl>
              <Show when={current().error}>
                {(error) => (
                  <p class="rm-alert" data-tone={status().tone === "red" ? "red" : "amber"}>
                    {error()}
                    <Show when={current().errorCode}>{(code) => <span class="mono"> · {code()}</span>}</Show>
                  </p>
                )}
              </Show>

              <Tabs class="rm-tabs-root" value={view()} onChange={(value) => setView(value as View)}>
                <div class="rm-bar">
                  <Tabs.List class="rm-tabs" aria-label="Run details">
                    <For each={tabs()}>
                      {(tab) => (
                        <Tabs.Trigger class="rm-tab" value={tab.value}>
                          {tab.label}
                          <Show when={tab.note}>
                            <span class="rm-tabn">{tab.note}</span>
                          </Show>
                        </Tabs.Trigger>
                      )}
                    </For>
                  </Tabs.List>
                  <Show when={view() === "transcript"}>
                    <div class="rm-tools" role="group" aria-label="Show in the transcript">
                      <span class="rm-lbl">Show</span>
                      <button type="button" class="rm-chip" aria-pressed={showThinking()} onClick={() => setShowThinking(!showThinking())}>
                        <span class="rm-chk" aria-hidden="true" />
                        Thinking
                      </button>
                      <button type="button" class="rm-chip" aria-pressed={showTools()} onClick={() => setShowTools(!showTools())}>
                        <span class="rm-chk" aria-hidden="true" />
                        Tool calls
                      </button>
                    </div>
                  </Show>
                </div>
                <div class="rm-body" ref={body} onScroll={onScroll}>
                  <Tabs.Content value="transcript">
                    <RunTranscript
                      run={current()}
                      items={items()}
                      invocation={invocation()}
                      agentName={agent()?.name ?? "Agent"}
                      harness={harness()}
                      live={active()}
                      showThinking={showThinking()}
                      showTools={showTools()}
                      loading={log.loading()}
                      error={log.error()}
                      skippedBytes={log.skippedBytes()}
                      plainLines={showsPlainLines(adapterType(), current().runtimeMode)}
                      onRetry={log.retry}
                      onShowInput={() => setView("input")}
                    />
                  </Tabs.Content>
                  <Tabs.Content value="input">
                    <RunInput
                      run={current()}
                      invocation={invocation()}
                      loading={events.isPending}
                      harness={harness()}
                      isAdmin={isAdmin()}
                      onShowTrace={() => setView("trace")}
                    />
                  </Tabs.Content>
                  <Tabs.Content value="raw">
                    <RunRawOutput chunks={log.chunks()} live={active()} loading={log.loading()} skippedBytes={log.skippedBytes()} logBytes={current().logBytes} onDownload={download} />
                  </Tabs.Content>
                  <Show when={isAdmin()}>
                    <Tabs.Content value="trace">
                      <RunTrace
                        run={current()}
                        trace={trace()}
                        checking={traceMeta.isPending}
                        harness={harness()}
                        agentName={agent()?.name ?? "this agent"}
                        open={view() === "trace"}
                        canRerun={!active() && supportsProviderTrace(adapterType(), agent()?.adapterConfig)}
                        rerunning={rerun.isPending}
                        onRerun={() => rerun.mutate()}
                        metaLine={trace() ? traceMetaLine(trace()!) : ""}
                      />
                    </Tabs.Content>
                  </Show>
                </div>
              </Tabs>

              <Show when={active()}>
                {/*
                  The live footer: what the transcript is doing, the task's queued messages, and
                  the composer, sending into this task's run (queue, steer now, or interrupt).
                */}
                <footer class="rm-foot">
                  <div class="rm-foot-status" role="status">
                    <span class="rm-pulse" aria-hidden="true" />
                    <span>
                      <b>Live</b>
                      <span class="rm-foot-meta">
                        {" "}· {following() ? "following new output" : "paused"}
                        <Show when={log.lastOutputAt()}>{(at) => <> · last output {agoLabel(at(), now())}</>}</Show>
                      </span>
                    </span>
                    <Show when={task.data}>
                      {(found) => <span class="rm-foot-hint">Messages go to {found().identifier ?? "the task"}</span>}
                    </Show>
                    <Button
                      size="compact"
                      class="rm-foot-follow"
                      onClick={() => {
                        const next = !following();
                        setFollowing(next);
                        if (next) toBottom();
                      }}
                    >
                      {following() ? "Pause following" : "Follow"}
                    </Button>
                  </div>
                  <Show when={task.data}>
                    {(found) => (
                      <>
                        <Show when={queue.data}>{(current) => <QueuedMessages taskId={found().id} queue={current()} />}</Show>
                        <Composer task={found()} liveRunId={props.runId} compact />
                      </>
                    )}
                  </Show>
                </footer>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
