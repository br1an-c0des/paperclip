import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { chatApi } from "@/api/chat";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";

/*
 * Which tasks are your chats, and with whom (`GET /companies/:id/chats`), for pages that get chats
 * back as tasks, such as search (decision 8). Only your own chats are listed; another person's chat
 * that you can see still looks like a task, since the task-shaped responses don't say.
 */
export function useChatIndex() {
  const company = useCompany();
  const settings = useExperimentalSettingsQuery();
  const chats = createQuery(() => ({
    queryKey: queryKeys.chat.list(company().id),
    queryFn: ({ signal }) => chatApi.list(company().id, signal),
    enabled: settings.data?.enableAgentChat === true,
    staleTime: 60_000,
  }));
  const byIssue = createMemo(
    () => new Map((chats.data ?? []).flatMap((chat) => (chat.conversationAgentId ? [[chat.id, chat.conversationAgentId] as const] : []))),
  );
  return {
    /** The agent a chat is with, by the chat's task id. */
    agentIdFor: (issueId: string | null | undefined) => (issueId ? byIssue().get(issueId) : undefined),
  };
}
