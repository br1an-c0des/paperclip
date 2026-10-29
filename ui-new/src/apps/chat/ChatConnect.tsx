import type { AppDefinition, ChatProvider, FieldDef, SlackAppConfiguration } from "@paperclipai/shared";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Hammer, MessagesSquare } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { activeAgents } from "@/api/agents";
import { chatEndpointsApi, type ChatEndpoint } from "@/api/chat-endpoints";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { pushToast } from "@/ui/Toast";
import { AppLogo, failureText, useGallery } from "../shared";
import {
  channelMethod,
  defaultSlackApp,
  hasToolMethod,
  isRepairing,
  missingCredentials,
  providerName,
  SETUP_STEPS,
  setupStep,
  slackManifest,
  type SetupStep,
} from "./chat-model";
import { GitHubGuidedSetup } from "./GitHubSetup";
import { CopyValue, SetupSteps, useChatEndpoint } from "./parts";
import { PhotonConnect } from "./PhotonConnect";
import { defaultSlackMethod, isProvisioned, type SlackMethod } from "./slack-model";
import { AutomaticSlackSetup, ManagedSlackSetup } from "./SlackSetup";

/*
 * Setting up a chat endpoint (`/apps/chat/connect?provider=…`, the old UI's ChatEndpointSetup):
 *
 * 1. Agent: who people will talk to. The agent is fixed for the endpoint; Slack also takes the
 *    app's name, bot name and slash command here. Continuing creates the endpoint as a draft.
 * 2. Connect: the provider's own steps (its guidance from the gallery), the Paperclip addresses to
 *    paste there, Slack's app manifest or GitHub's webhook secret, then the credentials it gives
 *    back (`POST …/setup` with `configure`, or `reconnect` when repairing).
 * 3. Verify: while the provider still has to call Paperclip's address, the page polls, and Verify
 *    asks again.
 * 4. Try it: send the agent a message there; once it arrives, Finish turns the endpoint on.
 *
 * `?resume=<id>` continues a draft; `&reconnect=1` replaces a working endpoint's credentials.
 *
 * Slack can also be set up for you (managed, or automatic with an App configuration access token)
 * and GitHub registers its App from a manifest (src/apps/chat/SlackSetup.tsx, GitHubSetup.tsx); the
 * manual forms below stay for your own app. Photon picks its line after inspecting the project
 * (PhotonConnect.tsx). Speko's in-browser test call isn't here: it needs Speko's browser client,
 * which ui-new doesn't bundle, so a persona is finished from its page.
 */

export function ChatConnect(props: { provider: ChatProvider; app: AppDefinition | null }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const [params, setParams] = useSearchParams<{ resume?: string; reconnect?: string; agentId?: string; purpose?: string }>();
  const [chosePurpose, setChosePurpose] = createSignal(params.purpose === "chat");
  const offerTools = () => Boolean(props.app && hasToolMethod(props.app) && !params.resume && !chosePurpose());

  return (
    <Show when={!offerTools()} fallback={<PurposeChoice app={props.app!} provider={props.provider} onChat={() => setChosePurpose(true)} />}>
      <SetupFlow
        provider={props.provider}
        app={props.app}
        resume={params.resume ?? null}
        reconnect={params.reconnect === "1"}
        agentId={params.agentId ?? null}
        onCreated={(id) => setParams({ resume: id, purpose: "chat" }, { replace: true })}
        base={base()}
      />
    </Show>
  );
}

function PurposeChoice(props: { app: AppDefinition; provider: ChatProvider; onChat: () => void }) {
  const company = useCompany();
  const name = () => providerName(props.provider);
  return (
    <section class="card ap-connect">
      <header class="ap-connect-head">
        <AppLogo app={props.app} name={props.app.name} size={48} />
        <div class="ap-connect-title">
          <h2 class="disp">Connect {props.app.name}</h2>
          <p>What should this {name()} connection do?</p>
        </div>
      </header>
      <ul class="ch-choices">
        <li>
          <button type="button" class="ch-choice" onClick={() => props.onChat()}>
            <MessagesSquare size={22} aria-hidden="true" />
            <span>
              <b>Chat with an agent</b>
              <span>People in {name()} can start and continue Paperclip tasks with one agent.</span>
            </span>
          </button>
        </li>
        <li>
          <A class="ch-choice" href={`/${company().issuePrefix}/apps/connect?source=${encodeURIComponent(props.app.slug)}`}>
            <Hammer size={22} aria-hidden="true" />
            <span>
              <b>Use it as an agent tool</b>
              <span>Agents use {name()} actions and data while they work.</span>
            </span>
          </A>
        </li>
      </ul>
    </section>
  );
}

function SetupFlow(props: {
  provider: ChatProvider;
  app: AppDefinition | null;
  resume: string | null;
  reconnect: boolean;
  agentId: string | null;
  onCreated: (id: string) => void;
  base: string;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const agents = useAgentsQuery();
  const [endpointId, setEndpointId] = createSignal(props.resume);
  const [viewed, setViewed] = createSignal<SetupStep | null>(null);
  // Poll while the provider still has to call back, and while waiting for the test message.
  const endpointQuery = useChatEndpoint(endpointId, (current) => (current && setupStep(current, false) === "verify" ? 2000 : false));
  const endpoint = () => endpointQuery.data ?? null;
  const repairing = () => isRepairing(endpoint(), props.reconnect);
  const reached = createMemo(() => setupStep(endpoint(), repairing()));
  const step = () => {
    const seen = viewed();
    const order = SETUP_STEPS.map((entry) => entry.key);
    return seen && order.indexOf(seen) <= order.indexOf(reached()) && seen !== "agent" ? seen : reached();
  };
  const name = () => providerName(props.provider);
  const [ownGitHubApp, setOwnGitHubApp] = createSignal(props.reconnect);
  const guidedGitHub = () =>
    props.provider === "github" && !repairing() && !ownGitHubApp() && Boolean(endpoint()) && !endpoint()!.botExternalId && step() !== "try";
  const save = (next: ChatEndpoint) => {
    client.setQueryData(queryKeys.chatEndpoints.detail(company().id, next.id), next);
    void client.invalidateQueries({ queryKey: queryKeys.chatEndpoints.list(company().id) });
  };
  const exit = () => navigate(props.base);

  return (
    <section class="card ap-connect ch-setup">
      <header class="ap-connect-head">
        <AppLogo app={props.app} name={name()} size={48} />
        <div class="ap-connect-title">
          <h2 class="disp">{repairing() ? `Reconnect ${name()}` : props.resume ? `Finish connecting ${name()}` : `Chat with an agent in ${name()}`}</h2>
          <p>
            <Show when={endpoint()} fallback="Pick the agent people will talk to, then connect it.">
              {(current) => (
                <>
                  {current().assignedAgentName} in {name()}
                  {current().providerAccountLabel ? ` · ${current().providerAccountLabel}` : ""}
                </>
              )}
            </Show>
          </p>
        </div>
      </header>
      <SetupSteps steps={SETUP_STEPS} current={step()} reached={reached()} onPick={(next) => setViewed(next)} />

      <Switch>
        <Match when={props.resume && endpointQuery.isPending}>
          <p class="cx-static" role="status">
            Loading the setup…
          </p>
        </Match>
        <Match when={props.resume && endpointQuery.isError}>
          <p class="cx-note cx-note--error" role="alert">
            This setup couldn't be loaded. It may have been removed. <A href={props.base}>Back to Apps</A>
          </p>
        </Match>
        <Match when={step() === "agent"}>
          <AgentStep
            provider={props.provider}
            agents={activeAgents(agents.data).filter((agent) => agent.status !== "pending_approval")}
            initialAgentId={props.agentId}
            onCreated={(next) => {
              save(next);
              setEndpointId(next.id);
              setViewed(null);
              props.onCreated(next.id);
            }}
            onCancel={exit}
          />
        </Match>
        <Match when={guidedGitHub() && endpoint()}>
          {(current) => <GitHubGuidedSetup endpoint={current()} base={props.base} onOwnApp={() => setOwnGitHubApp(true)} onExit={exit} />}
        </Match>
        <Match when={step() === "connect" && props.provider === "slack" && isProvisioned(endpoint()?.setup?.slackSetupMethod) && endpoint()}>
          {(current) => (
            <Show
              when={current().setup?.slackSetupMethod === "managed"}
              fallback={
                <AutomaticSlackSetup
                  endpoint={current()}
                  onSaved={save}
                  onExit={exit}
                  onManual={(existing) =>
                    void chatEndpointsApi.update(current().id, { slackSetupMethod: existing ? "existing" : "manual" }).then(save)
                  }
                />
              }
            >
              <ManagedSlackSetup
                endpoint={current()}
                reconnect={repairing()}
                onSaved={save}
                onExit={exit}
                onManual={() => void chatEndpointsApi.update(current().id, { slackSetupMethod: "automatic" }).then(save)}
              />
            </Show>
          )}
        </Match>
        <Match when={step() === "connect" && props.provider === "imessage-photon" && endpoint()}>
          {(current) => (
            <PhotonConnect
              endpoint={current()}
              repairing={repairing()}
              onSaved={(next) => {
                save(next);
                setViewed(null);
              }}
              onExit={exit}
            />
          )}
        </Match>
        <Match when={step() === "connect" && endpoint()}>
          {(current) => (
            <ConnectStep
              endpoint={current()}
              app={props.app}
              repairing={repairing()}
              onSaved={(next) => {
                save(next);
                setViewed(null);
              }}
              onExit={exit}
            />
          )}
        </Match>
        <Match when={step() === "verify" && endpoint()}>
          {(current) => <VerifyStep endpoint={current()} onSaved={save} onExit={exit} />}
        </Match>
        <Match when={step() === "try" && endpoint()}>
          {(current) => (
            <TryStep
              endpoint={current()}
              onDone={(next) => {
                save(next);
                if (next.status === "active") {
                  pushToast({ tone: "success", title: `${next.assignedAgentName} is in ${name()}` });
                  navigate(`${props.base}/chat/${next.id}/settings`);
                }
              }}
              onExit={exit}
            />
          )}
        </Match>
      </Switch>
    </section>
  );
}

function AgentStep(props: {
  provider: ChatProvider;
  agents: { id: string; name: string; appearance?: unknown; status: string }[];
  initialAgentId: string | null;
  onCreated: (endpoint: ChatEndpoint) => void;
  onCancel: () => void;
}) {
  const company = useCompany();
  const [agentId, setAgentId] = createSignal(props.initialAgentId ?? "");
  const agent = () => props.agents.find((candidate) => candidate.id === agentId()) ?? null;
  const [slack, setSlack] = createSignal<SlackAppConfiguration | null>(null);
  const slackApp = () => slack() ?? defaultSlackApp(agent()?.name ?? "");
  const slackOptions = createQuery(() => ({
    queryKey: [...queryKeys.chatEndpoints.all(company().id), "slack-setup-options"],
    queryFn: ({ signal }) => chatEndpointsApi.slackSetupOptions(company().id, signal),
    enabled: props.provider === "slack",
    retry: false,
  }));
  const [slackMethod, setSlackMethod] = createSignal<SlackMethod | null>(null);
  const method = () => slackMethod() ?? defaultSlackMethod(slackOptions.data);
  // A new agent means new defaults for the Slack app's names, unless they were edited.
  createEffect(on(agentId, () => setSlack(null), { defer: true }));
  const slackProblem = () => {
    if (props.provider !== "slack") return null;
    const app = slackApp();
    if (!app.appName.trim() || app.appName.length > 35) return "The app name needs 1 to 35 characters.";
    if (!app.botName.trim() || app.botName.length > 80) return "The bot name needs 1 to 80 characters.";
    if (!/^\/[a-z0-9_-]{1,31}$/.test(app.command)) return "The command starts with / and uses lowercase letters, numbers, - or _.";
    return null;
  };
  const create = createMutation(() => ({
    mutationFn: () =>
      chatEndpointsApi.create(company().id, {
        provider: props.provider,
        assignedAgentId: agentId(),
        ...(props.provider === "slack" ? { slackSetupMethod: method(), slackApp: slackApp() } : {}),
      }),
    onSuccess: (next) => props.onCreated(next),
  }));
  const setField = (key: keyof SlackAppConfiguration, value: string) => setSlack({ ...slackApp(), [key]: value });

  return (
    <form
      class="ch-step-body"
      onSubmit={(event) => {
        event.preventDefault();
        if (agentId() && !slackProblem()) create.mutate();
      }}
    >
      <Field label="Which agent do people talk to?" help="It stays the same for this connection. Connect another one for a different agent.">
        <Show when={props.agents.length > 0} fallback={<p class="cx-static">No active agents yet.</p>}>
          <ul class="cx-options" role="radiogroup" aria-label="Agent">
            <For each={props.agents}>
              {(candidate) => (
                <li>
                  <label class="cx-option" classList={{ "cx-option--on": candidate.id === agentId() }}>
                    <input type="radio" name="ch-agent" checked={candidate.id === agentId()} onChange={() => setAgentId(candidate.id)} />
                    <AgentAvatar agent={candidate as never} size={24} />
                    <span class="cx-option-name">{candidate.name}</span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Field>
      <Show when={props.provider === "slack" && agent()}>
        <div class="ch-grid">
          <Field label="Slack app name" for="ch-slack-app">
            <TextInput id="ch-slack-app" value={slackApp().appName} maxLength={35} onInput={(event) => setField("appName", event.currentTarget.value)} />
          </Field>
          <Field label="Bot name" for="ch-slack-bot">
            <TextInput id="ch-slack-bot" value={slackApp().botName} maxLength={80} onInput={(event) => setField("botName", event.currentTarget.value)} />
          </Field>
          <Field label="Slash command" for="ch-slack-command">
            <TextInput id="ch-slack-command" value={slackApp().command} maxLength={32} onInput={(event) => setField("command", event.currentTarget.value)} />
          </Field>
        </div>
      </Show>
      <Show when={props.provider === "slack" && agent()}>
        <Field label="How to set up the Slack app">
          <ul class="cx-options" role="radiogroup" aria-label="Slack setup">
            <Show when={slackOptions.data?.managedAvailable}>
              <li>
                <label class="cx-option" classList={{ "cx-option--on": method() === "managed" }}>
                  <input type="radio" name="ch-slack-method" checked={method() === "managed"} onChange={() => setSlackMethod("managed")} />
                  <span class="cx-option-name">
                    For me <span class="cx-row-meta">Paperclip's Slack app creates and installs it in a workspace you authorize.</span>
                  </span>
                </label>
              </li>
            </Show>
            <li>
              <label class="cx-option" classList={{ "cx-option--on": method() === "automatic" }}>
                <input type="radio" name="ch-slack-method" checked={method() === "automatic"} onChange={() => setSlackMethod("automatic")} />
                <span class="cx-option-name">
                  With a configuration token <span class="cx-row-meta">Paste a Slack App configuration access token; Paperclip creates the app.</span>
                </span>
              </label>
            </li>
            <li>
              <label class="cx-option" classList={{ "cx-option--on": method() === "manual" }}>
                <input type="radio" name="ch-slack-method" checked={method() === "manual"} onChange={() => setSlackMethod("manual")} />
                <span class="cx-option-name">
                  Myself <span class="cx-row-meta">Paste the app manifest in Slack and copy its credentials back.</span>
                </span>
              </label>
            </li>
          </ul>
        </Field>
      </Show>
      <Show when={slackProblem() && agent()}>
        <p class="cx-note cx-note--error" role="alert">
          {slackProblem()}
        </p>
      </Show>
      <Show when={create.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(create.error, "Couldn't start the setup.")}
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!agentId() || Boolean(slackProblem()) || create.isPending}>
          {create.isPending ? "Starting…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function publicOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function ConnectStep(props: { endpoint: ChatEndpoint; app: AppDefinition | null; repairing: boolean; onSaved: (next: ChatEndpoint) => void; onExit: () => void }) {
  const method = () => (props.app ? channelMethod(props.app) : null);
  const fields = createMemo<FieldDef[]>(() => method()?.credentialFields ?? []);
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [secret, setSecret] = createSignal<string | null>(null);
  const provider = () => props.endpoint.provider;
  const name = () => providerName(provider());
  const webhook = () => props.endpoint.setup?.webhookUrl ?? null;
  const slackApp = () => props.endpoint.setup?.slackApp ?? defaultSlackApp(props.endpoint.assignedAgentName);
  const manifest = () => (webhook() ? JSON.stringify(slackManifest(slackApp(), props.endpoint.assignedAgentName, webhook()!), null, 2) : null);
  // Reconnecting may keep the saved credentials: leave them empty to reuse them.
  const missing = () => (props.repairing ? [] : missingCredentials(fields(), values()));
  const githubSecretNeeded = () => provider() === "github" && !props.repairing && !props.endpoint.setup?.webhookSecretConfigured && !secret();

  const configure = createMutation(() => ({
    mutationFn: () => {
      const credentials = Object.fromEntries(Object.entries(values()).filter(([, value]) => value.trim()));
      return chatEndpointsApi.setup(props.endpoint.id, {
        action: props.repairing ? "reconnect" : "configure",
        ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
      });
    },
    onSuccess: (next) => {
      setValues({});
      props.onSaved(next);
    },
  }));
  const generate = createMutation(() => ({
    mutationFn: () => chatEndpointsApi.setupSecret(props.endpoint.id),
    onSuccess: (result) => setSecret(result.webhookSecret),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't make a webhook secret", body: failureText(error, "Try again.") }),
  }));
  const readKeyFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 64_000) {
      pushToast({ tone: "error", title: "That file is too big for a private key" });
      return;
    }
    const text = await file.text();
    setValues({ ...values(), privateKey: text });
  };

  return (
    <form
      class="ch-step-body"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing().length === 0 && !githubSecretNeeded()) configure.mutate();
      }}
    >
      <Show when={method()?.guidanceMd && !props.repairing}>
        <Markdown class="ap-guidance" source={method()!.guidanceMd!} />
      </Show>
      <Show when={props.repairing}>
        <p class="cx-note">Leave the fields empty to check the saved credentials again, or paste new ones from {name()}.</p>
      </Show>

      <Switch>
        <Match when={provider() === "slack"}>
          <ol class="ch-howto">
            <li>
              In Slack, create a new app <b>from a manifest</b>, pick the workspace, and paste this manifest.
            </li>
            <li>Install the app to the workspace, then copy its Bot User OAuth Token and its Signing Secret here.</li>
          </ol>
          <CopyValue label="App manifest" value={manifest()} block missing="This Paperclip has no public address for Slack to call yet." />
          <a class={buttonClass({ size: "compact" })} href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noopener noreferrer">
            Open Slack apps
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </Match>
        <Match when={provider() === "github"}>
          <ol class="ch-howto">
            <li>Create a GitHub App under the user or organization, with the homepage and webhook address below and this webhook secret.</li>
            <li>Give it Issues and Pull requests read and write, and subscribe to issue comments and pull request review comments.</li>
            <li>Create it for this account only, copy its App ID, generate a private key, and install it on the repositories.</li>
          </ol>
          <CopyValue label="Homepage address" value={publicOrigin(webhook())} />
          <Show
            when={secret()}
            fallback={
              <div class="ch-copy">
                <span class="ch-copy-label">Webhook secret</span>
                <Show when={props.endpoint.setup?.webhookSecretConfigured} fallback={<span class="cx-note">Make one, then paste it into the App's webhook settings. It's shown once.</span>}>
                  <span class="cx-note">A secret is saved. Make a new one only if you lost it.</span>
                </Show>
                <Button size="compact" disabled={generate.isPending} onClick={() => generate.mutate()}>
                  {generate.isPending ? "Making…" : props.endpoint.setup?.webhookSecretConfigured ? "Make a new secret" : "Make a webhook secret"}
                </Button>
              </div>
            }
          >
            {(value) => <CopyValue label="Webhook secret (shown once)" value={value()} />}
          </Show>
          <a
            class={buttonClass({ size: "compact" })}
            href={props.repairing ? "https://github.com/settings/apps" : "https://github.com/settings/apps/new"}
            target="_blank"
            rel="noopener noreferrer"
          >
            {props.repairing ? "Open GitHub App settings" : "Open the new GitHub App form"}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </Match>
      </Switch>

      <Show when={provider() !== "slack"}>
        <CopyValue label="Paperclip webhook address" value={webhook()} missing="This Paperclip has no public address for the provider to call yet." />
      </Show>
      <Show when={props.endpoint.setup?.messagingEndpoint}>
        <CopyValue label="Messaging endpoint" value={props.endpoint.setup?.messagingEndpoint} />
      </Show>
      <Show when={method()?.consoleLinks}>
        {(links) => (
          <p class="ch-links">
            <For each={Object.entries(links()).filter(([, url]) => typeof url === "string")}>
              {([key, url]) => (
                <a href={url as string} target="_blank" rel="noopener noreferrer">
                  {key === "docs" ? "Docs" : key === "keys" ? "Get a key" : key === "register" ? "Developer console" : key}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </For>
          </p>
        )}
      </Show>

      <For each={fields()}>
        {(field) => (
          <Field label={`${field.label}${props.repairing ? " (optional)" : ""}`} for={`ch-cred-${field.key}`} help={field.helperMd ? <Markdown source={field.helperMd} /> : undefined}>
            <Show
              when={field.type === "textarea"}
              fallback={
                <TextInput
                  id={`ch-cred-${field.key}`}
                  type={field.type === "password" || field.secret ? "password" : "text"}
                  autocomplete={field.secret || field.type === "password" ? "new-password" : "off"}
                  placeholder={field.placeholder}
                  value={values()[field.key] ?? ""}
                  onInput={(event) => setValues({ ...values(), [field.key]: event.currentTarget.value })}
                />
              }
            >
              <TextArea
                id={`ch-cred-${field.key}`}
                rows={4}
                class="mono"
                placeholder={field.placeholder}
                value={values()[field.key] ?? ""}
                onInput={(event) => setValues({ ...values(), [field.key]: event.currentTarget.value })}
              />
              <Show when={field.key === "privateKey"}>
                <label class="ch-file">
                  <input type="file" accept=".pem,.key,text/plain" onChange={(event) => void readKeyFile(event.currentTarget.files?.[0])} />
                  Choose a .pem file
                </label>
              </Show>
            </Show>
          </Field>
        )}
      </For>

      <Show when={configure.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(configure.error, `${name()} didn't accept those details.`)}
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" onClick={() => props.onExit()}>
          Save and exit
        </Button>
        <span class="ap-actions-end">
          <Show when={githubSecretNeeded()}>
            <span class="cx-note">Make the webhook secret first.</span>
          </Show>
          <Button type="submit" variant="primary" disabled={missing().length > 0 || githubSecretNeeded() || configure.isPending}>
            {configure.isPending ? "Checking…" : props.repairing ? "Reconnect" : `Connect ${name()}`}
          </Button>
        </span>
      </div>
    </form>
  );
}

function VerifyStep(props: { endpoint: ChatEndpoint; onSaved: (next: ChatEndpoint) => void; onExit: () => void }) {
  const name = () => providerName(props.endpoint.provider);
  const verify = createMutation(() => ({
    mutationFn: () => chatEndpointsApi.setup(props.endpoint.id, { action: "verify" }),
    onSuccess: (next) => props.onSaved(next),
  }));
  return (
    <div class="ch-step-body">
      <p class="cx-note">
        Paperclip is waiting for {name()} to call its address. Save the address in {name()}'s settings (and, for Slack, save the manifest), then check
        again. This page checks every few seconds.
      </p>
      <CopyValue label="Paperclip webhook address" value={props.endpoint.setup?.webhookUrl} />
      <Show when={props.endpoint.setup?.webhookVerifiedAt}>
        <p class="cx-ok">{name()} reached Paperclip.</p>
      </Show>
      <Show when={verify.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(verify.error, "Not verified yet.")}
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" onClick={() => props.onExit()}>
          Save and exit
        </Button>
        <Button variant="primary" disabled={verify.isPending} onClick={() => verify.mutate()}>
          {verify.isPending ? "Checking…" : "Verify"}
        </Button>
      </div>
    </div>
  );
}

function TryStep(props: { endpoint: ChatEndpoint; onDone: (next: ChatEndpoint) => void; onExit: () => void }) {
  const company = useCompany();
  const name = () => providerName(props.endpoint.provider);
  const voice = () => props.endpoint.provider === "speko";
  const status = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "test-status"),
    queryFn: ({ signal }) => chatEndpointsApi.testStatus(props.endpoint.id, signal),
    enabled: !voice() && props.endpoint.status !== "active",
    refetchInterval: 2500,
    retry: false,
  }));
  const received = () => Boolean(status.data?.messageReceivedAt);
  const finish = createMutation(() => ({
    mutationFn: () => (props.endpoint.provider === "slack" ? chatEndpointsApi.finishSlackSetup(props.endpoint.id) : chatEndpointsApi.test(props.endpoint.id)),
    onSuccess: (next) => props.onDone(next),
  }));
  const where = () => {
    const endpoint = props.endpoint;
    if (endpoint.provider === "telegram" && endpoint.botUsername) return `https://t.me/${endpoint.botUsername.replace(/^@/, "")}`;
    return endpoint.setup?.providerUrl ?? null;
  };
  const how = () => {
    const endpoint = props.endpoint;
    const bot = endpoint.botLabel ?? endpoint.botUsername ?? endpoint.assignedAgentName;
    switch (endpoint.provider) {
      case "slack":
        return `Send ${bot} a direct message in Slack, or use ${endpoint.setup?.slackApp?.command ?? endpoint.setup?.command ?? "its slash command"}.`;
      case "github":
        return `Mention @${endpoint.botUsername ?? bot} in an issue or pull request comment on an installed repository.`;
      case "telegram":
        return `Send ${bot} a direct message in Telegram.`;
      case "speko":
        return "Call the voice persona from Speko and ask the agent for something.";
      default:
        return `Send ${bot} a message in ${name()}.`;
    }
  };
  return (
    <div class="ch-step-body">
      <p>{how()}</p>
      <Show when={where()}>
        {(url) => (
          <a class={buttonClass({ size: "compact" })} href={url()} target="_blank" rel="noopener noreferrer">
            Open {name()}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </Show>
      <Show when={!voice()}>
        <p class={received() ? "cx-ok" : "cx-static"} role="status">
          {received() ? "The message arrived." : "Waiting for a message…"}
        </p>
      </Show>
      <Show when={finish.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(finish.error, "Not finished yet. Send the message, then try again.")}
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" onClick={() => props.onExit()}>
          Save and exit
        </Button>
        <Button variant="primary" disabled={finish.isPending || (!voice() && !received() && props.endpoint.provider !== "slack")} onClick={() => finish.mutate()}>
          {finish.isPending ? "Finishing…" : voice() ? "Verify the test call" : "Finish"}
        </Button>
      </div>
    </div>
  );
}
