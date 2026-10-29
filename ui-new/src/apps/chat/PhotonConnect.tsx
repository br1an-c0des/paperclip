import { createMutation } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { chatEndpointsApi, type ChatEndpoint } from "@/api/chat-endpoints";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { failureText } from "../shared";
import { photonCredentials } from "./chat-model";
import "./ChatExtras.css";

/*
 * iMessage through Photon (the old UI's PhotonConnectStep): enter the Photon project and its
 * secret, inspect it (`POST …/photon/inspect`) to see the lines it offers, pick a dedicated number
 * (or take the project's shared DM line), then connect. Reconnecting keeps the project and line;
 * leave the secret empty to reuse the saved one.
 */

export function PhotonConnect(props: { endpoint: ChatEndpoint; repairing: boolean; onSaved: (next: ChatEndpoint) => void; onExit: () => void }) {
  const [projectId, setProjectId] = createSignal(props.endpoint.providerAccountId ?? "");
  const [secret, setSecret] = createSignal("");
  const [lineId, setLineId] = createSignal("");
  const inspect = createMutation(() => ({
    mutationFn: () => chatEndpointsApi.inspectPhoton(props.endpoint.id, { projectId: projectId().trim(), projectSecret: secret() }),
    onSuccess: (result) => {
      const eligible = result.lines.filter((line) => line.eligible);
      setLineId(eligible.length === 1 ? eligible[0]!.lineId : "");
    },
  }));
  const credentials = () => photonCredentials(inspect.data ?? null, projectId(), secret(), lineId());
  const connect = createMutation(() => ({
    mutationFn: () =>
      chatEndpointsApi.setup(props.endpoint.id, {
        action: props.repairing ? "reconnect" : "configure",
        ...(credentials() ? { credentials: credentials()! } : {}),
      }),
    onSuccess: (next) => {
      setSecret("");
      props.onSaved(next);
    },
  }));
  const reset = () => {
    inspect.reset();
    setLineId("");
  };
  const busy = () => inspect.isPending || connect.isPending;

  return (
    <div class="ch-step-body">
      <p>
        Connect {props.endpoint.assignedAgentName} to Photon Cloud. Photon Pro offers direct messages through a shared line; a dedicated number also takes
        group chats, each turned on separately.
      </p>
      <p class="ch-links">
        <a href="https://app.photon.codes/" target="_blank" rel="noopener noreferrer">
          Photon dashboard <ExternalLink size={12} aria-hidden="true" />
        </a>
        <a href="https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing" target="_blank" rel="noopener noreferrer">
          Photon line setup <ExternalLink size={12} aria-hidden="true" />
        </a>
      </p>
      <Show when={props.repairing}>
        <p class="cx-note">
          Reconnecting keeps this project and {props.endpoint.photonAllocation === "shared" ? "its shared DM line" : (props.endpoint.botExternalId ?? "its number")}. Leave the
          secret empty to reuse the saved one.
        </p>
      </Show>
      <div class="ch-grid">
        <Field label="Project ID" for="ch-photon-project">
          <TextInput
            id="ch-photon-project"
            autocomplete="off"
            value={projectId()}
            disabled={busy() || Boolean(props.endpoint.botExternalId)}
            onInput={(event) => {
              setProjectId(event.currentTarget.value);
              reset();
            }}
          />
        </Field>
        <Field label="Project secret" for="ch-photon-secret">
          <TextInput
            id="ch-photon-secret"
            type="password"
            autocomplete="new-password"
            value={secret()}
            disabled={busy()}
            onInput={(event) => {
              setSecret(event.currentTarget.value);
              reset();
            }}
          />
        </Field>
      </div>
      <div>
        <Button size="compact" disabled={busy() || !projectId().trim() || !secret()} onClick={() => inspect.mutate()}>
          {inspect.isPending ? "Inspecting…" : "Inspect the Photon project"}
        </Button>
      </div>
      <Show when={inspect.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(inspect.error, "Photon didn't accept those details.")}
        </p>
      </Show>
      <Show when={inspect.data}>
        {(result) => (
          <fieldset class="ch-lines">
            <legend>
              {result().allocation === "shared" ? "Shared DMs" : "Dedicated numbers"} in {result().projectName}
            </legend>
            <Show when={!result().eligible}>
              <p class="cx-note cx-note--error" role="alert">
                {result().allocation === "shared"
                  ? "This shared project already belongs to another channel. Use a separate Photon project for each agent."
                  : "No dedicated number is free. Check the line allocation in Photon and your other Paperclip channels."}
              </p>
            </Show>
            <Show when={result().allocation === "shared" && result().eligible}>
              <p class="cx-static">
                Direct messages only. Enroll each sender on your Photon project's Users page, then use the number Photon gives that sender. People still link
                their Paperclip accounts; group chats can't be turned on.
              </p>
            </Show>
            <ul class="cx-options">
              <For each={result().lines}>
                {(line) => (
                  <li>
                    <label class="cx-option" classList={{ "cx-option--on": lineId() === line.lineId }}>
                      <input
                        type="radio"
                        name="ch-photon-line"
                        checked={lineId() === line.lineId}
                        disabled={!line.eligible || busy() || (Boolean(props.endpoint.botExternalId) && props.endpoint.botExternalId !== line.phoneNumber)}
                        onChange={() => setLineId(line.lineId)}
                      />
                      <span class="cx-option-name">
                        <span class="mono">{line.phoneNumber}</span>
                        <Show when={line.unavailableReason}>
                          <span class="cx-row-meta">{line.unavailableReason}</span>
                        </Show>
                      </span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
          </fieldset>
        )}
      </Show>
      <Show when={connect.isError}>
        <p class="cx-note cx-note--error" role="alert">
          {failureText(connect.error, "Photon didn't connect.")}
        </p>
      </Show>
      <div class="cx-actions">
        <Button variant="quiet" disabled={busy()} onClick={() => props.onExit()}>
          Save and exit
        </Button>
        <Button variant="primary" disabled={busy() || (!credentials() && !(props.repairing && !secret()))} onClick={() => connect.mutate()}>
          {connect.isPending ? "Connecting…" : props.repairing ? "Reconnect Photon" : inspect.data?.allocation === "shared" ? "Connect shared DMs" : "Connect the number"}
        </Button>
      </div>
    </div>
  );
}
