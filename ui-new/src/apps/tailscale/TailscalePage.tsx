import { A, useLocation } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Plus } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { tailscaleApi, type TailscaleConnection } from "@/api/tailscale";
import { useCompany } from "@/lib/company";
import { failure } from "@/projects/settings/shared";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { InfoTip } from "@/ui/InfoTip";
import { pushToast } from "@/ui/Toast";
import { AppLogo, StateTag } from "../shared";
import { useTailscaleConnections } from "./queries";
import {
  connectedNetworks,
  deviceLabel,
  keepPolling,
  networksSummary,
  networkState,
  returnProblem,
  SIGN_IN_POLL_MS,
  signingIn,
  signInDeadline,
  signInStep,
  sortDevices,
  TAILSCALE_LOGO,
  withConnection,
} from "./tailscale-model";
import "./Tailscale.css";

/*
 * Connections → Tailscale (`/:prefix/connections/tailscale`; the old UI's `/apps/tailscale`, U156):
 * the company's tailnets. Connect starts device sign-in, which opens Tailscale in a new tab (reserved
 * during the click, so a popup blocker lets it through) and keeps this page open; the row polls the
 * sign-in until it's approved, needs a tailnet admin's approval, or expires after ten minutes. A
 * connected tailnet lists its machines and offers a new SSH environment on it, or Disconnect.
 *
 * `?tailscale_error=` and `?tailscale_connection=` come back from the older OAuth callback.
 */

/** Browse's entry for Tailscale, shown only to people who can manage it. */
export function TailscaleEntry() {
  const company = useCompany();
  const { canManage, connections } = useTailscaleConnections();
  const connected = () => connectedNetworks(connections.data).length > 0;
  return (
    <Show when={canManage()}>
      <section class="card ap-card" aria-labelledby="ap-networks">
        <header class="chead ap-chead">
          <div>
            <h3 id="ap-networks" class="disp info-line">
              Networks
              <InfoTip label="About networks">Networks let SSH environments reach machines that aren't on the public internet.</InfoTip>
            </h3>
          </div>
        </header>
        <ul class="ap-rows">
          <li class="ap-row ap-row--link">
            <AppLogo name="Tailscale" logoUrl={TAILSCALE_LOGO} />
            <div class="ap-row-main">
              <A class="ap-row-name" href={`/${company().issuePrefix}/connections/tailscale`}>
                Tailscale
              </A>
              <span class="ap-row-meta" role={connections.isError ? "alert" : undefined}>
                {connections.isError ? `Couldn't load your tailnets: ${failure(connections.error, "")}` : connections.isPending ? "Loading…" : networksSummary(connections.data)}
              </span>
            </div>
            <A class={buttonClass({ size: "compact" })} href={`/${company().issuePrefix}/connections/tailscale`} aria-label={`${connected() ? "Manage" : "Connect"} Tailscale`}>
              {connected() ? "Manage" : "Connect"}
            </A>
          </li>
        </ul>
      </section>
    </Show>
  );
}

export function TailscalePage() {
  const company = useCompany();
  const client = useQueryClient();
  const location = useLocation();
  const { access, canManage, connections } = useTailscaleConnections();
  const [starting, setStarting] = createSignal(false);
  const [startError, setStartError] = createSignal<string | null>(null);
  /** A sign-in link the browser wouldn't open in a new tab. */
  const [fallbackUrl, setFallbackUrl] = createSignal<string | null>(null);
  const [disconnecting, setDisconnecting] = createSignal<TailscaleConnection | null>(null);
  let popup: Window | null = null;

  const closePopup = () => {
    try {
      popup?.close();
    } catch {
      // Already gone.
    }
    popup = null;
  };
  onCleanup(closePopup);
  // Switching organizations abandons a sign-in tab opened for the last one.
  createEffect(on(() => company().id, closePopup, { defer: true }));

  const search = () => new URLSearchParams(location.search);
  const comeback = () => returnProblem(search());
  const retryConnection = () => connections.data?.find((connection) => connection.id === search().get("tailscale_connection")) ?? null;
  const settingsBase = () => `/${company().issuePrefix}/company/settings`;

  const start = async (connectionId?: string) => {
    const companyId = company().id;
    setStartError(null);
    setFallbackUrl(null);
    // Reserve the tab during the click, before any request, so it isn't blocked.
    if (!popup || popup.closed) {
      try {
        popup = window.open("about:blank", "_blank");
        if (popup) popup.opener = null;
      } catch {
        popup = null;
      }
    }
    setStarting(true);
    try {
      const result = await tailscaleApi.connect(companyId, connectionId);
      client.setQueryData<TailscaleConnection[]>(queryKeys.tailscale.connections(companyId), (rows) => withConnection(rows, result.connection));
      if (companyId !== company().id) return closePopup();
      if (!result.authorizationUrl) return closePopup();
      if (popup && !popup.closed) {
        popup.location.assign(result.authorizationUrl);
        popup.focus();
      } else {
        setFallbackUrl(result.authorizationUrl);
      }
    } catch (caught) {
      closePopup();
      setStartError(failure(caught, "Couldn't start the Tailscale sign-in."));
    } finally {
      setStarting(false);
    }
  };

  const disconnect = async (connection: TailscaleConnection) => {
    try {
      const result = await tailscaleApi.disconnect(company().id, connection.id);
      client.setQueryData<TailscaleConnection[]>(queryKeys.tailscale.connections(company().id), (rows) => withConnection(rows, result));
      closePopup();
      setFallbackUrl(null);
      await client.invalidateQueries({ queryKey: queryKeys.tailscale.connections(company().id) });
      return true;
    } catch (caught) {
      pushToast({ tone: "error", title: `Couldn't disconnect ${connection.name}`, body: failure(caught, "") || undefined });
      return false;
    }
  };

  return (
    <section class="card ap-connect ts-page" aria-label="Tailscale">
      <header class="ap-connect-head">
        <AppLogo name="Tailscale" logoUrl={TAILSCALE_LOGO} size={48} />
        <div class="ap-connect-title">
          <h2 class="disp info-line">
            Tailscale
            <InfoTip label="About Tailscale">
              Paperclip joins its own device to your tailnet, then SSH environments can run agents on the tailnet's machines. Pick a machine when you make an SSH
              environment.
            </InfoTip>
          </h2>
          <Show when={canManage() && connections.data}>
            <p>{networksSummary(connections.data)}</p>
          </Show>
        </div>
        <Show when={canManage()}>
          <Button
            variant="primary"
            size="compact"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={starting() || connections.isError || signingIn(connections.data)}
            onClick={() => void start()}
          >
            {starting() ? "Connecting…" : "Connect a tailnet"}
          </Button>
        </Show>
      </header>

      <Switch>
        <Match when={access.isPending}>
          <p role="status">Checking your access…</p>
        </Match>
        <Match when={access.isError}>
          <p role="alert" class="ts-error">
            Couldn't check your access: {failure(access.error, "")}
          </p>
        </Match>
        <Match when={!canManage()}>
          <p role="status">Only an instance admin can connect or manage Tailscale networks.</p>
        </Match>
        <Match when={true}>
          <Show when={comeback()}>
            <div class="ts-alert" role="alert">
              <p>{comeback()}</p>
              <Show when={retryConnection()}>
                {(connection) => (
                  <Button size="compact" disabled={starting()} onClick={() => void start(connection().id)}>
                    Try again
                  </Button>
                )}
              </Show>
            </div>
          </Show>
          <Show when={startError()}>
            <p class="ts-error" role="alert">
              {startError()}
            </p>
          </Show>
          <Show when={fallbackUrl()}>
            {(url) => (
              <p class="ts-fallback" role="status">
                Your browser didn't open a new tab.{" "}
                <a class={buttonClass({ size: "compact" })} href={url()} target="_blank" rel="noopener noreferrer">
                  Open the Tailscale sign-in
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </p>
            )}
          </Show>
          <Switch>
            <Match when={connections.isPending}>
              <p role="status">Loading your tailnets…</p>
            </Match>
            <Match when={connections.isError}>
              <div class="ts-alert" role="alert">
                <p>Couldn't load your tailnets: {failure(connections.error, "")}</p>
                <Button size="compact" onClick={() => void connections.refetch()}>
                  Retry
                </Button>
              </div>
            </Match>
            <Match when={(connections.data ?? []).length === 0}>
              <p class="ts-empty">No tailnet connected yet. Connect one to pick its machines for SSH environments.</p>
            </Match>
            <Match when={true}>
              <ul class="ap-rows ts-rows">
                <For each={connections.data}>
                  {(connection) => (
                    <NetworkRow
                      connection={connection}
                      environmentsHref={`${settingsBase()}/environments?tailscale_connection=${encodeURIComponent(connection.id)}`}
                      starting={starting()}
                      onReconnect={() => void start(connection.id)}
                      onDisconnect={() => setDisconnecting(connection)}
                      onCancel={() => void disconnect(connection)}
                    />
                  )}
                </For>
              </ul>
            </Match>
          </Switch>
        </Match>
      </Switch>

      <Dialog
        open={!!disconnecting()}
        onOpenChange={(open) => !open && setDisconnecting(null)}
        title={`Disconnect ${disconnecting()?.name ?? "this tailnet"}?`}
        description="SSH environments on its machines stop working until you connect it again. Its machines stay in your tailnet."
        width={460}
        hideClose
        footer={
          <>
            <Button variant="quiet" onClick={() => setDisconnecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const connection = disconnecting();
                if (connection && (await disconnect(connection))) {
                  setDisconnecting(null);
                  pushToast({ tone: "success", title: `Disconnected ${connection.name}` });
                }
              }}
            >
              Disconnect
            </Button>
          </>
        }
      />
    </section>
  );
}

function NetworkRow(props: {
  connection: TailscaleConnection;
  environmentsHref: string;
  starting: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
  onCancel: () => void;
}) {
  const state = () => networkState(props.connection);
  return (
    <li class="ts-network">
      <div class="ap-row ts-network-head">
        <div class="ap-row-main">
          <span class="ap-row-name">{props.connection.name}</span>
        </div>
        <StateTag state={state()} />
      </div>
      <Switch>
        <Match when={props.connection.status === "connected"}>
          <Machines connection={props.connection} />
          <div class="ts-actions">
            <A class={buttonClass({ size: "compact" })} href={props.environmentsHref}>
              New SSH environment
            </A>
            <Button size="compact" variant="quiet" onClick={props.onDisconnect}>
              Disconnect
            </Button>
          </div>
        </Match>
        <Match when={props.connection.status === "authorizing"}>
          <DeviceSignIn connection={props.connection} onCancel={props.onCancel} />
        </Match>
        <Match when={true}>
          <div class="ts-actions">
            <Button size="compact" disabled={props.starting} onClick={props.onReconnect}>
              Reconnect
            </Button>
          </div>
        </Match>
      </Switch>
    </li>
  );
}

/** A connected tailnet's machines. */
function Machines(props: { connection: TailscaleConnection }) {
  const devices = createQuery(() => ({
    queryKey: queryKeys.tailscale.devices(props.connection.companyId, props.connection.id),
    queryFn: ({ signal }) => tailscaleApi.devices(props.connection.companyId, props.connection.id, signal),
    retry: false,
  }));
  const sorted = createMemo(() => sortDevices(devices.data));
  return (
    <div class="ts-machines">
      <Switch>
        <Match when={devices.isPending}>
          <p role="status">Loading machines…</p>
        </Match>
        <Match when={devices.isError}>
          <p role="alert" class="ts-error">
            Couldn't load its machines: {failure(devices.error, "")}{" "}
            <button type="button" class="cx-link" onClick={() => void devices.refetch()}>
              Retry
            </button>
          </p>
        </Match>
        <Match when={sorted().length === 0}>
          <p>No machines in this tailnet yet.</p>
        </Match>
        <Match when={true}>
          <ul class="ts-machine-list" aria-label={`Machines in ${props.connection.name}`}>
            <For each={sorted()}>
              {(device) => (
                <li class="ts-machine" classList={{ "ts-machine--offline": !device.online }}>
                  <i aria-hidden="true" />
                  <span class="ts-machine-name">{deviceLabel(device)}</span>
                  <span class="ts-machine-meta mono">{device.address}</span>
                  <span class="ts-machine-meta">{device.online ? "Online" : "Offline"}</span>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </div>
  );
}

/** A pending sign-in: polled until it's approved, waits for a tailnet admin, or expires. */
function DeviceSignIn(props: { connection: TailscaleConnection; onCancel: () => void }) {
  const client = useQueryClient();
  const [expired, setExpired] = createSignal(false);
  const seenAt = Date.now();
  const login = createQuery(() => ({
    queryKey: queryKeys.tailscale.deviceLogin(props.connection.companyId, props.connection.id),
    queryFn: () => tailscaleApi.deviceLogin(props.connection.companyId, props.connection.id),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: !expired(),
    refetchInterval: (query) => (keepPolling(query.state.data, expired(), !!query.state.error) ? SIGN_IN_POLL_MS : false),
  }));
  // Once it leaves "authorizing", the list shows its new state.
  createEffect(() => {
    const next = login.data?.connection;
    if (!next || next.status === "authorizing") return;
    client.setQueryData<TailscaleConnection[]>(queryKeys.tailscale.connections(props.connection.companyId), (rows) => withConnection(rows, next));
    if (next.status === "connected") pushToast({ tone: "success", title: `Connected ${next.name}` });
  });
  createEffect(() => {
    const wait = Math.max(0, signInDeadline(login.data, seenAt) - Date.now());
    const timer = window.setTimeout(() => setExpired(true), wait);
    onCleanup(() => window.clearTimeout(timer));
  });
  const step = () => signInStep(login.data, expired());
  return (
    <div class="ts-signin">
      <p role="status">
        {step() === "expired"
          ? "The sign-in expired. Cancel it and connect again."
          : step() === "approval"
            ? "Waiting for a tailnet admin to approve Paperclip's device."
            : "Waiting for you to approve the device in Tailscale. This updates when you finish."}
      </p>
      <Show when={login.isError}>
        <p role="alert" class="ts-error">
          Couldn't check the sign-in: {failure(login.error, "")}
        </p>
      </Show>
      <div class="ts-actions">
        <Show when={!expired() && login.data?.authorizationUrl}>
          {(url) => (
            <a class={buttonClass({ size: "compact" })} href={url()} target="_blank" rel="noopener noreferrer">
              Continue to Tailscale
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
        </Show>
        <Show when={!expired() && login.data?.needsApproval}>
          <a class={buttonClass({ size: "compact", variant: "quiet" })} href="https://login.tailscale.com/admin/machines" target="_blank" rel="noopener noreferrer">
            Open Tailscale machines
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </Show>
        <Show when={login.isError && !expired()}>
          <Button size="compact" onClick={() => void login.refetch()}>
            Check again
          </Button>
        </Show>
        <Button size="compact" variant="quiet" onClick={props.onCancel}>
          Cancel sign-in
        </Button>
      </div>
    </div>
  );
}
