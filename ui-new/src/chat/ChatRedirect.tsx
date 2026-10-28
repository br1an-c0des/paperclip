import { Navigate, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { chatApi } from "@/api/chat";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useExperimentalSettingsQuery } from "@/lib/company-data";
import { chatPath } from "./chat-model";

/*
 * The old UI's chat addresses, which agents, Slack and email still link to (ui/src/App.tsx):
 *
 * - `/:prefix/chats/:agentRef` (an agent's URL key or id, and anything after it) opens that agent's
 *   chat at its own address.
 * - `/:prefix/chats` opens your primary agent's chat, else your latest chat, else the agents list,
 *   as the old chat home picked one.
 */

export function ChatRedirect() {
  const params = useParams<{ agentRef: string }>();
  const company = useCompany();
  return <Navigate href={chatPath(company().issuePrefix, encodeURIComponent(params.agentRef))} />;
}

export function ChatsHomeRedirect() {
  const company = useCompany();
  const agents = useAgentsQuery();
  const settings = useExperimentalSettingsQuery();
  const primary = createQuery(() => ({
    queryKey: queryKeys.agents.primary(company().id),
    queryFn: ({ signal }) => agentsApi.primaryAgent(company().id, signal),
    retry: false,
  }));
  const chats = createQuery(() => ({
    queryKey: queryKeys.chat.list(company().id),
    queryFn: ({ signal }) => chatApi.list(company().id, signal),
    enabled: settings.data?.enableAgentChat === true,
    staleTime: 60_000,
  }));
  const ready = () =>
    !agents.isLoading && !primary.isLoading && !settings.isLoading && (settings.data?.enableAgentChat !== true || !chats.isLoading);
  const target = () => {
    const live = (agents.data ?? []).filter((agent) => agent.status !== "terminated");
    const primaryAgent = live.find((agent) => agent.id === primary.data?.primaryAgentId);
    if (primaryAgent) return chatPath(company().issuePrefix, primaryAgent.urlKey);
    const latest = [...(chats.data ?? [])]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((chat) => live.find((agent) => agent.id === chat.conversationAgentId))
      .find(Boolean);
    return latest ? chatPath(company().issuePrefix, latest.urlKey) : `/${company().issuePrefix}/agents`;
  };
  return (
    <Show when={ready()}>
      <Navigate href={target()} />
    </Show>
  );
}
