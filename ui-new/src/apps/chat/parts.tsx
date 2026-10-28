import { createQuery } from "@tanstack/solid-query";
import { Check, Copy } from "lucide-solid";
import { createSignal, For, Show, type JSX, type ParentProps } from "solid-js";
import { chatEndpointsApi, type ChatEndpoint } from "@/api/chat-endpoints";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";

/*
 * Pieces the chat endpoint pages share: the company's endpoints and one endpoint, a read-only value
 * with a Copy button (webhook addresses, commands, a manifest), and the setup steps.
 */

export function useChatEndpoints(enabled: () => boolean = () => true) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.list(company().id),
    queryFn: ({ signal }) => chatEndpointsApi.list(company().id, signal),
    enabled: enabled(),
    retry: false,
  }));
}

/** One endpoint. Provider callbacks don't always log activity, so an open page polls while asked. */
export function useChatEndpoint(id: () => string | null, poll: (endpoint: ChatEndpoint | undefined) => number | false = () => false) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.detail(company().id, id() ?? "none"),
    queryFn: ({ signal }) => chatEndpointsApi.get(id()!, signal),
    enabled: Boolean(id()),
    refetchInterval: (query) => poll(query.state.data),
    retry: false,
  }));
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A value to paste somewhere else, with a Copy button. `block` shows it as a code block. */
export function CopyValue(props: { label: string; value: string | null | undefined; block?: boolean; missing?: JSX.Element }) {
  const [copied, setCopied] = createSignal(false);
  const doCopy = async () => {
    if (!props.value) return;
    if (await copy(props.value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else pushToast({ tone: "error", title: "Couldn't copy", body: "Select it and copy it yourself." });
  };
  return (
    <div class="ch-copy">
      <span class="ch-copy-label">{props.label}</span>
      <Show when={props.value} fallback={<span class="cx-note cx-note--warn">{props.missing ?? "Not available yet."}</span>}>
        {(value) => (
          <div class="ch-copy-row" classList={{ "ch-copy-row--block": props.block }}>
            <Show when={props.block} fallback={<code class="ap-code mono">{value()}</code>}>
              <pre class="ch-pre mono">{value()}</pre>
            </Show>
            <Button size="compact" variant="quiet" icon={copied() ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={() => void doCopy()}>
              {copied() ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </Show>
    </div>
  );
}

/** Numbered setup steps; reached ones can be revisited. */
export function SetupSteps<T extends string>(props: {
  steps: { key: T; label: string }[];
  current: T;
  reached: T;
  onPick?: (step: T) => void;
  disabled?: boolean;
}) {
  const index = (key: T) => props.steps.findIndex((step) => step.key === key);
  return (
    <ol class="ch-steps" aria-label="Setup steps">
      <For each={props.steps}>
        {(step, i) => {
          const reachable = () => i() <= index(props.reached);
          return (
            <li classList={{ "ch-step--on": step.key === props.current, "ch-step--done": i() < index(props.reached) }}>
              <button
                type="button"
                disabled={props.disabled || !reachable() || !props.onPick}
                aria-current={step.key === props.current ? "step" : undefined}
                onClick={() => props.onPick?.(step.key)}
              >
                <span class="ch-step-n">{i() + 1}</span>
                {step.label}
              </button>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/** A settings card whose body is free content (lists, notes, toggles) rather than label rows. */
export function Card(props: ParentProps<{ title?: JSX.Element; description?: JSX.Element; footer?: JSX.Element }>) {
  return (
    <SettingsCard title={props.title} description={props.description} footer={props.footer}>
      <div class="ch-body">{props.children}</div>
    </SettingsCard>
  );
}
