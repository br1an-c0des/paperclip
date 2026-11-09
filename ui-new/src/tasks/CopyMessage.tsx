import { Check, Copy, X } from "lucide-solid";
import { createSignal, Match, onCleanup, Switch } from "solid-js";
import { copyText } from "./TaskActions";
import "./CopyMessage.css";

/*
 * Copy your own message as Markdown (U67, since the 2026-11-07 sync, upstream #19442, #19451): an
 * icon left of the message's time, copying the text as written, attachment links and all. With a
 * mouse it shows while the pointer is over the message or the button has focus; on a touch screen it
 * always shows. It reads "Copied" for two seconds, or "Couldn't copy" when the browser refused.
 */

export function CopyMessage(props: { text: string; class?: string }) {
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle");
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  const copy = async () => {
    window.clearTimeout(timer);
    try {
      await copyText(props.text);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer = window.setTimeout(() => setState("idle"), 2_000);
  };
  const label = () => (state() === "copied" ? "Copied" : state() === "failed" ? "Couldn't copy the message" : "Copy message as Markdown");
  return (
    <button
      type="button"
      class={`copy-msg ${props.class ?? ""}`}
      data-state={state()}
      aria-label={label()}
      title={label()}
      onClick={() => void copy()}
    >
      <Switch fallback={<Copy size={13} aria-hidden="true" />}>
        <Match when={state() === "copied"}>
          <Check size={13} aria-hidden="true" />
        </Match>
        <Match when={state() === "failed"}>
          <X size={13} aria-hidden="true" />
        </Match>
      </Switch>
    </button>
  );
}
