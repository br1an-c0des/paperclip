import type { ChatProvider } from "@paperclipai/shared";
import { A, Navigate, useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch } from "solid-js";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { AppLogo, StateTag, useGallery } from "../shared";
import { ChatConnect } from "./ChatConnect";
import { ChatEndpointPage } from "./ChatEndpointPage";
import { channelMethod, chatProviderVisible, endpointState, providerName, PROVIDER_NAMES, SETUP_PROVIDERS, type ChatRoute } from "./chat-model";
import { EmailSetup } from "./EmailSetup";
import { useChatEndpoints } from "./parts";
import "./Chat.css";

/*
 * The chat endpoint pages under `/:prefix/apps/chat` (AppsPage hands them over): setting one up,
 * and one endpoint's tabs. A provider the instance's flags turn off says so instead (AgentMail is
 * always on; GitHub follows `enableGitHubReviewBots`, the rest `enableChatConnectors`).
 */

export function ChatRoutes(props: { route: ChatRoute }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  return (
    <Switch>
      <Match when={props.route.kind === "redirect" && props.route}>
        {(route) => <Navigate href={`${base()}${(route() as { to: string }).to ? `/${(route() as { to: string }).to}` : ""}`} />}
      </Match>
      <Match when={props.route.kind === "connect"}>
        <ConnectRoute />
      </Match>
      <Match when={props.route.kind === "detail" && props.route}>
        {(route) => {
          const detail = route() as Extract<ChatRoute, { kind: "detail" }>;
          return <ChatEndpointPage endpointId={detail.endpointId} tab={detail.tab} />;
        }}
      </Match>
    </Switch>
  );
}

function ConnectRoute() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const [params] = useSearchParams<{ provider?: string; agentId?: string; resume?: string }>();
  const flags = useExperimentalSettingsQuery();
  const gallery = useGallery();
  const provider = () => (params.provider && params.provider in PROVIDER_NAMES ? (params.provider as ChatProvider) : null);
  const app = () => gallery.data?.apps.find((entry) => channelMethod(entry)?.provider === provider()) ?? null;
  return (
    <Switch>
      <Match when={!provider()}>
        <section class="card ap-later">
          <h2 class="disp">Which chat app?</h2>
          <p>
            Pick one from the gallery. <A href={base()}>Back to Apps</A>
          </p>
        </section>
      </Match>
      <Match when={flags.isPending || gallery.isPending}>
        <p class="ap-empty card" role="status">
          Loading…
        </p>
      </Match>
      <Match when={!chatProviderVisible(provider(), flags.data)}>
        <section class="card ap-later">
          <h2 class="disp">{providerName(provider()!)} chat is turned off</h2>
          <p>
            This Paperclip doesn't have {provider() === "github" ? "GitHub review bots" : "chat connectors"} turned on. An instance admin can turn it on in
            the app settings' features. <A href={base()}>Back to Apps</A>
          </p>
        </section>
      </Match>
      <Match when={provider() === "agentmail"}>
        <EmailSetup app={app()} agentId={params.agentId ?? null} resume={params.resume ?? null} />
      </Match>
      <Match when={!SETUP_PROVIDERS.has(provider()!)}>
        <section class="card ap-later">
          <h2 class="disp">{providerName(provider()!)} can't be set up here yet</h2>
          <p>
            Its setup needs steps this board doesn't have yet. <A href={base()}>Back to Apps</A>
          </p>
        </section>
      </Match>
      <Match when={provider()}>{(current) => <ChatConnect provider={current()} app={app()} />}</Match>
    </Switch>
  );
}

/**
 * Browse's "Chat endpoints" group: each of the company's endpoints the instance shows, opening its
 * page. AgentMail inboxes have their own group in Browse, so they're left out here.
 */
export function ChatEndpointGroup() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const flags = useExperimentalSettingsQuery();
  const gallery = useGallery();
  const anyOn = () => flags.data?.enableChatConnectors === true || flags.data?.enableGitHubReviewBots === true;
  const endpoints = useChatEndpoints(anyOn);
  const rows = () =>
    (endpoints.data ?? [])
      .filter((endpoint) => endpoint.status !== "archived" && endpoint.provider !== "agentmail" && chatProviderVisible(endpoint.provider, flags.data))
      .sort((a, b) => a.assignedAgentName.localeCompare(b.assignedAgentName));
  const appFor = (provider: string) => gallery.data?.apps.find((entry) => channelMethod(entry)?.provider === provider) ?? null;
  return (
    <Show when={rows().length > 0}>
      <div class="ap-group">
        <h4 class="ap-group-title">Chat endpoints</h4>
        <ul class="ap-rows">
          <For each={rows()}>
            {(endpoint) => {
              const state = () => endpointState(endpoint);
              return (
                <li class="ap-row ap-row--link">
                  <AppLogo app={appFor(endpoint.provider)} name={providerName(endpoint.provider)} />
                  <div class="ap-row-main">
                    <A class="ap-row-name" href={`${base()}/chat/${endpoint.id}/settings`}>
                      {endpoint.assignedAgentName} in {providerName(endpoint.provider)}
                    </A>
                    <Show when={endpoint.providerAccountLabel ?? state().message}>
                      {(meta) => <span class="ap-row-meta">{meta()}</span>}
                    </Show>
                  </div>
                  <StateTag state={state()} />
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}
