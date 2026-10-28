import type { AppDefinition } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { activeAgents } from "@/api/agents";
import { ApiError } from "@/api/client";
import { emailApi, type AgentMailInspection } from "@/api/email";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { AppLogo, failureText } from "../shared";
import { SetupSteps } from "./parts";
import { addressProblem, inboxDomains, suggestUsername } from "./email-model";

/*
 * Giving an agent an email address (`/apps/chat/connect?provider=agentmail`, the old UI's
 * EmailEndpointSetup), in two steps:
 *
 * 1. Account: the agent, and an AgentMail account: a saved one, or a new API key (checked, then
 *    saved for the company with only this agent allowed).
 * 2. Address: a new address on AgentMail's domain or a verified domain of yours, or an inbox the
 *    account already has; and how mail arrives (a live connection, or a webhook). Creating it uses
 *    one request id, so a retry after a failure resumes the same inbox rather than making another.
 *
 * Shown on every instance: AgentMail inboxes don't follow the chat connectors flag. The old UI's
 * work-boundary check for low-trust agents is the server's: its refusal is shown as is.
 */

type Step = "account" | "address";
const STEPS: { key: Step; label: string }[] = [
  { key: "account", label: "Agent and account" },
  { key: "address", label: "Email address" },
];

export function EmailSetup(props: { app: AppDefinition | null; agentId: string | null; resume: string | null }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const base = () => `/${company().issuePrefix}/apps`;
  const agents = useAgentsQuery();
  const choices = () => activeAgents(agents.data).filter((agent) => agent.status !== "pending_approval");
  const [step, setStep] = createSignal<Step>("account");
  const [agentId, setAgentId] = createSignal(props.agentId ?? "");
  const agent = () => choices().find((candidate) => candidate.id === agentId()) ?? null;
  const [requestId] = createSignal(props.resume ?? crypto.randomUUID());
  const [savedId, setSavedId] = createSignal<string>("");
  const [apiKey, setApiKey] = createSignal("");
  const [connectionId, setConnectionId] = createSignal("");
  const [inspection, setInspection] = createSignal<AgentMailInspection | null>(null);
  const [mode, setMode] = createSignal<"new" | "existing">("new");
  const [username, setUsername] = createSignal("");
  const [domain, setDomain] = createSignal("agentmail.to");
  const [inboxId, setInboxId] = createSignal("");
  const [receive, setReceive] = createSignal<"websocket" | "webhook">("websocket");
  const [taken, setTaken] = createSignal<string[]>([]);

  const credentials = createQuery(() => ({
    queryKey: queryKeys.tools.emailCredentials(company().id),
    queryFn: ({ signal }) => emailApi.credentials(company().id, signal),
    retry: false,
  }));
  const inboxes = createQuery(() => ({
    queryKey: queryKeys.tools.emailInboxes(company().id),
    queryFn: ({ signal }) => emailApi.inboxes(company().id, signal),
    retry: false,
  }));
  // A setup that failed half way left an inbox under this request id: finish that one.
  const pending = () => inboxes.data?.find((inbox) => inbox.id === requestId() && inbox.status !== "archived") ?? null;
  createEffect(
    on(pending, (inbox) => {
      if (!inbox) return;
      setAgentId(inbox.assignedAgentId);
      setReceive(inbox.receiveMode);
    }),
  );
  const agentName = createMemo(() => agent()?.name ?? "");
  createEffect(on(agentName, (name) => setUsername(suggestUsername(name))));
  createEffect(() => {
    if (!savedId() && (credentials.data?.length ?? 0) > 0 && !apiKey()) setSavedId(credentials.data![0]!.id);
  });

  const scopedToInbox = () => inspection()?.scope.scope_type === "inbox";
  const domains = createMemo(() => inboxDomains(inspection(), domain()));
  const assigned = (address: string) => (inboxes.data ?? []).some((inbox) => inbox.id !== requestId() && inbox.address === address && inbox.status !== "archived");

  const connect = createMutation(() => ({
    mutationFn: async () => {
      const saved = savedId() && !apiKey().trim() ? savedId() : null;
      const details = saved ? await emailApi.inspectSaved(company().id, saved) : await emailApi.inspect(company().id, apiKey().trim());
      let id = saved;
      if (!id) {
        const created = await emailApi.connect(company().id, {
          apiKey: apiKey().trim(),
          grantKind: "organization",
          allAgents: false,
          agentIds: [agentId()],
          idempotencyKey: requestId(),
        });
        id = created.id;
      }
      return { id, details };
    },
    onSuccess: ({ id, details }) => {
      setApiKey("");
      setConnectionId(id);
      setSavedId(id);
      setInspection(details);
      client.setQueryData(queryKeys.tools.emailInspection(company().id, id), details);
      void client.invalidateQueries({ queryKey: queryKeys.tools.emailCredentials(company().id) });
      const verified = inboxDomains(details, "agentmail.to").filter((value) => value !== "agentmail.to");
      if (verified[0]) setDomain(verified[0]);
      if (details.scope.scope_type === "inbox") {
        setMode("existing");
        setInboxId(details.inboxes[0]?.inbox_id ?? "");
      }
      setStep("address");
    },
  }));

  const address = () => pending()?.address ?? (mode() === "existing" ? inboxId() : `${username()}@${domain()}`);
  const problem = () => {
    if (pending()?.address) return null;
    if (mode() === "existing") return !inboxId() ? "Choose an inbox." : assigned(inboxId()) ? "That inbox already belongs to an agent." : null;
    return addressProblem(username(), address(), [...taken(), ...(inspection()?.inboxes.map((inbox) => inbox.inbox_id) ?? [])]);
  };
  const check = createMutation(() => ({
    mutationFn: () => emailApi.checkAddress(company().id, connectionId(), { username: username(), domain: domain() }),
    onSuccess: (result) => {
      if (result.status === "taken") setTaken([...taken(), result.address.toLowerCase()]);
    },
  }));
  const create = createMutation(() => ({
    mutationFn: () =>
      emailApi.setup(company().id, {
        assignedAgentId: agentId(),
        credentialConnectionId: connectionId(),
        ...(pending()?.address ? { inboxId: pending()!.address! } : mode() === "existing" ? { inboxId: inboxId() } : { username: username(), domain: domain() }),
        receiveMode: receive(),
        idempotencyKey: requestId(),
      }),
    onSuccess: (inbox) => {
      void client.invalidateQueries({ queryKey: queryKeys.tools.all(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.chatEndpoints.all(company().id) });
      pushToast({ tone: "success", title: `${agent()?.name ?? "The agent"} has an email address`, body: inbox.address ?? undefined });
      navigate(`${base()}/chat/${inbox.id}/settings`);
    },
    onError: (error) => {
      const code = error instanceof ApiError ? (error.body as { code?: string } | null)?.code : null;
      if (code === "agentmail_address_taken") setTaken([...taken(), address().toLowerCase()]);
      void client.invalidateQueries({ queryKey: queryKeys.tools.emailInboxes(company().id) });
    },
  }));

  return (
    <section class="card ap-connect ch-setup">
      <header class="ap-connect-head">
        <AppLogo app={props.app} name="AgentMail" size={48} />
        <div class="ap-connect-title">
          <h2 class="disp">Give an agent an email address</h2>
          <p>Email to the address becomes a task for the agent. Replies stay in the same task.</p>
        </div>
      </header>
      <SetupSteps steps={STEPS} current={step()} reached={connectionId() ? "address" : "account"} onPick={setStep} disabled={connect.isPending || create.isPending} />

      <Switch>
        <Match when={step() === "account"}>
          <form
            class="ch-step-body"
            onSubmit={(event) => {
              event.preventDefault();
              if (agentId() && (savedId() || apiKey().trim())) connect.mutate();
            }}
          >
            <Field label="Agent" help={pending() ? "This inbox's setup already names its agent." : undefined}>
              <Show when={choices().length > 0} fallback={<p class="cx-static">{agents.isPending ? "Loading agents…" : "No active agents yet."}</p>}>
                <ul class="cx-options" role="radiogroup" aria-label="Agent">
                  <For each={choices()}>
                    {(candidate) => (
                      <li>
                        <label class="cx-option" classList={{ "cx-option--on": candidate.id === agentId() }}>
                          <input type="radio" name="ch-email-agent" checked={candidate.id === agentId()} disabled={Boolean(pending())} onChange={() => setAgentId(candidate.id)} />
                          <AgentAvatar agent={candidate} size={24} />
                          <span class="cx-option-name">{candidate.name}</span>
                        </label>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Field>
            <Show when={(credentials.data?.length ?? 0) > 0}>
              <Field label="AgentMail account" for="ch-email-account">
                <select id="ch-email-account" class="input" value={apiKey().trim() ? "" : savedId()} onChange={(event) => { setSavedId(event.currentTarget.value); setApiKey(""); }}>
                  <For each={credentials.data}>
                    {(option) => (
                      <option value={option.id}>
                        {option.label}
                        {option.scope === "inbox" ? ` · one inbox (${option.inboxId ?? "?"})` : ""}
                      </option>
                    )}
                  </For>
                  <option value="">A new API key…</option>
                </select>
              </Field>
            </Show>
            <Show when={!savedId() || (credentials.data?.length ?? 0) === 0}>
              <Field
                label="AgentMail API key"
                for="ch-email-key"
                help={
                  <a href="https://console.agentmail.to/dashboard/api-keys" target="_blank" rel="noopener noreferrer">
                    Get a key <ExternalLink size={11} aria-hidden="true" />
                  </a>
                }
              >
                <TextInput id="ch-email-key" type="password" autocomplete="new-password" placeholder="am_…" value={apiKey()} onInput={(event) => setApiKey(event.currentTarget.value)} />
              </Field>
            </Show>
            <Show when={connect.isError}>
              <p class="cx-note cx-note--error" role="alert">
                {failureText(connect.error, "AgentMail didn't accept that key.")}
              </p>
            </Show>
            <div class="cx-actions">
              <A class={buttonClass({ variant: "quiet" })} href={base()}>
                Cancel
              </A>
              <Button type="submit" variant="primary" disabled={!agentId() || !(savedId() || apiKey().trim()) || connect.isPending}>
                {connect.isPending ? "Checking the account…" : "Continue"}
              </Button>
            </div>
          </form>
        </Match>
        <Match when={step() === "address"}>
          <form
            class="ch-step-body"
            onSubmit={(event) => {
              event.preventDefault();
              if (!problem()) create.mutate();
            }}
          >
            <Show
              when={!pending()?.address}
              fallback={
                <p class="cx-note">
                  <b>{pending()!.address}</b> was made in AgentMail; finish giving it to {agent()?.name ?? "the agent"}.
                </p>
              }
            >
              <Show when={!scopedToInbox()}>
                <Segmented
                  label="Address"
                  options={[
                    { value: "new", label: "A new address" },
                    { value: "existing", label: "An inbox you have" },
                  ]}
                  value={mode()}
                  onChange={setMode}
                />
              </Show>
              <Show
                when={mode() === "new"}
                fallback={
                  <Field label={`${agent()?.name ?? "The agent"}'s inbox`} for="ch-email-inbox">
                    <select id="ch-email-inbox" class="input" value={inboxId()} disabled={scopedToInbox()} onChange={(event) => setInboxId(event.currentTarget.value)}>
                      <option value="">Choose an inbox</option>
                      <For each={inspection()?.inboxes ?? []}>
                        {(inbox) => (
                          <option value={inbox.inbox_id} disabled={assigned(inbox.inbox_id)}>
                            {inbox.inbox_id}
                            {assigned(inbox.inbox_id) ? " (already an agent's)" : ""}
                          </option>
                        )}
                      </For>
                    </select>
                  </Field>
                }
              >
                <Field label={`${agent()?.name ?? "The agent"}'s address`} for="ch-email-name">
                  <div class="ch-address">
                    <TextInput
                      id="ch-email-name"
                      maxLength={64}
                      autocomplete="off"
                      spellcheck={false}
                      value={username()}
                      onInput={(event) => setUsername(event.currentTarget.value.toLowerCase())}
                      onBlur={() => !addressProblem(username(), address(), taken()) && connectionId() && check.mutate()}
                    />
                    <select class="input" aria-label="Email domain" value={domain()} onChange={(event) => setDomain(event.currentTarget.value)}>
                      <For each={domains()}>{(value) => <option value={value}>@{value}</option>}</For>
                    </select>
                  </div>
                </Field>
                <Show when={check.isPending}>
                  <p class="cx-static">Checking the address…</p>
                </Show>
                <Show when={check.data?.status === "unknown" && !problem()}>
                  <p class="cx-static">AgentMail confirms the address when it's made.</p>
                </Show>
              </Show>
            </Show>
            <Show when={problem() && (mode() === "existing" || username())}>
              <p class="cx-note cx-note--error" role="alert">
                {problem()}
              </p>
            </Show>
            <details class="ap-more">
              <summary>More settings</summary>
              <div class="ap-more-body">
                <Field
                  label="How mail arrives"
                  help={receive() === "webhook" ? "AgentMail calls this Paperclip's public address." : "Paperclip keeps a live connection open; no public address needed."}
                >
                  <Segmented
                    label="How mail arrives"
                    options={[
                      { value: "websocket", label: "Live connection" },
                      { value: "webhook", label: "Webhook" },
                    ]}
                    value={receive()}
                    onChange={setReceive}
                  />
                </Field>
                <a href="https://docs.agentmail.to/custom-domains" target="_blank" rel="noopener noreferrer">
                  Use your own domain <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
            </details>
            <Show when={create.isError}>
              <p class="cx-note cx-note--error" role="alert">
                {failureText(create.error, "The inbox couldn't be made.")}
              </p>
            </Show>
            <div class="cx-actions">
              <Button variant="quiet" onClick={() => setStep("account")}>
                Back
              </Button>
              <Button type="submit" variant="primary" disabled={Boolean(problem()) || create.isPending}>
                {create.isPending ? "Making the inbox…" : "Create the address"}
              </Button>
            </div>
          </form>
        </Match>
      </Switch>
    </section>
  );
}
