import type { ComposioAppSetupResult, ToolConnection } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, RefreshCw } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { aggregatorsApi } from "@/api/connection-extras";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { Card } from "../chat/parts";
import { failureText } from "../shared";
import { accountStatus, AGGREGATORS, managementUrl, toolkitSlug, type AggregatorId } from "./setups-model";

/*
 * An aggregator gateway's apps and accounts, on its connection page (the old UI's
 * AggregatorAppManager, ComposioAppManager, ComposioAppSetup and ArcadeDiscoverySetup):
 *
 * - The apps and accounts the gateway last saw upstream, how fresh that is, and Refresh. These are
 *   observations: they don't give agents access; the connection's actions do.
 * - Arcade lists accounts only with a project key and user id ("Sync accounts"); the gateway works
 *   without them.
 * - Composio connects one more app through the account: start, sign in to the app in Composio,
 *   then confirm here.
 *
 * Sign-in and account management stay in the provider ("Open in Composio/Arcade").
 */

export function AggregatorAccounts(props: { connection: ToolConnection; id: AggregatorId; canConfigure: boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const name = () => AGGREGATORS[props.id].name;
  const key = () => queryKeys.tools.connectionPart(company().id, props.connection.id, "aggregator-apps");
  const apps = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => aggregatorsApi.apps(props.connection.id, signal),
    refetchInterval: (query) => (query.state.data?.sync.status === "syncing" ? 1500 : false),
    retry: false,
  }));
  const refresh = createMutation(() => ({
    mutationFn: () => aggregatorsApi.refresh(props.connection.id, (apps.data?.apps ?? []).map((app) => app.toolkit)),
    onSuccess: (result) => client.setQueryData(key(), result),
    onError: (error) => pushToast({ tone: "error", title: `Couldn't check ${name()}`, body: failureText(error, "Try again.") }),
  }));
  const accounts = () => (apps.data?.apps ?? []).flatMap((snapshot) => snapshot.accounts.map((account) => ({ snapshot, account })));
  const manage = () => managementUrl(props.id, accounts()[0]?.account.managementUrl ?? (typeof props.connection.config?.managementUrl === "string" ? props.connection.config.managementUrl : null));
  const setupNeeded = () => apps.data?.discovery.availability === "setup_required";

  return (
    <Card
      title={`Apps through ${name()}`}
      description={`What ${name()} has connected for this account. Which of its tools agents may use is set below.`}
      footer={
        <>
          <Button
            size="compact"
            variant="quiet"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            disabled={refresh.isPending || apps.data?.discovery.availability !== "available"}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Checking…" : "Refresh"}
          </Button>
          <Show when={manage()}>
            {(url) => (
              <a class={buttonClass({ size: "compact" })} href={url()} target="_blank" rel="noopener noreferrer">
                Open in {name()}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          </Show>
        </>
      }
    >
      <Switch>
        <Match when={apps.isPending}>
          <p class="cx-static">Loading accounts…</p>
        </Match>
        <Match when={apps.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(apps.error, `Couldn't load ${name()}'s accounts.`)}
          </p>
        </Match>
        <Match when={true}>
          <Show when={apps.data?.sync.status === "error" || refresh.isError}>
            <p class="cx-note cx-note--warn">Couldn't check {name()} just now; these are the last accounts it saw.</p>
          </Show>
          <Show when={apps.data?.sync.status === "syncing"}>
            <p class="cx-static" role="status">
              Checking {apps.data!.sync.checked} of {apps.data!.sync.total}…
            </p>
          </Show>
          <Show
            when={accounts().length > 0}
            fallback={<p class="cx-static">{apps.data?.discovery.message ?? `No connected accounts in ${name()} yet.`}</p>}
          >
            <ul class="ch-list" aria-label={`Accounts in ${name()}`}>
              <For each={accounts()}>
                {({ snapshot, account }) => {
                  const status = () => accountStatus(snapshot, account);
                  return (
                    <li class="ch-row">
                      <span class="ch-row-main">
                        <b>{account.alias || `${snapshot.appName} account`}</b>
                        <span class="ch-row-meta">
                          {snapshot.appName} · {status().label}
                          {status().hint ? ` · ${status().hint}` : ""}
                          {account.isDefault ? " · Default" : ""}
                        </span>
                      </span>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
          <Show when={props.id === "arcade" && props.canConfigure && (setupNeeded() || accounts().length === 0)}>
            <ArcadeSync connection={props.connection} onSaved={(result) => client.setQueryData(key(), result)} />
          </Show>
          <Show when={props.id === "composio" && props.canConfigure}>
            <ComposioConnectApp connection={props.connection} onDone={() => void client.invalidateQueries({ queryKey: key() })} />
          </Show>
        </Match>
      </Switch>
    </Card>
  );
}

function ArcadeSync(props: { connection: ToolConnection; onSaved: (result: Awaited<ReturnType<typeof aggregatorsApi.arcadeDiscovery>>) => void }) {
  const [apiKey, setApiKey] = createSignal("");
  const [userId, setUserId] = createSignal("");
  const save = createMutation(() => ({
    mutationFn: () => aggregatorsApi.arcadeDiscovery(props.connection.id, { apiKey: apiKey().trim(), userId: userId().trim() }),
    onSuccess: (result) => {
      setApiKey("");
      props.onSaved(result);
      pushToast({ tone: "success", title: "Arcade accounts synced" });
    },
  }));
  return (
    <details class="ap-more">
      <summary>Sync Arcade accounts</summary>
      <form
        class="ap-more-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (apiKey().trim() && userId().trim()) save.mutate();
        }}
      >
        <p class="cx-note">The gateway works without this. A project key and user id let Paperclip list the accounts behind it; the key is stored and used only for that.</p>
        <Field label="Project API key" for="ap-arcade-key" help="From Arcade, for the same project as this gateway.">
          <TextInput id="ap-arcade-key" type="password" autocomplete="new-password" value={apiKey()} onInput={(event) => setApiKey(event.currentTarget.value)} />
        </Field>
        <Field label="Arcade user id" for="ap-arcade-user" help="The end-user id this gateway signs in as. It may not be your email.">
          <TextInput id="ap-arcade-user" autocomplete="off" value={userId()} onInput={(event) => setUserId(event.currentTarget.value)} />
        </Field>
        <Show when={save.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(save.error, "Couldn't save the account sync.")}
          </p>
        </Show>
        <div class="cx-actions">
          <span />
          <Button type="submit" size="compact" disabled={!apiKey().trim() || !userId().trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Save and sync"}
          </Button>
        </div>
      </form>
    </details>
  );
}

function ComposioConnectApp(props: { connection: ToolConnection; onDone: () => void }) {
  const [toolkit, setToolkit] = createSignal("");
  const [result, setResult] = createSignal<ComposioAppSetupResult | null>(null);
  const slug = () => toolkitSlug(toolkit());
  const setup = createMutation(() => ({
    mutationFn: (action: "start" | "complete") => aggregatorsApi.composioSetup(props.connection.id, slug(), { action }),
    onSuccess: (next) => {
      setResult(next);
      props.onDone();
      if (next.status === "connected") {
        pushToast({ tone: "success", title: `${toolkit().trim()} is connected through Composio` });
        setToolkit("");
        setResult(null);
      }
    },
  }));
  return (
    <details class="ap-more">
      <summary>Connect another app through Composio</summary>
      <form
        class="ap-more-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (slug()) setup.mutate(result() ? "complete" : "start");
        }}
      >
        <Field label="App" for="ap-composio-app" help="Composio's name for it, such as gmail, notion or googlesheets.">
          <TextInput
            id="ap-composio-app"
            autocomplete="off"
            value={toolkit()}
            disabled={Boolean(result())}
            onInput={(event) => {
              setToolkit(event.currentTarget.value);
              setResult(null);
            }}
          />
        </Field>
        <Show when={result()?.authorizationUrl}>
          {(url) => (
            <p class="cx-note">
              Finish connecting it in Composio, then come back:{" "}
              <a href={url()} target="_blank" rel="noopener noreferrer">
                connect {toolkit().trim()} in Composio <ExternalLink size={11} aria-hidden="true" />
              </a>
            </p>
          )}
        </Show>
        <Show when={setup.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(setup.error, "Couldn't set that app up.")}
          </p>
        </Show>
        <div class="cx-actions">
          <Show when={result()} fallback={<span />}>
            <Button size="compact" variant="quiet" disabled={setup.isPending} onClick={() => setup.mutate("start")}>
              Get a new link
            </Button>
          </Show>
          <Button type="submit" size="compact" disabled={!slug() || setup.isPending}>
            {setup.isPending ? "Checking…" : result() ? "I've connected it" : "Continue"}
          </Button>
        </div>
      </form>
    </details>
  );
}
