import { A } from "@solidjs/router";
import { Check, Copy } from "lucide-solid";
import { createSignal, For, Show, type JSX } from "solid-js";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { TonePill, type Tone } from "@/ui/Status";
import { failureText } from "../shared";
import "./Advanced.css";

/*
 * Small pieces the assistant, gateway, advanced and agent-tools pages share: copying setup values, a
 * value with a copy button, a card's loading and error lines, and a quiet pill for states without a
 * tone.
 */

/** Copies text and says so in a toast; never puts it anywhere else. */
export async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ title: "Copied", body: label, tone: "success" });
    return true;
  } catch {
    pushToast({ title: "Couldn't copy", body: "Select the text and copy it instead.", tone: "error" });
    return false;
  }
}

/** A setup value (a command, a config, an address) in a code block with a copy button. */
export function CopyBlock(props: { value: string; label: string; inline?: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    if (await copyToClipboard(props.value, props.label)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div class="tl-copy" classList={{ "tl-copy--inline": props.inline }}>
      <pre class="mono">{props.value}</pre>
      <Button variant="icon" size="compact" aria-label={`Copy ${props.label}`} onClick={() => void copy()}>
        <Show when={copied()} fallback={<Copy size={14} aria-hidden="true" />}>
          <Check size={14} aria-hidden="true" />
        </Show>
      </Button>
    </div>
  );
}

/** A loading or failed line inside a card, with a retry. */
export function CardState(props: { loading?: boolean; error?: unknown; what: string; onRetry?: () => void }) {
  return (
    <Show
      when={props.error}
      fallback={
        <Show when={props.loading}>
          <p class="ap-empty" role="status">
            Loading {props.what}…
          </p>
        </Show>
      }
    >
      <div class="ap-empty" role="alert">
        <p>
          Couldn't load {props.what}. {failureText(props.error, "")}
        </p>
        <Show when={props.onRetry}>
          <Button size="compact" onClick={() => props.onRetry?.()}>
            Try again
          </Button>
        </Show>
      </div>
    </Show>
  );
}

/** A state pill; states without a tone get a quiet outline. */
export function StatePill(props: { tone: Tone | null; children: JSX.Element }) {
  return (
    <Show when={props.tone} fallback={<span class="tl-pill">{props.children}</span>}>
      {(tone) => (
        <TonePill tone={tone()} compact>
          {props.children}
        </TonePill>
      )}
    </Show>
  );
}

/** Label and value pairs, as a definition list. */
export function Facts(props: { rows: [string, JSX.Element][]; mono?: boolean }) {
  return (
    <dl class="tl-facts">
      <For each={props.rows}>
        {([label, value]) => (
          <div>
            <dt>{label}</dt>
            <dd classList={{ mono: props.mono }}>{value}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

/** A row's secondary link, such as "Open" to a connection's page. */
export function RowLink(props: { href: string; children: JSX.Element }) {
  return (
    <A class="tl-rowlink" href={props.href}>
      {props.children}
    </A>
  );
}
