import type { ToolCallProgressSnapshot } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, on, Show, untrack, type Accessor } from "solid-js";
import type { LiveRun } from "@/api/heartbeats";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useNow } from "@/lib/clock";
import { useLiveEvent, useRunInterest } from "@/lib/live-events";
import { useLiveRunStatus } from "./LiveRunStatus";
import { latestProgress, pickProgress, ProgressEntries, progressView, readProgress } from "./tool-call-progress";
import "./ToolCallProgress.css";

/*
 * A long connected-app tool call's live progress (U154, upstream #21449): a bar that fills when the
 * app knows the total (a quiet sweep when it doesn't), the app's latest status line, the percent and
 * the time so far. The wording and the checks are in tool-call-progress.ts.
 *
 * - The task thread's live run line (TaskActivity.tsx) shows it under "Using <tool>" while the run
 *   has a tool in use. Only then does it hold the run (`useRunInterest`), as progress events reach
 *   only clients holding their run.
 * - The agent chat's live reply (chat/LiveReply.tsx) shows it under the running step; the reply
 *   already holds its run.
 */

/**
 * The run's tool calls' progress while `wanted` (a tool is running): from the live events, and the
 * task's saved progress read when a tool starts and when the tab comes back (live events aren't
 * handled while it's hidden). Once no tool is running, the running calls are forgotten.
 */
export function useToolCallProgress(options: { runId: Accessor<string>; issueId: Accessor<string | null | undefined>; wanted: Accessor<boolean> }) {
  let entries = new ProgressEntries();
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion((value) => value + 1);
  createEffect(
    on(
      options.runId,
      () => {
        entries = new ProgressEntries();
        bump();
      },
      { defer: true },
    ),
  );
  createEffect(
    on(options.wanted, (wanted) => {
      if (!wanted && entries.clear()) bump();
    }),
  );
  useLiveEvent(["heartbeat.run.tool_progress"], (event) => {
    const payload = event.payload ?? {};
    if (payload.runId !== untrack(options.runId)) return;
    const issueId = untrack(options.issueId);
    if (issueId && typeof payload.issueId === "string" && payload.issueId !== issueId) return;
    const snapshot = readProgress(payload);
    if (snapshot && entries.put(snapshot)) bump();
  });
  const saved = createQuery(() => ({
    queryKey: queryKeys.toolCallProgress(options.issueId() ?? ""),
    queryFn: ({ signal }) => issuesApi.toolCallProgress(options.issueId()!, signal),
    enabled: options.wanted() && !!options.issueId(),
    staleTime: 0,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: true,
    retry: false,
  }));
  createEffect(() => {
    if (!options.wanted()) return;
    const rows = saved.data;
    if (!rows) return;
    untrack(() => {
      const runId = options.runId();
      let changed = false;
      for (const row of rows) {
        const snapshot = readProgress(row as unknown as Record<string, unknown>);
        if (snapshot && snapshot.runId === runId) changed = entries.put(snapshot) || changed;
      }
      if (changed) bump();
    });
  });
  return createMemo(() => {
    version();
    return [...entries.values()];
  });
}

/** The progress line itself. Its message is the app's text, shown as text only. */
export function ToolProgressLine(props: { progress: ToolCallProgressSnapshot; class?: string }) {
  const now = useNow(() => true);
  const view = createMemo(() => progressView(props.progress, now()));
  return (
    <div class={props.class ? `tcp ${props.class}` : "tcp"} data-testid="tool-progress">
      <div
        class="tcp-bar"
        role="progressbar"
        aria-label={view().message ?? "Working"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view().percent ?? undefined}
      >
        <Show when={view().percent !== null} fallback={<span class="tcp-fill tcp-fill--sweep" />}>
          <span class="tcp-fill" style={{ width: `${view().percent}%` }} />
        </Show>
      </div>
      <div class="tcp-meta">
        <span class="tcp-message" title={view().message ?? undefined}>
          {view().message}
        </span>
        <Show when={view().percent !== null}>
          <span>{view().percent}%</span>
        </Show>
        <span>{view().elapsed}</span>
      </div>
    </div>
  );
}

/** Under the task thread's live run line: the progress of the tool the run is using now. */
export function RunToolProgress(props: { taskId: string; run: LiveRun }) {
  const status = useLiveRunStatus(
    () => props.run.id,
    () => props.run,
  );
  const tool = () => status()?.toolName ?? null;
  useRunInterest(() => (tool() ? [props.run.id] : []));
  const entries = useToolCallProgress({ runId: () => props.run.id, issueId: () => props.taskId, wanted: () => !!tool() });
  // The status names the tool as the runner does; when no call matches it, the run's latest call.
  const progress = createMemo(() => {
    const name = tool();
    if (!name) return null;
    return pickProgress(entries(), { names: [name] }, props.run.id) ?? latestProgress(entries(), props.run.id);
  });
  return <Show when={progress()}>{(found) => <ToolProgressLine progress={found()} class="tcp--row" />}</Show>;
}
