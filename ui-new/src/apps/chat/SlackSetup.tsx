import type { SlackTestMessageResult } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, ExternalLink, Send } from "lucide-solid";
import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { chatEndpointsApi, slackToolsApi, type ChatEndpoint } from "@/api/chat-endpoints";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { failureText } from "../shared";
import { Card } from "./parts";
import { automaticStage, managedMessage, managedWorkspace, slackSetupMessage } from "./slack-model";
import "./ChatExtras.css";

/*
 * Slack beyond the manifest you paste yourself (the old UI's slack/ManagedSlackSetup,
 * OwnSlackAppSetup, SlackTestMessageButton and SlackToolSettings):
 *
 * - Managed setup: Paperclip's Slack manager app, authorized once per workspace, creates and
 *   installs the agent's own app (`…/slack/managed/authorize`, `…/managed/provision`).
 * - Automatic setup: you paste an App configuration access token and Paperclip creates the app
 *   (`…/slack/registration`), then you install it with your Slack account (`…/slack/install`). A
 *   saved installation that didn't finish retries with `…/slack/resume`. The token is never kept:
 *   it lives in the field until the request, and isn't put in any query cache.
 * - A test message from the bot to you; Slack may first ask which Slack account is yours.
 * - The bot's tool permissions and your personal Slack search access.
 *
 * Slack's pages are opened by full-page navigation, as the old UI does, so its return lands back on
 * this saved draft.
 */

/** Sends you to Slack's authorization page. Paperclip Cloud hand-offs aren't supported here. */
function leaveFor(authorization: { authorizationUrl: string; handoff?: unknown }) {
  if (authorization.handoff) throw new Error("This Slack setup signs in through Paperclip Cloud, which this board can't hand off to yet.");
  window.location.assign(authorization.authorizationUrl);
}

export function ManagedSlackSetup(props: { endpoint: ChatEndpoint; reconnect: boolean; onSaved: (next: ChatEndpoint) => void; onExit: () => void; onManual: () => void }) {
  const company = useCompany();
  const options = createQuery(() => ({
    queryKey: [...queryKeys.chatEndpoints.all(company().id), "slack-setup-options"],
    queryFn: ({ signal }) => chatEndpointsApi.slackSetupOptions(company().id, signal),
    retry: false,
  }));
  const [picked, setPicked] = createSignal<string | null>(null);
  const [confirmed, setConfirmed] = createSignal(false);
  let requestId = crypto.randomUUID();
  const registration = () => props.endpoint.setup?.slackRegistration ?? null;
  const workspaces = () => options.data?.workspaces ?? [];
  const target = () => managedWorkspace(props.endpoint, options.data, picked());
  const uncertain = () => registration()?.status === "uncertain";
  const creating = () => registration()?.status === "creating";

  const authorize = async () => leaveFor(await chatEndpointsApi.authorizeSlackManager(props.endpoint.id));
  const connect = createMutation(() => ({
    mutationFn: async (mode: "connect" | "authorize") => {
      const { grantId, authorize: needsAuthorization } = target();
      if (mode === "authorize" || needsAuthorization || !grantId) return authorize();
      // A new request ID only when no app could have been made with the last one.
      if (confirmed() || registration()?.status === "failed") requestId = crypto.randomUUID();
      const result = await chatEndpointsApi.provisionManagedSlack(props.endpoint.id, {
        requestId,
        grantId,
        ...(props.reconnect ? { reconnect: true } : {}),
        ...(confirmed() ? { confirmedNoAppCreated: true } : {}),
      });
      setConfirmed(false);
      props.onSaved(await chatEndpointsApi.get(props.endpoint.id));
      if (result.authorization) leaveFor(result.authorization);
    },
    onError: async () => {
      void options.refetch();
      props.onSaved(await chatEndpointsApi.get(props.endpoint.id));
    },
  }));
  const message = () =>
    (connect.error ? failureText(connect.error, "Slack setup didn't finish.") : null) ??
    (props.endpoint.setup?.slackManagerError ? managedMessage(props.endpoint.setup.slackManagerError) : null) ??
    (options.isError ? "Couldn't load your Slack workspaces. Try again." : null) ??
    (registration()?.errorCode ? managedMessage(registration()!.errorCode!) : null);

  return (
    <div class="ch-step-body">
      <Show when={message()}>
        <p class="cx-note cx-note--error" role="alert">
          {message()}
        </p>
      </Show>
      <Switch>
        <Match when={options.isPending || creating() || connect.isPending}>
          <p class="cx-static" role="status">
            {connect.isPending ? (target().authorize ? "Opening Slack…" : "Connecting your agent…") : creating() ? "Setting up your Slack app…" : "Loading Slack…"}
          </p>
        </Match>
        <Match when={!options.data?.managedAvailable}>
          <p>Managed Slack setup isn't available right now. Try again later, or set the app up yourself.</p>
        </Match>
        <Match when={true}>
          <Show when={workspaces().length === 1}>
            <p>
              Add <b>{props.endpoint.assignedAgentName}</b> to <b>{workspaces()[0]!.workspaceName}</b>.
            </p>
          </Show>
          <Show when={workspaces().length === 0}>
            <p>Authorize Paperclip's Slack app in your workspace first. Slack brings you back here.</p>
          </Show>
          <Show when={workspaces().length > 1}>
            <Field label="Slack workspace" for="ch-slack-workspace">
              <select
                id="ch-slack-workspace"
                class="input"
                value={target().grantId ?? ""}
                disabled={Boolean(registration())}
                onChange={(event) => setPicked(event.currentTarget.value || null)}
              >
                <option value="">Choose a Slack workspace</option>
                <For each={workspaces()}>{(workspace) => <option value={workspace.grantId}>{workspace.workspaceName}</option>}</For>
              </select>
            </Field>
          </Show>
          <Show when={(!registration() || registration()?.errorCode === "slack_manager_reauthorize") && workspaces().length > 0}>
            <button type="button" class="cx-link" onClick={() => connect.mutate("authorize")}>
              {registration() ? "Reconnect the Slack workspace" : "Connect another Slack workspace"}
            </button>
          </Show>
        </Match>
      </Switch>
      <Show when={uncertain()}>
        <a href={registration()?.managementUrl ?? "https://api.slack.com/apps"} target="_blank" rel="noopener noreferrer">
          Open Slack app settings <ExternalLink size={12} aria-hidden="true" />
        </a>
        <label class="ch-check">
          <input type="checkbox" checked={confirmed()} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
          I checked Slack and no app was created. Create a new app.
        </label>
      </Show>
      <Show when={!registration()}>
        <button type="button" class="cx-link" onClick={() => props.onManual()}>
          Set the app up myself instead
        </button>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" disabled={connect.isPending} onClick={() => props.onExit()}>
          Save and exit
        </Button>
        <Show
          when={options.data?.managedAvailable}
          fallback={
            <Button variant="primary" disabled={options.isFetching} onClick={() => void options.refetch()}>
              Retry
            </Button>
          }
        >
          <Button
            variant="primary"
            disabled={connect.isPending || creating() || (workspaces().length > 1 && !target().grantId) || (uncertain() && !confirmed())}
            onClick={() => connect.mutate("connect")}
          >
            {target().authorize && registration() ? "Reconnect Slack" : registration()?.appId ? "Continue in Slack" : "Continue"}
          </Button>
        </Show>
      </div>
    </div>
  );
}

export function AutomaticSlackSetup(props: { endpoint: ChatEndpoint; onSaved: (next: ChatEndpoint) => void; onExit: () => void; onManual: (existing: boolean) => void }) {
  const [token, setToken] = createSignal("");
  const [checkedNoApp, setCheckedNoApp] = createSignal(false);
  let requestId = crypto.randomUUID();
  const registration = () => props.endpoint.setup?.slackRegistration ?? null;
  const stage = () => automaticStage(props.endpoint);

  const create = createMutation(() => ({
    mutationFn: async () => {
      const configurationToken = token().trim();
      setToken("");
      if (registration()?.status === "failed" || checkedNoApp()) requestId = crypto.randomUUID();
      const confirmedNoAppCreated = checkedNoApp();
      setCheckedNoApp(false);
      try {
        return await chatEndpointsApi.createSlackApp(props.endpoint.id, {
          requestId,
          credentials: { configurationToken },
          ...(confirmedNoAppCreated ? { confirmedNoAppCreated: true } : {}),
        });
      } catch (error) {
        // The answer can be lost after Slack made the app: only the saved state moves on.
        const current = await chatEndpointsApi.get(props.endpoint.id).catch(() => null);
        if (current?.setup?.slackRegistration?.appId) return current;
        if (current) props.onSaved(current);
        throw error;
      }
    },
    onSuccess: (next) => props.onSaved(next),
  }));
  const install = createMutation(() => ({
    mutationFn: async () => leaveFor(await chatEndpointsApi.installSlackApp(props.endpoint.id)),
  }));
  const resume = createMutation(() => ({
    mutationFn: () => chatEndpointsApi.resumeSlackInstallation(props.endpoint.id),
    onSuccess: (next) => props.onSaved(next),
  }));
  const busy = () => create.isPending || install.isPending || resume.isPending;
  const error = () => create.error ?? install.error ?? resume.error;
  const showTokenField = () => stage() === "create" || stage() === "retry-config" || (stage() === "uncertain" && checkedNoApp());

  return (
    <div class="ch-step-body">
      <Show when={error() || registration()?.errorCode}>
        <p class="cx-note cx-note--error" role="alert">
          {error() ? failureText(error(), "Slack didn't accept that.") : slackSetupMessage(registration()!.errorCode!)}
        </p>
      </Show>
      <Show when={stage() === "uncertain"}>
        <a href={registration()?.managementUrl ?? "https://api.slack.com/apps"} target="_blank" rel="noopener noreferrer">
          Open Slack app settings <ExternalLink size={12} aria-hidden="true" />
        </a>
        <label class="ch-check">
          <input type="checkbox" checked={checkedNoApp()} disabled={busy()} onChange={(event) => setCheckedNoApp(event.currentTarget.checked)} />
          I checked Slack and no app was created. Create a new app.
        </label>
      </Show>
      <Show when={showTokenField()}>
        <ol class="ch-howto">
          <li>
            In Slack's app settings, find <b>Your App Configuration Tokens</b> and choose <b>Generate Token</b>.
          </li>
          <li>Pick the workspace the bot should join.</li>
          <li>
            Copy the <b>Access Token</b> and paste it below. Paperclip uses it once to create the app.
          </li>
        </ol>
        <a class={buttonClass({ size: "compact" })} href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
          Get an App configuration access token
          <ExternalLink size={13} aria-hidden="true" />
        </a>
        <Field label="App configuration access token" for="ch-slack-config-token">
          <TextInput
            id="ch-slack-config-token"
            type="password"
            autocomplete="off"
            spellcheck={false}
            value={token()}
            disabled={busy()}
            onInput={(event) => setToken(event.currentTarget.value)}
          />
        </Field>
      </Show>
      <Show when={stage() === "creating"}>
        <p class="cx-static" role="status">
          Creating your Slack app. You can come back to this saved setup.
        </p>
      </Show>
      <Show when={registration()?.appId && stage() !== "retry-config"}>
        <p>
          <b>{props.endpoint.setup?.slackApp?.appName ?? "Your Slack app"}</b> is created. Install it with your Slack account; Paperclip links that account
          to you and sends you a welcome message.
        </p>
      </Show>
      <Show when={stage() === "resume"}>
        <p class="cx-note">
          The installation is saved but didn't finish connecting. Retry, or{" "}
          <button type="button" class="cx-link" disabled={busy()} onClick={() => install.mutate()}>
            authorize the same app in Slack again
          </button>
          .
        </p>
      </Show>
      <Show when={stage() === "create" && !registration()}>
        <p class="ch-links">
          <button type="button" class="cx-link" onClick={() => props.onManual(false)}>
            Paste a manifest myself
          </button>
          <button type="button" class="cx-link" onClick={() => props.onManual(true)}>
            Use an existing app
          </button>
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" disabled={busy()} onClick={() => props.onExit()}>
          Save and exit
        </Button>
        <Switch>
          <Match when={stage() === "resume"}>
            <Button variant="primary" disabled={busy()} onClick={() => resume.mutate()}>
              {resume.isPending ? "Retrying…" : "Retry connecting"}
            </Button>
          </Match>
          <Match when={stage() === "install"}>
            <Button variant="primary" disabled={busy()} onClick={() => install.mutate()}>
              {install.isPending ? "Opening Slack…" : "Install in Slack"}
            </Button>
          </Match>
          <Match when={true}>
            <Button variant="primary" disabled={busy() || stage() === "creating" || !token().trim()} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : stage() === "retry-config" ? "Retry app configuration" : "Create Slack app"}
            </Button>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// On the endpoint's page

type SlackAccounts = Extract<SlackTestMessageResult, { status: "connection_required" }>["accounts"];

/** "Send me a test message": the bot DMs you; first time, Slack asks which account is yours. */
export function SlackTestMessage(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const [requestId, setRequestId] = createSignal(crypto.randomUUID());
  const [accounts, setAccounts] = createSignal<SlackAccounts | null>(null);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [expired, setExpired] = createSignal(false);
  const principalsKey = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "principals");

  const send = createMutation(() => ({
    mutationFn: (input: { slackUserId?: string; accountCursor?: string; requestId?: string }) =>
      chatEndpointsApi.sendSlackTestMessage(props.endpoint.id, { requestId: requestId(), ...input }),
    onSuccess: (result, input) => {
      if (result.status === "connection_required") {
        const merged = input.accountCursor ? [...new Map([...(accounts() ?? []), ...result.accounts].map((account) => [account.id, account])).values()] : result.accounts;
        setAccounts(merged);
        setCursor(result.nextCursor);
        return;
      }
      setAccounts(null);
      void client.invalidateQueries({ queryKey: principalsKey() });
    },
  }));
  const sent = () => send.data?.status === "sent";
  const pending = () => (send.data?.status === "connection_pending" ? send.data : null);

  // An invitation waits for you to open it in Slack; once your account links, send the test.
  createEffect(
    on(pending, (invitation) => {
      setExpired(false);
      if (!invitation) return;
      const timer = setTimeout(() => setExpired(true), Math.max(0, new Date(invitation.expiresAt).getTime() - Date.now()));
      onCleanup(() => clearTimeout(timer));
    }),
  );
  const principals = createQuery(() => ({
    queryKey: principalsKey(),
    queryFn: ({ signal }) => chatEndpointsApi.principals(props.endpoint.id, signal),
    enabled: Boolean(pending()) && !expired(),
    refetchInterval: pending() && !expired() ? 3000 : false,
  }));
  createEffect(
    on(
      () => Boolean(pending() && principals.data?.some((link) => link.principalId === pending()!.principalId && link.status === "linked")),
      (linked) => {
        if (linked && !send.isPending) send.mutate({ slackUserId: selected() });
      },
    ),
  );
  const start = () => {
    if (expired()) {
      const next = crypto.randomUUID();
      setRequestId(next);
      send.mutate({ requestId: next, slackUserId: selected() });
    } else send.mutate({});
  };
  const shown = () => (accounts() ?? []).filter((account) => `${account.name} ${account.id}`.toLowerCase().includes(search().toLowerCase()));

  return (
    <div class="ch-test">
      <Button
        size="compact"
        icon={sent() ? <Check size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
        disabled={send.isPending || sent() || Boolean(pending() && !expired())}
        onClick={start}
      >
        {send.isPending ? "Sending…" : sent() ? "Test message sent" : expired() ? "Request a new invitation" : pending() ? "Waiting for Slack…" : "Send me a test message"}
      </Button>
      <Show when={pending()}>
        <p class="cx-static" role="status">
          {expired() ? "The Slack invitation expired." : "Open the invitation in Slack to connect your account."}
        </p>
      </Show>
      <Show when={send.isError && accounts() === null}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(send.error, "Couldn't send it.")}{" "}
          <button type="button" class="cx-link" onClick={() => send.reset()}>
            Dismiss
          </button>
        </p>
      </Show>
      <Dialog
        open={accounts() !== null}
        onOpenChange={(open) => {
          if (!open && !send.isPending) setAccounts(null);
        }}
        title="Connect your Slack account"
        description="Choose your account. Messages to this agent will use your Paperclip permissions."
        width={520}
        footer={
          <>
            <Button variant="quiet" disabled={send.isPending} onClick={() => setAccounts(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!selected() || send.isPending} onClick={() => send.mutate({ slackUserId: selected() })}>
              {send.isPending ? "Sending the invitation…" : "Send a connection invitation"}
            </Button>
          </>
        }
      >
        <div class="ch-step-body">
          <TextInput aria-label="Find your Slack account" placeholder="Find your name" value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
          <ul class="cx-options ch-accounts" role="radiogroup" aria-label="Your Slack account">
            <For each={shown()} fallback={<li class="cx-static">No available accounts found in this Slack workspace.</li>}>
              {(account) => (
                <li>
                  <label class="cx-option" classList={{ "cx-option--on": selected() === account.id }}>
                    <input type="radio" name="ch-slack-account" checked={selected() === account.id} onChange={() => setSelected(account.id)} />
                    <span class="cx-option-name">
                      {account.name} <span class="cx-row-meta">({account.id})</span>
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
          <Show when={cursor()}>
            <Button size="compact" variant="quiet" disabled={send.isPending} onClick={() => send.mutate({ accountCursor: cursor()! })}>
              Load more Slack accounts
            </Button>
          </Show>
          <Show when={send.isError}>
            <p class="cx-note cx-note--error" role="alert">
              {failureText(send.error, "Couldn't send the invitation.")}
            </p>
          </Show>
        </div>
      </Dialog>
    </div>
  );
}

/** The bot's Slack permissions, and your own search access (which needs the app's OAuth client). */
export function SlackTools(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const capabilities = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "slack-capabilities"),
    queryFn: ({ signal }) => slackToolsApi.capabilities(company().id, props.endpoint.id, signal),
    staleTime: 60_000,
    retry: false,
  }));
  const search = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "slack-search"),
    queryFn: ({ signal }) => slackToolsApi.search(company().id, props.endpoint.id, signal),
    retry: false,
  }));
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  createEffect(on(() => search.data?.clientId, (value) => setClientId(value ?? "")));
  const act = createMutation(() => ({
    mutationFn: async (action: "connect" | "disconnect" | "configure") => {
      if (action === "connect") {
        const result = await slackToolsApi.connectSearch(company().id, props.endpoint.id);
        window.location.assign(result.url);
        return;
      }
      if (action === "disconnect") await slackToolsApi.disconnectSearch(company().id, props.endpoint.id);
      else {
        await slackToolsApi.configureSearch(company().id, props.endpoint.id, { clientId: clientId().trim(), clientSecret: clientSecret() });
        setClientSecret("");
      }
      await search.refetch();
    },
  }));

  return (
    <Card title="Slack tools" description="Read, search and act in Slack. Some actions ask first.">
      <Switch>
        <Match when={capabilities.isPending}>
          <p class="cx-static">Checking Slack permissions…</p>
        </Match>
        <Match when={capabilities.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(capabilities.error, "Couldn't check Slack permissions.")}
          </p>
        </Match>
        <Match when={(capabilities.data?.missingScopes.length ?? 0) > 0}>
          <div class="cx-note cx-note--warn">
            <p>
              <b>Add permissions to unlock more tools.</b> The connection still works. In{" "}
              <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
                Slack app settings
              </a>
              , open OAuth &amp; Permissions, add these Bot Token Scopes, then reinstall the app:
            </p>
            <p class="mono ch-scopes">{capabilities.data!.missingScopes.join(", ")}</p>
          </div>
        </Match>
        <Match when={true}>
          <p class="cx-ok">The bot has every permission its tools use.</p>
        </Match>
      </Switch>

      <h4 class="ch-subhead">Your Slack search access</h4>
      <p class="cx-static">
        Optional. Your own authorization lets agents search private conversations you can see, on runtimes that support it. It can't read channels the bot
        hasn't joined or write as you.
      </p>
      <Switch>
        <Match when={search.isPending}>
          <p class="cx-static">Loading search access…</p>
        </Match>
        <Match when={search.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(search.error, "Couldn't load search access.")}
          </p>
        </Match>
        <Match when={search.data}>
          {(status) => (
            <>
              <Show when={!status().nativeSearchAvailable && status().limitation}>
                <p class="cx-static">{status().limitation}</p>
              </Show>
              <Show
                when={status().connected}
                fallback={
                  <Button size="compact" disabled={act.isPending || !status().configured} onClick={() => act.mutate("connect")}>
                    Connect Slack search
                  </Button>
                }
              >
                <p class="ch-inline">
                  <span class="cx-ok">Slack search connected</span>
                  <Button size="compact" disabled={act.isPending} onClick={() => act.mutate("disconnect")}>
                    Disconnect search
                  </Button>
                </p>
              </Show>
              <Show when={!status().configured}>
                <p class="cx-static">A connection manager needs to add the Slack app's OAuth client first.</p>
              </Show>
              <Show when={status().canConfigure}>
                <details class="ch-details">
                  <summary>OAuth client (connection managers)</summary>
                  <form
                    class="ch-step-body"
                    onSubmit={(event) => {
                      event.preventDefault();
                      act.mutate("configure");
                    }}
                  >
                    <p>
                      In Slack app settings, add this redirect address under OAuth &amp; Permissions, and the user scopes <code>search:read.public</code>,{" "}
                      <code>search:read.private</code> and <code>search:read.files</code>. The Client ID and Secret are under Basic Information.
                    </p>
                    <p class="mono ch-scopes">{status().redirectUri ?? "Give this Paperclip a public HTTPS address first."}</p>
                    <Field label="Client ID" for="ch-slack-client">
                      <TextInput id="ch-slack-client" value={clientId()} onInput={(event) => setClientId(event.currentTarget.value)} />
                    </Field>
                    <Field label="Client secret" for="ch-slack-secret">
                      <TextInput id="ch-slack-secret" type="password" autocomplete="new-password" value={clientSecret()} onInput={(event) => setClientSecret(event.currentTarget.value)} />
                    </Field>
                    <div class="cx-actions">
                      <span />
                      <Button type="submit" size="compact" variant="primary" disabled={act.isPending || !clientId().trim() || !clientSecret()}>
                        Save the OAuth client
                      </Button>
                    </div>
                  </form>
                </details>
              </Show>
            </>
          )}
        </Match>
      </Switch>
      <Show when={act.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(act.error, "Couldn't update Slack search.")}
        </p>
      </Show>
    </Card>
  );
}
