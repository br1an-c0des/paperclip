import type { EmailMessage, EmailPublicationSummary, EmailThreadSummary } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Mail, Paperclip } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { emailApi } from "@/api/email";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import {
  canResolveDelivery,
  deliveriesNeedingAttention,
  deliveryFor,
  deliveryLabel,
  inboxToggle,
  openDeliveries,
  threadSummary,
} from "./integrations-model";

/*
 * A task that is an email conversation (an agent's AgentMail inbox): a row saying so, with the
 * thread one click away. The thread shows every message (who it's from, to, the text, attachments,
 * how its delivery went), the sends Paperclip lost track of, where you record what happened after
 * checking AgentMail (it never resends), and the inbox's Pause/Resume. Replying is the agent's: you
 * ask it in the task. The thread refreshes every few seconds while it's an email task.
 */

export function EmailThread(props: { taskId: string }) {
  const company = useCompany();
  const thread = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "email-thread"),
    queryFn: ({ signal }) => emailApi.thread(company().id, props.taskId, signal),
    // Null is an ordinary task: no need to keep asking.
    refetchInterval: (query) => (query.state.data ? 3000 : false),
    retry: false,
  }));
  return <Show when={thread.data}>{(current) => <ThreadRow taskId={props.taskId} thread={current()} />}</Show>;
}

function ThreadRow(props: { taskId: string; thread: EmailThreadSummary }) {
  const [open, setOpen] = createSignal(false);
  const attention = () => deliveriesNeedingAttention(props.thread).length;
  return (
    <div class="tn ti">
      <section class="tn-row" data-tone={attention() > 0 ? "amber" : "neutral"} aria-label="Email thread">
        <span class="tn-icon" aria-hidden="true">
          <Mail size={16} />
        </span>
        <span class="tn-text">
          <b>{props.thread.subject || "Email thread"}</b>
          <span class="ti-meta">
            {threadSummary(props.thread)}
            {attention() > 0 ? ` · ${attention()} ${attention() === 1 ? "send needs" : "sends need"} checking` : ""}
          </span>
        </span>
        <span class="tn-action">
          <Button size="compact" onClick={() => setOpen(true)}>
            Open thread
          </Button>
        </span>
      </section>
      <Dialog open={open()} onOpenChange={setOpen} title={props.thread.subject || "Email thread"} description={props.thread.endpoint.address ?? undefined} width={760}>
        <ThreadBody taskId={props.taskId} thread={props.thread} />
      </Dialog>
    </div>
  );
}

export function ThreadBody(props: { taskId: string; thread: EmailThreadSummary }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "email-thread") });
  const toggle = () => inboxToggle(props.thread.endpoint.status);
  const control = createMutation(() => ({
    mutationFn: (action: "pause" | "resume") => emailApi.control(props.thread.endpoint.id, action),
    onSuccess: (_result, action) => {
      refresh();
      void client.invalidateQueries({ queryKey: queryKeys.tools.emailInboxes(company().id) });
      pushToast({ tone: "success", title: action === "pause" ? "Inbox paused" : "Inbox resumed" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't change the inbox", body: (error as Error).message }),
  }));

  return (
    <div class="ti-thread">
      <div class="ti-inbox">
        <span>
          Inbox <b>{props.thread.endpoint.address ?? "being set up"}</b> · {props.thread.endpoint.status === "paused" ? "paused: new mail waits" : props.thread.endpoint.status}
        </span>
        <span class="ti-inbox-actions">
          <Show when={toggle()}>
            {(action) => (
              <Button size="compact" disabled={control.isPending} onClick={() => control.mutate(action())}>
                {action() === "pause" ? "Pause inbox" : "Resume inbox"}
              </Button>
            )}
          </Show>
          <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`/${company().issuePrefix}/apps/chat/${props.thread.endpoint.id}/settings`}>
            Inbox settings
          </A>
        </span>
      </div>
      <For each={props.thread.messages} fallback={<p class="ti-meta">No messages yet.</p>}>
        {(message) => <MessageCard message={message} delivery={deliveryFor(props.thread, message)} />}
      </For>
      <For each={openDeliveries(props.thread)}>{(delivery) => <DeliveryCard delivery={delivery} onResolved={refresh} />}</For>
    </div>
  );
}

function MessageCard(props: { message: EmailMessage; delivery: EmailPublicationSummary | null }) {
  const inbound = () => props.message.direction === "inbound";
  return (
    <article class="ti-mail" aria-label={inbound() ? "Email received" : "Email sent"}>
      <header class="ti-mail-head">
        <span>
          <b>{props.message.from}</b>
          <Show when={inbound()}>
            <span class="ti-tag">External</span>
          </Show>
        </span>
        <time class="ti-meta" datetime={props.message.timestamp}>
          {new Date(props.message.timestamp).toLocaleString()}
        </time>
      </header>
      <p class="ti-meta">
        To {props.message.to.join(", ")}
        {props.message.cc?.length ? ` · Cc ${props.message.cc.join(", ")}` : ""}
      </p>
      <p class="ti-mail-subject">{props.message.subject}</p>
      <div class="ti-mail-text">{props.message.text || "(No text)"}</div>
      <Show when={props.message.attachmentIds.length > 0}>
        <div class="ti-files">
          <For each={props.message.attachmentIds}>
            {(id, index) => (
              <a class="ti-file" href={`/api/attachments/${encodeURIComponent(id)}/content`} target="_blank" rel="noopener noreferrer">
                <Paperclip size={13} aria-hidden="true" />
                Attachment {index() + 1}
              </a>
            )}
          </For>
        </div>
      </Show>
      <details class="ti-details">
        <summary>Email details</summary>
        <Show when={props.message.bcc?.length}>
          <p>Bcc {props.message.bcc!.join(", ")}</p>
        </Show>
        <p class="ti-break">Message id {props.message.providerMessageId}</p>
        <Show when={props.message.fullText && props.message.fullText !== props.message.text}>
          <div class="ti-mail-text">{props.message.fullText}</div>
        </Show>
      </details>
      <Show when={props.delivery}>
        {(delivery) => (
          <p class="ti-meta ti-mail-foot">
            {deliveryLabel(delivery().outcome)}
            {delivery().error ? ` · ${delivery().error}` : ""}
          </p>
        )}
      </Show>
    </article>
  );
}

export function DeliveryCard(props: { delivery: EmailPublicationSummary; onResolved: () => void }) {
  const company = useCompany();
  const [messageId, setMessageId] = createSignal("");
  const resolve = createMutation(() => ({
    mutationFn: (outcome: "sent" | "failed") => emailApi.resolve(company().id, props.delivery.id, outcome, messageId().trim() || undefined),
    onSuccess: () => {
      props.onResolved();
      pushToast({ tone: "success", title: "Delivery recorded" });
    },
  }));
  const request = () => props.delivery.request;
  return (
    <article class="ti-mail ti-mail--send" aria-label="Email send">
      <header class="ti-mail-head">
        <b>{request()?.subject ?? "Email reply"}</b>
        <span class="ti-tag" data-tone={props.delivery.outcome === "uncertain" || props.delivery.outcome === "failed" ? "amber" : undefined}>
          {deliveryLabel(props.delivery.outcome)}
        </span>
      </header>
      <Show when={request()?.to?.length}>
        <p class="ti-meta">To {request()!.to!.join(", ")}</p>
      </Show>
      <Show when={request()?.text}>
        <div class="ti-mail-text">{request()!.text}</div>
      </Show>
      <Show when={props.delivery.error}>
        <p class="ti-note" data-tone="error">
          {props.delivery.error}
        </p>
      </Show>
      <Show when={canResolveDelivery(props.delivery)}>
        <details class="ti-details" open>
          <summary>Say what happened</summary>
          <p>Check AgentMail first: if it went out, paste its message id. This records the outcome; it never resends.</p>
          <Field label="AgentMail message id" for={`ti-msg-${props.delivery.id}`}>
            <TextInput id={`ti-msg-${props.delivery.id}`} autocomplete="off" value={messageId()} onInput={(event) => setMessageId(event.currentTarget.value)} />
          </Field>
          <Show when={resolve.isError}>
            <p class="ti-note" data-tone="error" role="alert">
              {(resolve.error as Error).message || "Couldn't record it."}
            </p>
          </Show>
          <div class="ti-compose-actions">
            <Button size="compact" disabled={resolve.isPending} onClick={() => resolve.mutate("failed")}>
              It wasn't sent
            </Button>
            <Button size="compact" variant="primary" disabled={!messageId().trim() || resolve.isPending} onClick={() => resolve.mutate("sent")}>
              It was sent
            </Button>
          </div>
        </details>
      </Show>
    </article>
  );
}
