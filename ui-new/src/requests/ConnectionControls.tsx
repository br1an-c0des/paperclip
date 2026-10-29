import type { ConnectionIntentInteraction } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, RotateCcw } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { connectionIntentsApi } from "@/api/connection-intents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Footer } from "./card-parts";
import type { Request } from "./request-model";

/*
 * An agent asking to connect an app (a `connection_intent` card), after the old UI's
 * ConnectionIntentInteractionBody. Only the person it's addressed to can act; everyone else sees who
 * it waits on.
 *
 * - Access to an existing connection: the tools it would get, then Grant access or Not now.
 * - A new connection: reuse one you already have (`…/complete`), or set one up in Apps, which opens
 *   in a new tab while the card is marked "authorizing" (`…/phase`) and checks every few seconds for
 *   the new connection. The provider's sign-in page opens from Apps, not from here.
 * - An AI connection: use one of yours for the agent (`/agents/:id/connection-intents/:id/adopt`)
 *   when its sign-in needs adopting, continue with a repaired one, or set one up in Apps → AI
 *   connections.
 * - Not now declines (`…/decline`); the agent continues without it.
 */

type Payload = ConnectionIntentInteraction["payload"];

/** Where to set the app up: the server's setup path for its method, or the app's gallery page. */
export function setupHref(prefix: string, payload: Pick<Payload, "serviceSlug" | "purpose">, setupPath?: string | null) {
  if (payload.purpose === "ai") return `/${prefix}/apps/ai`;
  if (setupPath?.startsWith("/")) return setupPath.startsWith(`/${prefix}/`) ? setupPath : `/${prefix}${setupPath}`;
  if (payload.serviceSlug.startsWith("connection:")) return `/${prefix}/apps`;
  return `/${prefix}/apps/connect?source=${encodeURIComponent(payload.serviceSlug)}`;
}

function Logo(props: { payload: Payload }) {
  const [failed, setFailed] = createSignal(false);
  return (
    <Show
      when={props.payload.serviceLogoUrl && !failed()}
      fallback={
        <span class="rq-logo rq-logo--initial" aria-hidden="true">
          {props.payload.serviceName.trim().charAt(0).toUpperCase() || "?"}
        </span>
      }
    >
      <span class="rq-logo" aria-hidden="true">
        <img src={props.payload.serviceLogoUrl!} alt="" width={22} height={22} onError={() => setFailed(true)} />
      </span>
    </Show>
  );
}

export function ConnectionControls(props: { request: Request; interaction: ConnectionIntentInteraction; onDone: () => void }) {
  const client = useQueryClient();
  const company = useCompany();
  const payload = () => props.interaction.payload;
  const access = () => payload().accessRequest ?? null;
  const ai = () => payload().purpose === "ai";
  const [error, setError] = createSignal<string | null>(null);
  const [picked, setPicked] = createSignal<string | null>(null);
  const authorizing = () => payload().phase === "authorizing";

  const options = createQuery(() => ({
    queryKey: queryKeys.connectionIntents.setup(props.interaction.id),
    queryFn: ({ signal }) => connectionIntentsApi.setupOptions(props.interaction.id, signal),
    enabled: props.request.respond.allowed,
    refetchInterval: authorizing() ? 3000 : false,
  }));

  // The intent can settle elsewhere (a provider callback, another tab): refresh the card's sources.
  createEffect(
    on(
      () => options.data?.interaction.status,
      (status) => {
        if (status && status !== "pending") props.onDone();
      },
      { defer: true },
    ),
  );

  const existing = () => options.data?.existingConnections ?? [];
  const repair = () => options.data?.aiRepair ?? null;
  const adopting = () => options.data?.aiConnectionRequiresAdoption === true;
  const repaired = () => {
    const current = repair();
    return current && existing().some((connection) => connection.id === current.connection.id) ? current.connection : null;
  };
  // A single existing connection is picked for you.
  createEffect(() => {
    if (!picked() && existing().length === 1) setPicked(existing()[0]!.id);
  });
  const setupPath = createMemo(() => options.data?.service.methods.find((method) => method.setupPath)?.setupPath ?? null);

  const after = () => {
    setError(null);
    void client.invalidateQueries({ queryKey: queryKeys.connectionIntents.setup(props.interaction.id) });
    props.onDone();
  };
  const fail = (failure: Error) => setError(failure.message);
  const complete = createMutation(() => ({ mutationFn: (connectionId: string) => connectionIntentsApi.complete(props.interaction.id, connectionId), onSuccess: after, onError: fail }));
  const adopt = createMutation(() => ({
    mutationFn: (connectionId: string) => connectionIntentsApi.adopt(company().id, payload().requestingAgentId, props.interaction.id, connectionId),
    onSuccess: after,
    onError: fail,
  }));
  const decline = createMutation(() => ({ mutationFn: () => connectionIntentsApi.decline(props.interaction.id), onSuccess: after, onError: fail }));
  const phase = createMutation(() => ({
    mutationFn: (next: Payload["phase"]) => connectionIntentsApi.setPhase(props.interaction.id, next),
    onSuccess: () => props.onDone(),
    onError: fail,
  }));
  const busy = () => complete.isPending || adopt.isPending || decline.isPending;

  const notNow = () => (
    <Button size="compact" variant="quiet" disabled={busy()} onClick={() => decline.mutate()}>
      Not now
    </Button>
  );
  const setupLink = (label: string) => (
    <a
      class={buttonClass({ size: "compact", variant: existing().length ? "secondary" : "primary" })}
      href={setupHref(company().issuePrefix, payload(), setupPath())}
      target="_blank"
      rel="noopener"
      onClick={() => {
        if (!ai() && !authorizing()) phase.mutate("authorizing");
      }}
    >
      <ExternalLink size={14} aria-hidden="true" />
      {label}
    </a>
  );

  return (
    <>
      <div class="rq-app">
        <Logo payload={payload()} />
        <span>
          <b>{payload().serviceName}</b>
          <Show when={payload().upstreamService}>{(upstream) => <small> · through {upstream().name}</small>}</Show>
        </span>
      </div>
      <Show when={access()}>
        {(request) => (
          <ul class="rq-tools" aria-label="Tool permissions">
            <For each={request().tools}>
              {(tool) => (
                <li>
                  <span class="mono">{tool.toolName}</span>
                  <small>{tool.permission === "allowed" ? "Allowed" : "Ask first"}</small>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
      <Show when={props.request.respond.allowed && payload().phase === "needs_retry"}>
        <p class="rq-error" role="status">
          <RotateCcw size={13} aria-hidden="true" /> The sign-in didn't finish. Your choices are saved; try again.
        </p>
      </Show>
      <Show when={props.request.respond.allowed && !access()}>
        <Switch>
          <Match when={options.isPending}>
            <p class="rq-note">Loading the ways to connect…</p>
          </Match>
          <Match when={options.isError}>
            <p class="rq-error" role="alert">
              Couldn't load the ways to connect. {options.error?.message}
            </p>
          </Match>
          <Match when={ai() && repaired()}>{(connection) => <p class="rq-note">{connection().name} is ready again.</p>}</Match>
          <Match when={ai() && repair() && !adopting()}>
            <p class="rq-note">
              {repair()!.canReconnect
                ? `Reconnect ${repair()!.connection.name} in Apps → AI connections, then continue here.`
                : `${repair()!.connection.ownerName ?? "The account's owner"} must reconnect ${repair()!.connection.name}. You can continue here once it's back.`}
            </p>
          </Match>
          <Match when={existing().length > 0}>
            <div class="rq-opts" role="radiogroup" aria-label={adopting() ? "Your AI connections" : "Connections you can reuse"}>
              <For each={existing()}>
                {(connection) => (
                  <button
                    type="button"
                    class="rq-opt"
                    role="radio"
                    aria-checked={picked() === connection.id}
                    disabled={busy() || !connection.enabled}
                    onClick={() => setPicked(connection.id)}
                  >
                    <span class="rq-radio" aria-hidden="true" />
                    <span class="rq-opt-main">
                      {connection.name}
                      <small>{connection.enabled ? (connection.status ?? "ready").replaceAll("_", " ") : "Turned off"}</small>
                    </span>
                  </button>
                )}
              </For>
            </div>
            <Show when={adopting()}>
              <p class="rq-note">This replaces {payload().requestingAgentName}'s own sign-in with your account. The model stays the same.</p>
            </Show>
          </Match>
          <Match when={true}>
            <p class="rq-note">
              {ai()
                ? `${payload().requestingAgentName} needs a working AI connection. Set one up in Apps, then pick it here.`
                : authorizing()
                  ? "Finish connecting in the tab that opened. The new connection shows up here."
                  : "You don't have a connection to reuse yet. Set one up in Apps; it shows up here once it's connected."}
            </p>
          </Match>
        </Switch>
      </Show>
      <Footer request={props.request} error={error()}>
        <Switch>
          <Match when={access()}>
            {(request) => (
              <>
                <Button size="compact" variant="primary" disabled={busy() || options.data?.canGrantAccess === false} onClick={() => complete.mutate(request().connectionId)}>
                  {complete.isPending ? "Granting access…" : "Grant access"}
                </Button>
                {notNow()}
                <Show when={options.data?.canGrantAccess === false}>
                  <span class="rq-note">Only someone who manages connections can grant this.</span>
                </Show>
              </>
            )}
          </Match>
          <Match when={ai() && repaired()}>
            {(connection) => (
              <Button size="compact" variant="primary" disabled={busy()} onClick={() => complete.mutate(connection().id)}>
                Continue the task
              </Button>
            )}
          </Match>
          <Match when={true}>
            <Show when={existing().length > 0 && !(ai() && repair() && !adopting())}>
              <Button
                size="compact"
                variant="primary"
                disabled={busy() || !picked()}
                onClick={() => (adopting() ? adopt.mutate(picked()!) : complete.mutate(picked()!))}
              >
                {adopting() ? "Use it for the agent" : "Use this connection"}
              </Button>
            </Show>
            <Show when={!options.isPending}>{setupLink(ai() ? "Set up in AI connections" : existing().length ? "Set up a new one" : `Connect ${payload().serviceName}`)}</Show>
            <Show when={!ai()}>{notNow()}</Show>
          </Match>
        </Switch>
      </Footer>
    </>
  );
}
