import { For } from "solid-js";
import { useWritesFor } from "@/lib/offline/WriteQueueProvider";
import { WriteStatus } from "@/lib/offline/WriteStatus";
import "@/lib/offline/offline.css";

/*
 * Messages written on this task that haven't reached the server yet (U13), at the end of the
 * thread: waiting for the connection, sending, or failed with Retry and Discard. Each turns into
 * the real comment once it lands.
 */

export function PendingComments(props: { taskId: string }) {
  const writes = useWritesFor(() => `issue:${props.taskId}`);
  return (
    <For each={writes().filter((write) => write.kind === "comment")}>
      {(write) => (
        <article class="ow-pending-comment" data-status={write.status} aria-label="Message not sent yet">
          <div class="ow-pending-head">
            <b>You</b>
            <span>Not sent yet</span>
          </div>
          <div class="ow-pending-body">{write.preview?.text ?? ""}</div>
          <WriteStatus write={write} waiting="Saved offline. It's sent when Paperclip is back." />
        </article>
      )}
    </For>
  );
}
