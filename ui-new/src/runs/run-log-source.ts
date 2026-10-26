import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import { ApiError } from "@/api/client";
import { runsApi, type RunDetail } from "@/api/runs";
import { useLiveConnection, useLiveEvent } from "@/lib/live-events";
import { mergeChunks, parseLogSlice, readSeq, readStream, utf8Length, type RunLogChunk } from "./run-log";
import { isActiveRun } from "./run-model";

/*
 * A run's output for the run modal: the stored log read by byte offset, plus `heartbeat.run.log`
 * events from the live-events socket while the run is going. As in the old UI
 * (ui/src/components/transcript/useLiveRunTranscripts.ts), the socket is the live source and the
 * log is polled as a safety net: every 2s while the socket is down, every 15s while it's up. A run
 * whose log is larger than the budget starts at its tail and says how much it skipped.
 */

const PAGE_BYTES = 256_000;
/** How much of a stored log the modal reads at most; older output is skipped. */
export const LOG_BUDGET_BYTES = 4_000_000;
const SOCKET_FLUSH_MS = 200;

export type RunLogSource = {
  chunks: () => readonly RunLogChunk[];
  /** True until the first read finishes. */
  loading: () => boolean;
  error: () => string | null;
  /** Bytes at the start of the log that weren't loaded. */
  skippedBytes: () => number;
  /** When the last output arrived, from the socket or a read. */
  lastOutputAt: () => string | null;
  retry: () => void;
};

export function createRunLog(runId: () => string, run: () => RunDetail | undefined): RunLogSource {
  const connection = useLiveConnection();
  const [chunks, setChunks] = createSignal<readonly RunLogChunk[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [skippedBytes, setSkippedBytes] = createSignal(0);
  const [lastOutputAt, setLastOutputAt] = createSignal<string | null>(null);

  // Per-run read state. A new run id starts over; `generation` drops answers for the previous one.
  let generation = 0;
  let offset: number | null = null;
  let carried = "";
  let reading = false;
  let controller: AbortController | null = null;

  const add = (incoming: RunLogChunk[]) => {
    if (incoming.length === 0) return;
    setChunks((previous) => mergeChunks(previous, incoming));
    setLastOutputAt(incoming[incoming.length - 1]!.ts);
  };

  let again = false;
  const read = async (): Promise<void> => {
    const current = untrack(run);
    if (!current) return;
    if (reading) {
      // Read again when this one finishes, so output written meanwhile isn't missed.
      again = true;
      return;
    }
    const mine = generation;
    reading = true;
    controller = new AbortController();
    try {
      if (offset === null) {
        const known = current.logBytes ?? current.lastOutputBytes ?? 0;
        offset = known > LOG_BUDGET_BYTES ? known - LOG_BUDGET_BYTES : 0;
        setSkippedBytes(offset);
      }
      for (let page = 0; page < LOG_BUDGET_BYTES / PAGE_BYTES; page += 1) {
        const slice = await runsApi.log(current.id, offset, PAGE_BYTES, { signal: controller.signal });
        if (mine !== generation) return;
        const parsed = parseLogSlice(slice.content, carried);
        carried = parsed.rest;
        add(parsed.chunks);
        if (slice.nextOffset === undefined) {
          offset += utf8Length(slice.content);
          break;
        }
        offset = slice.nextOffset;
      }
      setError(null);
    } catch (caught) {
      if (mine !== generation || (caught instanceof DOMException && caught.name === "AbortError")) return;
      // A run that hasn't written output yet has no log.
      if (caught instanceof ApiError && caught.status === 404) setError(null);
      else setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mine === generation) {
        reading = false;
        setLoading(false);
        if (again) {
          again = false;
          void read();
        }
      }
    }
  };

  // Start over for each run, once its detail has loaded (the log's size sets where reading starts).
  createEffect(
    on(runId, () => {
      generation += 1;
      controller?.abort();
      offset = null;
      carried = "";
      reading = false;
      again = false;
      setChunks([]);
      setLoading(true);
      setError(null);
      setSkippedBytes(0);
      setLastOutputAt(null);
    }),
  );
  const readyRunId = createMemo(() => (run()?.id === runId() ? runId() : null));
  createEffect(on(readyRunId, (ready) => ready && void read()));

  // Poll while the run is going, and read once more when it ends to pick up the last output.
  // Memos, so the poll is re-armed only when these change, not on every refetch of the run.
  const active = createMemo(() => {
    const current = run();
    return !!current && current.id === runId() && isActiveRun(current.status);
  });
  const socketOpen = createMemo(() => connection() === "open");
  createEffect(
    on(
      [active, socketOpen],
      ([isActive, socketOpen], previous) => {
        if (!isActive) {
          if (previous?.[0]) void read();
          return;
        }
        const interval = window.setInterval(() => void read(), socketOpen ? 15_000 : 2_000);
        onCleanup(() => window.clearInterval(interval));
      },
    ),
  );

  // Live output, batched so a fast stream rebuilds the transcript a few times a second at most.
  let pending: RunLogChunk[] = [];
  let flushTimer: number | undefined;
  createEffect(
    on(runId, () => {
      pending = [];
    }),
  );
  const flush = () => {
    flushTimer = undefined;
    const batch = pending;
    pending = [];
    add(batch);
  };
  useLiveEvent(["heartbeat.run.log"], (event) => {
    const payload = event.payload ?? {};
    if (payload.runId !== untrack(runId) || typeof payload.chunk !== "string" || !payload.chunk) return;
    const seq = readSeq(payload.seq);
    pending.push({
      ts: typeof payload.ts === "string" ? payload.ts : event.createdAt,
      stream: readStream(payload.stream),
      chunk: payload.chunk,
      ...(seq === undefined ? {} : { seq }),
    });
    flushTimer ??= window.setTimeout(flush, SOCKET_FLUSH_MS);
  });
  onCleanup(() => {
    generation += 1;
    controller?.abort();
    window.clearTimeout(flushTimer);
  });

  return {
    chunks,
    loading,
    error,
    skippedBytes,
    lastOutputAt,
    retry: () => {
      setError(null);
      void read();
    },
  };
}
