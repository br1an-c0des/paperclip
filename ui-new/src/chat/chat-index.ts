import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { chatApi } from "@/api/chat";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useExperimentalSettingsQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { chatPath, yourChatAgent, type ChatLike } from "./chat-model";

/*
 * Which tasks are your chats, and with whom (`GET /companies/:id/chats`), for pages that get chats
 * back as tasks: search, the task page and modal, workload, the agent's sessions and the Org
 * dashboard's activity (decision 8). Every page shares the one query (`chat.list`).
 *
 * Only your own chats are listed. A full task response also says (`conversationAgentId`), so a task
 * loaded on its own is recognised before the list arrives; compact lists and search results don't,
 * so another person's chat still looks like a task there.
 */
export function useChatIndex() {
  const company = useCompany();
  const session = useSession();
  const agents = useAgentsQuery();
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
  const byIdentifier = createMemo(
    () =>
      new Map((chats.data ?? []).flatMap((chat) => (chat.conversationAgentId && chat.identifier ? [[chat.identifier, chat.conversationAgentId] as const] : []))),
  );
  const href = (agentId: string) => chatPath(company().issuePrefix, agents.data?.find((agent) => agent.id === agentId)?.urlKey ?? agentId);
  return {
    /** Whether the list of your chats has loaded (or isn't coming: chat is off). */
    settled: () => settings.isSuccess && (settings.data?.enableAgentChat !== true || chats.isSuccess || chats.isError),
    /** Your chats' task ids. */
    ids: createMemo(() => new Set(byIssue().keys())),
    /** The agent a chat is with, by the chat's task id. */
    agentIdFor: (issueId: string | null | undefined) => (issueId ? byIssue().get(issueId) : undefined),
    /** The agent a task is your chat with, from the list or the task's own fields. */
    chatAgentOf: (task: ChatLike) => yourChatAgent(task, byIssue(), session.youId()),
    /** The agent, when a task reference (an id or an identifier like TES-13) is one of your chats. */
    agentIdForRef: (ref: string) => byIssue().get(ref) ?? byIdentifier().get(ref.toUpperCase()),
    /** The chat's address, by its agent. */
    href,
  };
}

export type ChatIndex = ReturnType<typeof useChatIndex>;
