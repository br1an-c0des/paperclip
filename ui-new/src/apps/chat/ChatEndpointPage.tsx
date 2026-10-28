import type { ChatActivityItem, VoiceCallHistoryEntry } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowDownLeft, ArrowUpRight, Activity as ActivityIcon, ExternalLink, Pause, Phone, Play, RefreshCw, Trash2, Unlink } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { chatEndpointsApi, githubChatApi, voiceApi, type ChatEndpoint, type ChatEndpointResource, type ChatResolution } from "@/api/chat-endpoints";
import { emailApi } from "@/api/email";
import { queryKeys } from "@/api/queryKeys";
import { dateTime } from "@/agents/shared";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextArea, TextInput } from "@/ui/Field";
import { PageHeader, Tabs } from "@/ui/PageHeader";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { failureText, StateTag } from "../shared";
import {
  ACTIVITY_KIND_LABELS,
  canReplay,
  canResolve,
  chatConnectHref,
  endpointState,
  healthPresentation,
  isToggleableResource,
  LIFECYCLE_GUIDANCE,
  needsSetup,
  providerName,
  RESOLUTION_LABELS,
  resolutionActions,
  resolutionText,
  tabsFor,
  type ChatTab,
} from "./chat-model";
import { Card, CopyValue, useChatEndpoint } from "./parts";

/*
 * One chat endpoint (`/apps/chat/:endpointId/:tab`, the old UI's ChatEndpointDetail):
 *
 * - Settings: the channels and groups it answers in, direct messages, Slack's @mention rule and how
 *   the agent writes there; a voice persona's phone line and the incoming calls waiting for a code;
 *   an AgentMail inbox's address and receiving mode.
 * - Access: the people whose chat identities are linked to Paperclip accounts (a personal
 *   confirmation link for each one waiting, disconnecting a linked one), and whether people without
 *   a linked account may start isolated tasks.
 * - Reviews (GitHub): the pull request reviews its bot made.
 * - Conversations: each conversation and the task behind it.
 * - Activity: the endpoint's health, pause, resume, reconnect and remove, then every delivery,
 *   publication and provider action, with Replay for a failed one and Resolve for one Paperclip
 *   lost track of; a voice persona's calls join the first page.
 *
 * Not here: task defaults (project and workspace for new chat tasks), Slack's tools and personal
 * search, the GitHub bot's repository and review settings, and Speko's callback number.
 */

export function ChatEndpointPage(props: { endpointId: string; tab: ChatTab }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const base = () => `/${company().issuePrefix}/apps`;
  // Activity and conversations follow provider callbacks, which don't always log activity.
  const query = useChatEndpoint(
    () => props.endpointId,
    () => (props.tab === "activity" || props.tab === "conversations" ? 5000 : false),
  );

  return (
    <Switch>
      <Match when={query.isPending}>
        <p class="ap-empty card" role="status">
          Loading the connection…
        </p>
      </Match>
      <Match when={query.isError || !query.data}>
        <section class="card ap-later">
          <h2 class="disp">Chat connection not found</h2>
          <p>
            It may have been removed. <A href={base()}>Back to Apps</A>
          </p>
        </section>
      </Match>
      <Match when={query.data}>
        {(endpoint) => {
          const agent = () => agents.data?.find((candidate) => candidate.id === endpoint().assignedAgentId);
          const name = () => providerName(endpoint().provider);
          const tabs = () => tabsFor(endpoint().provider);
          const slackUrl = () => {
            if (endpoint().provider !== "slack") return null;
            const appId = endpoint().setup?.slackRegistration?.appId;
            return appId ? `https://api.slack.com/apps/${encodeURIComponent(appId)}/oauth` : "https://api.slack.com/apps";
          };
          return (
            <>
              <PageHeader
                size="compact"
                mark={<AgentAvatar agent={agent() ?? { id: endpoint().assignedAgentId, name: endpoint().assignedAgentName }} size={40} />}
                crumbs={
                  <>
                    <A href={base()}>Apps</A>
                    <span aria-hidden="true">/</span>
                    <span>{name()}</span>
                  </>
                }
                title={`${endpoint().assignedAgentName} in ${name()}`}
                numbers={
                  <>
                    <StateTag state={endpointState(endpoint())} />
                    <Show when={endpoint().providerAccountLabel ?? (endpoint().provider === "agentmail" ? endpoint().botExternalId : null)}>
                      {(label) => <span>{label()}</span>}
                    </Show>
                    <Show when={endpoint().lastActivityAt}>{(at) => <span>Last message {dateTime(at())}</span>}</Show>
                  </>
                }
                actions={
                  <>
                    <Show when={slackUrl()}>
                      {(url) => (
                        <a class={buttonClass({ size: "compact", variant: "quiet" })} href={url()} target="_blank" rel="noopener noreferrer">
                          Slack app settings
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      )}
                    </Show>
                    <Show when={needsSetup(endpoint()) && endpoint().provider !== "agentmail"}>
                      <A class={buttonClass({ size: "compact", variant: "primary" })} href={chatConnectHref(base(), endpoint().provider, { resume: endpoint().id })}>
                        Continue setup
                      </A>
                    </Show>
                  </>
                }
                tabs={<Tabs label="Chat connection" items={tabs().map((tab) => ({ label: tab.label, href: `${base()}/chat/${endpoint().id}/${tab.key}` }))} />}
              />
              <Switch>
                <Match when={props.tab === "settings"}>
                  <SettingsTab endpoint={endpoint()} />
                </Match>
                <Match when={props.tab === "access"}>
                  <AccessTab endpoint={endpoint()} />
                </Match>
                <Match when={props.tab === "reviews" && endpoint().provider === "github"}>
                  <ReviewsTab endpoint={endpoint()} />
                </Match>
                <Match when={props.tab === "conversations"}>
                  <ConversationsTab endpoint={endpoint()} />
                </Match>
                <Match when={props.tab === "activity"}>
                  <ActivityTab endpoint={endpoint()} />
                </Match>
                <Match when={true}>
                  <p class="card ap-empty">This connection has no {props.tab} tab.</p>
                </Match>
              </Switch>
            </>
          );
        }}
      </Match>
    </Switch>
  );
}

/** Saves an endpoint change and puts the answer in the cache. */
function useUpdateEndpoint(endpoint: () => ChatEndpoint) {
  const company = useCompany();
  const client = useQueryClient();
  return createMutation(() => ({
    mutationFn: (input: Parameters<typeof chatEndpointsApi.update>[1]) => chatEndpointsApi.update(endpoint().id, input),
    onSuccess: (next) => client.setQueryData(queryKeys.chatEndpoints.detail(company().id, next.id), next),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save", body: failureText(error, "Try again.") }),
  }));
}

// ---------------------------------------------------------------------------------------------
// Settings

function SettingsTab(props: { endpoint: ChatEndpoint }) {
  return (
    <Switch>
      <Match when={props.endpoint.provider === "agentmail"}>
        <InboxSettings endpoint={props.endpoint} />
      </Match>
      <Match when={props.endpoint.provider === "speko"}>
        <PhoneLine endpoint={props.endpoint} />
        <IncomingCalls endpoint={props.endpoint} />
      </Match>
      <Match when={true}>
        <Destinations endpoint={props.endpoint} />
        <Behaviour endpoint={props.endpoint} />
      </Match>
    </Switch>
  );
}

function Destinations(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "resources");
  const resources = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => chatEndpointsApi.resources(props.endpoint.id, signal),
    refetchInterval: props.endpoint.provider === "slack" ? 5000 : false,
    retry: false,
  }));
  const shown = () => (resources.data ?? []).filter((resource) => isToggleableResource(props.endpoint.provider, resource.type));
  const save = createMutation(() => ({
    // One resource at a time, so a stale list never overwrites someone else's change.
    mutationFn: (resource: Pick<ChatEndpointResource, "id" | "enabled">) => chatEndpointsApi.updateResources(props.endpoint.id, [resource]),
    onSuccess: (next) => client.setQueryData(key(), next),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't change that channel", body: failureText(error, "Try again.") }),
  }));
  const isSlack = () => props.endpoint.provider === "slack";
  return (
    <Card
      title={isSlack() ? "Channels" : "Where it answers"}
      description={
        props.endpoint.provider === "imessage-photon" && props.endpoint.photonAllocation === "shared"
          ? "A shared Photon line takes direct messages only; enroll senders in Photon and link them in Access."
          : isSlack()
            ? `Invite ${props.endpoint.assignedAgentName} to a channel in Slack to add it here.`
            : "Turn each channel or group on or off."
      }
    >
      <Switch>
        <Match when={resources.isPending}>
          <p class="cx-static">Loading…</p>
        </Match>
        <Match when={resources.isError}>
          <p class="cx-note cx-note--error" role="alert">
            Couldn't load its channels.{" "}
            <button type="button" class="cx-link" onClick={() => void resources.refetch()}>
              Try again
            </button>
          </p>
        </Match>
        <Match when={shown().length === 0}>
          <p class="cx-static">No channels yet.</p>
        </Match>
        <Match when={true}>
          <ul class="ch-list">
            <For each={shown()}>
              {(resource) => (
                <li>
                  <Toggle
                    checked={resource.enabled}
                    disabled={resource.availability !== "available" || props.endpoint.photonAllocation === "shared" || save.isPending}
                    onChange={(enabled) => save.mutate({ id: resource.id, enabled })}
                    label={resource.label}
                    description={
                      [
                        resource.availability === "available" ? resource.detail : "Unavailable at the provider",
                        resource.participants?.length ? `With ${resource.participants.join(", ")}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  />
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </Card>
  );
}

function Behaviour(props: { endpoint: ChatEndpoint }) {
  const update = useUpdateEndpoint(() => props.endpoint);
  const [instructions, setInstructions] = createSignal(props.endpoint.communicationInstructions ?? "");
  createEffect(on(() => props.endpoint.communicationInstructions, (value) => setInstructions(value ?? ""), { defer: true }));
  const command = () => props.endpoint.setup?.command ?? `/task@${props.endpoint.botUsername?.replace(/^@/, "") ?? "bot_username"}`;
  return (
    <Show when={props.endpoint.provider !== "github"}>
      <Card title="How it answers">
        <Toggle
          checked={props.endpoint.allowDirectMessages ?? false}
          disabled={update.isPending}
          onChange={(allowDirectMessages) => update.mutate({ allowDirectMessages })}
          label="Allow direct messages"
          description={props.endpoint.provider === "discord" ? "People must also allow direct messages in the server's privacy settings." : undefined}
        />
        <Show when={props.endpoint.provider === "slack"}>
          <Toggle
            checked={props.endpoint.requireAtMention ?? false}
            disabled={update.isPending}
            onChange={(requireAtMention) => update.mutate({ requireAtMention })}
            label="Answer only when @mentioned"
            description="In channels, including thread replies. Direct messages never need a mention."
          />
        </Show>
        <Show when={props.endpoint.provider === "microsoft-teams"}>
          <Toggle
            checked={props.endpoint.allowGroupChats ?? false}
            disabled={update.isPending}
            onChange={(allowGroupChats) => update.mutate({ allowGroupChats })}
            label="Allow group chats"
            description="The bot may take part in group chats it's installed in."
          />
        </Show>
        <Show when={props.endpoint.provider === "telegram"}>
          <div class="ch-copy">
            <span class="ch-copy-label">Group command</span>
            <code class="ap-code mono">{command()} &lt;request&gt;</code>
            <span class="cx-note">Telegram doesn't pass ordinary mentions to bots in groups: use this command, or reply to the bot.</span>
          </div>
        </Show>
        <Show when={props.endpoint.provider === "slack"}>
          <div class="ch-copy">
            <label class="ch-copy-label" for="ch-instructions">
              How to write in Slack
            </label>
            <TextArea
              id="ch-instructions"
              rows={4}
              maxLength={4000}
              placeholder="For example: keep replies short, use threads, never @channel."
              value={instructions()}
              onInput={(event) => setInstructions(event.currentTarget.value)}
            />
            <div class="cx-actions">
              <span />
              <Button
                size="compact"
                disabled={update.isPending || instructions() === (props.endpoint.communicationInstructions ?? "")}
                onClick={() => update.mutate({ communicationInstructions: instructions() })}
              >
                Save
              </Button>
            </div>
          </div>
        </Show>
      </Card>
    </Show>
  );
}

function InboxSettings(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const inboxes = createQuery(() => ({
    queryKey: queryKeys.tools.emailInboxes(company().id),
    queryFn: ({ signal }) => emailApi.inboxes(company().id, signal),
    retry: false,
  }));
  const inbox = () => inboxes.data?.find((entry) => entry.id === props.endpoint.id) ?? null;
  return (
    <Card title="Inbox" description={`Email to this address becomes tasks for ${props.endpoint.assignedAgentName}; replies stay in the same task.`}>
      <Show when={inbox()} fallback={<p class="cx-static">{inboxes.isPending ? "Loading…" : "The inbox details aren't available."}</p>}>
        {(current) => (
          <dl class="ch-facts">
            <dt>Address</dt>
            <dd>{current().address ?? "Being set up"}</dd>
            <dt>Receiving</dt>
            <dd>{current().receiveMode === "webhook" ? "Webhook" : "Live connection (no public address needed)"}</dd>
            <dt>Status</dt>
            <dd>{current().status.replace(/_/g, " ")}</dd>
            <Show when={current().lastSyncAt}>
              <dt>Last checked</dt>
              <dd>{dateTime(current().lastSyncAt)}</dd>
            </Show>
            <Show when={current().lastError}>
              <dt>Last error</dt>
              <dd>{current().lastError}</dd>
            </Show>
          </dl>
        )}
      </Show>
      <Show when={props.endpoint.connectionId}>
        {(connectionId) => (
          <p class="cx-note">
            The AgentMail account and which agents may use it are on its <A href={`/${company().issuePrefix}/apps/${connectionId()}/permissions`}>connection page</A>.
          </p>
        )}
      </Show>
    </Card>
  );
}

function PhoneLine(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "voice-phone");
  const phone = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => voiceApi.phone(company().id, props.endpoint.id, signal),
    enabled: props.endpoint.status === "active",
    retry: false,
  }));
  const [numberId, setNumberId] = createSignal("");
  createEffect(on(() => phone.data?.number?.id, (id) => setNumberId(id ?? phone.data?.inventory.find((entry) => entry.available)?.id ?? "")));
  const save = createMutation(() => ({
    mutationFn: (input: { numberId: string; enabled: boolean; guestIntake?: boolean }) => voiceApi.savePhone(company().id, props.endpoint.id, input),
    onSuccess: (next) => client.setQueryData(key(), next),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save the phone line", body: failureText(error, "Try again.") }),
  }));
  const current = () => phone.data?.number ?? null;
  return (
    <Card title="Phone line" description="A Speko phone number people can call to reach the agent.">
      <Switch>
        <Match when={props.endpoint.status !== "active"}>
          <p class="cx-static">Finish setting up the voice persona first.</p>
        </Match>
        <Match when={phone.isPending}>
          <p class="cx-static">Loading…</p>
        </Match>
        <Match when={phone.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(phone.error, "Couldn't load the phone line.")}
          </p>
        </Match>
        <Match when={(phone.data?.inventory.length ?? 0) === 0 && !current()}>
          <p class="cx-static">There are no phone numbers in this Speko account yet.</p>
        </Match>
        <Match when={true}>
          <label class="ch-copy">
            <span class="ch-copy-label">Number</span>
            <select class="input" value={numberId()} onChange={(event) => setNumberId(event.currentTarget.value)} disabled={save.isPending}>
              <For each={phone.data?.inventory ?? []}>
                {(entry) => (
                  <option value={entry.id} disabled={!entry.available && entry.id !== current()?.id}>
                    {entry.phoneNumber}
                    {entry.label ? ` · ${entry.label}` : ""}
                    {entry.issues.length ? ` · ${entry.issues.join(", ")}` : ""}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Toggle
            checked={current()?.enabled ?? false}
            disabled={!numberId() || save.isPending}
            onChange={(enabled) => save.mutate({ numberId: numberId(), enabled, guestIntake: current()?.guestIntake })}
            label="Answer calls on this number"
          />
          <Toggle
            checked={current()?.guestIntake ?? false}
            disabled={!current() || save.isPending}
            onChange={(guestIntake) => save.mutate({ numberId: numberId(), enabled: current()?.enabled ?? false, guestIntake })}
            label="Let unknown callers start a new task"
            description="Under a task-scoped low-trust policy. Private calls still need their code approved here."
          />
        </Match>
      </Switch>
    </Card>
  );
}

function IncomingCalls(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "voice-incoming");
  const calls = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => voiceApi.incoming(company().id, props.endpoint.id, signal),
    enabled: props.endpoint.status === "active",
    refetchInterval: 4000,
    retry: false,
  }));
  const [codes, setCodes] = createSignal<Record<string, string>>({});
  const waiting = () => (calls.data ?? []).filter((call) => call.state === "awaiting_approval");
  const decide = createMutation(() => ({
    mutationFn: (input: { callId: string; approve: boolean }) =>
      voiceApi.decide(company().id, props.endpoint.id, input.callId, { approve: input.approve, approvalCode: codes()[input.callId] ?? "" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key() }),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't answer the call", body: failureText(error, "Check the code and try again.") }),
  }));
  return (
    <Show when={props.endpoint.status === "active"}>
      <Card title="Calls waiting for you" description="A private incoming call goes ahead once you enter the code the caller hears.">
        <Show when={waiting().length > 0} fallback={<p class="cx-static">No calls are waiting.</p>}>
          <ul class="ch-list">
            <For each={waiting()}>
              {(call) => (
                <li class="ch-row">
                  <Phone size={16} aria-hidden="true" />
                  <span class="ch-row-main">
                    <b>Call at {dateTime(call.createdAt)}</b>
                    <span class="ch-row-meta">Expires {dateTime(call.expiresAt)}</span>
                  </span>
                  <TextInput
                    aria-label="Code the caller hears"
                    placeholder="Code"
                    class="ch-code-input"
                    value={codes()[call.id] ?? ""}
                    onInput={(event) => setCodes({ ...codes(), [call.id]: event.currentTarget.value })}
                  />
                  <Button size="compact" disabled={decide.isPending || !(codes()[call.id] ?? "").trim()} onClick={() => decide.mutate({ callId: call.id, approve: true })}>
                    Approve
                  </Button>
                  <Button size="compact" variant="quiet" disabled={decide.isPending} onClick={() => decide.mutate({ callId: call.id, approve: false })}>
                    Decline
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Card>
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// Access

function AccessTab(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const update = useUpdateEndpoint(() => props.endpoint);
  const key = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "principals");
  const usesLinks = () => props.endpoint.provider !== "speko" && props.endpoint.provider !== "agentmail" && props.endpoint.provider !== "github";
  const links = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => chatEndpointsApi.principals(props.endpoint.id, signal),
    enabled: usesLinks(),
    refetchInterval: 5000,
    retry: false,
  }));
  const [confirmation, setConfirmation] = createSignal<{ who: string; url: string } | null>(null);
  const intent = createMutation(() => ({
    mutationFn: (input: { principalId: string; who: string }) => chatEndpointsApi.linkIntent(props.endpoint.id, input.principalId),
    onSuccess: (result, input) => setConfirmation({ who: input.who, url: new URL(result.confirmationUrl, window.location.origin).toString() }),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't make a confirmation link", body: failureText(error, "Try again.") }),
  }));
  const revoke = createMutation(() => ({
    mutationFn: (principalId: string) => chatEndpointsApi.revokeLink(props.endpoint.id, principalId),
    onSuccess: () => client.invalidateQueries({ queryKey: key() }),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't disconnect the account", body: failureText(error, "Try again.") }),
  }));
  const joinCommand = () => `${props.endpoint.setup?.slackApp?.command ?? props.endpoint.setup?.command ?? "/paperclip"} connect`;
  const invitation = () => {
    const workspace = props.endpoint.providerAccountId ? `https://app.slack.com/client/${encodeURIComponent(props.endpoint.providerAccountId)}` : "https://app.slack.com/";
    return `Talk to ${props.endpoint.assignedAgentName} in Slack: ${workspace}\nSend ${joinCommand()}, then open the bot's private link and sign in to Paperclip to confirm your account. If you're new to the organization, ask for access and an admin will approve it.`;
  };

  return (
    <Switch>
      <Match when={props.endpoint.provider === "speko"}>
        <Card title="Private voice access">
          <p class="cx-note">
            Browser calls use the signed-in person's access, bound to the chosen agent and task. A private incoming call needs its spoken code
            approved in Settings; unknown callers can start a new task only when the phone line allows it.
          </p>
        </Card>
      </Match>
      <Match when={props.endpoint.provider === "agentmail" || props.endpoint.provider === "github"}>
        <Card title="Access">
          <p class="cx-note">
            {props.endpoint.provider === "github"
              ? "Who can ask the bot for reviews follows the repositories the GitHub App is installed on."
              : "Anyone who emails the address starts or continues a task. Which agents may use the AgentMail account is on its connection page."}
            <Show when={props.endpoint.connectionId}>
              {(connectionId) => (
                <>
                  {" "}
                  <A href={`/${company().issuePrefix}/apps/${connectionId()}/permissions`}>Open the connection</A>
                </>
              )}
            </Show>
          </p>
        </Card>
      </Match>
      <Match when={true}>
        <Card
          title="People"
          description={
            <>
              People with linked accounts work with their own Paperclip permissions. <A href={`/${company().issuePrefix}/company/settings/members`}>Members</A>
            </>
          }
        >
          <Show when={props.endpoint.provider === "slack"}>
            <details class="ap-more">
              <summary>Invite people</summary>
              <div class="ap-more-body">
                <p class="cx-note">They send the command in Slack, open the bot's private link, and sign in to confirm their Slack account. The link expires after 15 minutes.</p>
                <CopyValue label="Command" value={joinCommand()} />
                <CopyValue label="Invitation" value={invitation()} block />
              </div>
            </details>
          </Show>
          <Show when={confirmation()}>
            {(current) => (
              <div class="ch-confirm">
                <CopyValue label={`Confirmation link for ${current().who}`} value={current().url} />
                <span class="cx-note">Share it only with this person: they sign in and confirm their own account.</span>
              </div>
            )}
          </Show>
          <Switch>
            <Match when={links.isPending}>
              <p class="cx-static">Loading people…</p>
            </Match>
            <Match when={links.isError}>
              <p class="cx-note cx-note--error" role="alert">
                Couldn't load people.{" "}
                <button type="button" class="cx-link" onClick={() => void links.refetch()}>
                  Try again
                </button>
              </p>
            </Match>
            <Match when={(links.data ?? []).length === 0}>
              <p class="cx-static">No linked accounts yet.</p>
            </Match>
            <Match when={true}>
              <ul class="ch-list" aria-label="People">
                <For each={links.data}>
                  {(link) => (
                    <li class="ch-row">
                      <span class="ch-row-main">
                        <b>{link.paperclipUserLabel ?? link.externalLabel}</b>
                        <span class="ch-row-meta">
                          {link.status === "revoked"
                            ? "Disconnected"
                            : link.status === "linked"
                              ? link.externalLabel !== link.paperclipUserLabel
                                ? link.externalLabel
                                : "Linked"
                              : "Waiting for them to confirm"}
                        </span>
                      </span>
                      <Show
                        when={link.status === "linked"}
                        fallback={
                          <Button
                            size="compact"
                            disabled={intent.isPending}
                            onClick={() => {
                              setConfirmation(null);
                              intent.mutate({ principalId: link.principalId, who: link.externalLabel });
                            }}
                          >
                            Make a confirmation link
                          </Button>
                        }
                      >
                        <Button size="compact" variant="quiet" icon={<Unlink size={14} aria-hidden="true" />} disabled={revoke.isPending} onClick={() => revoke.mutate(link.principalId)}>
                          Disconnect
                        </Button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Match>
          </Switch>
        </Card>
        <Card title="Guests">
          <Toggle
            checked={props.endpoint.allowUnlinkedPeople}
            disabled={update.isPending}
            onChange={(allowUnlinkedPeople) => update.mutate({ allowUnlinkedPeople })}
            label="Let people without a linked account start tasks"
            description="Their tasks run isolated; they can't approve actions, spend or manage access. Requests are refused when isolation isn't available."
          />
        </Card>
      </Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------
// Reviews, conversations

function ReviewsTab(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const reviews = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "reviews"),
    queryFn: ({ signal }) => githubChatApi.reviews(props.endpoint.id, signal),
    refetchInterval: 10_000,
    retry: false,
  }));
  return (
    <Card title="Pull request reviews" description="Reviews the bot made, newest first. Each has a task with its run.">
      <Switch>
        <Match when={reviews.isPending}>
          <p class="cx-static">Loading…</p>
        </Match>
        <Match when={reviews.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(reviews.error, "Couldn't load reviews.")}
          </p>
        </Match>
        <Match when={(reviews.data ?? []).length === 0}>
          <p class="cx-static">No reviews yet. Mention the bot on a pull request to ask for one.</p>
        </Match>
        <Match when={true}>
          <ul class="ch-list">
            <For each={[...(reviews.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}>
              {(review) => (
                <li class="ch-row">
                  <span class="ch-row-main">
                    <b>
                      {review.repository}#{review.pullNumber}
                    </b>
                    <span class="ch-row-meta">
                      {review.state.replace(/_/g, " ")}
                      {review.assessment ? ` · score ${review.assessment.score} of 5` : ""}
                      {review.conclusion ? ` · ${review.conclusion.replace(/_/g, " ")}` : ""} · {dateTime(review.createdAt)}
                    </span>
                    <Show when={review.assessment?.summary}>
                      <span class="ch-row-text">{review.assessment!.summary}</span>
                    </Show>
                  </span>
                  <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`/${company().issuePrefix}/issues/${review.issueId}`}>
                    Task
                  </A>
                  <Show when={review.checkUrl ?? review.summaryUrl}>
                    {(url) => (
                      <a class={buttonClass({ size: "compact", variant: "quiet" })} href={url()} target="_blank" rel="noopener noreferrer">
                        On GitHub
                        <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </Card>
  );
}

const CONVERSATION_STATE: Record<string, string> = {
  active: "Active",
  waiting: "Waiting",
  completed: "Done",
  unavailable: "Unavailable at the provider",
  endpoint_removed: "Connection removed",
};

function ConversationsTab(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const conversations = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "conversations"),
    queryFn: ({ signal }) => chatEndpointsApi.conversations(props.endpoint.id, signal),
    refetchInterval: 5000,
    retry: false,
  }));
  return (
    <Card title="Conversations" description="Each conversation is a task the agent works in.">
      <Switch>
        <Match when={conversations.isPending}>
          <p class="cx-static">Loading…</p>
        </Match>
        <Match when={conversations.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(conversations.error, "Couldn't load conversations.")}
          </p>
        </Match>
        <Match when={(conversations.data ?? []).length === 0}>
          <p class="cx-static">No conversations yet.</p>
        </Match>
        <Match when={true}>
          <ul class="ch-list">
            <For each={conversations.data}>
              {(conversation) => (
                <li class="ch-row">
                  <span class="ch-row-main">
                    <b>{conversation.externalLabel}</b>
                    <span class="ch-row-meta">
                      {CONVERSATION_STATE[conversation.state] ?? conversation.state} · {dateTime(conversation.updatedAt)}
                      {conversation.lastPublicationStatus && conversation.lastPublicationStatus !== "published"
                        ? ` · last reply ${conversation.lastPublicationStatus.replace(/_/g, " ")}`
                        : ""}
                    </span>
                  </span>
                  <Show when={conversation.issueId}>
                    <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`/${company().issuePrefix}/issues/${conversation.issueIdentifier ?? conversation.issueId}`}>
                      {conversation.issueIdentifier ?? "Task"}
                    </A>
                  </Show>
                  <Show when={conversation.externalUrl}>
                    {(url) => (
                      <a class={buttonClass({ size: "compact", variant: "quiet" })} href={url()} target="_blank" rel="noopener noreferrer">
                        Open
                        <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Activity

type Entry = { kind: "item"; at: string; item: ChatActivityItem } | { kind: "call"; at: string; call: VoiceCallHistoryEntry };

function ActivityTab(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const base = () => `/${company().issuePrefix}/apps`;
  const [cursors, setCursors] = createSignal<(string | null)[]>([null]);
  const cursor = () => cursors()[cursors().length - 1] ?? null;
  const activityKey = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "activity");
  const activity = createQuery(() => ({
    queryKey: [...activityKey(), cursor() ?? "first"],
    queryFn: ({ signal }) => chatEndpointsApi.activity(props.endpoint.id, cursor(), signal),
    refetchInterval: cursor() ? false : 5000,
    retry: false,
  }));
  const voice = () => props.endpoint.provider === "speko";
  const calls = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "voice-history"),
    queryFn: ({ signal }) => voiceApi.history(company().id, props.endpoint.id, signal),
    enabled: voice() && !cursor(),
    retry: false,
  }));
  // Calls join the first page by time; older pages are the endpoint's own events.
  const entries = createMemo<Entry[]>(() =>
    [
      ...(activity.data?.items ?? []).map((item): Entry => ({ kind: "item", at: item.createdAt, item })),
      ...(voice() && !cursor() ? (calls.data ?? []) : []).map((call): Entry => ({ kind: "call", at: call.session.createdAt, call })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
  );
  const refresh = () => client.invalidateQueries({ queryKey: activityKey() });
  const replay = createMutation(() => ({
    mutationFn: (item: ChatActivityItem) =>
      item.kind === "publication" ? chatEndpointsApi.replayPublication(props.endpoint.id, item.id) : chatEndpointsApi.replayDelivery(props.endpoint.id, item.id),
    onSuccess: () => {
      void refresh();
      pushToast({ tone: "success", title: "Queued to try again" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't replay it", body: failureText(error, "Try again.") }),
  }));
  const [resolving, setResolving] = createSignal<ChatActivityItem | null>(null);
  const resolve = createMutation(() => ({
    mutationFn: (input: { item: ChatActivityItem; action: ChatResolution }) =>
      input.item.kind === "publication"
        ? chatEndpointsApi.resolvePublication(
            props.endpoint.id,
            input.item.id,
            input.action,
            input.item.fileTransfer ? { phase: input.item.fileTransfer.phase, version: input.item.fileTransfer.version } : undefined,
          )
        : chatEndpointsApi.resolveAction(props.endpoint.id, input.item.id, input.action),
    onSuccess: () => {
      setResolving(null);
      void refresh();
      pushToast({ tone: "success", title: "Settled" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't settle it", body: failureText(error, "Try again.") }),
  }));
  const [removing, setRemoving] = createSignal(false);
  const lifecycle = createMutation(() => ({
    mutationFn: async (action: "pause" | "resume" | "remove") =>
      props.endpoint.provider === "agentmail" ? (await emailApi.control(props.endpoint.id, action), null) : chatEndpointsApi.setup(props.endpoint.id, { action }),
    onSuccess: (next, action) => {
      void client.invalidateQueries({ queryKey: queryKeys.chatEndpoints.all(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.tools.emailInboxes(company().id) });
      if (action === "remove") {
        pushToast({ tone: "success", title: "Connection removed" });
        navigate(base());
        return;
      }
      if (next) client.setQueryData(queryKeys.chatEndpoints.detail(company().id, next.id), next);
      pushToast({ tone: "success", title: action === "pause" ? "Paused" : "Running again" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't change the connection", body: failureText(error, "Try again.") }),
  }));
  const health = () => healthPresentation(props.endpoint);
  const status = () => props.endpoint.status;
  const guidance = () => LIFECYCLE_GUIDANCE[props.endpoint.provider];
  const surfaces = () => {
    const callbacks = props.endpoint.setup?.callbackSurfaces;
    return callbacks
      ? [
          ["Events", callbacks.events],
          ["Interactivity", callbacks.interactivity],
          ["Slash command", callbacks.slashCommands],
        ] as const
      : [];
  };

  return (
    <>
      <Card title="Connection">
        <Show when={(status() !== "active" && health().message) || health().error}>
          <div class="cx-note" classList={{ "cx-note--warn": status() === "attention" || status() === "revoked" }} role="status">
            <Show when={health().message}>
              <p>{health().message}</p>
            </Show>
            <Show when={health().previousHealth}>
              <p>Last reported: {health().previousHealth}</p>
            </Show>
            <Show when={health().error}>
              <p>
                {health().errorLabel}: {health().error}
              </p>
            </Show>
          </div>
        </Show>
        <Show when={props.endpoint.provider === "slack" && surfaces().length > 0}>
          <dl class="ch-facts">
            <For each={surfaces()}>
              {([label, surface]) => (
                <>
                  <dt>{label}</dt>
                  <dd>
                    {surface.status === "current" ? "Current" : surface.status === "stale" ? "Address out of date" : "Not seen yet"}
                    {surface.observedAt ? ` · ${dateTime(surface.observedAt)}` : ""}
                  </dd>
                </>
              )}
            </For>
          </dl>
          <Show when={props.endpoint.setup?.callbacksNeedUpdate}>
            <p class="cx-note cx-note--warn">Slack's callback addresses need updating: save the current app manifest in Slack, then use the app once.</p>
          </Show>
        </Show>
        <Show when={status() !== "archived"}>
          <div class="ch-actions">
            <Show when={status() === "active"}>
              <Button size="compact" icon={<Pause size={14} aria-hidden="true" />} disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("pause")}>
                Pause
              </Button>
            </Show>
            <Show when={status() === "paused"}>
              <Button size="compact" icon={<Play size={14} aria-hidden="true" />} disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("resume")}>
                Resume
              </Button>
            </Show>
            <Show when={props.endpoint.provider !== "agentmail"}>
              <A
                class={buttonClass({ size: "compact" })}
                href={chatConnectHref(base(), props.endpoint.provider, {
                  resume: props.endpoint.id,
                  reconnect: status() !== "draft" && status() !== "verifying",
                })}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {status() === "draft" || status() === "verifying" ? "Finish setup" : "Reconnect"}
              </A>
            </Show>
            <Button size="compact" variant="danger" ghost icon={<Trash2 size={14} aria-hidden="true" />} disabled={lifecycle.isPending} onClick={() => setRemoving(true)}>
              Remove
            </Button>
          </div>
          <Show when={status() !== "draft" && status() !== "verifying"}>
            <p class="cx-note">{guidance().reconnect}</p>
          </Show>
        </Show>
      </Card>

      <Card
        title="Recent activity"
        footer={
          <div class="ch-pager">
            <span>Page {cursors().length}</span>
            <Button size="compact" variant="quiet" disabled={cursors().length === 1 || activity.isFetching} onClick={() => setCursors(cursors().slice(0, -1))}>
              Newer
            </Button>
            <Button
              size="compact"
              variant="quiet"
              disabled={!activity.data?.nextCursor || activity.isFetching}
              onClick={() => activity.data?.nextCursor && setCursors([...cursors(), activity.data.nextCursor])}
            >
              Older
            </Button>
          </div>
        }
      >
        <Switch>
          <Match when={activity.isPending}>
            <p class="cx-static">Loading…</p>
          </Match>
          <Match when={activity.isError}>
            <p class="cx-note cx-note--error" role="alert">
              Couldn't load activity.{" "}
              <button type="button" class="cx-link" onClick={() => void activity.refetch()}>
                Try again
              </button>
            </p>
          </Match>
          <Match when={entries().length === 0}>
            <p class="cx-static">Nothing yet.</p>
          </Match>
          <Match when={true}>
            <ul class="ch-list" aria-label="Activity">
              <For each={entries()}>
                {(entry) => (
                  <Show when={entry.kind === "item" ? entry.item : null} fallback={<CallRow call={(entry as Extract<Entry, { kind: "call" }>).call} />}>
                    {(item) => (
                      <li class="ch-row">
                        <span class="ch-row-icon" aria-hidden="true">
                          {item().kind === "delivery" ? <ArrowDownLeft size={15} /> : item().kind === "publication" ? <ArrowUpRight size={15} /> : <ActivityIcon size={15} />}
                        </span>
                        <span class="ch-row-main">
                          <b>{item().summary}</b>
                          <span class="ch-row-meta">
                            {ACTIVITY_KIND_LABELS[item().kind]} · {item().status.replace(/_/g, " ")} · {dateTime(item().createdAt)}
                          </span>
                          <Show when={item().fileTransfer}>
                            {(file) => (
                              <span class="ch-row-meta">
                                {file().filename} · {file().phase.replace(/_/g, " ")}
                              </span>
                            )}
                          </Show>
                          <Show when={item().detail}>
                            <span class="ch-row-text">{item().detail}</span>
                          </Show>
                        </span>
                        <Show when={props.endpoint.provider !== "agentmail" && canReplay(item())}>
                          <Button size="compact" disabled={replay.isPending} onClick={() => replay.mutate(item())} aria-label={`Replay failed ${item().kind}`}>
                            Replay
                          </Button>
                        </Show>
                        <Show when={props.endpoint.provider !== "agentmail" && canResolve(item())}>
                          <Button size="compact" onClick={() => setResolving(item())}>
                            Resolve
                          </Button>
                        </Show>
                      </li>
                    )}
                  </Show>
                )}
              </For>
            </ul>
          </Match>
        </Switch>
        <Show when={props.endpoint.provider === "agentmail" && (activity.data?.items ?? []).some((item) => item.kind === "publication" && item.status === "delivery_unknown")}>
          <p class="cx-note">Settle unconfirmed email deliveries on the conversation's task.</p>
        </Show>
      </Card>

      <Dialog
        open={resolving() !== null}
        onOpenChange={(open) => !open && setResolving(null)}
        title="Settle an unconfirmed send"
        description={resolving() ? resolutionText(resolving()!) : undefined}
        width={480}
        footer={
          <>
            <Button variant="quiet" disabled={resolve.isPending} onClick={() => setResolving(null)}>
              Leave it
            </Button>
            <For each={resolving() ? resolutionActions(resolving()!) : []}>
              {(action) => (
                <Button variant={action === "mark_delivered" ? "primary" : "secondary"} disabled={resolve.isPending} onClick={() => resolve.mutate({ item: resolving()!, action })}>
                  {RESOLUTION_LABELS[action]}
                </Button>
              )}
            </For>
          </>
        }
      >
        <p class="cx-note">{resolving()?.summary}</p>
      </Dialog>
      <ConfirmDialog
        open={removing()}
        onOpenChange={setRemoving}
        title="Remove this connection?"
        body={
          <>
            {props.endpoint.assignedAgentName} stops receiving new work from {providerName(props.endpoint.provider)}. Existing tasks stay. {guidance().remove}
          </>
        }
        confirmLabel="Remove connection"
        danger
        onConfirm={() => lifecycle.mutateAsync("remove")}
      />
    </>
  );
}

function CallRow(props: { call: VoiceCallHistoryEntry }) {
  const company = useCompany();
  const report = () => props.call.report;
  const cost = () => (report().costMicroUsd ? `$${(Number(report().costMicroUsd) / 1_000_000).toFixed(2)}` : null);
  return (
    <li class="ch-row">
      <span class="ch-row-icon" aria-hidden="true">
        <Phone size={15} />
      </span>
      <span class="ch-row-main">
        <b>Call · {props.call.session.state.replace(/_/g, " ")}</b>
        <span class="ch-row-meta">
          {dateTime(props.call.session.createdAt)}
          {report().durationSeconds != null ? ` · ${Math.round(report().durationSeconds! / 60)} min` : ""}
          {cost() ? ` · ${cost()}` : ""}
        </span>
        <Show when={report().transcript.length > 0}>
          <details class="ch-transcript">
            <summary>Transcript</summary>
            <ol>
              <For each={report().transcript}>
                {(line) => (
                  <li>
                    <b>{line.speaker === "agent" ? "Agent" : "Caller"}:</b> {line.text}
                  </li>
                )}
              </For>
            </ol>
          </details>
        </Show>
      </span>
      <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`/${company().issuePrefix}/issues/${props.call.session.issueId}`}>
        Task
      </A>
    </li>
  );
}
