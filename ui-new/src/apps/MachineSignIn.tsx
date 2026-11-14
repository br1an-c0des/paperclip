import type { ConnectToolAppResult, MachineSignInPublicKey, MachineSignInSetupResult, MachineSignInStatus, RotateMachineSignIn, ToolConnection } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { toolsApi } from "@/api/tools";
import { dateTime, shortDate } from "@/agents/shared";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Field, SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { pushToast } from "@/ui/Toast";
import { CopyBlock } from "./advanced/parts";
import {
  MACHINE_METHODS,
  machineCreateInput,
  machineCreateProblem,
  machineMethodLabel,
  machineSignInService,
  machineTestInput,
  machineTestProblem,
  newMachineDraft,
  publicKeyText,
  rotationStage,
  scopesText,
  type MachineDraft,
} from "./machine-sign-in-model";
import { ChoiceCard, failureText, useRefreshTools } from "./shared";

/*
 * Machine sign-in (OAuth client credentials) for an organization connection, after the old UI's
 * MachineSignInSetup (upstream #21473, #21566); the model and API notes are in
 * machine-sign-in-model.ts.
 *
 * - MachineSignInSetup: the sixth choice in "Connect your own MCP server"'s sign-in step. Pick how
 *   Paperclip proves who it is, create the key (then register its public key with the provider) or
 *   enter the secret, add the client ID and scopes, and test. A passing test turns it on, and the
 *   page finishes it like any other connection. A failed test keeps the draft and its key.
 * - MachineSignInCard: the connection's Settings tab. Its status, the public key, Test, and
 *   rotation: a new secret (tested before it replaces the old one), or a new key that's staged
 *   until it's registered and Complete rotation switches to it. Upstream has rotation as an API
 *   only; this is its control.
 *
 * A secret is sent once and the field is emptied; afterwards only "Saved" shows.
 */

function hostOf(link: string) {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

function PublicKeyBlocks(props: { publicKey: MachineSignInPublicKey; label: string }) {
  return (
    <div class="ap-machine-keys">
      <span class="fhelp">PEM</span>
      <CopyBlock value={publicKeyText(props.publicKey, "pem")} label={`${props.label} (PEM)`} />
      <span class="fhelp">JSON (JWK)</span>
      <CopyBlock value={publicKeyText(props.publicKey, "jwk")} label={`${props.label} (JSON)`} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Setting it up, inside "Connect your own MCP server"

export function MachineSignInSetup(props: {
  link: string;
  name: string;
  /** The draft this page created, kept by the page so switching options and back resumes it. */
  setup: MachineSignInSetupResult | null;
  onSetup: (setup: MachineSignInSetupResult | null) => void;
  /** Turns the tested connection on with its access; the page navigates on. */
  onConnected: (result: ConnectToolAppResult) => Promise<void>;
  /** Who may use it, above the footer. */
  access: JSX.Element;
  cancelHref: string;
}) {
  const company = useCompany();
  const refresh = useRefreshTools();
  const [draft, setDraft] = createStore<MachineDraft>(newMachineDraft());
  const [error, setError] = createSignal<string | null>(null);
  // Resuming a draft: its client ID and scopes come back into the fields.
  createEffect(
    on(
      () => props.setup?.connectionId,
      () => {
        const status = props.setup?.machineSignIn;
        if (!status) return;
        setDraft({ method: status.method, clientId: draft.clientId || (status.clientId ?? ""), scopes: draft.scopes || scopesText(status.scopes) });
      },
    ),
  );

  const create = createMutation(() => ({
    mutationFn: (input: { link: string; name: string; draft: MachineDraft }) => toolsApi.createMachineSignIn(company().id, machineCreateInput(input.link, input.name, input.draft)),
    onSuccess: (created) => {
      props.onSetup(created);
      // The secret went with the draft; a later test sends only a replacement.
      setDraft("clientSecret", "");
      void refresh();
    },
  }));
  const test = createMutation(() => ({
    mutationFn: async (input: { setup: MachineSignInSetupResult; clientId: string; scopes: string; secret: string }) => {
      const result = await toolsApi.testMachineSignIn(input.setup.connectionId, machineTestInput(input.setup.machineSignIn, input.clientId, input.scopes, input.secret));
      setDraft("clientSecret", "");
      await props.onConnected(result);
    },
  }));
  const busy = () => create.isPending || test.isPending;

  const createProblem = () => machineCreateProblem(props.link, draft);
  const testProblem = () => machineTestProblem(draft.clientId);
  const problem = () => (props.setup ? testProblem() : createProblem() ?? (draft.method === "client_secret" ? testProblem() : null));

  const run = async () => {
    setError(null);
    try {
      let setup = props.setup;
      // A new draft took the typed secret with it; a saved draft's test sends only a replacement.
      const replacement = setup ? draft.clientSecret : "";
      if (!setup) {
        setup = await create.mutateAsync({ link: props.link, name: props.name, draft: { ...draft } });
        // A key has to be registered with the provider first; a secret can be tested at once.
        if (setup.machineSignIn.method === "paperclip_key") return;
      }
      await test.mutateAsync({ setup, clientId: draft.clientId, scopes: draft.scopes, secret: replacement });
    } catch (caught) {
      setError(failureText(caught, "Paperclip couldn't set up machine sign-in. Check the details and try again."));
      void refresh();
    }
  };

  const primaryLabel = () => {
    if (create.isPending) return draft.method === "paperclip_key" ? "Creating the key…" : "Saving…";
    if (test.isPending) return "Testing…";
    return !props.setup && draft.method === "paperclip_key" ? "Create key" : "Test connection";
  };

  return (
    <div class="ap-machine" data-testid="machine-sign-in-setup">
      <Show
        when={props.setup}
        fallback={
          <>
            <ul class="cx-options ap-machine-methods" role="radiogroup" aria-label="How Paperclip proves who it is">
              <For each={MACHINE_METHODS}>
                {(option) => (
                  <li>
                    <ChoiceCard
                      name="ap-machine-method"
                      title={option.title}
                      info={option.description}
                      checked={draft.method === option.value}
                      disabled={busy()}
                      onSelect={() => setDraft("method", option.value)}
                    />
                  </li>
                )}
              </For>
            </ul>
            <Field
              label="Sign-in service (optional)"
              info={`Leave it blank and Paperclip asks ${hostOf(props.link) || "the server"} where to sign in. Otherwise enter the address or token URL from the provider's docs.`}
              for="ap-machine-service"
            >
              <TextInput id="ap-machine-service" type="url" autocomplete="off" placeholder="Found automatically" value={draft.signInService} onInput={(event) => setDraft("signInService", event.currentTarget.value)} />
            </Field>
            <Field
              label={draft.method === "paperclip_key" ? "Client ID (optional)" : "Client ID"}
              info={draft.method === "paperclip_key" ? "The ID the provider shows for the Paperclip client. You can add it after registering the key." : "The ID the provider shows for the Paperclip client."}
              for="ap-machine-client"
            >
              <TextInput id="ap-machine-client" autocomplete="off" spellcheck={false} value={draft.clientId} onInput={(event) => setDraft("clientId", event.currentTarget.value)} />
            </Field>
            <Show when={draft.method === "client_secret"}>
              <Field label="Client secret" for="ap-machine-secret">
                <TextInput id="ap-machine-secret" type="password" autocomplete="new-password" value={draft.clientSecret} onInput={(event) => setDraft("clientSecret", event.currentTarget.value)} />
              </Field>
            </Show>
          </>
        }
      >
        {(setup) => (
          <>
            <Show when={setup().machineSignIn.publicKey}>
              {(key) => (
                <div class="ap-machine-register">
                  <span class="info-line">
                    <b>Register this public key with the provider for the Paperclip client.</b>
                    <InfoTip label="About the public key">It isn't secret: paste it into the provider's console, or send it to whoever manages it.</InfoTip>
                  </span>
                  <PublicKeyBlocks publicKey={key()} label="Public key" />
                </div>
              )}
            </Show>
            <Field label="Client ID" info="The ID the provider shows for the Paperclip client." for="ap-machine-client-confirm">
              <TextInput id="ap-machine-client-confirm" autocomplete="off" spellcheck={false} value={draft.clientId} onInput={(event) => setDraft("clientId", event.currentTarget.value)} />
            </Field>
            <Show when={setup().machineSignIn.method === "client_secret"}>
              <Field label="Client secret" for="ap-machine-secret-replace" help={setup().machineSignIn.hasClientSecret ? "Saved. Enter a new one only to replace it." : "Not saved yet."}>
                <TextInput id="ap-machine-secret-replace" type="password" autocomplete="new-password" placeholder={setup().machineSignIn.hasClientSecret ? "••••••••" : ""} value={draft.clientSecret} onInput={(event) => setDraft("clientSecret", event.currentTarget.value)} />
              </Field>
            </Show>
          </>
        )}
      </Show>
      <Field label="Scopes (optional)" info="Separate them with spaces, as the provider's docs list them." for="ap-machine-scopes">
        <TextInput id="ap-machine-scopes" autocomplete="off" spellcheck={false} value={draft.scopes} onInput={(event) => setDraft("scopes", event.currentTarget.value)} />
      </Field>

      {props.access}

      <Show when={error()}>
        {(text) => (
          <p class="cx-note cx-note--error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <div class="cx-actions">
        <A class={buttonClass({ variant: "quiet" })} href={props.cancelHref}>
          Cancel
        </A>
        <Show when={props.setup}>
          <Button
            variant="quiet"
            disabled={busy()}
            onClick={() => {
              props.onSetup(null);
              setError(null);
            }}
          >
            Start over
          </Button>
        </Show>
        <span class="ap-actions-end">
          <Show when={problem() && props.link.trim()}>
            <span class="cx-note">{problem()}</span>
          </Show>
          <Button variant="primary" disabled={busy() || Boolean(problem())} onClick={() => void run()}>
            {primaryLabel()}
          </Button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A connection's machine sign-in, on its Settings tab

export function MachineSignInCard(props: { connection: ToolConnection; canConfigure: boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const refresh = useRefreshTools();
  const key = () => queryKeys.tools.connectionPart(company().id, props.connection.id, "machine-sign-in");
  const status = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => toolsApi.machineSignIn(props.connection.id, signal),
    enabled: props.canConfigure,
    retry: false,
  }));
  const [clientId, setClientId] = createSignal("");
  const [scopes, setScopes] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [replacing, setReplacing] = createSignal(false);
  // The fields follow the saved values until they're edited.
  createEffect(
    on(
      () => status.data,
      (data) => {
        if (!data) return;
        setClientId(data.clientId ?? "");
        setScopes(scopesText(data.scopes));
      },
    ),
  );
  const saved = (data: MachineSignInStatus) => {
    client.setQueryData(key(), data);
    void refresh();
  };
  const edited = () => {
    const data = status.data;
    return Boolean(data && (clientId().trim() !== (data.clientId ?? "") || scopes().trim() !== scopesText(data.scopes)));
  };

  const test = createMutation(() => ({
    mutationFn: () => toolsApi.testMachineSignIn(props.connection.id, machineTestInput(status.data!, clientId(), scopes())),
    onSuccess: () => {
      const wasDraft = props.connection.status === "draft";
      pushToast({
        title: "Machine sign-in works",
        body: wasDraft ? "It's on now. Choose which of its actions agents may use in Permissions." : "Paperclip got a token and listed the server's tools.",
        tone: "success",
      });
      void status.refetch();
      void refresh();
    },
    onError: (error) => pushToast({ title: "The test didn't pass", body: failureText(error, "Check the provider's settings and try again."), tone: "error" }),
  }));
  const rotate = createMutation(() => ({
    mutationFn: (input: RotateMachineSignIn) => toolsApi.rotateMachineSignIn(props.connection.id, input),
    onSuccess: (result) => {
      saved(result.machineSignIn);
      setSecret("");
      setReplacing(false);
      pushToast(
        result.completed
          ? { title: "Client secret replaced", body: "The new secret passed a test and is in use.", tone: "success" }
          : { title: "New key created", body: "Register it with the provider, then complete the rotation.", tone: "success" },
      );
    },
    onError: (error) => pushToast({ title: "Couldn't rotate it", body: failureText(error, "Nothing was changed. Try again."), tone: "error" }),
  }));
  const complete = createMutation(() => ({
    mutationFn: () => toolsApi.completeMachineSignInRotation(props.connection.id),
    onSuccess: (result) => {
      saved(result.machineSignIn);
      pushToast({ title: "Rotation complete", body: "Paperclip now signs in with the new key; the old one is deleted.", tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't complete the rotation", body: failureText(error, "The current key still works. Check the new key is registered, then try again."), tone: "error" }),
  }));
  const busy = () => test.isPending || rotate.isPending || complete.isPending;

  return (
    <SettingsCard title="Machine sign-in" info="Agents use this connection as the client your provider registered for Paperclip, not as any person. Paperclip asks the sign-in service for a new token when the last one runs out.">
      <Show when={props.canConfigure} fallback={<p class="cx-note ap-card-body">Only a connection manager can see and change its sign-in.</p>}>
        <Show when={status.data} fallback={<p class="cx-note ap-card-body" role={status.isError ? "alert" : "status"}>{status.isError ? failureText(status.error, "Couldn't load its machine sign-in.") : "Loading its machine sign-in…"}</p>}>
          {(data) => (
            <>
              <SettingsRow label="Proves who it is with">
                <span class="cx-static">{machineMethodLabel(data())}</span>
              </SettingsRow>
              <SettingsRow label="Sign-in service" info="Fixed at setup. Paperclip sends this connection's credentials only there, and refuses if the server later points somewhere else.">
                <span class="cx-static mono ap-machine-service">{machineSignInService(data())}</span>
              </SettingsRow>
              <SettingsRow label="Client ID" for="ap-ms-client" info="The ID the provider shows for the Paperclip client. A change is saved when the test passes.">
                <TextInput id="ap-ms-client" autocomplete="off" spellcheck={false} disabled={busy()} value={clientId()} onInput={(event) => setClientId(event.currentTarget.value)} />
              </SettingsRow>
              <SettingsRow label="Scopes" for="ap-ms-scopes" info="Separate them with spaces, as the provider's docs list them. A change is saved when the test passes.">
                <TextInput id="ap-ms-scopes" autocomplete="off" spellcheck={false} disabled={busy()} placeholder="None" value={scopes()} onInput={(event) => setScopes(event.currentTarget.value)} />
              </SettingsRow>
              <Show when={data().method === "client_secret"}>
                <SettingsRow label="Client secret" info="Kept in the company's vault and never shown again.">
                  <span class="cx-static">{data().hasClientSecret ? "Saved" : "Not saved"}</span>
                </SettingsRow>
              </Show>
              <Show when={data().publicKey}>
                {(publicKey) => (
                  <SettingsRow label="Public key" help={`Created ${shortDate(publicKey().createdAt)}.`} info="The key registered with the provider. It isn't secret.">
                    <details class="ap-machine-details">
                      <summary>Show the public key</summary>
                      <PublicKeyBlocks publicKey={publicKey()} label="Public key" />
                    </details>
                  </SettingsRow>
                )}
              </Show>
              <SettingsRow label="Last token">
                <span class="cx-static">{data().lastTokenAt ? dateTime(data().lastTokenAt!) : "None yet"}</span>
              </SettingsRow>
              <SettingsRow label="Test" help={machineTestProblem(clientId()) ?? undefined} info="Paperclip asks the sign-in service for a token, then lists the server's tools with it. A passing test turns the connection on.">
                <div class="ap-inline">
                  <Button size="compact" variant="primary" disabled={busy() || Boolean(machineTestProblem(clientId()))} onClick={() => test.mutate()}>
                    {test.isPending ? "Testing…" : edited() ? "Test and save" : "Test"}
                  </Button>
                </div>
              </SettingsRow>

              <Show
                when={rotationStage(data()) === "pending" && data().pendingPublicKey}
                fallback={
                  <SettingsRow label="Rotate" info="Replace the key or secret without downtime. A new secret is tested before it replaces the old one; a new key waits until it's registered with the provider.">
                    <div class="ap-machine-rotate">
                      <Show
                        when={replacing()}
                        fallback={
                          <div class="ap-inline">
                            <Show
                              when={data().method === "paperclip_key"}
                              fallback={
                                <Button size="compact" disabled={busy()} onClick={() => setReplacing(true)}>
                                  Replace the secret
                                </Button>
                              }
                            >
                              <Button size="compact" disabled={busy()} onClick={() => rotate.mutate({ method: "paperclip_key" })}>
                                {rotate.isPending ? "Creating a key…" : "Start key rotation"}
                              </Button>
                            </Show>
                            <Button
                              size="compact"
                              variant="quiet"
                              disabled={busy()}
                              onClick={() => (data().method === "paperclip_key" ? setReplacing(true) : rotate.mutate({ method: "paperclip_key" }))}
                            >
                              {data().method === "paperclip_key" ? "Use a client secret instead" : "Use a Paperclip key instead"}
                            </Button>
                          </div>
                        }
                      >
                        <form
                          class="ap-inline"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (secret()) rotate.mutate({ method: "client_secret", clientSecret: secret() });
                          }}
                        >
                          <TextInput type="password" autocomplete="new-password" aria-label="New client secret" placeholder="New client secret" disabled={busy()} value={secret()} onInput={(event) => setSecret(event.currentTarget.value)} />
                          <Button type="submit" size="compact" variant="primary" disabled={busy() || !secret()}>
                            {rotate.isPending ? "Testing…" : "Test and replace"}
                          </Button>
                          <Button
                            size="compact"
                            variant="quiet"
                            disabled={busy()}
                            onClick={() => {
                              setSecret("");
                              setReplacing(false);
                            }}
                          >
                            Cancel
                          </Button>
                        </form>
                      </Show>
                    </div>
                  </SettingsRow>
                }
              >
                {(pending) => (
                  <SettingsRow
                    label="New key"
                    help={`Waiting since ${shortDate(pending().createdAt)}. The current ${data().method === "client_secret" ? "secret" : "key"} keeps working until you complete the rotation.`}
                    info="Register this public key with the provider for the Paperclip client. Complete rotation tests it, then switches to it and deletes the old one."
                  >
                    <div class="ap-machine-rotate">
                      <PublicKeyBlocks publicKey={pending()} label="New public key" />
                      <div class="ap-inline">
                        <Button size="compact" variant="primary" disabled={busy()} onClick={() => complete.mutate()}>
                          {complete.isPending ? "Testing the new key…" : "Complete rotation"}
                        </Button>
                        <Button size="compact" variant="quiet" disabled={busy()} onClick={() => rotate.mutate({ method: "paperclip_key" })}>
                          Make another key
                        </Button>
                      </div>
                    </div>
                  </SettingsRow>
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </SettingsCard>
  );
}
