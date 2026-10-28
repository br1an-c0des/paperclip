import type { AgentDetail, EmailEndpointSummary } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { chatEndpointsApi } from "@/api/chat-endpoints";
import { emailApi } from "@/api/email";
import { queryKeys } from "@/api/queryKeys";
import { chatApps, chatConnectHref, channelMethod, chatProviderVisible, endpointState, providerName } from "@/apps/chat/chat-model";
import { useChatEndpoints } from "@/apps/chat/parts";
import { StateTag, useGallery } from "@/apps/shared";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { buttonClass, Button } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { failure } from "../shared";

/*
 * The agent's channels (`agents/channels`): the chat endpoints people reach it through (Slack,
 * GitHub, Teams, Discord, Telegram, a voice persona) and its email inboxes, each opening its page in
 * Apps, with Connect a channel and Disconnect. Chat endpoints show only while the instance has
 * `enableChatConnectors` on (GitHub review bots: `enableGitHubReviewBots`); email inboxes always.
 */

type ChannelRow = { id: string; provider: string; label: string; detail: string | null; state: ReturnType<typeof endpointState> };

function inboxState(inbox: EmailEndpointSummary): ChannelRow["state"] {
  return inbox.status === "active"
    ? { kind: "connected", label: "Connected", tone: "green", message: null }
    : inbox.status === "paused"
      ? { kind: "paused", label: "Paused", tone: null, message: null }
      : { kind: "attention", label: inbox.status.replace(/_/g, " "), tone: "amber", message: inbox.lastError };
}

export function ChannelsPanel(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const base = () => `/${company().issuePrefix}/apps`;
  const flags = useExperimentalSettingsQuery();
  const gallery = useGallery();
  const chatOn = () => flags.data?.enableChatConnectors === true || flags.data?.enableGitHubReviewBots === true;
  const endpoints = useChatEndpoints(chatOn);
  const inboxes = createQuery(() => ({
    queryKey: queryKeys.tools.emailInboxes(company().id),
    queryFn: ({ signal }) => emailApi.inboxes(company().id, signal),
    retry: false,
  }));

  const rows = createMemo<ChannelRow[]>(() => {
    const chat = (chatOn() ? (endpoints.data ?? []) : [])
      .filter((endpoint) => endpoint.assignedAgentId === props.agent.id && endpoint.status !== "archived" && endpoint.provider !== "agentmail")
      .filter((endpoint) => chatProviderVisible(endpoint.provider, flags.data))
      .map((endpoint) => ({
        id: endpoint.id,
        provider: endpoint.provider,
        label: providerName(endpoint.provider),
        detail: endpoint.providerAccountLabel ?? endpoint.botLabel ?? null,
        state: endpointState(endpoint),
      }));
    const email = (inboxes.data ?? [])
      .filter((inbox) => inbox.assignedAgentId === props.agent.id && inbox.status !== "archived")
      .map((inbox) => ({ id: inbox.id, provider: "agentmail", label: "Email", detail: inbox.address ?? "Being set up", state: inboxState(inbox) }));
    return [...chat, ...email];
  });
  const providers = createMemo(() =>
    chatApps(gallery.data?.apps ?? [], flags.data)
      .map((app) => ({ app, provider: channelMethod(app)!.provider }))
      .sort((a, b) => a.app.name.localeCompare(b.app.name)),
  );

  const [removing, setRemoving] = createSignal<ChannelRow | null>(null);
  const remove = createMutation(() => ({
    mutationFn: async (row: ChannelRow) => {
      if (row.provider === "agentmail") await emailApi.control(row.id, "remove");
      else await chatEndpointsApi.setup(row.id, { action: "remove" });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.chatEndpoints.all(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.tools.emailInboxes(company().id) });
      pushToast({ tone: "success", title: "Channel disconnected" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't disconnect it", body: failure(error, "Try again.") }),
  }));

  return (
    <SettingsCard
      title="Channels"
      description={`Where people reach ${props.agent.name} outside Paperclip. Each conversation becomes a task.`}
      footer={
        <Show when={providers().length > 0}>
          <Menu>
            <Menu.Trigger as={Button} size="compact">
              Connect a channel
            </Menu.Trigger>
            <Menu.Content label="Connect a channel" width={220}>
              <For each={providers()}>
                {(entry) => (
                  <Menu.Item onSelect={() => navigate(chatConnectHref(base(), entry.provider, { agentId: props.agent.id }))}>
                    {entry.provider === "agentmail" ? "Email (AgentMail)" : entry.app.name}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </Show>
      }
    >
      <Show when={endpoints.isError && chatOn()}>
        <p class="ps-list-note" role="alert">
          Couldn't load the chat channels. {failure(endpoints.error, "")}
        </p>
      </Show>
      <ul class="ps-list">
        <For
          each={rows()}
          fallback={
            <Show when={!endpoints.isPending || !chatOn()}>
              <li class="ps-list-note">No channels yet.</li>
            </Show>
          }
        >
          {(row) => (
            <li class="ps-list-row">
              <span class="ps-list-name">
                <A href={`${base()}/chat/${row.id}/settings`}>
                  <b>{row.label}</b>
                </A>
                <Show when={row.detail}>
                  <span class="ps-list-meta">{row.detail}</span>
                </Show>
              </span>
              <StateTag state={row.state} />
              <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`${base()}/chat/${row.id}/settings`}>
                Open
              </A>
              <Button size="compact" variant="quiet" disabled={remove.isPending} onClick={() => setRemoving(row)}>
                Disconnect
              </Button>
            </li>
          )}
        </For>
      </ul>
      <ConfirmDialog
        open={removing() !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Disconnect ${removing()?.label ?? "this channel"}?`}
        body={`${props.agent.name} stops receiving new work from it. Existing tasks stay.`}
        confirmLabel="Disconnect"
        danger
        onConfirm={() => remove.mutateAsync(removing()!)}
      />
    </SettingsCard>
  );
}
