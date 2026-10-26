import { Download } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { formatBytes } from "./run-model";
import { streamCounts, type RunLogChunk, type RunLogStream } from "./run-log";
import "./RunRawOutput.css";

/*
 * The Raw output view (board 16, `view` = raw): every record of the run's output as the harness
 * wrote it, with its time and stream. Streams can be hidden, long lines wrapped, and the loaded
 * output downloaded. Only the newest lines render at first; earlier ones load on request.
 */

const PAGE = 1500;
const STREAMS: RunLogStream[] = ["stdout", "stderr", "system"];

function clock(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function RunRawOutput(props: {
  chunks: readonly RunLogChunk[];
  live: boolean;
  loading: boolean;
  skippedBytes: number;
  logBytes: number | null;
  onDownload: () => void;
}) {
  const [hidden, setHidden] = createSignal<ReadonlySet<RunLogStream>>(new Set());
  const [wrap, setWrap] = createSignal(true);
  const [limit, setLimit] = createSignal(PAGE);
  const counts = createMemo(() => streamCounts(props.chunks));
  const filtered = createMemo(() => props.chunks.filter((chunk) => !hidden().has(chunk.stream)));
  const lines = createMemo(() => filtered().slice(Math.max(0, filtered().length - limit())));
  const earlier = () => filtered().length - lines().length;

  const toggle = (stream: RunLogStream) => {
    const next = new Set(hidden());
    if (next.has(stream)) next.delete(stream);
    else next.add(stream);
    setHidden(next);
  };

  return (
    <div class="rr">
      <div class="rr-bar">
        <div class="rr-chips" role="group" aria-label="Streams">
          <For each={STREAMS}>
            {(stream) => (
              <button type="button" class="rm-chip" aria-pressed={!hidden().has(stream)} onClick={() => toggle(stream)}>
                <span class="rm-chk" aria-hidden="true" />
                {stream}
                <span class="rr-n">{counts()[stream].toLocaleString()}</span>
              </button>
            )}
          </For>
        </div>
        <span class="cap">
          {props.chunks.length.toLocaleString()} records loaded
          <Show when={props.logBytes}>{(bytes) => <> · full log {formatBytes(bytes())}</>}</Show>
          <Show when={props.skippedBytes > 0}> · the first {formatBytes(props.skippedBytes)} skipped</Show>
        </span>
        <span class="rr-actions">
          <button type="button" class="rm-b" aria-pressed={wrap()} onClick={() => setWrap(!wrap())}>
            Wrap lines
          </button>
          <button type="button" class="rm-b" disabled={props.chunks.length === 0} onClick={() => props.onDownload()}>
            <Download size={13} aria-hidden="true" />
            Download log
          </button>
        </span>
      </div>
      <Show when={earlier() > 0}>
        <button type="button" class="rt-fold rr-more" onClick={() => setLimit(limit() + PAGE)}>
          Show {Math.min(PAGE, earlier()).toLocaleString()} earlier lines ({earlier().toLocaleString()} hidden)
        </button>
      </Show>
      <Show
        when={lines().length > 0}
        fallback={<p class="cap rr-empty">{props.loading ? "Loading the output…" : props.live ? "No output yet." : "This run left no output."}</p>}
      >
        <div class="rr-log" classList={{ "rr-log--nowrap": !wrap() }} role="log" aria-label="Raw output">
          <For each={lines()}>
            {(chunk) => (
              <div data-stream={chunk.stream}>
                <span class="rr-t">{clock(chunk.ts)}</span>
                <span class="rr-s">{chunk.stream}</span>
                <code>{chunk.chunk.replace(/\r?\n$/, "")}</code>
              </div>
            )}
          </For>
          <Show when={props.live}>
            <div>
              <span class="rr-t" />
              <span class="rr-s" />
              <code>
                <span class="rt-caret" aria-hidden="true">
                  ▍
                </span>
              </code>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
