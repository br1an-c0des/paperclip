import type { ExternalChannelBindingSummary, IssueAttachment } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Paperclip, Radio } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { chatEndpointsApi } from "@/api/chat-endpoints";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { chatProviderVisible, providerName, PUBLICATION_FEEDBACK, publicationDone } from "@/apps/chat/chat-model";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { Button, buttonClass } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import {
  boardSendKey,
  clearRetainedSend,
  publishBoardMessage,
  readRejection,
  readRetainedSend,
  writeRetainedSend,
  type BoardSendRejection,
  type RetainedSend,
} from "./board-send";
import { canSendToBinding } from "./integrations-model";

/*
 * A task started from a chat conversation (Slack, Teams, Discord, Telegram, GitHub): which one, a
 * link to it, and "Send to …", which posts a board message there, with task files if you pick or
 * add some. A send carries one idempotency key until it's confirmed, so a retry is the same send
 * rather than a second message; while one is unconfirmed the text and files are locked. The send is
 * kept in session storage from just before it goes until it's confirmed (board-send.ts), so a reload
 * brings it back to finish rather than to send again. Only while chat connectors are on (GitHub:
 * review bots).
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
  const storageKey = () => boardSendKey(company().id, props.taskId, props.binding.endpointId, props.binding.conversationId);
  const [composing, setComposing] = createSignal(false);
  const [body, setBody] = createSignal("");
  const [picked, setPicked] = createSignal<string[]>([]);
  // The send being finished: from just before it's posted until it's confirmed, also across a reload.
  const [kept, setKept] = createSignal<RetainedSend | null>(null);
  const [rejection, setRejection] = createSignal<BoardSendRejection | null>(null);
  const [storageError, setStorageError] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  // A send kept from before a reload comes back to be finished.
  createEffect(
    on(storageKey, (key) => {
      try {
        const saved = readRetainedSend(key);
        setKept(saved);
        setBody(saved?.body ?? "");
        setPicked(saved?.attachmentIds ?? []);
        setRejection(saved?.rejection ?? null);
        setComposing(Boolean(saved));
        setStorageError(null);
      } catch {
        setStorageError("A send kept from earlier couldn't be read. Check Activity for it before sending anything new.");
        setComposing(true);
      }
    }),
  );
  const keep = (value: RetainedSend) => {
    writeRetainedSend(storageKey(), value);
    setKept(value);
  };

  const attachments = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "attachments"),
    queryFn: ({ signal }) => issuesApi.listAttachments(props.taskId, signal),
    enabled: composing(),
  }));
  // Files already sent with a comment can't go again; a kept send shows the files it carries.
  const files = createMemo((): { id: string; name: string }[] => {
    const held = kept();
    const all = attachments.data ?? [];
    if (held) {
      return held.attachmentIds.map((id) => ({
        id,
        name: held.attachmentNames.find((file) => file.id === id)?.name ?? all.find((file) => file.id === id)?.originalFilename ?? "A task file",
      }));
    }
    return all.filter((file) => file.issueCommentId === null).map((file) => ({ id: file.id, name: file.originalFilename ?? "Untitled file" }));
  });
  // A picked file that has since gone out with a comment drops out of the pick.
  createEffect(() => {
    if (kept()) return;
    const usable = new Set((attachments.data ?? []).filter((file) => file.issueCommentId === null).map((file) => file.id));
    if (!attachments.data) return;
    const still = picked().filter((id) => usable.has(id));
    if (still.length !== picked().length) setPicked(still);
  });

  const reset = () => {
    clearRetainedSend(storageKey());
    setKept(null);
    setRejection(null);
    setStorageError(null);
    setBody("");
    setPicked([]);
    setComposing(false);
    send.reset();
  };
  const refreshTask = () => {
    for (const key of [queryKeys.issues.detail(props.taskId), queryKeys.issues.section(props.taskId, "attachments")]) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
  const finished = () => {
    reset();
    refreshTask();
    pushToast({ tone: "success", title: `Sent to ${name()}` });
  };

  const publication = () => kept()?.publication ?? null;
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
    mutationFn: (input: RetainedSend) =>
      publishBoardMessage(props.binding.endpointId, props.binding.conversationId, {
        body: input.body,
        idempotencyKey: input.idempotencyKey,
        attachmentIds: input.attachmentIds,
      }),
    onSuccess: (result, input) => {
      refreshTask();
      if (result.state === "published") return finished();
      try {
        keep({ ...input, publication: { id: result.id, state: result.state, attempts: result.attempts } });
      } catch {
        // The send and its key are already kept; checking it again reuses them.
        setKept({ ...input, publication: { id: result.id, state: result.state, attempts: result.attempts } });
      }
    },
    onError: (error, input) => {
      const rejected = readRejection(error, {
        endpointId: props.binding.endpointId,
        conversationId: props.binding.conversationId,
        idempotencyKey: input.idempotencyKey,
        attachmentIds: input.attachmentIds,
      });
      if (!rejected) return;
      try {
        keep({ ...input, rejection: rejected });
      } catch {
        setStorageError("The refused send couldn't be kept. Allow site storage, then send again to read its answer.");
        return;
      }
      setRejection(rejected);
      refreshTask();
    },
  }));

  const submit = () => {
    const text = body().trim();
    if (!text) return;
    const held = kept();
    const next: RetainedSend = held ?? {
      body: text,
      attachmentIds: picked(),
      attachmentNames: files().filter((file) => picked().includes(file.id)),
      idempotencyKey: crypto.randomUUID(),
      publication: null,
    };
    // Kept before it's posted: a send that can't be kept isn't sent, or a reload could send it twice.
    try {
      keep(next);
    } catch {
      setStorageError("This browser won't keep the send, so it wasn't sent. Allow site storage and try again.");
      return;
    }
    send.mutate(next);
  };
  // Take the refused files out and start a new send with the rest.
  const editRefused = () => {
    const refused = new Set(rejection()?.attachmentIds ?? []);
    const held = kept();
    clearRetainedSend(storageKey());
    setKept(null);
    setRejection(null);
    setPicked((held?.attachmentIds ?? picked()).filter((id) => !refused.has(id)));
    send.reset();
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const added: IssueAttachment = await issuesApi.uploadAttachment(company().id, props.taskId, file);
      setPicked((current) => [...current, added.id]);
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't add ${file.name}`, body: error instanceof Error ? error.message : String(error) });
    } finally {
      setUploading(false);
      // An interrupted upload may still have stored the file.
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "attachments") });
    }
  };

  const state = () => status.data?.publication.state ?? publication()?.state ?? null;
  const locked = () => kept() !== null || storageError() !== null;
  // Kept but never answered: the page went away before the server did.
  const unconfirmed = () => kept() !== null && publication() === null && !rejection() && !send.isPending && !send.isError;

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
            <div class="ti-files" role="group" aria-label="Files to send">
              <For each={files()}>
                {(file) => (
                  <label class="ti-file" data-refused={rejection()?.attachmentIds.includes(file.id) || undefined}>
                    <input
                      type="checkbox"
                      checked={kept() ? true : picked().includes(file.id)}
                      disabled={locked()}
                      onChange={() => setPicked((current) => (current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id]))}
                    />
                    <span>{file.name}</span>
                  </label>
                )}
              </For>
              <Show when={!locked()}>
                <Button size="compact" variant="quiet" disabled={uploading()} onClick={() => fileInput?.click()}>
                  <Paperclip size={13} aria-hidden="true" />
                  {uploading() ? "Adding…" : "Add a file"}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void upload(file);
                  }}
                />
              </Show>
            </div>
            <Show when={picked().length > 0 && !body().trim()}>
              <p class="ti-note">Add a message to send with the files.</p>
            </Show>
            <Show when={state()}>
              {(current) => (
                <p class="ti-note" data-tone={PUBLICATION_FEEDBACK[current()].tone} role="status">
                  {PUBLICATION_FEEDBACK[current()].title}
                  {status.data && status.data.total > 1 ? ` (${status.data.published} of ${status.data.total} parts)` : ""}
                </p>
              )}
            </Show>
            <Show when={unconfirmed()}>
              <p class="ti-note" data-tone="warn" role="status">
                This send wasn't confirmed before the page closed. Send again repeats the same send, so it won't post twice.
              </p>
            </Show>
            <Show when={send.isError && !rejection()}>
              <p class="ti-note" data-tone="error" role="alert">
                Couldn't confirm it was sent. Sending again repeats the same send, so it won't post twice.
              </p>
            </Show>
            <Show when={rejection()}>
              <p class="ti-note" data-tone="error" role="alert">
                Not sent: a picked file already went out with a comment.{" "}
                <Button size="compact" onClick={editRefused}>
                  Edit the send
                </Button>
              </p>
            </Show>
            <Show when={storageError()}>
              {(message) => (
                <p class="ti-note" data-tone="error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <div class="ti-compose-actions">
              <Show
                when={kept()}
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
              <Button
                type="submit"
                size="compact"
                disabled={!body().trim() || send.isPending || uploading() || !!rejection() || (publication() !== null && !send.isError)}
              >
                {send.isPending ? "Sending…" : send.isError || unconfirmed() ? "Send again" : "Send"}
              </Button>
            </div>
          </form>
        </Show>
      </section>
    </div>
  );
}
