import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { FoldVertical, LoaderCircle } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { issueContextApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery } from "@/lib/company-data";
import { describeError } from "@/lib/offline/errors";
import { agoLabel } from "@/runs/run-model";
import { Button } from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import {
  ACTIVE_REFRESH_MS,
  compactState,
  contextLevel,
  contextPercent,
  contextRows,
  formatTokens,
  levelNote,
  type ContextLevel,
} from "./context-usage";
import "./TaskContext.css";

/*
 * The Context row in a task's Properties (`tasks/properties`, since the 2026-11-07 sync, upstream
 * #19273, #19378, #19801): a small bar and "10% of 258k" for the assignee session's context window.
 * A tap, a click or hovering opens the breakdown (tokens, cost, compactions) and Compact now, which
 * queues a short run that summarizes the agent's conversation and does no task work. The row is
 * left out until a harness has reported a window. Agent Chat shows the same value in its Activity
 * column, since a chat can be compacted while it waits for you.
 *
 * The reading refreshes every 8 s while a run on the task is going (or a compaction is pending), once
 * more when the run ends, and when the task's status changes (Compact now needs an open task).
 */

/** The reading's query, shared by the row and the thread's compaction dividers. */
export function contextUsageQuery(taskId: string, assigneeId: string | null | undefined) {
  return {
    queryKey: queryKeys.issues.section(taskId, "context-usage", assigneeId ?? "none"),
    queryFn: ({ signal }: { signal: AbortSignal }) => issueContextApi.usage(taskId, signal),
  };
}

export type TaskContext = ReturnType<typeof useTaskContext>;

export function useTaskContext(taskId: () => string, assigneeId: () => string | null | undefined, status?: () => string | undefined) {
  const company = useCompany();
  const client = useQueryClient();
  const liveRuns = useLiveRunsQuery();
  const active = createMemo(() => (liveRuns.data ?? []).some((run) => run.issueId === taskId()));
  const [pending, setPending] = createSignal(false);
  const query = createQuery(() => {
    const polling = active() || pending();
    return {
      ...contextUsageQuery(taskId(), assigneeId()),
      refetchInterval: polling ? ACTIVE_REFRESH_MS : (false as const),
      staleTime: polling ? 0 : 60_000,
    };
  });
  createEffect(() => setPending(query.data?.compaction?.status === "pending"));
  // The final measurement once the run settles; and Compact now's state once the status changes.
  createEffect(on(active, (now, before) => before && !now && void query.refetch(), { defer: true }));
  createEffect(on(() => status?.(), (now, before) => before !== undefined && now !== before && void query.refetch(), { defer: true }));

  const compact = createMutation(() => ({
    mutationFn: () => issueContextApi.compact(taskId()),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) }),
        client.invalidateQueries({ queryKey: queryKeys.issues.section(taskId(), "context-usage") }),
      ]),
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't compact the context", body: describeError(error, "Try again in a moment.") }),
  }));

  return {
    usage: () => query.data ?? null,
    /** A first load that failed; a failed refresh keeps the reading it has. */
    error: () => (query.data === undefined && query.isError ? (query.error as Error) : null),
    retry: () => void query.refetch(),
    retrying: () => query.isFetching,
    /** Whether the row shows: a reading, or a first load that failed. */
    visible: () => !!query.data || (query.data === undefined && query.isError),
    requesting: () => compact.isPending,
    compact: () => compact.mutate(),
  };
}

function Bar(props: { percent: number; level: ContextLevel; wide?: boolean }) {
  return (
    <span class="ctx-bar" classList={{ "ctx-bar--wide": props.wide }} data-level={props.level} aria-hidden="true">
      <span style={{ width: `${props.percent}%` }} />
    </span>
  );
}

/** Opens on hover with a mouse, after a short wait; leaving closes it unless it was clicked open. */
const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 200;

/** The row's value: the bar and label, opening the breakdown and Compact now. */
export function ContextUsageValue(props: { context: TaskContext }) {
  const [open, setOpen] = createSignal(false);
  const [byHover, setByHover] = createSignal(false);
  let timer: number | undefined;
  let pressed = false;
  const clear = () => window.clearTimeout(timer);
  onCleanup(clear);
  const hoverOpen = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || open()) return clear();
    clear();
    timer = window.setTimeout(() => {
      setByHover(true);
      setOpen(true);
    }, HOVER_OPEN_MS);
  };
  const hoverClose = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clear();
    if (byHover()) timer = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };
  const changed = (next: boolean) => {
    clear();
    // A click on a card hovering open keeps it open, now as if clicked.
    if (!next && pressed && byHover()) {
      pressed = false;
      setByHover(false);
      return;
    }
    pressed = false;
    if (!next) setByHover(false);
    setOpen(next);
  };

  return (
    <Show when={props.context.usage()} fallback={<ContextError context={props.context} />}>
      {(usage) => {
        const level = () => contextLevel(usage());
        return (
          <Popover open={open()} onOpenChange={changed}>
            <Popover.Trigger
              class="ctx-trigger"
              data-level={level()}
              aria-label={`Context window: ${contextPercent(usage())}% of ${formatTokens(usage().windowTokens)} tokens used. Show the breakdown`}
              onPointerDown={() => (pressed = true)}
              onPointerEnter={hoverOpen}
              onPointerLeave={hoverClose}
            >
              <Bar percent={contextPercent(usage())} level={level()} />
              <span class="ctx-label">
                {contextPercent(usage())}%<span class="ctx-muted"> of {formatTokens(usage().windowTokens)}</span>
              </span>
            </Popover.Trigger>
            <Popover.Content
              title="Context window"
              width={300}
              onOpenAutoFocus={(event) => byHover() && event.preventDefault()}
            >
              <div class="ctx-card" onPointerEnter={(event) => event.pointerType === "mouse" && clear()} onPointerLeave={hoverClose}>
                <ContextCard context={props.context} />
              </div>
            </Popover.Content>
          </Popover>
        );
      }}
    </Show>
  );
}

/** The breakdown, with Compact now when the server says what it can do. */
export function ContextCard(props: { context: TaskContext }) {
  return (
    <Show when={props.context.usage()}>
      {(usage) => {
        const level = () => contextLevel(usage());
        const state = () => compactState(usage().compaction, props.context.requesting());
        return (
          <>
            <div class="ctx-head">
              <span class="ctx-tokens">
                {formatTokens(usage().usedTokens)} of {formatTokens(usage().windowTokens)} tokens
                <span class="ctx-muted"> · updated {agoLabel(usage().observedAt)}</span>
              </span>
              <span class="ctx-percent" data-level={level()}>
                {contextPercent(usage())}%
              </span>
            </div>
            <Bar percent={contextPercent(usage())} level={level()} wide />
            <Show when={levelNote(level())}>
              {(note) => (
                <p class="ctx-note" data-level={level()}>
                  {note()}
                </p>
              )}
            </Show>
            <Show when={contextRows(usage()).length > 0}>
              <dl class="ctx-rows">
                <For each={contextRows(usage())}>
                  {(row) => (
                    <div>
                      <dt>{row.label}</dt>
                      <dd classList={{ "ctx-muted": row.muted }}>{row.value}</dd>
                    </div>
                  )}
                </For>
              </dl>
            </Show>
            <Show when={state()}>
              {(compact) => (
                <div class="ctx-compact">
                  <Button
                    size="compact"
                    variant={level() === "normal" ? "secondary" : "primary"}
                    disabled={compact().status !== "available"}
                    icon={
                      compact().status === "pending" ? (
                        <LoaderCircle size={14} class="ctx-spin" aria-hidden="true" />
                      ) : (
                        <FoldVertical size={14} aria-hidden="true" />
                      )
                    }
                    onClick={() => compact().status === "available" && props.context.compact()}
                  >
                    {compact().status === "pending" ? "Compacting…" : "Compact now"}
                  </Button>
                  <p class="ctx-muted" role={compact().status === "unavailable" ? "note" : undefined}>
                    {compact().note}
                  </p>
                </div>
              )}
            </Show>
          </>
        );
      }}
    </Show>
  );
}

/**
 * The chat's context window in its Activity column, under a section title, once there's a reading.
 * Compact now works while the chat waits for you (#19801); the server allows it to the chat's owner.
 */
export function ChatContextSection(props: { chatId: string; agentId: string }) {
  const context = useTaskContext(() => props.chatId, () => props.agentId);
  return (
    <Show when={context.usage()}>
      <section class="ch-side-sec ctx-chat" aria-labelledby={`ctx-chat-${props.chatId}`}>
        <h3 class="disp" id={`ctx-chat-${props.chatId}`}>
          Context
        </h3>
        <ContextUsageValue context={context} />
      </section>
    </Show>
  );
}

function ContextError(props: { context: TaskContext }) {
  return (
    <Show when={props.context.error()}>
      {(error) => (
        <span class="ctx-error">
          <span class="ctx-muted">Couldn't load the context window: {describeError(error())}</span>
          <button type="button" class="ctx-retry" disabled={props.context.retrying()} onClick={() => props.context.retry()}>
            Retry
          </button>
        </span>
      )}
    </Show>
  );
}
