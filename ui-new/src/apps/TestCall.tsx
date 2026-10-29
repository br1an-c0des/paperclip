import type { ConnectionGrantsResponse, RailwaySshSetup, ToolCatalogEntry, ToolConnection, ToolConnectionTestCallResult } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { browserUseApi } from "@/api/browser-use";
import { queryKeys } from "@/api/queryKeys";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { SchemaForm } from "@/plugins/SchemaForm";
import { validateValues, type JsonSchemaNode } from "@/plugins/schema-form";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { displayName } from "./apps-model";
import { failureText, useRefreshTools } from "./shared";
import {
  browserUseGrants,
  cleanParameters,
  costCap,
  DECISION_LABELS,
  decisionFor,
  grantLabel,
  isTerminal,
  PHASE_LABELS,
  railwayGrants,
  resultError,
  resultText,
  sortTestAgents,
} from "./test-call-model";
import "./TestCall.css";
import "./chat/ChatExtras.css";

/*
 * Testing one action as an agent (the old UI's ActionTestDialog), from the Actions list on a
 * connection's Permissions: pick the agent to act as, see whether the action is Allowed, Ask first
 * or Off for it, fill in the action's inputs (its JSON schema), and run it. The call is real: it
 * uses the agent's permissions and the connection's credentials, so the dialog says so. An Ask-first
 * call waits in Review and the dialog follows it there until it's done.
 *
 * Also here, the app panels a connection's Settings shows for its app: Railway's container access
 * (an SSH key pair and a verified host key) and Browser Use Cloud's saved profiles and cost cap.
 */

export function TestCallDialog(props: { connection: ToolConnection; entry: ToolCatalogEntry | null; onClose: () => void }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/apps`;
  const agents = createQuery(() => ({
    queryKey: queryKeys.tools.connectionPart(company().id, props.connection.id, "test-agents"),
    queryFn: ({ signal }) => toolsApi.testAgents(props.connection.id, signal),
    enabled: Boolean(props.entry),
  }));
  const sorted = createMemo(() => sortTestAgents(agents.data?.agents ?? []));
  const [picked, setPicked] = createSignal<string | null>(null);
  const agentId = () => (picked() && sorted().some((agent) => agent.id === picked()) ? picked() : (sorted()[0]?.id ?? null));
  const access = createQuery(() => ({
    queryKey: queryKeys.tools.connectionPart(company().id, props.connection.id, `test-access:${agentId() ?? ""}`),
    queryFn: ({ signal }) => toolsApi.testAgentAccess(props.connection.id, agentId()!, signal),
    enabled: Boolean(props.entry && agentId()),
    staleTime: 30_000,
  }));
  const decision = () => (props.entry ? decisionFor(access.data?.access, props.entry) : "off");
  const schema = () => (props.entry?.inputSchema ?? { type: "object", properties: {} }) as JsonSchemaNode;
  const [values, setValues] = createSignal<Record<string, unknown>>({});
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [outcome, setOutcome] = createSignal<ToolConnectionTestCallResult | null>(null);
  createEffect(
    on(
      () => [props.entry?.id, agentId()],
      () => {
        setOutcome(null);
        setErrors({});
      },
    ),
  );
  createEffect(on(() => props.entry?.id, () => setValues({})));

  const run = createMutation(() => ({
    mutationFn: () => toolsApi.runTestCall(props.connection.id, { agentId: agentId()!, toolName: props.entry!.toolName, parameters: cleanParameters(values()) }),
    onSuccess: (result) => setOutcome(result),
    onError: (error) => pushToast({ tone: "error", title: "The test didn't run", body: failureText(error, "Try again.") }),
  }));
  const status = createQuery(() => ({
    queryKey: queryKeys.tools.connectionPart(company().id, props.connection.id, `test-call:${outcome()?.actionRequestId ?? ""}`),
    queryFn: ({ signal }) => toolsApi.testCallStatus(props.connection.id, outcome()!.actionRequestId!, signal),
    enabled: Boolean(outcome()?.actionRequestId),
    refetchInterval: (query) => (isTerminal(query.state.data?.phase) ? false : 2000),
  }));
  const submit = () => {
    const problems = validateValues(schema(), values());
    setErrors(problems);
    if (Object.keys(problems).length === 0) run.mutate();
  };
  const title = () => (props.entry ? displayName(props.entry.toolName, props.entry.title) : "");

  return (
    <Dialog
      open={Boolean(props.entry)}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={`Test ${title()}`}
      description="Runs the real action, with the permissions and credentials the agent would use."
      width={680}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onClose()}>
            Close
          </Button>
          <Button variant="primary" disabled={!agentId() || !access.data || run.isPending || decision() === "off"} title={decision() === "off" ? "The action is off for this agent." : undefined} onClick={submit}>
            {run.isPending ? "Running…" : outcome() ? "Run again" : "Run it"}
          </Button>
        </>
      }
    >
      <div class="ap-test">
        <Switch>
          <Match when={agents.isPending}>
            <p class="cx-static" role="status">
              Loading agents…
            </p>
          </Match>
          <Match when={agents.isError}>
            <p class="cx-note cx-note--error" role="alert">
              Couldn't load the agents you can test as.{" "}
              <button type="button" class="cx-link" onClick={() => void agents.refetch()}>
                Try again
              </button>
            </p>
          </Match>
          <Match when={sorted().length === 0}>
            <p class="cx-static">No agents to test as.</p>
          </Match>
          <Match when={true}>
            <div class="ap-test-agent">
              <label class="field-stack" for="ap-test-agent">
                <span class="field-label">Act as</span>
                <select id="ap-test-agent" class="input" value={agentId() ?? ""} onChange={(event) => setPicked(event.currentTarget.value)}>
                  <For each={sorted()}>{(agent) => <option value={agent.id}>{agent.title ? `${agent.name} (${agent.title})` : agent.name}</option>}</For>
                </select>
              </label>
              <Show when={access.data} fallback={<span class="cx-static">{access.isError ? "Couldn't load its permissions." : "Checking its permissions…"}</span>}>
                <Show when={decision() !== "off"} fallback={<span class="cx-row-meta">{DECISION_LABELS.off}</span>}>
                  <TonePill tone={decision() === "allowed" ? "green" : "amber"} compact>
                    {DECISION_LABELS[decision()]}
                  </TonePill>
                </Show>
              </Show>
            </div>
            <Show when={decision() === "off" && access.data}>
              <p class="cx-note">
                This action is off for the agent, so a test call would be refused. Turn it on in Permissions, or give the agent access, to test it.
              </p>
            </Show>
            <Show when={decision() === "ask_first"}>
              <p class="cx-note">The call waits in Review until someone allows it, then runs.</p>
            </Show>
            <Show when={Object.keys(schema().properties ?? {}).length > 0} fallback={<p class="cx-static">This action takes no inputs.</p>}>
              <SchemaForm schema={schema()} values={values()} onChange={setValues} errors={errors()} disabled={run.isPending} advancedLabel="More options" />
            </Show>
          </Match>
        </Switch>

        <Show when={outcome()}>
          {(result) => (
            <section class="ap-test-result" aria-live="polite">
              <Switch>
                <Match when={result().upstreamPending}>
                  {(pending) => (
                    <>
                      <p class="cx-note">
                        {pending().message ?? (pending().kind === "authorization" ? "The app needs you to sign in before it runs this." : "The app is waiting for an approval on its side.")}
                      </p>
                      <ul class="ch-links">
                        <For each={pending().links}>
                          {(link) => (
                            <li>
                              <a href={link.url} target="_blank" rel="noopener noreferrer">
                                Continue at {link.host} <ExternalLink size={12} aria-hidden="true" />
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </>
                  )}
                </Match>
                <Match when={result().decision === "ask_first"}>
                  <p class="cx-static" role="status">
                    {status.data ? PHASE_LABELS[status.data.phase] : "Waiting for approval in Review"}
                    <Show when={status.data?.durationMs}>{(ms) => <> · {(ms() / 1000).toFixed(1)}s</>}</Show>
                  </p>
                  <Show when={!isTerminal(status.data?.phase)}>
                    <A href={`${base()}/${props.connection.id}/review`}>Open Review</A>
                  </Show>
                  <Show when={status.data?.phase === "done" || status.data?.error}>
                    <ResultBody value={status.data?.result} error={status.data?.error?.message} />
                  </Show>
                </Match>
                <Match when={result().decision === "off"}>
                  <p class="cx-note cx-note--error" role="alert">
                    {result().error?.message ?? "The action is off for this agent."}
                  </p>
                </Match>
                <Match when={true}>
                  <ResultBody value={result().result} error={result().error?.message} />
                </Match>
              </Switch>
            </section>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

function ResultBody(props: { value: unknown; error?: string | null }) {
  const failed = () => props.error ?? resultError(props.value);
  return (
    <>
      <Show when={failed()} fallback={<p class="cx-ok">It ran.</p>}>
        <p class="cx-note cx-note--error" role="alert">
          {failed()}
        </p>
      </Show>
      <Show when={props.value !== undefined}>
        <pre class="ap-test-output mono">{resultText(props.value)}</pre>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// App panels on a connection's Settings

export function RailwayPanel(props: { connection: ToolConnection; grants: ConnectionGrantsResponse | undefined }) {
  const refresh = useRefreshTools();
  const setup = () => (props.connection.config?.railwaySsh as RailwaySshSetup | null | undefined) ?? null;
  const grants = createMemo(() => railwayGrants(props.grants));
  const [picked, setPicked] = createSignal("");
  const [knownHosts, setKnownHosts] = createSignal(setup()?.knownHosts ?? "");
  createEffect(on(() => setup()?.knownHosts, (value) => setKnownHosts(value ?? ""), { defer: true }));
  const grantId = () => setup()?.grantId ?? (picked() || grants().eligible[0]?.id);
  const manager = () => props.grants?.capabilities.canConfigure === true;
  const canConfigure = () => manager() && props.connection.status === "active" && grants().eligible.some((grant) => grant.id === grantId());
  const canRemove = () => manager() && grants().owned.some((grant) => grant.id === setup()?.grantId);
  const act = createMutation(() => ({
    mutationFn: (input: Parameters<typeof toolsApi.configureRailwaySsh>[1]) => toolsApi.configureRailwaySsh(props.connection.id, input),
    onSettled: () => refresh(),
    onError: (error) => pushToast({ tone: "error", title: "Container access wasn't changed", body: failureText(error, "Try again.") }),
  }));
  const apiMessage = () => (typeof props.connection.config?.railwayApiMessage === "string" ? props.connection.config.railwayApiMessage : null);

  return (
    <SettingsCard title="Railway operations" description={apiMessage() ?? "Check for new actions after connecting to see service, log and deployment access."}>
      <div class="ap-card-body ap-panel">
        <p>
          Optionally, give Paperclip direct SSH access to Railway containers with a key pair it makes.{" "}
          <a href="https://docs.railway.com/cli/ssh" target="_blank" rel="noopener noreferrer">
            Railway SSH docs
          </a>
        </p>
        <Show when={(canConfigure() || canRemove()) && grantId()} fallback={<p class="cx-static">A connection manager who owns the authorization can set up container access.</p>}>
          <Show when={!setup()}>
            <Show when={grants().eligible.length > 1}>
              <label class="field-stack" for="ap-railway-grant">
                <span class="field-label">Authorization</span>
                <select id="ap-railway-grant" class="input" value={grantId()} onChange={(event) => setPicked(event.currentTarget.value)}>
                  <For each={grants().eligible}>{(grant) => <option value={grant.id}>{grantLabel(grant)}</option>}</For>
                </select>
              </label>
            </Show>
            <div>
              <Button size="compact" disabled={act.isPending} onClick={() => act.mutate({ action: "prepare", grantId: grantId()! })}>
                Make an SSH key pair
              </Button>
            </div>
          </Show>
          <Show when={setup()}>
            {(current) => (
              <>
                <label class="field-stack" for="ap-railway-public">
                  <span class="field-label">Public key</span>
                  <TextArea id="ap-railway-public" class="mono" rows={3} readOnly value={current().publicKey} />
                  <span class="fhelp">
                    Add it to the Railway account this authorization uses. The private key stays in Paperclip's vault.{" "}
                    <a href="https://docs.railway.com/cli/ssh#manage-ssh-keys" target="_blank" rel="noopener noreferrer">
                      Railway key setup
                    </a>
                  </span>
                </label>
                <label class="field-stack" for="ap-railway-hosts">
                  <span class="field-label">Verified Railway host key</span>
                  <TextArea id="ap-railway-hosts" class="mono" rows={3} placeholder="ssh.railway.com ssh-ed25519 …" value={knownHosts()} onInput={(event) => setKnownHosts(event.currentTarget.value)} />
                  <span class="fhelp">Paste the ssh.railway.com line from a known_hosts entry you checked yourself. Paperclip refuses untrusted or changed host keys.</span>
                </label>
                <div class="cx-actions">
                  <Button size="compact" variant="danger" disabled={act.isPending} onClick={() => act.mutate({ action: "remove", grantId: current().grantId })}>
                    Remove the container key
                  </Button>
                  <Button size="compact" variant="primary" disabled={!canConfigure() || act.isPending || !knownHosts().trim()} onClick={() => act.mutate({ action: "enable", grantId: current().grantId, knownHosts: knownHosts() })}>
                    {current().enabled ? "Update the host key" : "Turn on container access"}
                  </Button>
                </div>
                <p class="cx-static">
                  {current().enabled ? "Container access is on for this authorization." : "Add the public key and the host key before turning access on."} Removing the key stops new
                  connections; remove its public key from Railway too.
                </p>
              </>
            )}
          </Show>
        </Show>
      </div>
    </SettingsCard>
  );
}

export function BrowserUsePanel(props: { connection: ToolConnection; grants: ConnectionGrantsResponse | undefined }) {
  const eligible = createMemo(() => browserUseGrants(props.grants));
  const [picked, setPicked] = createSignal("");
  const grantId = () => picked() || eligible()[0]?.id;
  return (
    <SettingsCard title="Browser settings" description="Which saved Browser Use profiles agents may use, and the most one browser run may cost.">
      <div class="ap-card-body ap-panel">
        <Show when={eligible().length > 1}>
          <label class="field-stack" for="ap-bu-grant">
            <span class="field-label">Credential</span>
            <select id="ap-bu-grant" class="input" value={grantId()} onChange={(event) => setPicked(event.currentTarget.value)}>
              <For each={eligible()}>{(grant, index) => <option value={grant.id}>{grantLabel(grant, index())}</option>}</For>
            </select>
          </label>
        </Show>
        <Show when={grantId()} keyed fallback={<p class="cx-static">The credential's owner or a manager of a shared one can set saved profiles and the cost cap.</p>}>
          {(id) => <BrowserUseCredential companyId={props.connection.companyId} grantId={id} />}
        </Show>
      </div>
    </SettingsCard>
  );
}

function BrowserUseCredential(props: { companyId: string; grantId: string }) {
  const client = useQueryClient();
  const key = () => queryKeys.tools.connectionPart(props.companyId, "browser-use", props.grantId);
  const saved = createQuery(() => ({
    queryKey: [...key(), "settings"],
    queryFn: ({ signal }) => browserUseApi.cloudSettings(props.companyId, props.grantId, signal),
  }));
  const profiles = createQuery(() => ({
    queryKey: [...key(), "profiles"],
    queryFn: ({ signal }) => browserUseApi.cloudProfiles(props.companyId, props.grantId, signal),
    retry: false,
  }));
  const [allowed, setAllowed] = createSignal<string[]>([]);
  const [limit, setLimit] = createSignal("");
  createEffect(
    on(
      () => saved.data,
      (data) => {
        if (!data) return;
        setAllowed(data.allowedProfileIds);
        setLimit(data.maxCostUsd?.toString() ?? "");
      },
    ),
  );
  const cap = () => costCap(limit());
  const save = createMutation(() => ({
    mutationFn: () => browserUseApi.saveCloudSettings(props.companyId, props.grantId, { allowedProfileIds: allowed(), maxCostUsd: cap().ok ? (cap() as { value: number | null }).value : null }),
    onSuccess: (next) => {
      client.setQueryData([...key(), "settings"], next);
      pushToast({ tone: "success", title: "Browser settings saved" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save the browser settings", body: failureText(error, "Check your access to the credential.") }),
  }));
  return (
    <>
      <SettingsRow label="Most a browser run may cost" help="In US dollars. Empty uses what's left of the Paperclip budget; agents may set less." for="ap-bu-limit">
        <TextInput id="ap-bu-limit" type="number" min="0" step="0.01" placeholder="No cap of its own" value={limit()} onInput={(event) => setLimit(event.currentTarget.value)} />
      </SettingsRow>
      <fieldset class="ap-panel-set">
        <legend class="field-label">Saved profiles agents may use</legend>
        <p class="cx-static">
          Fresh browsers are the default. A saved profile lets agents use its website logins. Manage profiles in{" "}
          <a href="https://cloud.browser-use.com" target="_blank" rel="noopener noreferrer">
            Browser Use Cloud
          </a>
          .
        </p>
        <Switch>
          <Match when={profiles.isPending}>
            <p class="cx-static">Loading profiles…</p>
          </Match>
          <Match when={profiles.isError}>
            <p class="cx-note cx-note--error" role="alert">
              Couldn't load the profiles.{" "}
              <button type="button" class="cx-link" onClick={() => void profiles.refetch()}>
                Retry
              </button>
            </p>
          </Match>
          <Match when={(profiles.data?.length ?? 0) === 0}>
            <p class="cx-static">No saved profiles.</p>
          </Match>
          <Match when={true}>
            <For each={profiles.data}>
              {(profile) => (
                <label class="ch-check">
                  <input
                    type="checkbox"
                    checked={allowed().includes(profile.id)}
                    onChange={(event) => setAllowed(event.currentTarget.checked ? [...allowed(), profile.id] : allowed().filter((id) => id !== profile.id))}
                  />
                  {profile.name ?? profile.id}
                </label>
              )}
            </For>
          </Match>
        </Switch>
      </fieldset>
      <Show when={saved.isError}>
        <p class="cx-note cx-note--error" role="alert">
          Couldn't load the browser settings for this credential.
        </p>
      </Show>
      <div class="cx-actions">
        <span />
        <Button size="compact" variant="primary" disabled={!saved.data || save.isPending || !cap().ok} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save browser settings"}
        </Button>
      </div>
    </>
  );
}
