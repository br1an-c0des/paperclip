import type { AggregatorAppsResponse, ComposioAppSetupResult, ToolConnection } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQueries, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, RefreshCw } from "lucide-solid";
import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import { aggregatorsApi } from "@/api/connection-extras";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { AppLogo, failureText, useConnections } from "../shared";
import {
  connectStart,
  gatewaySetupHref,
  gatewaysByProvider,
  gatewayStatus,
  PROVIDER_NAMES,
  routesFor,
  routesText,
  usableGateway,
  type CatalogRoute,
  type CatalogRow,
  type CatalogSource,
} from "./catalog-model";
import { accountStatus, managementUrl, type AggregatorId } from "./setups-model";

/*
 * Composio and Arcade's apps in Browse's gallery (the old UI's catalog sources, its
 * AggregatorConnectDialog, ComposioAppSetup and AggregatorAppManager). The rows come from
 * catalog-model.ts; this draws them, and the two dialogs:
 *
 * - Connect: pick the provider when the app has both, then a saved gateway. Composio connects the
 *   app there and then (`POST tool-connections/:id/composio/apps/:toolkit/setup`, start, sign in to
 *   the app in Composio, then complete); Arcade manages app sign-in itself, so Continue opens Arcade.
 *   With no gateway for the provider, Connect goes to the gateway's setup.
 * - Manage, for an app with accounts: the accounts each gateway saw, Refresh
 *   (`POST …/aggregator/apps/refresh`), and the provider's own page.
 *
 * The public catalog (about 100 kB of JSON) loads only when the gallery does.
 */

/** The shared package's catalog of Composio and Arcade apps, loaded on first use. */
export function useAggregatorCatalog() {
  const [module] = createResource(() => import("@paperclipai/shared/aggregator-app-catalog"));
  return module;
}

/** The company's gateways, and what each has seen upstream (`GET tool-connections/:id/aggregator/apps`). */
export function useGatewayAccounts() {
  const company = useCompany();
  const connections = useConnections();
  const gateways = createMemo(() => gatewaysByProvider(connections.data?.connections ?? []));
  const all = createMemo(() => [...gateways().composio, ...gateways().arcade].filter((connection) => connection.status !== "draft"));
  const queries = createQueries(() => ({
    queries: all().map((connection) => ({
      queryKey: queryKeys.tools.connectionPart(company().id, connection.id, "aggregator-apps"),
      queryFn: ({ signal }: { signal: AbortSignal }) => aggregatorsApi.apps(connection.id, signal),
      staleTime: 60_000,
      retry: false,
    })),
  }));
  const observed = createMemo(() => queries.flatMap((query) => (query.data ? [query.data as AggregatorAppsResponse] : [])));
  return { gateways, observed };
}

const PAGE = 24;

/** The catalog rows a source and search show, a page at a time. */
export function CatalogSection(props: { rows: CatalogRow[]; source: CatalogSource; gateways: Record<AggregatorId, ToolConnection[]>; loading: boolean; searching: boolean }) {
  const company = useCompany();
  const navigate = useNavigate();
  const base = () => `/${company().issuePrefix}/apps`;
  const [shown, setShown] = createSignal(PAGE);
  const [connecting, setConnecting] = createSignal<CatalogRow | null>(null);
  const [managing, setManaging] = createSignal<CatalogRow | null>(null);
  const page = () => props.rows.slice(0, shown());
  const connect = (row: CatalogRow) => {
    const start = connectStart(routesFor(row, props.source), props.gateways);
    if (start.kind === "setup") navigate(gatewaySetupHref(base(), start.route));
    else setConnecting(row);
  };
  const title = () => (props.source === "composio" ? "Through Composio" : props.source === "arcade" ? "Through Arcade" : "Through Composio and Arcade");

  return (
    <Show when={props.loading || props.rows.length > 0}>
      <div class="ap-group ap-catalog">
        <h4 class="ap-group-title">
          {title()}
          <span>
            {props.loading
              ? "Loading their apps…"
              : `${props.rows.length.toLocaleString()} ${props.rows.length === 1 ? "app" : "apps"} through a gateway you connect. Sign-in to each app happens in the provider.`}
          </span>
        </h4>
        <ul class="ap-grid" aria-label={title()}>
          <For each={page()}>
            {(row) => (
              <li class="ap-tile">
                <div class="ap-tile-head">
                  <AppLogo name={row.name} logoUrl={row.logoUrl} size={40} />
                  <div class="ap-tile-title">
                    <span class="ap-tile-name">{row.name}</span>
                    <Show when={row.accounts.length > 0}>
                      <span class="ap-tile-count">{row.accounts.length === 1 ? "1 account" : `${row.accounts.length} accounts`}</span>
                    </Show>
                  </div>
                </div>
                <p class="ap-tile-desc">{routesText({ routes: routesFor(row, props.source) })}</p>
                <span class="ap-inline">
                  <Show when={row.accounts.length > 0}>
                    <Button size="compact" onClick={() => setManaging(row)}>
                      Manage
                    </Button>
                  </Show>
                  <Button size="compact" variant={row.accounts.length > 0 ? "quiet" : "secondary"} onClick={() => connect(row)}>
                    {row.accounts.length > 0 ? "Add account" : "Connect"}
                  </Button>
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.rows.length > shown()}>
          <div class="ap-more-rows">
            <span class="cx-note" role="status">
              Showing {shown().toLocaleString()} of {props.rows.length.toLocaleString()}
              {props.searching ? "" : ". Search to find one"}
            </span>
            <Button size="compact" variant="quiet" onClick={() => setShown(shown() + PAGE * 2)}>
              Show more
            </Button>
          </div>
        </Show>
      </div>
      <Show when={connecting()}>
        {(row) => <CatalogConnectDialog row={row()} routes={routesFor(row(), props.source)} gateways={props.gateways} onClose={() => setConnecting(null)} />}
      </Show>
      <Show when={managing()}>{(row) => <CatalogManageDialog row={row()} gateways={props.gateways} onClose={() => setManaging(null)} />}</Show>
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// Connect

export function CatalogConnectDialog(props: { row: CatalogRow; routes: CatalogRoute[]; gateways: Record<AggregatorId, ToolConnection[]>; onClose: () => void }) {
  const company = useCompany();
  const navigate = useNavigate();
  const base = () => `/${company().issuePrefix}/apps`;
  const [route, setRoute] = createSignal<CatalogRoute | null>(props.routes.length === 1 ? props.routes[0]! : null);
  const choose = (next: CatalogRoute) => {
    if (props.gateways[next.provider].length === 0) {
      props.onClose();
      navigate(gatewaySetupHref(base(), next));
    } else setRoute(next);
  };
  const back = () => (props.routes.length > 1 ? () => setRoute(null) : undefined);
  const title = () => (route() ? `Connect ${props.row.name} through ${PROVIDER_NAMES[route()!.provider]}` : `Connect ${props.row.name}`);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} title={title()} width={520}>
      <Switch>
        <Match when={!route()}>
          <p class="cx-note">Which service should handle the connection? It signs in to {props.row.name} and makes the calls.</p>
          <ul class="cx-options ap-providers" aria-label="Providers">
            <For each={props.routes}>
              {(candidate) => (
                <li>
                  <button type="button" class="cx-option ap-provider" onClick={() => choose(candidate)}>
                    <span class="ap-method-text">
                      <span class="cx-option-name">{PROVIDER_NAMES[candidate.provider]}</span>
                      <span class="cx-option-note">{gatewayStatus(props.gateways[candidate.provider])}</span>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Match>
        <Match when={route()?.provider === "composio" && route()}>
          {(current) => <ComposioSetup row={props.row} route={current()} gateways={props.gateways.composio} onBack={back()} onClose={props.onClose} />}
        </Match>
        <Match when={route()}>
          {(current) => <ArcadeContinue row={props.row} route={current()} gateways={props.gateways.arcade} onBack={back()} onClose={props.onClose} />}
        </Match>
      </Switch>
    </Dialog>
  );
}

function GatewayPicker(props: { id: string; provider: AggregatorId; gateways: ToolConnection[]; value: string; onChange: (id: string) => void; disabled?: boolean; newOption?: boolean }) {
  return (
    <Field label={`${PROVIDER_NAMES[props.provider]} gateway`} for={props.id}>
      <select id={props.id} class="input" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)}>
        <For each={props.gateways}>{(gateway) => <option value={gateway.id}>{gateway.name}</option>}</For>
        <Show when={props.newOption}>
          <option value="__new__">Set up another gateway…</option>
        </Show>
      </select>
    </Field>
  );
}

/** Composio: connect the app through a saved gateway, signing in to the app in Composio. */
function ComposioSetup(props: { row: CatalogRow; route: CatalogRoute; gateways: ToolConnection[]; onBack?: () => void; onClose: () => void }) {
  const company = useCompany();
  const navigate = useNavigate();
  const client = useQueryClient();
  const usable = () => props.gateways.filter(usableGateway);
  const [selected, setSelected] = createSignal<string | null>(null);
  const gatewayId = () => selected() ?? usable()[0]?.id ?? "__new__";
  const [result, setResult] = createSignal<ComposioAppSetupResult | null>(null);
  const setup = createMutation(() => ({
    mutationFn: (action: "start" | "complete") => aggregatorsApi.composioSetup(gatewayId(), props.route.toolkit, { action }),
    onSuccess: (next) => {
      setResult(next);
      void client.invalidateQueries({ queryKey: queryKeys.tools.connectionPart(company().id, gatewayId(), "aggregator-apps") });
      if (next.status === "connected") {
        pushToast({ tone: "success", title: `${props.row.name} is connected through Composio` });
        props.onClose();
      }
    },
  }));
  const setupNew = () => {
    props.onClose();
    navigate(gatewaySetupHref(`/${company().issuePrefix}/apps`, props.route));
  };
  return (
    <div class="ap-dialog-body">
      <Show when={usable().length === 0}>
        <p class="cx-note cx-note--warn">None of your Composio gateways is working right now. Fix one on its page, or set up another.</p>
      </Show>
      <GatewayPicker
        id="ap-catalog-composio"
        provider="composio"
        gateways={usable()}
        value={gatewayId()}
        disabled={setup.isPending}
        newOption
        onChange={(id) => {
          setSelected(id);
          setResult(null);
          setup.reset();
        }}
      />
      <Show when={result()}>
        <p class="cx-note" role="status">
          Finish connecting {props.row.name} in Composio, then come back here.
        </p>
        <Show when={result()!.authorizationUrl}>
          {(url) => (
            <a class={buttonClass({ size: "compact" })} href={url()} target="_blank" rel="noopener noreferrer">
              Connect {props.row.name} in Composio
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
        </Show>
      </Show>
      <Show when={setup.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(setup.error, "Couldn't set this app up. Try again.")}
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" disabled={setup.isPending} onClick={() => (props.onBack ? props.onBack() : props.onClose())}>
          {props.onBack ? "Back" : "Cancel"}
        </Button>
        <span class="ap-actions-end">
          <Show when={result() && result()!.status !== "connected"}>
            <Button variant="quiet" disabled={setup.isPending} onClick={() => setup.mutate("start")}>
              Get a new link
            </Button>
          </Show>
          <Button
            variant="primary"
            disabled={setup.isPending}
            onClick={() => (gatewayId() === "__new__" ? setupNew() : setup.mutate(result() ? "complete" : "start"))}
          >
            {setup.isPending ? "Checking…" : gatewayId() === "__new__" ? "Set up a gateway" : result() ? "I've connected it" : "Continue"}
          </Button>
        </span>
      </div>
    </div>
  );
}

/** Arcade: app sign-in happens in Arcade, through the gateway you pick. */
function ArcadeContinue(props: { row: CatalogRow; route: CatalogRoute; gateways: ToolConnection[]; onBack?: () => void; onClose: () => void }) {
  const company = useCompany();
  const [selected, setSelected] = createSignal<string | null>(null);
  const gateway = () => props.gateways.find((candidate) => candidate.id === selected()) ?? props.gateways.find(usableGateway) ?? props.gateways[0] ?? null;
  const url = () => managementUrl("arcade", typeof gateway()?.config?.managementUrl === "string" ? (gateway()!.config!.managementUrl as string) : null);
  return (
    <div class="ap-dialog-body">
      <p class="cx-note">Your Arcade gateway is saved. {props.row.name}'s sign-in is managed inside Arcade; an agent may also be asked to authorize it the first time it uses a tool.</p>
      <GatewayPicker id="ap-catalog-arcade" provider="arcade" gateways={props.gateways} value={gateway()?.id ?? ""} onChange={setSelected} />
      <A class="cx-link" href={gatewaySetupHref(`/${company().issuePrefix}/apps`, props.route)} onClick={props.onClose}>
        Set up another Arcade gateway
      </A>
      <div class="cx-actions">
        <Button variant="quiet" onClick={() => (props.onBack ? props.onBack() : props.onClose())}>
          {props.onBack ? "Back" : "Cancel"}
        </Button>
        <Show when={url()}>
          {(href) => (
            <a class={buttonClass({ variant: "primary" })} href={href()} target="_blank" rel="noopener noreferrer" onClick={props.onClose}>
              Continue in Arcade
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Manage

/** The accounts the gateways saw for one app, with Refresh and the provider's own page. */
export function CatalogManageDialog(props: { row: CatalogRow; gateways: Record<AggregatorId, ToolConnection[]>; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const base = () => `/${company().issuePrefix}/apps`;
  const all = () => [...props.gateways.composio, ...props.gateways.arcade];
  const groups = createMemo(() =>
    all()
      .map((gateway) => ({ gateway, accounts: props.row.accounts.filter((item) => item.connectionId === gateway.id) }))
      .filter((group) => group.accounts.length > 0),
  );
  const refresh = createMutation(() => ({
    mutationFn: async () => {
      for (const group of groups()) {
        const toolkits = [...new Set(group.accounts.map((item) => item.snapshot.toolkit))];
        const result = await aggregatorsApi.refresh(group.gateway.id, toolkits);
        client.setQueryData(queryKeys.tools.connectionPart(company().id, group.gateway.id, "aggregator-apps"), result);
      }
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't check the provider", body: failureText(error, "These are the last accounts it saw.") }),
  }));
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={`Manage ${props.row.name}`}
      description="Accounts and sign-in are managed in the provider. Which of its tools agents may use is set on the gateway's page."
      width={560}
      footer={
        <>
          <Button variant="quiet" onClick={props.onClose}>
            Close
          </Button>
          <Button icon={<RefreshCw size={14} aria-hidden="true" />} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Checking…" : "Refresh"}
          </Button>
        </>
      }
    >
      <For each={groups()}>
        {(group) => {
          const provider = () => (group.gateway.config?.sourceTemplateKey === "arcade" ? "arcade" : "composio") as AggregatorId;
          const manage = () =>
            managementUrl(provider(), group.accounts[0]?.account.managementUrl ?? (typeof group.gateway.config?.managementUrl === "string" ? group.gateway.config.managementUrl : null));
          return (
            <section class="ap-dialog-body">
              <ul class="ch-list" aria-label={`Accounts through ${group.gateway.name}`}>
                <For each={group.accounts}>
                  {(item) => {
                    const status = () => accountStatus(item.snapshot, item.account);
                    return (
                      <li class="ch-row">
                        <span class="ch-row-main">
                          <b>{item.account.alias || `${props.row.name} account`}</b>
                          <span class="ch-row-meta">
                            {status().label}
                            {status().hint ? ` · ${status().hint}` : ""}
                            {item.account.isDefault ? " · Default" : ""}
                          </span>
                        </span>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <p class="cx-note">
                Through <A href={`${base()}/${group.gateway.id}/permissions`} onClick={props.onClose}>{group.gateway.name}</A>
                {provider() === "composio" ? ". Its permissions apply to every app on this gateway." : "."}
                <Show when={manage()}>
                  {(href) => (
                    <>
                      {" "}
                      <a href={href()} target="_blank" rel="noopener noreferrer">
                        Open in {PROVIDER_NAMES[provider()]} <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    </>
                  )}
                </Show>
              </p>
            </section>
          );
        }}
      </For>
    </Dialog>
  );
}
