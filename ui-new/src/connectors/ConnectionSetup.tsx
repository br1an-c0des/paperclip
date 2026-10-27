import type { AiAuthMethod, AiConnectionList } from "@paperclipai/shared";
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import { activeAgents } from "@/api/agents";
import { aiConnectionsApi, type AiConnectionResult } from "@/api/ai-connections";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { Switch as Toggle } from "@/ui/Switch";
import {
  apiKeyInput,
  defaultConnectionName,
  draftProblem,
  loginIntent,
  newDraft,
  reconnectDraft,
  type Connection,
  type Ownership,
  type SetupDraft,
} from "./connection-model";
import { createLocalLogin } from "./local-login";

/*
 * Connect (or reconnect) a Claude account. Two steps for a subscription: the details (name, who can
 * use it, which agents), then the browser sign-in. An API key saves from the first step. The sign-in
 * is bound to the details, so going back and changing who can use it starts a new sign-in.
 */

export function ConnectionSetup(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: AiConnectionList;
  reconnect?: Connection;
  subscriptionSupported: boolean;
  onSaved: (name: string, result: AiConnectionResult) => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.reconnect ? `Reconnect ${props.reconnect.name}` : "Connect Claude"}
      description={
        props.reconnect
          ? "Sign in again to restore this connection. Its name and who can use it stay the same."
          : "Add a Claude account so agents can run on it."
      }
      width={620}
    >
      <SetupBody
        list={props.list}
        reconnect={props.reconnect}
        subscriptionSupported={props.subscriptionSupported}
        onCancel={() => props.onOpenChange(false)}
        onSaved={props.onSaved}
      />
    </Dialog>
  );
}

function SetupBody(props: {
  list: AiConnectionList;
  reconnect?: Connection;
  subscriptionSupported: boolean;
  onCancel: () => void;
  onSaved: (name: string, result: AiConnectionResult) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const canManage = () => props.list.canManageConnections;
  // The draft is set once per opening: the dialog's body mounts when it opens.
  const [draft, setDraft] = createStore<SetupDraft>(
    props.reconnect
      ? reconnectDraft(props.reconnect, props.list.canManageConnections)
      : newDraft(props.list.canManageConnections, props.subscriptionSupported ? "subscription" : "api_key"),
  );
  const [nameEdited, setNameEdited] = createSignal(Boolean(props.reconnect));
  const [step, setStep] = createSignal<"details" | "sign_in">("details");
  const [browserCode, setBrowserCode] = createSignal("");
  const login = createLocalLogin(() => company().id);
  const problem = () => draftProblem(draft, canManage());
  const agentList = () => activeAgents(agents.data);

  const finish = (result: AiConnectionResult) => {
    void client.invalidateQueries({ queryKey: queryKeys.aiConnections.list(company().id) });
    props.onSaved(draft.name.trim(), result);
  };

  const saveKey = createMutation(() => ({
    mutationFn: () => aiConnectionsApi.create(company().id, apiKeyInput(draft)),
    onSuccess: finish,
    onSettled: () => setDraft("apiKey", ""),
  }));

  createEffect(
    on(
      () => login.state(),
      (state) => {
        if (state.phase === "saved") finish(state.result);
      },
    ),
  );

  // Keep the suggested name in step with the choices until the person types their own.
  const updateName = (ownership: Ownership, method: AiAuthMethod) => {
    if (!nameEdited()) setDraft("name", defaultConnectionName(ownership, method));
  };
  const setMethod = (method: AiAuthMethod) => {
    setDraft("method", method);
    updateName(draft.ownership, method);
  };
  const setOwnership = (ownership: Ownership) => {
    setDraft("ownership", ownership);
    updateName(ownership, draft.method);
  };
  const toggleAgent = (id: string, on: boolean) =>
    setDraft("agentIds", (ids) => (on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id)));

  const continueToSignIn = () => {
    if (problem() || !props.subscriptionSupported) return;
    setBrowserCode("");
    setStep("sign_in");
    login.begin(loginIntent(draft));
  };
  const backToDetails = () => {
    login.pause();
    setStep("details");
  };
  const submitKey = (event?: Event) => {
    event?.preventDefault();
    if (problem() || !draft.apiKey.trim() || saveKey.isPending) return;
    saveKey.mutate();
  };
  const submitCode = (event: Event) => {
    event.preventDefault();
    const code = browserCode();
    if (!code.trim()) return;
    void login.submitCode(code).then(() => setBrowserCode(""));
  };

  return (
    <div class="cx-setup">
      <Show when={step() === "details"}>
        <form class="cx-setup-form" onSubmit={(event) => (draft.method === "api_key" ? submitKey(event) : (event.preventDefault(), continueToSignIn()))}>
          <Show when={!props.reconnect}>
            <Field label="How to connect" help={draft.method === "subscription" ? "Use your Claude Pro or Max plan. Recommended." : "Pay per use with a key from the Anthropic Console."}>
              <Segmented
                label="How to connect"
                options={[
                  { value: "subscription", label: "Claude subscription" },
                  { value: "api_key", label: "API key" },
                ]}
                value={draft.method}
                onChange={setMethod}
              />
            </Field>
          </Show>
          <Show when={draft.method === "subscription" && !props.subscriptionSupported}>
            <p class="cx-note cx-note--warn" role="status">
              This Paperclip server doesn't allow signing in from the board (it's an authenticated, public deployment). Use an
              API key instead.
            </p>
          </Show>

          <Field label="Name" for="cx-name">
            <TextInput
              id="cx-name"
              value={draft.name}
              disabled={Boolean(props.reconnect)}
              maxLength={160}
              onInput={(event) => {
                setNameEdited(true);
                setDraft("name", event.currentTarget.value);
              }}
            />
          </Field>

          <Show when={!props.reconnect}>
            <Field
              label="Who can use it"
              help={
                canManage()
                  ? draft.ownership === "shared"
                    ? "Everyone in the company can run agents on it."
                    : "Only runs you're responsible for use it. It becomes your personal Claude default if you don't have one."
                  : "Only a connection manager can share a connection with everyone."
              }
            >
              <Show when={canManage()} fallback={<p class="cx-static">Just me</p>}>
                <Segmented
                  label="Who can use it"
                  options={[
                    { value: "shared", label: "Everyone in the company" },
                    { value: "personal", label: "Just me" },
                  ]}
                  value={draft.ownership}
                  onChange={setOwnership}
                />
              </Show>
            </Field>

            <div class="cx-agents" role="group" aria-labelledby="cx-agents-label">
              <span id="cx-agents-label" class="field-label">
                Agents
              </span>
              <Toggle
                checked={draft.allAgents}
                onChange={(on) => setDraft("allAgents", on)}
                disabled={!canManage()}
                label="Every agent"
                description={canManage() ? "Current and future agents can use it." : "Only a connection manager can give every agent access."}
              />
              <Show when={!draft.allAgents}>
                <Show
                  when={agentList().length > 0}
                  fallback={<p class="cx-static">{agents.isPending ? "Loading agents…" : "No agents yet."}</p>}
                >
                  <ul class="cx-options">
                    <For each={agentList()}>
                      {(agent) => {
                        const checked = () => draft.agentIds.includes(agent.id);
                        return (
                          <li>
                            <label class="cx-option" classList={{ "cx-option--on": checked() }}>
                              <input
                                type="checkbox"
                                checked={checked()}
                                onChange={(event) => toggleAgent(agent.id, event.currentTarget.checked)}
                              />
                              <AgentAvatar agent={agent} size={24} />
                              <span class="cx-option-name">{agent.name}</span>
                              <Show when={agent.adapterType}>
                                <span class="cx-option-note mono">{agent.adapterType}</span>
                              </Show>
                            </label>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
                <Show when={draft.ownership === "personal" && draft.agentIds.length === 0}>
                  <p class="fhelp">Leave every agent unticked to keep it as your personal default only.</p>
                </Show>
              </Show>
              <Show when={agents.isError}>
                <p class="cx-note cx-note--error" role="alert">
                  Could not load agents.
                </p>
              </Show>
            </div>
          </Show>

          <Show when={draft.method === "api_key"}>
            <Field label="Anthropic API key" for="cx-key" help="Paperclip checks the key with Anthropic before saving it.">
              <TextInput
                id="cx-key"
                type="password"
                autocomplete="new-password"
                placeholder="sk-ant-…"
                value={draft.apiKey}
                onInput={(event) => setDraft("apiKey", event.currentTarget.value)}
              />
            </Field>
          </Show>

          <Show when={problem()}>{(text) => <p class="cx-note">{text()}</p>}</Show>
          <Show when={saveKey.error}>
            {(error) => (
              <p class="cx-note cx-note--error" role="alert">
                {(error() as Error).message}
              </p>
            )}
          </Show>

          <div class="cx-actions">
            <Button variant="quiet" onClick={props.onCancel}>
              Cancel
            </Button>
            <Show
              when={draft.method === "api_key"}
              fallback={
                <Button type="submit" variant="primary" disabled={Boolean(problem()) || !props.subscriptionSupported}>
                  Continue to sign-in
                </Button>
              }
            >
              <Button type="submit" variant="primary" disabled={Boolean(problem()) || !draft.apiKey.trim() || saveKey.isPending}>
                {saveKey.isPending ? "Checking the key…" : props.reconnect ? "Reconnect" : "Connect"}
              </Button>
            </Show>
          </div>
        </form>
      </Show>

      <Show when={step() === "sign_in"}>
        <section class="cx-signin" aria-label="Claude sign-in" aria-live="polite">
          <Switch>
            <Match when={login.state().phase === "idle" || login.state().phase === "preparing"}>
              <p class="cx-static" role="status">
                Starting Claude sign-in on the Paperclip server…
              </p>
            </Match>
            <Match when={(() => { const s = login.state(); return s.phase === "sign_in" ? s : null; })()}>
              {(state) => (
                <Show
                  when={state().authorizationUrl}
                  fallback={
                    <p class="cx-static" role="status">
                      Preparing the sign-in link…
                    </p>
                  }
                >
                  {(url) => (
                    <Show
                      when={!state().codeSubmitted}
                      fallback={
                        <p class="cx-static" role="status">
                          Code sent. Waiting for Claude to confirm the sign-in…
                        </p>
                      }
                    >
                      <ol class="cx-steps">
                        <li>
                          <span>Open the sign-in page and approve access with your Claude account.</span>
                          <a class={buttonClass({ variant: "secondary", size: "compact" })} href={url()} target="_blank" rel="noreferrer noopener">
                            <ExternalLink size={14} aria-hidden="true" />
                            Sign in to Claude
                          </a>
                        </li>
                        <li>
                          <span>Claude then shows an authorization code. Paste it here.</span>
                          <form class="cx-code" onSubmit={submitCode}>
                            <TextInput
                              aria-label="Authorization code"
                              placeholder="Paste authorization code here"
                              autocomplete="off"
                              spellcheck={false}
                              value={browserCode()}
                              disabled={state().submitting}
                              onInput={(event) => setBrowserCode(event.currentTarget.value)}
                            />
                            <Button type="submit" variant="primary" size="compact" disabled={!browserCode().trim() || state().submitting}>
                              {state().submitting ? "Sending…" : "Submit code"}
                            </Button>
                          </form>
                        </li>
                      </ol>
                      <Show when={state().code}>
                        {(code) => (
                          <p class="cx-static">
                            Code to enter at the provider: <span class="mono">{code()}</span>
                          </p>
                        )}
                      </Show>
                    </Show>
                  )}
                </Show>
              )}
            </Match>
            <Match when={(() => { const s = login.state(); return s.phase === "ready" ? s : null; })()}>
              {(state) => (
                <>
                  <p class="cx-ok" role="status">
                    Claude is signed in. Save to add the connection.
                  </p>
                  <Show when={state().error}>
                    {(error) => (
                      <p class="cx-note cx-note--error" role="alert">
                        {error()}
                      </p>
                    )}
                  </Show>
                  <button type="button" class="cx-link" onClick={() => login.retry()}>
                    Use a different account
                  </button>
                </>
              )}
            </Match>
            <Match when={login.state().phase === "saving" || login.state().phase === "saved"}>
              <p class="cx-static" role="status">
                Saving the connection…
              </p>
            </Match>
            <Match when={(() => { const s = login.state(); return s.phase === "error" ? s : null; })()}>
              {(state) => (
                <>
                  <p class="cx-note cx-note--error" role="alert">
                    {state().message}
                  </p>
                  <button type="button" class="cx-link" onClick={() => login.retry()}>
                    Start sign-in again
                  </button>
                </>
              )}
            </Match>
          </Switch>
          <Show when={(() => { const s = login.state(); return s.phase === "sign_in" ? s.expiresAt : null; })()}>
            {(expiresAt) => (
              <p class="fhelp">
                This sign-in stays open until{" "}
                <time class="mono" dateTime={expiresAt()}>
                  {new Date(expiresAt()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
                . You can close this dialog and come back to it.
              </p>
            )}
          </Show>
        </section>

        <div class="cx-actions">
          <Button variant="quiet" onClick={backToDetails} disabled={login.state().phase === "saving"}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={login.state().phase !== "ready"}
            onClick={() => void login.connect(draft.name)}
          >
            {login.state().phase === "saving" ? "Saving…" : props.reconnect ? "Reconnect" : "Save connection"}
          </Button>
        </div>
      </Show>
    </div>
  );
}
