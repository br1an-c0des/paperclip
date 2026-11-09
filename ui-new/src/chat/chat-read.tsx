import type { IssueComment } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, on, onCleanup, untrack } from "solid-js";
import { chatApi } from "@/api/chat";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLiveEvent } from "@/lib/live-events";
import { useSession } from "@/lib/session";
import { useChatListQuery } from "./chat-index";
import { badgeCount, newestUnreadable, readThrough, unreadChatCounts, unreadMessagesLabel } from "./chat-model";
import "./ChatRead.css";

/*
 * Read state for agent chat (decision 48, build plan 3.13), after ui/src/hooks/useAgentChatRead.tsx
 * and the old sidebar's dots:
 *
 * - A chat is unread for you while it has agent messages newer than where you last read
 *   (`isUnreadForMe` on `GET /companies/:id/chats`). Agent replies count, and so do messages an
 *   agent sends from another task's run (briefings and reports). `unreadMessageCount` says how
 *   many (U65, upstream #19627).
 * - The open chat marks itself read up to its newest agent message while you can see it: the
 *   window is visible and focused, and you're at the foot of the thread
 *   (`POST /issues/:id/read` with `throughCommentId`).
 * - `useUnreadChats()` gives the agents with unread chats and their counts, for a badge beside each
 *   in the nav and on the dock (`ChatUnreadBadge`). It keeps the list fresh from live events:
 *   activity on one of your chats, or a message delivered to a chat of yours that isn't listed yet.
 */

/** The agents whose chats with you have messages you haven't read, and how many messages. */
export function useUnreadChats(openAgentId?: () => string | null | undefined) {
  const company = useCompany();
  const client = useQueryClient();
  const session = useSession();
  const chats = useChatListQuery();
  useLiveEvent(["activity.logged"], (event) => {
    const payload = event.payload ?? {};
    if (payload.entityType !== "issue") return;
    const entityId = typeof payload.entityId === "string" ? payload.entityId : null;
    const details = (payload.details ?? null) as Record<string, unknown> | null;
    const known = !!entityId && (untrack(() => chats.data) ?? []).some((chat) => chat.id === entityId);
    const delivered = typeof details?.conversationUserId === "string" && details.conversationUserId === untrack(session.youId);
    if (known || delivered || payload.action === "issue.conversation_opened") void client.invalidateQueries({ queryKey: queryKeys.chat.list(company().id) });
  });
  const counts = createMemo(() => unreadChatCounts(chats.data, openAgentId?.()));
  const messages = createMemo(() => [...counts().values()].reduce((sum, count) => sum + count, 0));
  return {
    /** Unread messages in your chat with this agent; 0 when it's read. */
    countFor: (agentId: string) => counts().get(agentId) ?? 0,
    /** How many chats have unread messages. */
    count: () => counts().size,
    /** Unread messages across your chats. */
    messages,
  };
}

/** The badge for a chat with messages you haven't read: how many, in the run tone. */
export function ChatUnreadBadge(props: { count: number; class?: string; from?: string }) {
  const label = () => `${unreadMessagesLabel(props.count)}${props.from ? ` from ${props.from}` : ""}`;
  return (
    <span class={`ch-unread${props.class ? ` ${props.class}` : ""}`} role="img" aria-label={label()} title={label()}>
      {badgeCount(props.count)}
    </span>
  );
}

const RETRY_MS = [1_500, 5_000];

/**
 * Marks the open chat read up to its newest agent message whenever you can see it. `atFoot` says
 * whether the reader is at the foot of the thread; scrolling, focus and the tab showing again check
 * once more. A refused mark (the chat isn't yours, or it's gone) isn't tried again for that message.
 */
export function useChatReadMarker(options: {
  chatId: () => string | null;
  agentId: () => string;
  /** Whether the chat was unread when it loaded (`isUnreadForMe`). */
  unread: () => boolean;
  comments: () => readonly IssueComment[];
  /** True once the chat and its first page of messages have loaded. */
  ready: () => boolean;
  atFoot: () => boolean;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const newest = createMemo(() => newestUnreadable(options.comments()));
  // Where this view last marked the chat read. Until the first load it's unknown; a chat that
  // loads already read starts from its newest message, so only messages after it are marked.
  let marked: { id: string; at: number } | null = null;
  let baseline = false;
  let busy = false;
  let failures = 0;
  let refused: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const visible = () => typeof document === "undefined" || (document.visibilityState === "visible" && document.hasFocus());

  const check = async () => {
    const chatId = options.chatId();
    if (!chatId || !baseline || busy || timer !== undefined) return;
    const target = readThrough(newest(), { unread: untrack(options.unread), marked });
    if (!target || target === refused || !visible() || !options.atFoot()) return;
    const at = new Date(newest()!.createdAt).getTime();
    busy = true;
    try {
      await chatApi.markRead(chatId, target);
      marked = { id: target, at };
      failures = 0;
      void client.invalidateQueries({ queryKey: queryKeys.chat.list(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.chat.detail(company().id, options.agentId()) });
    } catch (error) {
      const retryable = !(error instanceof ApiError) || error.status === 408 || error.status === 429 || error.status >= 500;
      const delay = RETRY_MS[failures];
      if (retryable && delay !== undefined) {
        failures += 1;
        timer = setTimeout(() => {
          timer = undefined;
          void check();
        }, delay);
      } else refused = target;
    } finally {
      busy = false;
    }
  };

  createEffect(
    on(options.ready, (ready) => {
      if (!ready || baseline) return;
      baseline = true;
      if (!untrack(options.unread)) {
        const latest = untrack(newest);
        marked = latest ? { id: latest.id, at: new Date(latest.createdAt).getTime() } : { id: "", at: -Infinity };
      }
      queueMicrotask(() => void check());
    }),
  );
  createEffect(on(() => newest()?.id, () => queueMicrotask(() => void check()), { defer: true }));

  const onChange = () => void check();
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  onCleanup(() => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  });

  return { check };
}
