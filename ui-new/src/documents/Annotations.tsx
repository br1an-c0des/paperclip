import type { DocumentAnnotationThreadWithComments } from "@paperclipai/shared";
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { Check, MessageSquarePlus, RotateCcw, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js";
import { documentsApi } from "@/api/documents";
import { stampLabel } from "@/tasks/thread-model";
import { Button } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { anchorForSelection, type SelectionAnchor } from "./anchor";
import { quote, rawSpanFor, visibleThreads, type ThreadFilter } from "./annotation-model";
import { documentKeys, type DocumentHost } from "./host";
import "./Annotations.css";

/*
 * Comments on a document's text (annotation threads), as the old UI has them: select a passage in
 * the rendered document and comment on it; passages with comments are highlighted, and clicking
 * one opens its thread; threads take replies and can be resolved and reopened. Highlights use the
 * CSS Custom Highlight API, so the rendered Markdown is never rewritten.
 */

type Thread = DocumentAnnotationThreadWithComments;

// Highlights in the rendered document ---------------------------------------------------------------

const supportsHighlights = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function rangesFor(container: HTMLElement, passage: string): Range[] {
  const span = rawSpanFor(container.textContent ?? "", passage);
  if (!span) return [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const ranges: Range[] = [];
  let cursor = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const start = cursor;
    const end = cursor + text.data.length;
    if (end > span.start && start < span.end) {
      const range = document.createRange();
      range.setStart(text, Math.max(0, span.start - start));
      range.setEnd(text, Math.min(text.data.length, span.end - start));
      ranges.push(range);
    }
    cursor = end;
    if (cursor >= span.end) break;
  }
  return ranges;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

export type PendingComment = SelectionAnchor & { top: number; left: number };

/**
 * Wires a rendered document up for comments: draws the threads' highlights, reports a text
 * selection as a pending anchor (with where to put the Comment button), and opens a thread when its
 * passage is clicked. `container` must be the element holding the rendered Markdown, positioned.
 */
export function useAnnotationLayer(options: {
  container: Accessor<HTMLElement | undefined>;
  markdown: Accessor<string>;
  threads: Accessor<Thread[]>;
  focusedId: Accessor<string | null>;
  pendingText: Accessor<string | null>;
  enabled: Accessor<boolean>;
  onSelect: (pending: PendingComment | null) => void;
  onFocusThread: (id: string) => void;
}) {
  // The rendered Markdown is replaced wholesale when it changes, so re-measure after every DOM change.
  const [version, setVersion] = createSignal(0);
  createEffect(() => {
    const element = options.container();
    if (!element) return;
    const observer = new MutationObserver(() => setVersion((value) => value + 1));
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    onCleanup(() => observer.disconnect());
  });

  const threadRanges = createMemo(() => {
    const element = options.container();
    if (!element || !options.enabled()) return [] as { id: string; ranges: Range[] }[];
    version();
    return options
      .threads()
      .filter((thread) => thread.status === "open" && thread.anchorState !== "orphaned")
      .map((thread) => ({ id: thread.id, ranges: rangesFor(element, thread.selectedText) }));
  });

  createEffect(() => {
    if (!supportsHighlights()) return;
    const all = new Highlight();
    const focused = new Highlight();
    const pending = new Highlight();
    for (const entry of threadRanges()) {
      for (const range of entry.ranges) (entry.id === options.focusedId() ? focused : all).add(range);
    }
    const element = options.container();
    const text = options.pendingText();
    if (element && text) for (const range of rangesFor(element, text)) pending.add(range);
    CSS.highlights.set("doc-annotation", all);
    CSS.highlights.set("doc-annotation-focus", focused);
    CSS.highlights.set("doc-annotation-pending", pending);
    onCleanup(() => {
      CSS.highlights.delete("doc-annotation");
      CSS.highlights.delete("doc-annotation-focus");
      CSS.highlights.delete("doc-annotation-pending");
    });
  });

  const readSelection = () => {
    const element = options.container();
    if (!element || !options.enabled()) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return options.onSelect(null);
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return options.onSelect(null);
    const before = document.createRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    const anchor = anchorForSelection({
      markdown: options.markdown(),
      renderedText: element.textContent ?? "",
      renderedStart: before.toString().length,
      selectedText: range.toString(),
    });
    if (!anchor) return options.onSelect(null);
    const box = range.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    options.onSelect({
      ...anchor,
      top: box.bottom - frame.top + 6,
      left: Math.max(0, Math.min(box.left - frame.left, frame.width - 140)),
    });
  };

  createEffect(() => {
    const element = options.container();
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelectionChange = () => {
      clearTimeout(timer);
      timer = setTimeout(readSelection, 180);
    };
    const onClick = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      const caret = caretAt(event.clientX, event.clientY);
      if (!caret) return;
      const hit = threadRanges().find((entry) => entry.ranges.some((range) => range.isPointInRange(caret.node, caret.offset)));
      if (hit) options.onFocusThread(hit.id);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    element.addEventListener("click", onClick);
    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
      element.removeEventListener("click", onClick);
    });
  });

  /** Scrolls a thread's passage into view. */
  return {
    reveal: (id: string) => {
      const range = threadRanges().find((entry) => entry.id === id)?.ranges[0];
      const target = range?.startContainer.parentElement;
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
  };
}

// The comments panel ----------------------------------------------------------------------------------

export function CommentsPanel(props: {
  host: DocumentHost;
  docKey: string;
  threads: Thread[];
  loading: boolean;
  revision: { id: string | null; number: number };
  blocked: string | null;
  pending: SelectionAnchor | null;
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onClearPending: () => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [filter, setFilter] = createSignal<ThreadFilter>("open");
  const [draft, setDraft] = createSignal("");
  const shown = createMemo(() => visibleThreads(props.threads, filter()));
  const counts = createMemo(() => ({
    open: visibleThreads(props.threads, "open").length,
    resolved: visibleThreads(props.threads, "resolved").length,
  }));
  const refresh = () => client.invalidateQueries({ queryKey: documentKeys.annotations(props.host, props.docKey) });

  const create = createMutation(() => ({
    mutationFn: (body: string) =>
      documentsApi.annotations.create(props.host.owner, props.docKey, {
        baseRevisionId: props.revision.id!,
        baseRevisionNumber: props.revision.number,
        selector: props.pending!.selector,
        body,
      }),
    onSuccess: (thread) => {
      setDraft("");
      props.onClearPending();
      setFilter("open");
      props.onFocus(thread.id);
      void refresh();
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't add the comment", body: (error as Error).message }),
  }));

  const submit = () => {
    const body = draft().trim();
    if (!body || !props.pending || !props.revision.id || props.blocked || create.isPending) return;
    create.mutate(body);
  };

  return (
    <aside class="dc" aria-label="Comments on this document">
      <div class="dc-head">
        <h3 class="dc-title">Comments</h3>
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Close comments" onClick={() => props.onClose()}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <Segmented
        label="Show comments"
        options={[
          { value: "open", label: `Open ${counts().open}` },
          { value: "resolved", label: `Resolved ${counts().resolved}` },
          { value: "all", label: "All" },
        ]}
        value={filter()}
        onChange={setFilter}
      />
      <Show
        when={props.pending}
        fallback={
          <p class="dc-hint">
            <MessageSquarePlus size={14} aria-hidden="true" />
            {props.blocked ?? "Select text in the document to comment on it."}
          </p>
        }
      >
        {(pending) => (
          <div class="dc-composer">
            <blockquote class="dc-quote">{quote(pending().selectedText)}</blockquote>
            <TextArea
              rows={3}
              value={draft()}
              placeholder="Write a comment…"
              aria-label="Comment"
              ref={(element) => queueMicrotask(() => element.focus())}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
                if (event.key === "Escape") props.onClearPending();
              }}
            />
            <Show when={props.blocked}>{(reason) => <p class="dc-hint">{reason()}</p>}</Show>
            <div class="dc-actions">
              <Button size="compact" variant="quiet" onClick={() => props.onClearPending()}>
                Cancel
              </Button>
              <Button size="compact" variant="primary" disabled={!draft().trim() || Boolean(props.blocked) || create.isPending} onClick={submit}>
                {create.isPending ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={!props.loading} fallback={<p class="dc-hint">Loading…</p>}>
        <Show when={shown().length > 0} fallback={<p class="dc-hint">{filter() === "resolved" ? "No resolved comments." : "No comments yet."}</p>}>
          <ul class="dc-threads">
            <For each={shown()}>
              {(thread) => (
                <ThreadCard
                  host={props.host}
                  docKey={props.docKey}
                  thread={thread}
                  focused={thread.id === props.focusedId}
                  onFocus={() => props.onFocus(thread.id)}
                  onChanged={() => void refresh()}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </aside>
  );
}

function ThreadCard(props: {
  host: DocumentHost;
  docKey: string;
  thread: Thread;
  focused: boolean;
  onFocus: () => void;
  onChanged: () => void;
}) {
  const [reply, setReply] = createSignal("");
  let card: HTMLLIElement | undefined;
  createEffect(() => {
    if (props.focused) card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  const send = createMutation(() => ({
    mutationFn: (body: string) => documentsApi.annotations.reply(props.host.owner, props.docKey, props.thread.id, { body }),
    onSuccess: () => {
      setReply("");
      props.onChanged();
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't send the reply", body: (error as Error).message }),
  }));
  const status = createMutation(() => ({
    mutationFn: () =>
      documentsApi.annotations.setStatus(props.host.owner, props.docKey, props.thread.id, props.thread.status === "resolved" ? "open" : "resolved"),
    onSuccess: () => props.onChanged(),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't update the comment", body: (error as Error).message }),
  }));
  const submit = () => {
    const body = reply().trim();
    if (body && !send.isPending) send.mutate(body);
  };
  const author = (comment: Thread["comments"][number]) =>
    props.host.nameOf(comment.authorAgentId, comment.authorUserId) ?? (comment.authorType === "system" ? "Paperclip" : "Someone");

  return (
    <li
      ref={card}
      class="dc-thread"
      data-status={props.thread.status}
      data-anchor={props.thread.anchorState}
      data-focused={props.focused || undefined}
    >
      <button type="button" class="dc-quote dc-quote--button" aria-expanded={props.focused} onClick={() => props.onFocus()}>
        {quote(props.thread.selectedText)}
      </button>
      <Show when={props.thread.anchorState === "stale"}>
        <p class="dc-hint">The passage changed since this comment; it points at the closest match.</p>
      </Show>
      <ol class="dc-comments">
        <For each={props.focused ? props.thread.comments : props.thread.comments.slice(-1)}>
          {(comment) => (
            <li class="dc-comment">
              <span class="dc-comment-by">
                <strong>{author(comment)}</strong> · {stampLabel(comment.createdAt)}
              </span>
              <Markdown source={comment.body} class="dc-comment-body" />
            </li>
          )}
        </For>
      </ol>
      <Show
        when={props.focused}
        fallback={
          <Show when={props.thread.comments.length > 1}>
            <button type="button" class="dc-more" onClick={() => props.onFocus()}>
              {props.thread.comments.length - 1} earlier {props.thread.comments.length === 2 ? "reply" : "replies"}
            </button>
          </Show>
        }
      >
        <TextArea
          rows={2}
          value={reply()}
          placeholder="Reply…"
          aria-label="Reply"
          onInput={(event) => setReply(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div class="dc-actions">
          <Button
            size="compact"
            icon={props.thread.status === "resolved" ? <RotateCcw size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
            disabled={status.isPending}
            onClick={() => status.mutate()}
          >
            {props.thread.status === "resolved" ? "Reopen" : "Resolve"}
          </Button>
          <Button size="compact" variant="primary" disabled={!reply().trim() || send.isPending} onClick={submit}>
            {send.isPending ? "Sending…" : "Reply"}
          </Button>
        </div>
      </Show>
    </li>
  );
}

