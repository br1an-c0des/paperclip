import { createEffect, createMemo, createSignal, on, Show, untrack } from "solid-js";
import type { LiveRunStatus } from "@/api/heartbeats";
import { useNow } from "@/lib/clock";
import { useLiveEvent } from "@/lib/live-events";
import { applyRunEvent, liveStatusLine, mergeStatus, snapshotOfRun, type RunStatusSnapshot } from "./live-run-status";
import "./LiveRunStatus.css";

/*
 * The quiet line under a live run that says what it's doing (U107, upstream #20460): on the task's
 * live run line (TaskActivity.tsx) and in the agent chat's live reply (chat/LiveReply.tsx). The
 * wording is in live-run-status.ts. It isn't a live region: it changes every second.
 */

type StatusFields = { [K in keyof LiveRunStatus]?: unknown };

const SIGNALS = ["heartbeat.run.progress", "heartbeat.run.event", "heartbeat.run.log", "heartbeat.run.activity"] as const;

/** The run's status: what its read carries, moved on by the live events since. */
export function useLiveRunStatus(runId: () => string, read: () => StatusFields | null | undefined) {
  const [live, setLive] = createSignal<RunStatusSnapshot | null>(null);
  createEffect(on(runId, () => setLive(null), { defer: true }));
  useLiveEvent([...SIGNALS], (event) => {
    const next = applyRunEvent(untrack(live), event, untrack(runId));
    if (next) setLive(next);
  });
  return createMemo(() => mergeStatus(snapshotOfRun(read()), live()));
}

export function LiveRunStatusLine(props: { runId: string; run: StatusFields | null | undefined; active: boolean; class?: string }) {
  const status = useLiveRunStatus(
    () => props.runId,
    () => props.run,
  );
  const now = useNow(() => props.active);
  const line = () => (props.active ? liveStatusLine(status(), now()) : null);
  return (
    <Show when={line()}>
      {(text) => (
        <p class={props.class ? `lrs ${props.class}` : "lrs"} title={text()}>
          {text()}
        </p>
      )}
    </Show>
  );
}
