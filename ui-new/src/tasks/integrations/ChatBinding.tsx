import type { ChatPublicationSummary, ExternalChannelBindingSummary } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Radio } from "lucide-solid";
import { createEffect, createSignal, on, Show } from "solid-js";
import { chatEndpointsApi } from "@/api/chat-endpoints";
import { queryKeys } from "@/api/queryKeys";
import { chatProviderVisible, providerName, PUBLICATION_FEEDBACK, publicationDone } from "@/apps/chat/chat-model";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button, buttonClass } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { canSendToBinding } from "./integrations-model";

/*
 * A task started from a chat conversation (Slack, Teams, Discord, Telegram, GitHub): which one, a
 * link to it, and "Send to …", which posts a board message there. A send carries one idempotency
 * key until it's confirmed, so a retry is the same send rather than a second message; while one is
 * unconfirmed the text is locked. Only while chat connectors are on (GitHub: review bots).
 *
 * Not here: attaching files to a send, and keeping an unconfirmed send across a reload (the old UI
 * kept it in browser storage). An unconfirmed send is settled in the endpoint's Activity.
 */

export function ChatBinding(props: { taskId: string }) {
  const flags = useExperimentalSettingsQuery();
  const enabled = () => flags.data?.enableChatConnectors === true || flags.data?.enableGitHubReviewBots === true;
  const query = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "chat-binding"),
    queryFn: ({ signal }) => chatEndpointsApi.issueBinding(props.taskId, signal),
    enabled: enabled(),
    retry: false,
  }));
  const binding = () => {
    const current = enabled() ? query.data : null;
    return current && chatProviderVisible(current.provider, flags.data) && canSendToBinding(current) ? current : null;
  };
  return <Show when={binding()}>{(current) => <BindingRow taskId={props.taskId} binding={current()} />}</Show>;
}

function BindingRow(props: { taskId: string; binding: ExternalChannelBindingSummary }) {
  const company = useCompany();
  const client = useQueryClient();
  const name = () => providerName(props.binding.provider);
  const [composing, setComposing] = createSignal(false);
  const [body, setBody] = createSignal("");
  const [sendKey, setSendKey] = createSignal<string | null>(null);
  const [publication, setPublication] = createSignal<ChatPublicationSummary | null>(null);

  const reset = () => {
    setBody("");
    setSendKey(null);
    setPublication(null);
    setComposing(false);
  };
  const refreshTask = () => void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
  const finished = () => {
    reset();
    refreshTask();
    pushToast({ tone: "success", title: `Sent to ${name()}` });
  };

  const status = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.binding.endpointId, "publication", publication()?.id ?? ""),
    queryFn: ({ signal }) => chatEndpointsApi.publicationStatus(props.binding.endpointId, props.binding.conversationId, publication()!.id, signal),
    enabled: publication() !== null,
    refetchInterval: 2000,
    staleTime: 0,
    retry: false,
  }));
  createEffect(on(() => status.data, (batch) => publication() && publicationDone(batch) && finished()));

  const send = createMutation(() => ({
    mutationFn: (input: { body: string; key: string }) =>
      chatEndpointsApi.publishBoardMessage(props.binding.endpointId, props.binding.conversationId, input.body, input.key),
    onSuccess: (result) => {
      if (result.state === "published") finished();
      else {
        setPublication(result);
        refreshTask();
      }
    },
  }));
  const submit = () => {
    const text = body().trim();
    if (!text) return;
    const key = sendKey() ?? crypto.randomUUID();
    setSendKey(key);
    send.mutate({ body: text, key });
  };
  const state = () => status.data?.publication.state ?? publication()?.state ?? null;
  const locked = () => sendKey() !== null;

  return (
    <div class="tn ti">
      <section class="tn-row" data-tone="neutral" aria-label="External conversation">
        <span class="tn-icon" aria-hidden="true">
          <Radio size={16} />
        </span>
        <span class="tn-text">
          <b>Connected to {name()}</b>
          <span class="ti-meta">
            {props.binding.externalLabel}
            {props.binding.botLabel ? ` · as ${props.binding.botLabel}` : ""}
          </span>
        </span>
        <span class="tn-action">
          <Show when={props.binding.externalUrl}>
            {(url) => (
              <a class={buttonClass({ size: "compact" })} href={url()} target="_blank" rel="noopener noreferrer">
                Open in {name()}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          </Show>
          <Show when={!composing()}>
            <Button size="compact" onClick={() => setComposing(true)}>
              Send to {name()}
            </Button>
          </Show>
          <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`/${company().issuePrefix}/apps/chat/${props.binding.endpointId}/activity`}>
            Activity
          </A>
        </span>
        <Show when={composing()}>
          <form
            class="ti-compose"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label class="sr-only" for={`ti-send-${props.taskId}`}>
              Message to {name()}
            </label>
            <TextArea
              id={`ti-send-${props.taskId}`}
              rows={3}
              value={body()}
              disabled={locked()}
              placeholder={`Posts to ${props.binding.externalLabel} as the board`}
              onInput={(event) => setBody(event.currentTarget.value)}
            />
            <Show when={state()}>
              {(current) => (
                <p class="ti-note" data-tone={PUBLICATION_FEEDBACK[current()].tone} role="status">
                  {PUBLICATION_FEEDBACK[current()].title}
                  {status.data && status.data.total > 1 ? ` (${status.data.published} of ${status.data.total} parts)` : ""}
                </p>
              )}
            </Show>
            <Show when={send.isError}>
              <p class="ti-note" data-tone="error" role="alert">
                Couldn't confirm it was sent. Sending again repeats the same send, so it won't post twice.
              </p>
            </Show>
            <div class="ti-compose-actions">
              <Show
                when={locked()}
                fallback={
                  <Button size="compact" variant="quiet" onClick={reset}>
                    Cancel
                  </Button>
                }
              >
                <Button size="compact" variant="quiet" title="Keeps nothing of this send; check Activity before writing a new one" onClick={reset}>
                  Discard
                </Button>
              </Show>
              <Button type="submit" size="compact" disabled={!body().trim() || send.isPending || (publication() !== null && !send.isError)}>
                {send.isPending ? "Sending…" : send.isError ? "Send again" : "Send"}
              </Button>
            </div>
          </form>
        </Show>
      </section>
    </div>
  );
}
