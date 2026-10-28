import type { ToolMcpGatewayClientSnippet, ToolMcpGatewayToken, ToolMcpGatewayTokenCreated, ToolMcpGatewayWithTokens, ToolProfileWithDetails } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation } from "@tanstack/solid-query";
import { Pencil, Plus, Send } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { toolAccessApi } from "@/api/tool-access";
import { dateTime, shortDate } from "@/agents/shared";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, SettingsCard, TextInput } from "@/ui/Field";
import { PageHeader, Tabs } from "@/ui/PageHeader";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { CardState, copyToClipboard, CopyBlock, Facts, RowLink, StatePill } from "../advanced/parts";
import { useGateways, useProfiles } from "../advanced/queries";
import { GATEWAY_TABS, type GatewayTab } from "../advanced/routes-model";
import { failureText, useApplications, useConnections } from "../shared";
import { ToolActivity } from "./Activity";
import {
  allowedToolsLabel,
  defaultExpiry,
  defaultTokenName,
  endpointUrl,
  expiryFromDate,
  filledSnippet,
  gatewayApps,
  isOn,
  maskedToken,
  orderedSnippets,
  overviewSnippet,
  scopeLabel,
  tokenCounts,
  tokenStatus,
  TOKEN_STATUS,
  type GatewayApp,
} from "./gateway-model";
import { GatewayDialog, useGatewayToggle, useRefreshGateways } from "./Gateways";

/*
 * One gateway (`/apps/gateways/:gatewayId/:tab`, the old UI's GatewayDetail):
 *
 * - Overview: on or off, its apps, tokens and health, who can use it, and how a client connects.
 * - Apps and tools: the apps its access profile includes, each linking to its connection.
 * - Tokens: issue a token (shown in full once), and the token history with revoke.
 * - Activity: calls through it in the last 30 days.
 * - Advanced: transport details, its raw configuration, and archiving it.
 *
 * Client snippets fill a client's config with this board's address and a token issued on this page
 * (an existing token's secret can't be read back).
 */

const ACTIONS = ["tools/list", "tools/call"] as const;

export function GatewayDetail(props: { gatewayId: string; tab: GatewayTab }) {
  const company = useCompany();
  const gateways = useGateways();
  const profiles = useProfiles();
  const connections = useConnections();
  const applications = useApplications();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const toggle = useGatewayToggle();
  const [editing, setEditing] = createSignal(false);
  const [snippets, setSnippets] = createSignal(false);
  // Tokens issued on this page, whose secret can still fill a snippet.
  const [issued, setIssued] = createSignal<ToolMcpGatewayTokenCreated[]>([]);
  const base = () => `/${company().issuePrefix}/apps/gateways`;
  const gateway = createMemo(() => gateways.data?.gateways.find((entry) => entry.id === props.gatewayId) ?? null);
  const profile = createMemo(() => profiles.data?.profiles.find((entry) => entry.id === gateway()?.profileId));
  const apps = createMemo(() => gatewayApps(profile(), applications.data?.applications ?? [], connections.data?.connections ?? []));
  const scope = () => {
    const current = gateway();
    if (!current) return "";
    return scopeLabel(
      current,
      new Map((projects.data ?? []).map((project) => [project.id, project.name])),
      new Map((agents.data ?? []).map((agent) => [agent.id, agent.name])),
    );
  };
  const remember = (token: ToolMcpGatewayTokenCreated) => setIssued((list) => [token, ...list.filter((entry) => entry.id !== token.id)]);
  // A revoked token's secret no longer connects, so it leaves the snippets.
  const usable = createMemo(() => {
    const revoked = new Set((gateway()?.tokens ?? []).filter((token) => token.revokedAt).map((token) => token.id));
    return issued().filter((token) => !revoked.has(token.id));
  });

  return (
    <Switch>
      <Match when={!gateways.isSuccess}>
        <section class="card">
          <CardState loading={gateways.isPending} error={gateways.error} what="the gateway" onRetry={() => void gateways.refetch()} />
        </section>
      </Match>
      <Match when={!gateway() || gateway()!.status === "archived"}>
        <section class="card ap-later">
          <h2 class="disp">Gateway not found</h2>
          <p>
            It may have been archived. <A href={base()}>Back to gateways</A>
          </p>
        </section>
      </Match>
      <Match when={gateway()}>
        {(current) => {
          const endpoint = () => endpointUrl(current().endpointPath, location.origin);
          return (
            <>
              <PageHeader
                size="compact"
                crumbs={
                  <>
                    <A href={`/${company().issuePrefix}/apps`}>Apps</A>
                    <span aria-hidden="true">/</span>
                    <A href={base()}>Gateways</A>
                  </>
                }
                title={current().name}
                numbers={
                  <>
                    <StatePill tone={isOn(current()) ? "green" : null}>{isOn(current()) ? "On" : "Off"}</StatePill>
                    <span>{scope()}</span>
                    <span>{allowedToolsLabel(profile())}</span>
                  </>
                }
                actions={
                  <>
                    <Button size="compact" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                    <Button size="compact" variant="primary" icon={<Send size={14} aria-hidden="true" />} onClick={() => setSnippets(true)}>
                      Client snippets
                    </Button>
                  </>
                }
                tabs={<Tabs label="Gateway" items={GATEWAY_TABS.map((tab) => ({ label: tab.label, href: `${base()}/${current().id}/${tab.key}` }))} />}
              >
                <CopyBlock inline value={endpoint()} label="gateway address" />
              </PageHeader>

              <Switch>
                <Match when={props.tab === "overview"}>
                  <Overview gateway={current()} profile={profile()} apps={apps()} scope={scope()} endpoint={endpoint()} toggling={toggle.isPending} onToggle={() => toggle.mutate(current())} />
                </Match>
                <Match when={props.tab === "apps"}>
                  <AppsCard apps={apps()} profile={profile()} intro />
                </Match>
                <Match when={props.tab === "tokens"}>
                  <Tokens gateway={current()} onIssued={remember} />
                </Match>
                <Match when={props.tab === "activity"}>
                  <section class="card ap-card" aria-labelledby="gw-activity">
                    <header class="chead">
                      <h3 id="gw-activity" class="disp">
                        Calls through this gateway
                      </h3>
                      <p>The last 30 days. Open a call to see its tool, decision, and redacted arguments and result.</p>
                    </header>
                    <ToolActivity filter={{ gateway: current().id, window: "30d" }} empty="No calls have gone through this gateway yet." />
                  </section>
                </Match>
                <Match when={props.tab === "advanced"}>
                  <Advanced gateway={current()} endpoint={endpoint()} />
                </Match>
              </Switch>

              <GatewayDialog open={editing()} onOpenChange={setEditing} gateway={current()} />
              <SnippetsDialog open={snippets()} onOpenChange={setSnippets} gateway={current()} issued={usable()} onIssued={remember} endpoint={endpoint()} />
            </>
          );
        }}
      </Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------

function Overview(props: {
  gateway: ToolMcpGatewayWithTokens;
  profile: ToolProfileWithDetails | undefined;
  apps: GatewayApp[];
  scope: string;
  endpoint: string;
  toggling: boolean;
  onToggle: () => void;
}) {
  const counts = () => tokenCounts(props.gateway);
  const attention = () => props.apps.filter((app) => app.needsAttention).length;
  return (
    <>
      <div class="tl-stats">
        <div class="card tl-stat">
          <span>{isOn(props.gateway) ? "On" : "Off"}</span>
          <Toggle checked={isOn(props.gateway)} disabled={props.toggling} onChange={() => props.onToggle()} label="Gateway on" labelHidden />
        </div>
        <div class="card tl-stat">
          <span>Apps</span>
          <b>
            {props.apps.length} {props.apps.length === 1 ? "app" : "apps"} · {allowedToolsLabel(props.profile)}
          </b>
        </div>
        <div class="card tl-stat">
          <span>Tokens</span>
          <b>
            {counts().active} active{counts().expiring > 0 ? ` · ${counts().expiring} expiring` : ""}
          </b>
        </div>
        <div class="card tl-stat">
          <span>Health</span>
          <b>{attention() === 0 ? "All good" : `${attention()} ${attention() === 1 ? "app needs" : "apps need"} attention`}</b>
        </div>
      </div>
      <SettingsCard title="Who can use it" description="Anyone holding an active token, limited to the tools its access profile allows.">
        <div class="ap-card-body tl-chips">
          <span class="tl-chip">Scope · {props.scope}</span>
          <span class="tl-chip">Profile · {props.profile?.name ?? "Unavailable"}</span>
          <span class="tl-chip">
            {counts().active} active {counts().active === 1 ? "token" : "tokens"}
          </span>
        </div>
      </SettingsCard>
      <AppsCard apps={props.apps} profile={props.profile} />
      <SettingsCard title="How clients connect" description="Add this to a client's MCP settings, with a token from the Tokens tab, or use Client snippets.">
        <div class="ap-card-body">
          <CopyBlock value={overviewSnippet(props.gateway, props.endpoint)} label="client config" />
        </div>
      </SettingsCard>
    </>
  );
}

function AppsCard(props: { apps: GatewayApp[]; profile: ToolProfileWithDetails | undefined; intro?: boolean }) {
  const company = useCompany();
  const href = (app: GatewayApp) => (app.connection ? `/${company().issuePrefix}/apps/${app.connection.id}/permissions` : `/${company().issuePrefix}/apps/app/${app.application.id}`);
  return (
    <section class="card ap-card" aria-labelledby="gw-apps">
      <header class="chead ap-chead">
        <div>
          <h3 id="gw-apps" class="disp">
            Apps in this gateway
          </h3>
          <Show when={props.intro}>
            <p>
              The access profile{props.profile ? ` ${props.profile.name}` : ""} decides which tools go through: {allowedToolsLabel(props.profile).toLowerCase()}.
            </p>
          </Show>
        </div>
        <Show when={props.profile}>
          {(found) => <RowLink href={`/${company().issuePrefix}/apps/advanced/profiles/${found().id}`}>Open the profile</RowLink>}
        </Show>
      </header>
      <ul class="ap-rows">
        <For each={props.apps} fallback={<li class="ap-empty">Its access profile doesn't include any apps yet.</li>}>
          {(app) => (
            <li class="ap-row">
              <div class="ap-row-main">
                <A class="ap-row-name" href={href(app)}>
                  {app.name}
                </A>
                <span class="ap-row-meta">
                  {app.toolCount > 0 ? `${app.toolCount} ${app.toolCount === 1 ? "tool" : "tools"} picked` : "All its tools"}
                  {app.needsAttention ? " · sign-in or key needs attention; reconnect it to restore access" : ""}
                </span>
              </div>
              <StatePill tone={app.needsAttention ? "amber" : "green"}>{app.needsAttention ? "Needs attention" : "Healthy"}</StatePill>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Tokens

const PAGE = 10;

function Tokens(props: { gateway: ToolMcpGatewayWithTokens; onIssued: (token: ToolMcpGatewayTokenCreated) => void }) {
  const company = useCompany();
  const refresh = useRefreshGateways();
  const [issuing, setIssuing] = createSignal(false);
  const [name, setName] = createSignal("");
  const [note, setNote] = createSignal("");
  const [expires, setExpires] = createSignal(defaultExpiry());
  const [created, setCreated] = createSignal<ToolMcpGatewayTokenCreated | null>(null);
  const [revoking, setRevoking] = createSignal<ToolMcpGatewayToken | null>(null);
  const [confirmName, setConfirmName] = createSignal("");
  const [page, setPage] = createSignal(1);
  const tokens = createMemo(() => [...props.gateway.tokens].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  const pages = () => Math.max(1, Math.ceil(tokens().length / PAGE));
  const visible = () => tokens().slice((Math.min(page(), pages()) - 1) * PAGE, Math.min(page(), pages()) * PAGE);

  const issue = createMutation(() => ({
    mutationFn: () =>
      toolAccessApi.createGatewayToken(company().id, props.gateway.id, {
        name: name().trim(),
        clientLabel: name().trim(),
        ownerNote: note().trim(),
        allowedActions: [...ACTIONS],
        expiresAt: expiryFromDate(expires()),
      }),
    onSuccess: (token) => {
      setCreated(token);
      setIssuing(false);
      setNote("");
      props.onIssued(token);
      pushToast({ title: "Token issued", body: "Copy it now. Once you leave this page only its first characters are shown.", tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't issue the token", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const revoke = createMutation(() => ({
    mutationFn: (token: ToolMcpGatewayToken) => toolAccessApi.revokeGatewayToken(company().id, token.id),
    onSuccess: (token) => {
      setRevoking(null);
      if (created()?.id === token.id) setCreated(null);
      pushToast({ title: "Token revoked", body: `${token.name} can no longer connect.`, tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't revoke the token", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const startIssuing = () => {
    setName(defaultTokenName(props.gateway));
    setExpires(defaultExpiry());
    setIssuing(true);
  };

  return (
    <>
      <section class="card ap-card" aria-labelledby="gw-tokens">
        <header class="chead ap-chead">
          <div>
            <h3 id="gw-tokens" class="disp">
              Tokens
            </h3>
            <p>
              A reusable token for an outside client; its name is also the client's label. Agent runs get their own one-hour token, revoked when the run ends, so
              revoked rows from runs are history, not tokens you made.
            </p>
          </div>
          <Show when={!issuing()}>
            <Button size="compact" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={startIssuing}>
              Issue token
            </Button>
          </Show>
        </header>
        <Show when={issuing()}>
          <form
            class="tl-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (name().trim()) issue.mutate();
            }}
          >
            <Field label="Token name" for="gw-token-name" help="Also used as the client label.">
              <TextInput id="gw-token-name" maxLength={160} value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            </Field>
            <Field label="Expires" for="gw-token-expires">
              <TextInput id="gw-token-expires" type="date" required value={expires()} onInput={(event) => setExpires(event.currentTarget.value)} />
            </Field>
            <Field label="Owner note (optional)" for="gw-token-note">
              <TextInput id="gw-token-note" maxLength={1000} placeholder="Who uses this token, or why it exists" value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
            </Field>
            <div class="cx-actions">
              <Button variant="quiet" onClick={() => setIssuing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!name().trim() || !expires() || issue.isPending}>
                {issue.isPending ? "Issuing…" : "Issue token"}
              </Button>
            </div>
          </form>
        </Show>
        <Show when={created()}>
          {(token) => (
            <div class="tl-form">
              <p class="cx-note cx-note--warn">
                <b>Copy the new token now.</b> It's in Client snippets for this visit; after that only its first characters are shown.
              </p>
              <CopyBlock value={token().token} label="token" />
              <div>
                <Button size="compact" variant="quiet" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </Show>
      </section>

      <section class="card ap-card" aria-labelledby="gw-history">
        <header class="chead">
          <h3 id="gw-history" class="disp">
            Token history
          </h3>
          <p>{tokens().length === 1 ? "1 token" : `${tokens().length} tokens`}, newest first.</p>
        </header>
        <ul class="ap-rows">
          <For each={visible()} fallback={<li class="ap-empty">No tokens have been issued for this gateway.</li>}>
            {(token) => {
              const status = () => tokenStatus(token);
              return (
                <li class="ap-row">
                  <div class="ap-row-main">
                    <span class="ap-row-name">{token.name}</span>
                    <span class="ap-row-meta">
                      <span class="mono">{maskedToken(token)}</span>
                      {token.ownerNote && token.ownerNote !== token.name ? ` · ${token.ownerNote}` : ""} · made {shortDate(token.createdAt)}
                      {token.lastUsedAt ? ` · last used ${dateTime(token.lastUsedAt)}` : " · never used"}
                      {token.expiresAt ? ` · ${status() === "expired" ? "expired" : "expires"} ${shortDate(token.expiresAt)}` : " · no expiry"}
                    </span>
                  </div>
                  <span class="tl-row-side">
                    <StatePill tone={TOKEN_STATUS[status()].tone}>{TOKEN_STATUS[status()].label}</StatePill>
                    <Show when={status() !== "revoked"}>
                      <Button
                        size="compact"
                        variant="danger"
                        onClick={() => {
                          setConfirmName("");
                          setRevoking(token);
                        }}
                      >
                        Revoke
                      </Button>
                    </Show>
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={pages() > 1}>
          <div class="tl-more">
            <span class="cx-note">
              Page {Math.min(page(), pages())} of {pages()}
            </span>
            <Button size="compact" variant="quiet" disabled={page() <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Newer
            </Button>
            <Button size="compact" variant="quiet" disabled={page() >= pages()} onClick={() => setPage((value) => Math.min(pages(), value + 1))}>
              Older
            </Button>
          </div>
        </Show>
      </section>

      <Dialog
        open={revoking() !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this token?"
        width={460}
        hideClose
        footer={
          <>
            <Button variant="quiet" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={confirmName().trim() !== revoking()?.name || revoke.isPending} onClick={() => revoke.mutate(revoking()!)}>
              {revoke.isPending ? "Revoking…" : "Revoke token"}
            </Button>
          </>
        }
      >
        <div class="tl-stack">
          <p class="confirm-body">
            Any client using <b>{revoking()?.name}</b> goes quiet at once. This can't be undone. Type the token's name to confirm.
          </p>
          <TextInput aria-label="The token's name" placeholder={revoking()?.name} value={confirmName()} onInput={(event) => setConfirmName(event.currentTarget.value)} />
        </div>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function SnippetsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateway: ToolMcpGatewayWithTokens;
  issued: ToolMcpGatewayTokenCreated[];
  onIssued: (token: ToolMcpGatewayTokenCreated) => void;
  endpoint: string;
}) {
  const company = useCompany();
  const refresh = useRefreshGateways();
  const list = createMemo(() => orderedSnippets(props.gateway.clientSnippets ?? []));
  const [client, setClient] = createSignal<ToolMcpGatewayClientSnippet["client"] | null>(null);
  const active = () => list().find((snippet) => snippet.client === client()) ?? list()[0] ?? null;
  // Only tokens issued on this page that still work can fill a snippet.
  const usable = createMemo(() =>
    props.issued.filter((token) => {
      const status = tokenStatus(props.gateway.tokens.find((entry) => entry.id === token.id) ?? token);
      return status === "active" || status === "expiring";
    }),
  );
  const [tokenId, setTokenId] = createSignal<string | null>(null);
  const token = () => usable().find((entry) => entry.id === tokenId()) ?? usable()[0] ?? null;
  const fill = (secret: string) => ({ endpointPath: props.gateway.endpointPath, endpoint: props.endpoint, token: secret });
  const issue = createMutation(() => ({
    mutationFn: () => {
      const name = defaultTokenName(props.gateway);
      return toolAccessApi.createGatewayToken(company().id, props.gateway.id, {
        name,
        clientLabel: name,
        ownerNote: "",
        allowedActions: [...ACTIONS],
        expiresAt: expiryFromDate(defaultExpiry()),
      });
    },
    onSuccess: (created) => {
      props.onIssued(created);
      setTokenId(created.id);
      pushToast({ title: "Token issued", body: "The snippets now include its full Authorization header.", tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't issue a token", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Client snippets"
      description="Pick a client and copy a complete configuration. It reaches only the tools this gateway exposes, not the rest of Paperclip."
      width={720}
    >
      <div class="tl-stack">
        <div class="ap-inline">
          <span class="field-label">Token</span>
          <Show
            when={usable().length > 0}
            fallback={
              <Button size="compact" disabled={issue.isPending} onClick={() => issue.mutate()}>
                {issue.isPending ? "Issuing…" : "Issue a token"}
              </Button>
            }
          >
            <select class="tl-select" aria-label="Token" value={token()?.id ?? ""} onChange={(event) => setTokenId(event.currentTarget.value)}>
              <For each={usable()}>
                {(entry) => (
                  <option value={entry.id} selected={entry.id === token()?.id}>
                    {entry.name} · {maskedToken(entry)}
                  </option>
                )}
              </For>
            </select>
            <Button size="compact" variant="quiet" disabled={issue.isPending} onClick={() => issue.mutate()}>
              Issue another
            </Button>
            <Button size="compact" variant="quiet" onClick={() => void copyToClipboard(`Authorization: Bearer ${token()!.token}`, "Authorization header")}>
              Copy header
            </Button>
          </Show>
        </div>
        <Show when={!token()}>
          <p class="cx-note">A snippet needs the full token, and a token's secret can't be read back later, so issue one here to fill them in.</p>
        </Show>
        <Show when={list().length > 0} fallback={<p class="cx-note">This server sent no client snippets. Use the address and a token directly.</p>}>
          <div class="ap-chips" role="group" aria-label="Client">
            <For each={list()}>
              {(snippet) => (
                <button type="button" class="ap-chip" aria-pressed={active()?.client === snippet.client} onClick={() => setClient(snippet.client)}>
                  {snippet.label}
                </button>
              )}
            </For>
          </div>
          <Show when={active()}>
            {(snippet) => (
              <>
                <Show
                  when={token()}
                  fallback={<pre class="tl-pre mono">{filledSnippet(snippet().config, fill("pcgw_•••"))}</pre>}
                >
                  {(chosen) => <CopyBlock value={filledSnippet(snippet().config, fill(chosen().token))} label={`${snippet().label} config`} />}
                </Show>
                <For each={snippet().notes}>{(note) => <p class="cx-note">{note}</p>}</For>
              </>
            )}
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

function Advanced(props: { gateway: ToolMcpGatewayWithTokens; endpoint: string }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshGateways();
  const [confirming, setConfirming] = createSignal(false);
  const [confirmName, setConfirmName] = createSignal("");
  const raw = () =>
    JSON.stringify(
      {
        gatewayPublicId: props.gateway.gatewayPublicId,
        displaySlug: props.gateway.displaySlug,
        status: props.gateway.status,
        profileId: props.gateway.profileId,
        defaultProfileMode: props.gateway.defaultProfileMode,
        contextScopeType: props.gateway.contextScopeType,
        contextScopeId: props.gateway.contextScopeId,
        endpointPath: props.gateway.endpointPath,
        authConfig: props.gateway.authConfig,
        headerPolicy: props.gateway.headerPolicy,
        metadataPolicy: props.gateway.metadataPolicy,
        onDemandToolsConfig: props.gateway.onDemandToolsConfig,
      },
      null,
      2,
    );
  const archive = createMutation(() => ({
    mutationFn: () => toolAccessApi.updateGateway(company().id, props.gateway.id, { status: "archived" }),
    onSuccess: () => {
      pushToast({ title: "Gateway archived", body: `${props.gateway.name} can't be reached any more.`, tone: "success" });
      navigate(`/${company().issuePrefix}/apps/gateways`);
    },
    onError: (error) => pushToast({ title: "Couldn't archive the gateway", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  return (
    <>
      <SettingsCard title="Transport">
        <div class="ap-card-body tl-stack">
          <Facts
            rows={[
              ["Transport", "streamable_http"],
              ["Authentication", "bearer"],
              ["Protocol version", "2025-03-26"],
              ["Public ID", <span class="mono">{props.gateway.gatewayPublicId}</span>],
            ]}
          />
          <CopyBlock value={props.endpoint} label="endpoint address" />
        </div>
      </SettingsCard>
      <SettingsCard title="Raw configuration">
        <div class="ap-card-body">
          <CopyBlock value={raw()} label="gateway configuration" />
        </div>
      </SettingsCard>
      <section class="card ap-card ap-danger" aria-labelledby="gw-archive">
        <header class="chead">
          <h3 id="gw-archive" class="disp">
            Archive this gateway
          </h3>
          <p>Takes it offline for every client; its tokens stop working. Type the gateway's name to confirm.</p>
        </header>
        <div class="ap-card-body">
          <Show
            when={confirming()}
            fallback={
              <Button size="compact" variant="danger" onClick={() => setConfirming(true)}>
                Archive gateway
              </Button>
            }
          >
            <div class="ap-inline">
              <TextInput aria-label="The gateway's name" placeholder={props.gateway.name} value={confirmName()} onInput={(event) => setConfirmName(event.currentTarget.value)} />
              <Button size="compact" variant="danger" disabled={confirmName().trim() !== props.gateway.name || archive.isPending} onClick={() => archive.mutate()}>
                {archive.isPending ? "Archiving…" : "Archive"}
              </Button>
              <Button
                size="compact"
                variant="quiet"
                onClick={() => {
                  setConfirming(false);
                  setConfirmName("");
                }}
              >
                Cancel
              </Button>
            </div>
          </Show>
        </div>
      </section>
    </>
  );
}
