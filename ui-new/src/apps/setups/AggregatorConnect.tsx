import type { AppDefinition } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import { ExternalLink, Plus, Trash2 } from "lucide-solid";
import { createSignal, For, Index, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { accessInstalls, connectFailure, errorCode, finishDefaults, type AccessDraft } from "../apps-model";
import { AgentAccessPicker, AppLogo, useGallery, useRefreshTools } from "../shared";
import { IdentityPicker } from "./SetupExtras";
import {
  AGGREGATORS,
  gatewayPayload,
  gatewayProblem,
  identityProblem,
  newGatewayDraft,
  withIdentity,
  type AggregatorId,
  type GatewayAuth,
  type GatewayDraft,
  type IdentityChoice,
} from "./setups-model";

/*
 * Connecting an aggregator gateway, Composio or Arcade (`/apps/connect?source=composio|arcade`, the
 * old UI's remote-MCP provider setup): its steps, the gateway's MCP address (Composio Connect's by
 * default), how it signs in (by itself, a bearer token, headers, or none), whose account it is, and
 * which agents may use it. Signing in leaves for the provider and comes back to the connection's
 * page, where its accounts and apps are listed (AggregatorAccounts).
 */

const AUTH_OPTIONS: { value: GatewayAuth; label: string }[] = [
  { value: "auto", label: "Sign in" },
  { value: "bearer", label: "Token" },
  { value: "custom_headers", label: "Headers" },
  { value: "none", label: "None" },
];

export function AggregatorConnect(props: { app: AppDefinition; id: AggregatorId; resume: string | null }) {
  const company = useCompany();
  const navigate = useNavigate();
  const gallery = useGallery();
  const refresh = useRefreshTools();
  const info = () => AGGREGATORS[props.id];
  const method = () => props.app.methods.find((candidate) => candidate.transport === "mcp_remote") ?? null;
  const [draft, setDraft] = createStore<GatewayDraft>(newGatewayDraft(props.id));
  const [access, setAccess] = createSignal<AccessDraft>({ mode: "specific", agentIds: new Set() });
  const [identity, setIdentity] = createSignal<IdentityChoice>({ kind: "organization", agentId: null });
  const [failure, setFailure] = createSignal<string | null>(null);
  const [ownAddress, setOwnAddress] = createSignal(!info().defaultUrl);
  // A gateway address can carry a personal token even though the method signs in with none, so the
  // choice is always offered (the old UI does the same); the organization one when you may make it.
  const kinds = () => (gallery.data?.capabilities.canCreateOrganizationGrant === false ? (["user"] as const) : (["organization", "user"] as const));
  const problem = () => gatewayProblem(draft) ?? identityProblem(identity());

  const connect = createMutation(() => ({
    mutationFn: async () => {
      const payload = withIdentity(
        { ...gatewayPayload(props.id, method(), draft), ...(props.resume ? { resumeConnectionId: props.resume } : {}) },
        identity(),
      );
      const result = await toolsApi.connectApp(company().id, payload);
      await toolsApi.putInstalls(result.connectionId, accessInstalls(company().id, access()));
      if (result.auth?.kind === "oauth") {
        const start = result.auth.startUrl?.trim()
          ? { authorizationUrl: result.auth.startUrl.trim(), handoff: result.auth.handoff }
          : await toolsApi.startOAuth(result.connectionId, { asCurrentUser: result.connection.credentialPolicy === "per_user" });
        if (start.handoff) throw new Error("This gateway signs in through Paperclip Cloud, which this board can't hand off to yet.");
        window.location.assign(start.authorizationUrl);
        return null;
      }
      const defaults = finishDefaults(result);
      await toolsApi.finishApp(company().id, result.connectionId, {
        enabledCatalogEntryIds: defaults.enabled,
        askFirstCatalogEntryIds: defaults.askFirst,
        access: access().mode === "all" ? "all_agents" : { agentIds: [...access().agentIds] },
      });
      return result.connectionId;
    },
    onSuccess: (connectionId) => {
      void refresh();
      if (!connectionId) return;
      pushToast({ tone: "success", title: `${info().name} connected`, body: "Its apps and accounts are on its page." });
      navigate(`/${company().issuePrefix}/apps/${connectionId}/permissions`);
    },
    onError: (error) => {
      void refresh();
      setFailure(connectFailure(errorCode(error), error instanceof Error ? error.message : null));
    },
  }));

  const addressField = () => (
    <Field label="MCP address" for="ap-gw-url" help={info().urlHelp}>
      <TextInput
        id="ap-gw-url"
        type="url"
        autocomplete="off"
        spellcheck={false}
        placeholder={info().placeholder}
        value={draft.url}
        onInput={(event) => setDraft("url", event.currentTarget.value)}
      />
    </Field>
  );

  return (
    <form
      class="card ap-connect"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem()) return;
        setFailure(null);
        connect.mutate();
      }}
    >
      <header class="ap-connect-head">
        <AppLogo app={props.app} name={info().name} size={48} />
        <div class="ap-connect-title">
          <h2 class="disp">{props.resume ? `Finish connecting ${info().name}` : `Connect ${info().name}`}</h2>
          <p>{props.app.description} Paperclip decides which of its tools agents get; app sign-in happens in {info().name}.</p>
        </div>
        <a class={buttonClass({ size: "compact", variant: "quiet" })} href={info().setupUrl} target="_blank" rel="noopener noreferrer">
          Guide
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </header>

      <ol class="ch-howto">
        <For each={info().steps}>{(step) => <li>{step}</li>}</For>
      </ol>

      <Show
        when={ownAddress()}
        fallback={
          <button type="button" class="cx-link" onClick={() => setOwnAddress(true)}>
            Use an existing {info().name} session's address
          </button>
        }
      >
        {addressField()}
      </Show>

      <Field label="Sign-in" help={info().authHelp}>
        <Segmented label="Sign-in" options={AUTH_OPTIONS} value={draft.auth} onChange={(value) => setDraft("auth", value)} />
      </Field>
      <Show when={draft.auth === "bearer"}>
        <Field label="Token" for="ap-gw-token" help="Just the token, without the word Bearer.">
          <TextInput id="ap-gw-token" type="password" autocomplete="new-password" value={draft.token} onInput={(event) => setDraft("token", event.currentTarget.value)} />
        </Field>
      </Show>
      <Show when={draft.auth === "bearer" || draft.auth === "custom_headers"}>
        <div class="ap-headers" role="group" aria-label={draft.auth === "bearer" ? "More headers" : "Headers"}>
          <Index each={draft.headers}>
            {(row, index) => (
              <div class="ap-header-row">
                <TextInput
                  aria-label={`Header ${index + 1} name`}
                  placeholder={props.id === "arcade" ? "Arcade-User-ID" : "Header name"}
                  value={row().name}
                  onInput={(event) => setDraft("headers", index, "name", event.currentTarget.value)}
                />
                <TextInput
                  aria-label={`Header ${index + 1} value`}
                  type="password"
                  autocomplete="new-password"
                  placeholder="Value"
                  value={row().value}
                  onInput={(event) => setDraft("headers", index, "value", event.currentTarget.value)}
                />
                <Button
                  variant="icon"
                  size="compact"
                  aria-label={`Remove header ${index + 1}`}
                  disabled={draft.headers.length === 1}
                  onClick={() => setDraft("headers", (rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            )}
          </Index>
          <Button size="compact" variant="quiet" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setDraft("headers", (rows) => [...rows, { name: "", value: "" }])}>
            Add a header
          </Button>
        </div>
      </Show>

      <IdentityPicker kinds={[...kinds()]} value={identity()} onChange={setIdentity} disabled={connect.isPending} />

      <Field label="Which agents can use it">
        <AgentAccessPicker value={access()} onChange={setAccess} disabled={connect.isPending} allDescription="Current and future agents can use it, and carry its tools on every run." />
      </Field>

      <Show when={failure()}>
        {(text) => (
          <p class="cx-note cx-note--error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <div class="cx-actions">
        <A class={buttonClass({ variant: "quiet" })} href={`/${company().issuePrefix}/apps`}>
          Cancel
        </A>
        <span class="ap-actions-end">
          <Show when={problem()}>
            <span class="cx-note">{problem()}</span>
          </Show>
          <Button type="submit" variant="primary" disabled={Boolean(problem()) || connect.isPending}>
            {connect.isPending ? "Connecting and finding tools…" : `Connect ${info().name}`}
          </Button>
        </span>
      </div>
    </form>
  );
}
