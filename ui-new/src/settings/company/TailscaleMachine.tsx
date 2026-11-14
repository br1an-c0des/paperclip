import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Copy, Monitor, Network } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { tailscaleApi, type TailscalePairing } from "@/api/tailscale";
import { useTailscaleConnections } from "@/apps/tailscale/queries";
import {
  autoConnection,
  connectedNetworks,
  deviceLabel,
  samePairingTarget,
  showsConnectionPicker,
  sortDevices,
  type PairingTarget,
} from "@/apps/tailscale/tailscale-model";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, TextArea } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { copyText, failure } from "./shared";
import "@/apps/tailscale/Tailscale.css";

/*
 * The SSH environment form's Tailscale machine (U156; the old UI's TailscaleSshMachine): the tailnet
 * (picked for you when only one is connected), one of its machines, and pairing. Pairing makes a
 * fresh SSH key pair, keeps the private key as a company secret, and shows a command that installs
 * the public key on the machine; the form then uses that secret. A pairing answer for another
 * tailnet, machine or port than the current one is ignored, so a late answer can't set the key.
 */

export function TailscaleMachine(props: {
  connectionId: string;
  deviceId: string;
  port: number;
  onChange: (selection: { connectionId: string; deviceId: string; host: string }) => void;
  onPaired: (secretId: string) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const { canManage, access, connections } = useTailscaleConnections();
  const connected = createMemo(() => connectedNetworks(connections.data));
  const settingsHref = () => `/${company().issuePrefix}/connections/tailscale`;

  // A sole connected tailnet is picked for you.
  createEffect(() => {
    const only = autoConnection(connected(), props.connectionId);
    if (only) props.onChange({ connectionId: only, deviceId: "", host: "" });
  });

  const devices = createQuery(() => ({
    queryKey: queryKeys.tailscale.devices(company().id, props.connectionId),
    queryFn: ({ signal }) => tailscaleApi.devices(company().id, props.connectionId, signal),
    enabled: canManage() && !!props.connectionId,
    retry: false,
  }));
  const sorted = createMemo(() => sortDevices(devices.data));
  const device = () => devices.data?.find((entry) => entry.id === props.deviceId) ?? null;
  const connectionName = (id: string) => connected().find((connection) => connection.id === id)?.name ?? "A tailnet that isn't connected";

  let alive = true;
  onCleanup(() => (alive = false));
  const target = (): PairingTarget => ({ companyId: company().id, connectionId: props.connectionId, deviceId: props.deviceId, port: props.port });
  const [pairing, setPairing] = createSignal<{ target: PairingTarget; result: TailscalePairing } | null>(null);
  const [pairingBusy, setPairingBusy] = createSignal(false);
  const [pairingError, setPairingError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const currentPairing = () => {
    const found = pairing();
    return found && samePairingTarget(found.target, target()) ? found.result : null;
  };

  const pair = async () => {
    const asked = target();
    setPairingBusy(true);
    setPairingError(null);
    setCopied(false);
    try {
      const result = await tailscaleApi.pairing(asked.companyId, asked.connectionId, asked.deviceId, asked.port);
      // Only for the choice still on screen: a late answer can't change the key.
      if (!alive || !samePairingTarget(asked, target())) return;
      setPairing({ target: asked, result });
      props.onPaired(result.privateKeySecretId);
      void client.invalidateQueries({ queryKey: queryKeys.projectSettings.secrets(asked.companyId) });
    } catch (caught) {
      if (alive && samePairingTarget(asked, target())) setPairingError(failure(caught, "Couldn't prepare the pairing."));
    } finally {
      if (alive) setPairingBusy(false);
    }
  };

  return (
    <div class="field-stack ts-pairing">
      <Switch>
        <Match when={access.isPending}>
          <span class="ts-note" role="status">
            Checking your access…
          </span>
        </Match>
        <Match when={!canManage()}>
          <span class="ts-note" role="status">
            Only an instance admin can change this environment's Tailscale machine.
          </span>
        </Match>
        <Match when={connections.isPending}>
          <span class="ts-note" role="status">
            Loading your tailnets…
          </span>
        </Match>
        <Match when={connections.isError}>
          <span class="ts-note ts-note--alert" role="alert">
            Couldn't load your tailnets: {failure(connections.error, "")}
          </span>
        </Match>
        <Match when={connected().length === 0 && !props.connectionId}>
          <span class="ts-note" role="status">
            No tailnet is connected. <A href={settingsHref()}>Connect one in Connections</A>, then pick its machine here.
          </span>
        </Match>
        <Match when={true}>
          <Show when={showsConnectionPicker(connected(), props.connectionId)}>
            <span class="field-label">Tailnet</span>
            <Menu>
              <Menu.Trigger as={FieldButton} icon={<Network size={13} aria-hidden="true" />} aria-label="Tailnet">
                {props.connectionId ? connectionName(props.connectionId) : "Pick a tailnet"}
              </Menu.Trigger>
              <Menu.Content label="Tailnets" width={300}>
                <For each={connected()}>
                  {(connection) => (
                    <Menu.Item
                      onSelect={() => connection.id !== props.connectionId && props.onChange({ connectionId: connection.id, deviceId: "", host: "" })}
                      hint={props.connectionId === connection.id ? <Check size={14} /> : undefined}
                    >
                      {connection.name}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </Show>

          <Show when={props.connectionId}>
            <span class="field-label">Machine</span>
            <Menu>
              <Menu.Trigger as={FieldButton} icon={<Monitor size={13} aria-hidden="true" />} aria-label="Tailscale machine" disabled={devices.isPending}>
                {devices.isPending ? "Loading machines…" : device() ? deviceLabel(device()!) : props.deviceId ? "A machine that isn't in this tailnet" : "Pick a machine"}
              </Menu.Trigger>
              <Menu.Content label="Machines" width={360}>
                <For each={sorted()} fallback={<p class="nt-menu-note">No machines in this tailnet.</p>}>
                  {(entry) => (
                    <Menu.Item
                      disabled={!entry.online}
                      description={entry.online ? entry.address : "Offline"}
                      onSelect={() => entry.id !== props.deviceId && props.onChange({ connectionId: props.connectionId, deviceId: entry.id, host: entry.address })}
                      hint={props.deviceId === entry.id ? <Check size={14} /> : undefined}
                    >
                      {deviceLabel(entry)}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
            <Show when={devices.isError}>
              <span class="ts-note ts-note--alert" role="alert">
                Couldn't load its machines: {failure(devices.error, "")}
              </span>
            </Show>
            <Show when={!devices.isPending && device() && !device()!.online}>
              <span class="ts-note" role="status">
                This machine is offline. Runs fail until it's back.
              </span>
            </Show>
          </Show>

          <Show when={props.connectionId && props.deviceId}>
            <span class="info-line">
              <Button size="compact" disabled={pairingBusy()} onClick={() => void pair()}>
                {pairingBusy() ? "Preparing…" : currentPairing() ? "Prepare a new pairing" : "Prepare pairing"}
              </Button>
              <InfoTip label="About pairing">
                Makes a new SSH key, keeps its private key in Paperclip's vault for this environment, and gives you a command that adds the public key to the
                machine. The command also prints the username, workspace path and known hosts to enter below. Prepare it again after changing the port.
              </InfoTip>
            </span>
            <Show when={pairingError()}>
              <span class="ts-note ts-note--alert" role="alert">
                {pairingError()}
              </span>
            </Show>
            <Show when={currentPairing()}>
              {(result) => (
                <>
                  <span class="ts-note" role="status">
                    Run this on {device()?.name ?? "the machine"} as the user agents will run as.
                  </span>
                  <TextArea aria-label="Pairing command" class="mono ts-command" readOnly rows={8} spellcheck={false} value={result().command} />
                  <span>
                    <Button
                      size="compact"
                      variant="quiet"
                      icon={copied() ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                      onClick={async () => setCopied(await copyText(result().command))}
                    >
                      {copied() ? "Copied" : "Copy command"}
                    </Button>
                  </span>
                </>
              )}
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}
