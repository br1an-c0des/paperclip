import { ChevronDown } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { connectivity } from "./connectivity";
import { WriteStatus } from "./WriteStatus";
import { useWriteQueue } from "./WriteQueueProvider";
import "./offline.css";

/*
 * The app's one connection notice, at the top of every board page (after #15754's
 * ConnectionStatusBanner): the server is out of reach, or writes made meanwhile are waiting, being
 * sent, or failed. "Review" lists them all, each with Retry or Discard, whichever page they were
 * made on.
 */

const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

export function SyncBanner(props: { reconnecting: boolean }) {
  const queue = useWriteQueue();
  const [open, setOpen] = createSignal(false);
  const offline = () => props.reconnecting || connectivity.status() === "offline";
  const failed = () => queue.writes().filter((write) => write.status === "failed");
  const count = () => queue.writes().length;
  const tone = () => (offline() ? "offline" : failed().length > 0 ? "failed" : "syncing");
  const message = () => {
    const changes = count();
    if (offline()) {
      return changes > 0
        ? `Can't reach Paperclip. ${plural(changes, "change is", "changes are")} saved here and sent when it's back.`
        : "Connection interrupted. Reconnecting automatically…";
    }
    if (failed().length > 0) return `${plural(failed().length, "change", "changes")} couldn't be saved.`;
    return `Sending ${plural(changes, "saved change", "saved changes")}…`;
  };

  return (
    <Show when={offline() || count() > 0}>
      <div class="ow-banner" data-tone={tone()} role="status">
        <div class="ow-banner-row">
          <span class="ow-banner-text">{message()}</span>
          <Show when={queue.unsaved()}>
            <span class="ow-banner-text">Keep this tab open: the browser wouldn't store some of them.</span>
          </Show>
          <span class="ow-banner-actions">
            <Show when={offline()}>
              <Button size="compact" variant="quiet" onClick={() => connectivity.checkNow()}>
                Try again
              </Button>
            </Show>
            <Show when={count() > 0}>
              <Button
                size="compact"
                variant="quiet"
                aria-expanded={open()}
                icon={<ChevronDown size={14} aria-hidden="true" class="ow-chevron" classList={{ "ow-chevron--open": open() }} />}
                onClick={() => setOpen((value) => !value)}
              >
                Review
              </Button>
            </Show>
          </span>
        </div>
        <Show when={open() && count() > 0}>
          <ul class="ow-list">
            <For each={queue.writes()}>
              {(write) => (
                <li class="ow-item">
                  <span class="ow-item-label">{write.label}</span>
                  <Show when={write.preview?.text ?? write.preview?.title}>{(text) => <span class="ow-item-preview">{text()}</span>}</Show>
                  <WriteStatus write={write} compact />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
