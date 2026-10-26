import type { ProviderTraceMetadata } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Copy, Download, Eye, RotateCcw, Trash2, Waypoints } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { runsApi, type RunDetail } from "@/api/runs";
import { useCompany } from "@/lib/company";
import { pushToast } from "@/ui/Toast";
import { clockTime, dayLabel, isActiveRun } from "./run-model";
import { decodeFrame, traceReadable, traceRows } from "./trace-model";
import "./RunTrace.css";

/*
 * The Provider trace view (board 16, `view` = trace; decision 4). Only instance admins get this tab.
 * A trace records every raw request and response between the harness and the model provider. It
 * opens only when the tab does, because the server logs each view; bodies stay withheld until an
 * admin reveals a frame, which is logged too. Without a trace, the view offers a rerun with one.
 */

const FRAME_PAGE = 50;

export function RunTrace(props: {
  run: RunDetail;
  trace: ProviderTraceMetadata | null;
  checking: boolean;
  harness: string;
  agentName: string;
  /** Whether the tab is showing; the trace is fetched only then. */
  open: boolean;
  canRerun: boolean;
  rerunning: boolean;
  onRerun: () => void;
  metaLine: string;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const [selected, setSelected] = createSignal<number | null>(null);
  const [revealed, setRevealed] = createSignal<Record<number, string>>({});
  const [limit, setLimit] = createSignal(FRAME_PAGE);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  createEffect(
    on(
      () => props.run.id,
      () => {
        setSelected(null);
        setRevealed({});
        setLimit(FRAME_PAGE);
        setConfirmDelete(false);
      },
      { defer: true },
    ),
  );

  const inspection = createQuery(() => ({
    queryKey: queryKeys.runs.providerTrace(props.run.id),
    queryFn: ({ signal }) => runsApi.providerTrace(props.run.id, signal),
    enabled: props.open && traceReadable(props.trace),
    retry: false,
    staleTime: 30_000,
  }));
  const rows = createMemo(() => traceRows(inspection.data?.entries ?? []));
  const current = createMemo(() => rows().find((row) => row.frameId === selected()) ?? rows()[0] ?? null);

  const reveal = createMutation(() => ({
    mutationFn: (frameId: number) => runsApi.revealProviderTraceFrame(props.run.id, frameId),
    onSuccess: (frame) => setRevealed({ ...revealed(), [frame.frameId]: decodeFrame(frame.rawBase64) }),
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't reveal the frame", body: error.message }),
  }));
  const remove = createMutation(() => ({
    mutationFn: () => runsApi.deleteProviderTrace(props.run.id),
    onSuccess: () => {
      setConfirmDelete(false);
      pushToast({ tone: "success", title: "Deleted the provider trace" });
      void client.invalidateQueries({ queryKey: queryKeys.runs.providerTraceMetadata(company().id, props.run.id) });
      client.removeQueries({ queryKey: queryKeys.runs.providerTrace(props.run.id) });
    },
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't delete the trace", body: error.message }),
  }));
  const download = async () => {
    try {
      const blob = await runsApi.downloadProviderTrace(props.run.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `provider-trace-${props.run.id}.ndjson`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't download the trace", body: error instanceof Error ? error.message : String(error) });
    }
  };

  const frameText = () => {
    const row = current();
    if (!row) return "";
    return revealed()[row.frameId] ?? JSON.stringify(row.parsed, null, 2) ?? "";
  };

  return (
    <Show
      when={traceReadable(props.trace)}
      fallback={
        <div class="rm-empty">
          <Waypoints size={22} aria-hidden="true" />
          <h3 class="disp">{props.checking ? "Checking for a trace…" : props.trace ? "This run's trace is gone" : "No provider trace for this run"}</h3>
          <Show when={!props.checking}>
            <p>
              {props.trace
                ? `It was ${props.trace.status === "deleted" ? "deleted" : "removed after 24 hours"}. `
                : ""}
              A provider trace records every raw request and response between {props.harness} and the model provider, including the full
              system prompt, tool definitions and message history. Only instance admins can see traces, and each is deleted after 24 hours.
            </p>
            <div class="rt-actions">
              <button type="button" class="rm-b" disabled={!props.canRerun || props.rerunning} onClick={() => props.onRerun()}>
                <RotateCcw size={13} aria-hidden="true" />
                {props.rerunning ? "Starting…" : "Rerun with trace"}
              </button>
            </div>
            <span class="cap">
              {isActiveRun(props.run.status)
                ? "You can rerun with a trace once this run ends. "
                : props.canRerun
                  ? ""
                  : "This harness can't record a provider trace. "}
              To trace every run of {props.agentName}, turn on "Capture raw provider traces" under Debugging in the agent's settings.
            </span>
          </Show>
        </div>
      }
    >
      <div class="rx">
        <div class="rx-head">
          <h3 class="disp">Provider trace</h3>
          <span class="cap">
            {props.metaLine}
            <Show when={props.trace?.expiresAt}>
              {(expires) => (
                <>
                  {" "}· deleted {dayLabel(expires()).toLowerCase()} at {clockTime(expires()).replace(/:\d\d (am|pm)$/, " $1")}
                </>
              )}
            </Show>
          </span>
          <span class="rx-actions">
            <button type="button" class="rm-b" onClick={() => void download()}>
              <Download size={13} aria-hidden="true" />
              Download
            </button>
            <Show
              when={confirmDelete()}
              fallback={
                <button type="button" class="rm-b rm-b--warn" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} aria-hidden="true" />
                  Delete trace
                </button>
              }
            >
              <button type="button" class="rm-b rm-b--warn" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? "Deleting…" : "Delete for good"}
              </button>
              <button type="button" class="rm-b" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </Show>
          </span>
        </div>

        <Show when={inspection.isPending}>
          <p class="cap">Loading the trace…</p>
        </Show>
        <Show when={inspection.isError}>
          <p class="rm-note rm-note--error">The trace couldn't be loaded: {(inspection.error as Error)?.message}</p>
        </Show>
        <Show when={rows().length > 0}>
          <div class="rx-table-wrap">
            <table class="rx-table">
              <thead>
                <tr>
                  <th class="rx-num">#</th>
                  <th>Direction</th>
                  <th>Time</th>
                  <th>Frame</th>
                  <th class="rx-num">Size</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows().slice(0, limit())}>
                  {(row) => (
                    <tr classList={{ "rx-on": current()?.frameId === row.frameId }}>
                      <td class="rx-num">{row.frameId}</td>
                      <td>
                        {row.direction === "request" ? "→ request" : row.direction === "response" ? "← response" : "stderr"}
                      </td>
                      <td class="mono">{row.time ? clockTime(row.time) : ""}</td>
                      <td class="rx-frame">
                        <button type="button" aria-pressed={current()?.frameId === row.frameId} onClick={() => setSelected(row.frameId)}>
                          {row.summary}
                        </button>
                      </td>
                      <td class="rx-num">{row.size}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <Show when={rows().length > limit()}>
            <button type="button" class="rt-fold" onClick={() => setLimit(limit() + FRAME_PAGE)}>
              Show {Math.min(FRAME_PAGE, rows().length - limit())} more frames ({rows().length - limit()} left)
            </button>
          </Show>
        </Show>

        <Show when={current()}>
          {(row) => (
            <section class="rx-frame-detail" aria-labelledby="rx-frame-h">
              <div class="rx-head">
                <h3 class="disp" id="rx-frame-h">
                  Frame {row().frameId} · {row().direction}
                </h3>
                <span class="cap">
                  {row().size}
                  {revealed()[row().frameId] ? " · exact bytes" : row().withheld.length > 0 ? ` · ${row().withheld.length} parts withheld` : ""}
                </span>
                <span class="rx-actions">
                  <Show when={row().exactAvailable && !revealed()[row().frameId]}>
                    <button type="button" class="rm-b" disabled={reveal.isPending} onClick={() => reveal.mutate(row().frameId)}>
                      <Eye size={13} aria-hidden="true" />
                      {reveal.isPending ? "Revealing…" : "Reveal bodies"}
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="rm-b"
                    onClick={() =>
                      void navigator.clipboard.writeText(frameText()).then(
                        () => pushToast({ tone: "success", title: "Copied the frame" }),
                        () => pushToast({ tone: "error", title: "Couldn't copy the frame" }),
                      )
                    }
                  >
                    <Copy size={13} aria-hidden="true" />
                    Copy
                  </button>
                </span>
              </div>
              <pre class="rm-pre rx-pre">{frameText()}</pre>
            </section>
          )}
        </Show>
        <span class="cap">
          Only instance admins see this tab. Message bodies stay hidden until you reveal a frame, and each view and reveal is logged.
        </span>
      </div>
    </Show>
  );
}
