import { CloudOff, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";
import { Button } from "@/ui/Button";
import { connectivity } from "./connectivity";
import { useWriteQueue } from "./WriteQueueProvider";
import type { QueuedWrite } from "./write-queue";
import "./offline.css";

/*
 * Where a queued write was made, how it stands: waiting for the connection, sending, or failed with
 * its reason and Retry or Discard. A failure Retry can't fix (a conflict, an answer someone else
 * gave) offers Discard only, or the screen's own way forward (`action`).
 */

export function writeStatusText(write: QueuedWrite, offline: boolean, waiting = "Saved offline. It's sent when Paperclip is back.") {
  if (write.status === "failed") return write.error ?? "Couldn't send this.";
  if (write.status === "sending") return "Sending…";
  if (offline) return waiting;
  return write.attempts > 0 ? "Couldn't send yet. Trying again…" : "Waiting to send…";
}

export function WriteStatus(props: {
  write: QueuedWrite;
  /** What a waiting write says ("Saved offline, will sync"). */
  waiting?: string;
  /** A screen's own way forward for a failure, such as "Edit my version". */
  action?: { label: string; run: () => void };
  compact?: boolean;
}) {
  const queue = useWriteQueue();
  const offline = () => connectivity.status() === "offline";
  return (
    <div class="ow-status" classList={{ "ow-status--failed": props.write.status === "failed", "ow-status--compact": props.compact }} role="status">
      <Switch>
        <Match when={props.write.status === "failed"}>
          <TriangleAlert size={14} aria-hidden="true" />
        </Match>
        <Match when={props.write.status === "sending"}>
          <LoaderCircle size={14} class="ow-spin" aria-hidden="true" />
        </Match>
        <Match when={true}>
          <CloudOff size={14} aria-hidden="true" />
        </Match>
      </Switch>
      <span class="ow-text">{writeStatusText(props.write, offline(), props.waiting)}</span>
      <Show when={props.write.status !== "sending"}>
        <span class="ow-actions">
          <Show when={props.write.status === "failed" && props.action}>
            {(action) => (
              <Button size="compact" variant="secondary" onClick={() => action().run()}>
                {action().label}
              </Button>
            )}
          </Show>
          <Show when={!props.write.settled && (props.write.status === "failed" || !offline())}>
            <Button size="compact" variant={props.write.status === "failed" ? "primary" : "secondary"} icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => queue.retry(props.write.id)}>
              {props.write.status === "failed" ? "Retry" : "Send now"}
            </Button>
          </Show>
          <Button size="compact" variant="quiet" icon={<X size={14} aria-hidden="true" />} onClick={() => queue.discard(props.write.id)}>
            Discard
          </Button>
        </span>
      </Show>
    </div>
  );
}
