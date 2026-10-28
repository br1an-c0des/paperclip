import type { AgentDetail, Issue, IssueWorkMode } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { ArrowUp, Check, ChevronDown, LoaderCircle, Paperclip, TriangleAlert, X } from "lucide-solid";
import { batch, createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { commentsApi } from "@/api/comments";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { queuedCommentsApi } from "@/api/queued-comments";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { attachmentIds, clearComposerDraft, loadComposerDraft, messageBody, saveComposerDraft, type ComposerAttachment } from "@/tasks/composer/composer-model";
import { newId } from "@/tasks/new-task";
import "@/tasks/composer/Composer.css";

/*
 * The chat's composer (board 12): the message, files by the clip, paste or drop, the mode, and Send.
 *
 * - Enter sends and Shift+Enter starts a new line, as in a chat. `/` lists the commands; `/new`
 *   starts a fresh session (the history stays visible), as does New session in the header.
 * - The first message or upload creates the chat (`ensure`).
 * - While the agent is replying, Send queues the message for its next turn ("Queue"); the menu
 *   steers it into the reply going now, or stops the reply and starts over with it.
 * - Modes are the chat task's work mode: Standard can plan and hand off tasks, Ask only discusses,
 *   Plan researches and writes the plan.
 * - The draft is kept per agent until it's sent.
 */

const MODES: { value: IssueWorkMode; label: string; description: string }[] = [
  { value: "standard", label: "Standard", description: "Discusses, plans and hands off tasks" },
  { value: "ask", label: "Ask", description: "Discusses without creating tasks or documents" },
  { value: "planning", label: "Plan", description: "Researches and writes up a plan before any hand-off" },
];

const COMMANDS = [{ name: "/new", description: "Start a fresh session. The history stays here." }];

type SendMode = "send" | "steer" | "interrupt";

export function ChatComposer(props: {
  agent: AgentDetail;
  chat: Issue | null;
  ensure: () => Promise<Issue>;
  /** The reply going now, if any. */
  replyRunId: string | null;
  /** Why sending is off, such as a paused agent. */
  disabledReason?: string | null;
  ref?: (api: { focus: () => void; send: (body: string) => Promise<boolean> }) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  let textarea: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  const draftKey = () => `chat:${company().id}:${props.agent.id}`;
  const [body, setBody] = createSignal("");
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [modeChoice, setModeChoice] = createSignal<IssueWorkMode | null>(null);
  let requestId = newId();

  createEffect(
    on(draftKey, (key, previous) => {
      if (previous) saveComposerDraft(previous, { body: body(), attachments: attachments() });
      const draft = loadComposerDraft(key);
      batch(() => {
        setBody(draft.body);
        setAttachments(draft.attachments);
        setProblem(null);
        setModeChoice(null);
      });
      requestId = newId();
      queueMicrotask(resize);
    }),
  );
  createEffect(
    on([body, attachments], () => {
      const key = draftKey();
      const timer = window.setTimeout(() => saveComposerDraft(key, { body: body(), attachments: attachments() }), 300);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );
  onCleanup(() => saveComposerDraft(draftKey(), { body: body(), attachments: attachments() }));

  const mode = () => modeChoice() ?? props.chat?.workMode ?? "standard";
  const modeMeta = () => MODES.find((entry) => entry.value === mode()) ?? MODES[0]!;
  const live = () => !!props.replyRunId;
  const commandsOpen = () => /^\/\S*$/.test(body()) && COMMANDS.some((command) => command.name.startsWith(body()) && command.name !== body());

  const resize = () => {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  };

  const upload = async (file: File) => {
    const key = newId();
    const inline = file.type.startsWith("image/");
    setAttachments((list) => [...list, { key, name: file.name, size: file.size, status: "uploading", inline }]);
    try {
      const chat = await props.ensure();
      const uploaded = await issuesApi.uploadAttachment(company().id, chat.id, file);
      if (!attachments().some((item) => item.key === key)) return;
      const name = uploaded.originalFilename ?? file.name;
      setAttachments((list) => list.map((item) => (item.key === key ? { ...item, name, status: "attached", attachmentId: uploaded.id, contentPath: uploaded.contentPath } : item)));
      if (inline) setBody((text) => `${text}${text && !text.endsWith("\n") ? "\n" : ""}![${name.replace(/[[\]\\]/g, "\\$&")}](${uploaded.contentPath})`);
    } catch (error) {
      setAttachments((list) => list.map((item) => (item.key === key ? { ...item, status: "error", error: error instanceof Error ? error.message : "Upload failed" } : item)));
    }
  };
  const addFiles = (files: FileList | File[] | null | undefined) => {
    for (const file of Array.from(files ?? [])) void upload(file);
  };

  /** Posts a message; true when it went. */
  const post = async (text: string, files: readonly ComposerAttachment[], how: SendMode): Promise<boolean> => {
    setProblem(null);
    setSending(true);
    try {
      const chat = await props.ensure();
      if (mode() !== chat.workMode) await issuesApi.update(chat.id, { workMode: mode() });
      const comment = await commentsApi.post(chat.id, {
        body: text,
        clientRequestId: requestId,
        ...(attachmentIds(text, files).length ? { attachmentIds: attachmentIds(text, files) } : {}),
        ...(how === "interrupt" ? { interrupt: true } : {}),
      });
      requestId = newId();
      if (how === "steer")
        await steerIn(chat.id, comment.id).catch((error: unknown) =>
          pushToast({ tone: "error", title: "Couldn't steer the message", body: `${error instanceof Error ? error.message : String(error)} It's queued for the next turn.` }),
        );
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(chat.id) });
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSending(false);
    }
  };

  const send = async (how: SendMode) => {
    if (sending() || props.disabledReason) return;
    if (attachments().some((item) => item.status === "uploading")) return setProblem("Wait for the files to finish uploading.");
    if (attachments().some((item) => item.status === "error")) return setProblem("Remove the files that didn't upload, or try them again.");
    const text = messageBody(body(), attachments());
    if (!text) return setProblem("Write a message first.");
    if (await post(text, attachments(), how)) {
      batch(() => {
        setBody("");
        setAttachments([]);
        setModeChoice(null);
      });
      clearComposerDraft(draftKey());
      queueMicrotask(resize);
    }
  };

  const steerIn = async (chatId: string, commentId: string) => {
    const latest = await queuedCommentsApi.get(chatId);
    const queued = latest.entries.some((entry) => entry.comment.id === commentId);
    if (!queued || !latest.queueId || !latest.targetRunId || latest.steeringDisposition !== "available") {
      if (queued) pushToast({ tone: "info", title: "Queued for the next turn", body: "This reply can't take messages midway, so it waits for the next turn." });
      return;
    }
    const next = await queuedCommentsApi.steer(chatId, commentId, { queueId: latest.queueId, revision: latest.revision, targetRunId: latest.targetRunId });
    client.setQueryData(queryKeys.issues.section(chatId, "queued-comments"), next);
  };

  props.ref?.({
    focus: () => textarea?.focus(),
    send: (text) => post(text, [], "send"),
  });

  return (
    <form
      class="cmp ch-cmp"
      classList={{ "cmp--drop": dragging() }}
      data-mode={mode()}
      aria-busy={sending()}
      onSubmit={(event) => {
        event.preventDefault();
        void send("send");
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      <div class="cmp-field">
        <Show when={commandsOpen()}>
          <div class="cmp-picker" role="listbox" aria-label="Commands">
            <For each={COMMANDS.filter((command) => command.name.startsWith(body()))}>
              {(command) => (
                <div
                  class="cmp-option"
                  role="option"
                  aria-selected="true"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setBody(command.name);
                    textarea?.focus();
                  }}
                >
                  <span class="mono cmp-option-id">{command.name}</span>
                  <span class="cmp-option-label">{command.description}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
        <label class="sr-only" for={`chat-composer-${props.agent.id}`}>
          Message {props.agent.name}
        </label>
        <textarea
          id={`chat-composer-${props.agent.id}`}
          ref={textarea}
          class="cmp-text"
          rows={2}
          value={body()}
          placeholder={props.disabledReason ?? `Message ${props.agent.name}, or type / for commands`}
          readOnly={sending()}
          disabled={!!props.disabledReason}
          onInput={(event) => {
            setBody(event.currentTarget.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && commandsOpen()) {
              event.preventDefault();
              setBody(COMMANDS.find((command) => command.name.startsWith(body()))!.name);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              void send("send");
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            addFiles(files);
          }}
        />
      </div>

      <Show when={attachments().length > 0}>
        <ul class="cmp-files" aria-label="Files">
          <For each={attachments()}>
            {(item) => (
              <li class="cmp-file" data-status={item.status} title={item.error}>
                <Show when={item.status === "uploading"} fallback={item.status === "error" ? <TriangleAlert size={13} aria-hidden="true" /> : <Paperclip size={13} aria-hidden="true" />}>
                  <LoaderCircle size={13} class="cmp-spin" aria-hidden="true" />
                </Show>
                <span class="cmp-file-name">{item.name}</span>
                <Show when={item.status === "error"}>
                  <span class="cmp-file-error">{item.error ?? "Didn't upload"}</span>
                </Show>
                <button type="button" class="cmp-file-x" aria-label={`Remove ${item.name}`} onClick={() => setAttachments((list) => list.filter((entry) => entry.key !== item.key))}>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={problem()}>
        <p class="cmp-problem" role="alert">
          {problem()}
        </p>
      </Show>

      <div class="cmp-bar">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          class="btn btn--icon btn--compact"
          aria-label="Attach a file"
          title="Attach a file"
          disabled={!!props.disabledReason}
          onClick={() => fileInput?.click()}
        >
          <Paperclip size={15} aria-hidden="true" />
        </button>
        <Menu>
          <Menu.Trigger class="cmp-pill" aria-label={`Work mode: ${modeMeta().label}`} title={modeMeta().description} disabled={!!props.disabledReason}>
            {modeMeta().label}
            <ChevronDown size={13} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label="Mode" width={300}>
            <For each={MODES}>
              {(entry) => (
                <Menu.Item description={entry.description} hint={entry.value === mode() ? <Check size={14} aria-hidden="true" /> : undefined} onSelect={() => setModeChoice(entry.value)}>
                  {entry.label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
        <span class="ch-cmp-hint">{live() ? "Sends when this reply finishes · /new starts a fresh session" : "/new starts a fresh session"}</span>

        <div class="cmp-send">
          <Button type="submit" variant="primary" size="compact" class="cmp-send-main" disabled={sending() || !!props.disabledReason} title="Send (Enter)">
            <Show when={sending()} fallback={<ArrowUp size={14} aria-hidden="true" />}>
              <LoaderCircle size={14} class="cmp-spin" aria-hidden="true" />
            </Show>
            {live() ? "Queue" : "Send"}
          </Button>
          <Menu placement="top-end">
            <Menu.Trigger class="btn btn--primary btn--compact cmp-send-more" aria-label="Send options" disabled={sending() || !!props.disabledReason}>
              <ChevronDown size={14} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Send options" width={300}>
              <Show when={live()}>
                <Menu.Item description="Send it into the reply that's going now" onSelect={() => void send("steer")}>
                  Steer into this reply
                </Menu.Item>
                <Menu.Item description="Stop this reply and start over with your message" onSelect={() => void send("interrupt")}>
                  Interrupt and send
                </Menu.Item>
                <Menu.Item description="Wait for the agent's next turn" onSelect={() => void send("send")}>
                  Queue for the next turn
                </Menu.Item>
                <Menu.Separator />
              </Show>
              <Menu.Item
                description={`${props.agent.name} forgets what's above. The history stays here.`}
                onSelect={() => void post("/new", [], "send")}
              >
                Start a new session
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
      </div>
    </form>
  );
}
