import type { ConnectionMethodDef, ToolCatalogEntry, ToolConnection } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { RefreshCw } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { toolsApi } from "@/api/tools";
import { dateTime, shortDate } from "@/agents/shared";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { usePeopleQuery } from "@/lib/company-data";
import { Button, buttonClass } from "@/ui/Button";
import { SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { PageHeader, Tabs } from "@/ui/PageHeader";
import { Segmented } from "@/ui/Segmented";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import {
  accessFrom,
  accessSelection,
  accessWithInstalls,
  actionPermission,
  appProfile,
  askFirstIds,
  connectionRows,
  connectionSlug,
  DETAIL_TABS,
  displayName,
  enabledIds,
  hostedAt,
  installState,
  installTargets,
  riskLabel,
  splitCatalog,
  toolMethods,
  withPermission,
  type AccessDraft,
  type ActionPermission,
  type DetailTab,
} from "./apps-model";
import { ReviewQueue } from "./Review";
import { ConnectionExtras } from "./identities/Identities";
import { AgentAccessPicker, AppLogo, failureText, StateTag, useApplications, useGallery, usePendingRequests, useRefreshTools } from "./shared";

/*
 * One connection (`/apps/:connectionId/:tab`, the old UI's AppDetail):
 *
 * - Permissions: which agents may use it, and each action Off, Ask first or Allowed. Every save
 *   restates the whole set (`POST tools/apps/:id/finish`), as the old UI does: the server replaces
 *   the app profile's actions, bindings and ask-first policies together. Agents that carry the tools
 *   on every run (installs) stay allowed. An AI account's agents are its installs.
 * - Review: its Ask-first calls waiting for your OK, and new actions the server held back until
 *   someone reviews them.
 * - Settings: its name, pausing it, a health check, its details, and disconnecting it (which revokes
 *   its credentials).
 *
 * A connection that needs attention offers to sign in again or replace its key. The OAuth return
 * (`?success=1`, `?oauth=failed`) lands here, as the server sends it.
 *
 * Who it acts as (personal, per-agent and organization identities, audiences, delegations) and an
 * aggregator's accounts sit above Permissions (src/apps/identities/, src/apps/setups/).
 *
 * Not here yet: agent-specific tool profiles, the test-an-action dialog, connection
 * activity (in the company's activity), and app-specific panels (Browser Use, Railway, Honcho,
 * email inboxes, aggregators).
 */

export function AppDetail(props: { connectionId: string; tab: DetailTab; success: boolean; oauth: string | null }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshTools();
  const base = () => `/${company().issuePrefix}/apps`;
  const id = () => props.connectionId;

  const connectionQuery = createQuery(() => ({
    queryKey: queryKeys.tools.connection(company().id, id()),
    queryFn: ({ signal }) => toolsApi.connection(id(), signal),
    retry: false,
  }));
  const grants = createQuery(() => ({
    queryKey: queryKeys.tools.connectionPart(company().id, id(), "grants"),
    queryFn: ({ signal }) => toolsApi.grants(id(), signal),
    retry: false,
  }));
  const applications = useApplications();
  const gallery = useGallery();
  const pending = usePendingRequests();

  const row = createMemo(() => {
    const connection = connectionQuery.data;
    if (!connection) return null;
    return connectionRows([connection], applications.data?.applications ?? [], gallery.data?.apps ?? [])[0] ?? null;
  });
  const canConfigure = () => grants.data?.capabilities.canConfigure === true;
  const pendingHere = () => (pending.data?.actionRequests ?? []).filter((item) => item.connectionId === id()).length;

  // Back from a provider's sign-in: say so once, then drop the marker from the address.
  createEffect(
    on(
      () => [props.success, row()?.name] as const,
      ([success, name]) => {
        if (!success || !name) return;
        pushToast({ title: `${name} connected`, body: "Review its actions and who can use it.", tone: "success" });
        void refresh();
        navigate(`${base()}/${id()}/${props.tab}`, { replace: true });
      },
    ),
  );

  return (
    <Switch>
      <Match when={connectionQuery.isPending}>
        <p class="ap-empty card" role="status">
          Loading the connection…
        </p>
      </Match>
      <Match when={connectionQuery.isError || !row()}>
        <section class="card ap-later">
          <h2 class="disp">Connection not found</h2>
          <p>
            It may have been disconnected. <A href={base()}>Back to Apps</A>
          </p>
        </section>
      </Match>
      <Match when={row()}>
        {(current) => {
          const connection = () => current().connection;
          const isAi = () => connection().connectionPurpose === "ai";
          return (
            <>
              <PageHeader
                size="compact"
                mark={<AppLogo app={current().app} name={current().name} size={40} />}
                crumbs={
                  <>
                    <A href={base()}>Apps</A>
                    <span aria-hidden="true">/</span>
                    <span>{current().app?.name ?? "Custom app"}</span>
                  </>
                }
                title={current().name}
                numbers={
                  <>
                    <StateTag state={current().state} />
                    <Show when={hostedAt(connection()) && !current().app}>
                      <span>hosted at {hostedAt(connection())}</span>
                    </Show>
                    <Show when={connection().lastUsedAt}>{(at) => <span>Last used {shortDate(at())}</span>}</Show>
                  </>
                }
                tabs={
                  <Tabs
                    label="Connection"
                    items={DETAIL_TABS.map((tab) => ({
                      label:
                        tab.key === "review" && pendingHere() > 0 ? (
                          <>
                            Review <span class="ap-count">{pendingHere()}</span>
                          </>
                        ) : (
                          tab.label
                        ),
                      href: `${base()}/${id()}/${tab.key}`,
                    }))}
                  />
                }
              />

              <Show when={props.oauth === "failed" || props.oauth === "denied"}>
                <p class="card cx-note cx-note--warn ap-flash" role="alert">
                  {props.oauth === "denied" ? "Sign-in was cancelled." : "Sign-in didn't finish."} The connection wasn't changed; you can try again below.
                </p>
              </Show>
              <Show when={current().state.kind === "attention" || current().state.kind === "draft"}>
                <ReconnectCard connection={connection()} methods={current().app ? toolMethods(current().app!) : []} canConfigure={canConfigure()} />
              </Show>

              <Switch>
                <Match when={props.tab === "permissions"}>
                  <Show when={isAi()}>
                    <p class="card cx-note ap-flash">
                      An AI account. Its sign-in, default and usage are in <A href={`${base()}/ai`}>AI connections</A>.
                    </p>
                  </Show>
                  <ConnectionExtras connection={connection()} canConfigure={canConfigure()} />
                  <Permissions connection={connection()} canConfigure={canConfigure()} editable={grants.data?.capabilities.editableAgentIds} />
                </Match>
                <Match when={props.tab === "review"}>
                  <section class="card ap-card" aria-labelledby="ap-detail-review">
                    <header class="chead">
                      <h3 id="ap-detail-review" class="disp">
                        Waiting for your OK
                      </h3>
                      <p>Calls to {current().name} that ask you first.</p>
                    </header>
                    <ReviewQueue connectionId={id()} />
                  </section>
                  <Show when={!isAi()}>
                    <NewActions connection={connection()} canConfigure={canConfigure()} />
                  </Show>
                </Match>
                <Match when={props.tab === "settings"}>
                  <ConnectionSettings connection={connection()} name={current().name} canConfigure={canConfigure()} />
                </Match>
              </Switch>
            </>
          );
        }}
      </Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------
// Permissions

/** The app profile, policies, catalog and installs one connection's Permissions and Review read. */
function useConnectionAccess(connection: () => ToolConnection) {
  const company = useCompany();
  const refresh = useRefreshTools();
  const id = () => connection().id;
  const isAi = () => connection().connectionPurpose === "ai";
  const catalog = createQuery(() => ({
    queryKey: queryKeys.tools.connectionPart(company().id, id(), "catalog"),
    queryFn: ({ signal }) => toolsApi.catalog(id(), signal),
    enabled: !isAi(),
  }));
  const profiles = createQuery(() => ({
    queryKey: queryKeys.tools.profiles(company().id),
    queryFn: ({ signal }) => toolsApi.profiles(company().id, signal),
  }));
  const policies = createQuery(() => ({
    queryKey: queryKeys.tools.policies(company().id),
    queryFn: ({ signal }) => toolsApi.policies(company().id, signal),
  }));
  const installs = createQuery(() => ({
    queryKey: queryKeys.tools.connectionPart(company().id, id(), "installs"),
    queryFn: ({ signal }) => toolsApi.installs(id(), signal),
  }));
  const profile = () => appProfile(profiles.data?.profiles ?? [], id());
  const enabled = createMemo(() => enabledIds(profile()));
  const askFirst = createMemo(() => askFirstIds(policies.data?.policies ?? [], id()));
  const install = createMemo(() => installState(installs.data?.installs ?? connection().installs));
  const access = createMemo(() => (isAi() ? accessFrom(undefined, install()) : accessFrom(profile(), install())));
  const split = createMemo(() => splitCatalog(catalog.data?.catalog ?? []));
  const loading = () => profiles.isPending || policies.isPending || installs.isPending || (!isAi() && catalog.isPending);
  const failed = () => profiles.isError || policies.isError || installs.isError || (!isAi() && catalog.isError);

  /** Saves the whole set: actions, ask-first, who may use it (and which new actions were reviewed). */
  const save = createMutation(() => ({
    mutationFn: async (next: { enabled?: Set<string>; askFirst?: Set<string>; access?: AccessDraft; reviewed?: Set<string> }): Promise<unknown> => {
      const accessNext = next.access ?? access();
      if (isAi()) {
        return toolsApi.putInstalls(id(), installTargets(company().id, { onAll: accessNext.mode === "all", agentIds: accessNext.agentIds }));
      }
      const on = next.enabled ?? enabled();
      const ask = next.askFirst ?? askFirst();
      return toolsApi.finishApp(company().id, id(), {
        enabledCatalogEntryIds: [...on],
        askFirstCatalogEntryIds: [...ask].filter((entry) => on.has(entry)),
        ...(next.reviewed ? { reviewedCatalogEntryIds: [...next.reviewed] } : {}),
        access: accessSelection(accessWithInstalls(accessNext, install())),
      });
    },
    onError: (error) => pushToast({ title: "Couldn't save that", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const retry = () => {
    void catalog.refetch();
    void profiles.refetch();
    void policies.refetch();
    void installs.refetch();
  };
  return { catalog, split, enabled, askFirst, install, access, loading, failed, save, retry, isAi };
}

function Permissions(props: { connection: ToolConnection; canConfigure: boolean; editable?: string[] }) {
  const state = useConnectionAccess(() => props.connection);
  return (
    <Switch>
      <Match when={state.failed()}>
        <div class="ap-empty card" role="alert">
          <p>Couldn't load this connection's tools.</p>
          <Button size="compact" onClick={state.retry}>
            Try again
          </Button>
        </div>
      </Match>
      <Match when={state.loading()}>
        <p class="ap-empty card" role="status">
          Loading tools…
        </p>
      </Match>
      <Match when={true}>
        <AccessCard state={state} canConfigure={props.canConfigure} editable={props.editable} />
        <Show when={!state.isAi()}>
          <ActionsCard connection={props.connection} state={state} canConfigure={props.canConfigure} />
        </Show>
      </Match>
    </Switch>
  );
}

type AccessState = ReturnType<typeof useConnectionAccess>;

function AccessCard(props: { state: AccessState; canConfigure: boolean; editable?: string[] }) {
  const [draft, setDraft] = createSignal<AccessDraft>(props.state.access());
  createEffect(on(props.state.access, (next) => setDraft(next), { defer: true }));
  const dirty = () => {
    const a = draft();
    const b = props.state.access();
    return a.mode !== b.mode || (a.mode === "specific" && (a.agentIds.size !== b.agentIds.size || [...a.agentIds].some((agent) => !b.agentIds.has(agent))));
  };
  const installed = () => props.state.install();
  return (
    <SettingsCard
      title="Which agents can use it"
      description={
        props.state.isAi()
          ? "The agents that run on this account."
          : installed().onAll
            ? "Every agent carries its tools on every run, so every agent may use it."
            : installed().agentIds.size > 0
              ? "Agents marked Installed carry its tools on every run, so they stay allowed."
              : "Allowed agents can use its tools when they ask for them."
      }
      footer={
        !props.canConfigure ? (
          <span class="cx-note">Only a connection manager can change who uses it.</span>
        ) : dirty() || props.state.save.isPending ? (
          <span class="ap-actions-end">
            <Show when={props.state.save.isPending}>
              <span class="cx-note">Saving…</span>
            </Show>
            <Show when={dirty()}>
              <Button size="compact" variant="quiet" disabled={props.state.save.isPending} onClick={() => setDraft(props.state.access())}>
                Discard
              </Button>
              <Button size="compact" variant="primary" disabled={props.state.save.isPending} onClick={() => props.state.save.mutate({ access: draft() })}>
                Save
              </Button>
            </Show>
          </span>
        ) : undefined
      }
    >
      <div class="ap-card-body">
        <AgentAccessPicker
          value={draft()}
          onChange={setDraft}
          disabled={!props.canConfigure || props.state.save.isPending}
          locked={props.state.isAi() ? undefined : installed().agentIds}
          editable={props.editable}
        />
      </div>
    </SettingsCard>
  );
}

const PERMISSION_OPTIONS: { value: ActionPermission; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "ask", label: "Ask first" },
  { value: "allowed", label: "Allowed" },
];

function ActionsCard(props: { connection: ToolConnection; state: AccessState; canConfigure: boolean }) {
  const company = useCompany();
  const refresh = useRefreshTools();
  const [query, setQuery] = createSignal("");
  const refreshCatalog = createMutation(() => ({
    mutationFn: () => toolsApi.refreshCatalog(props.connection.id),
    onSuccess: (result) =>
      pushToast({
        title: `Found ${result.discoveredCount} ${result.discoveredCount === 1 ? "action" : "actions"}`,
        body: result.quarantinedCount > 0 ? `${result.quarantinedCount} new ${result.quarantinedCount === 1 ? "action needs" : "actions need"} your review.` : undefined,
        tone: "success",
      }),
    onError: (error) => pushToast({ title: "Couldn't refresh actions", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const matches = (entry: ToolCatalogEntry) => {
    const q = query().trim().toLowerCase();
    return !q || [entry.toolName, entry.title ?? "", entry.description ?? ""].join(" ").toLowerCase().includes(q);
  };
  const set = (ids: string[], next: ActionPermission) =>
    props.state.save.mutate(withPermission(ids, next, props.state.enabled(), props.state.askFirst()));
  const quarantined = () => props.state.split().quarantined.length;

  return (
    <section class="card ap-card" aria-labelledby="ap-actions">
      <header class="chead ap-chead">
        <div>
          <h3 id="ap-actions" class="disp">
            Actions
          </h3>
          <p>What agents may do with it. Ask first sends each call to Review before it runs.</p>
        </div>
        <Show when={props.canConfigure}>
          <Button size="compact" disabled={refreshCatalog.isPending} icon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => refreshCatalog.mutate()}>
            {refreshCatalog.isPending ? "Checking…" : "Check for new actions"}
          </Button>
        </Show>
      </header>
      <Show when={quarantined() > 0}>
        <A class="ap-banner ap-banner--inline" href={`/${company().issuePrefix}/apps/${props.connection.id}/review`}>
          {quarantined()} new {quarantined() === 1 ? "action is" : "actions are"} off until someone reviews {quarantined() === 1 ? "it" : "them"}.
        </A>
      </Show>
      <Show when={props.state.split().active.length > 12}>
        <div class="ap-filters">
          <TextInput type="search" placeholder="Find an action" aria-label="Find an action" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
        </div>
      </Show>
      <Show when={props.state.split().active.length > 0} fallback={<p class="ap-empty">No actions found yet. Check for new actions once the connection works.</p>}>
        <ActionGroup title="Reads" entries={props.state.split().readOnly.filter(matches)} state={props.state} canConfigure={props.canConfigure} onSet={set} />
        <ActionGroup title="Makes changes" entries={props.state.split().changes.filter(matches)} state={props.state} canConfigure={props.canConfigure} onSet={set} />
      </Show>
    </section>
  );
}

function ActionGroup(props: {
  title: string;
  entries: ToolCatalogEntry[];
  state: AccessState;
  canConfigure: boolean;
  onSet: (ids: string[], next: ActionPermission) => void;
}) {
  const busy = () => !props.canConfigure || props.state.save.isPending;
  return (
    <Show when={props.entries.length > 0}>
      <div class="ap-group">
        <div class="ap-group-head">
          <h4 class="ap-group-title">
            {props.title} <span>{props.entries.length}</span>
          </h4>
          <Show when={props.canConfigure && props.entries.length > 1}>
            <label class="ap-setall">
              <span>Set all</span>
              <select
                class="input"
                disabled={busy()}
                value=""
                onChange={(event) => {
                  const value = event.currentTarget.value as ActionPermission;
                  event.currentTarget.value = "";
                  if (value) props.onSet(props.entries.map((entry) => entry.id), value);
                }}
              >
                <option value="">…</option>
                <For each={PERMISSION_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
              </select>
            </label>
          </Show>
        </div>
        <ul class="ap-rows">
          <For each={props.entries}>
            {(entry) => {
              const value = () => actionPermission(entry.id, props.state.enabled(), props.state.askFirst());
              return (
                <li class="ap-action">
                  <div class="ap-row-main">
                    <span class="ap-row-name">{displayName(entry.toolName, entry.title)}</span>
                    <span class="ap-row-meta">
                      <span class="mono">{entry.toolName}</span> · {riskLabel(entry)}
                    </span>
                    <Show when={entry.description}>
                      <span class="ap-action-desc">{entry.description}</span>
                    </Show>
                  </div>
                  <Show when={props.canConfigure} fallback={<span class="ap-row-meta">{PERMISSION_OPTIONS.find((option) => option.value === value())?.label}</span>}>
                    <Segmented
                      label={`${displayName(entry.toolName, entry.title)} permission`}
                      options={PERMISSION_OPTIONS}
                      value={value()}
                      onChange={(next) => {
                        if (!busy() && next !== value()) props.onSet([entry.id], next);
                      }}
                    />
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}

/** New actions the server held back (quarantined) until someone turns them on or leaves them off. */
function NewActions(props: { connection: ToolConnection; canConfigure: boolean }) {
  const state = useConnectionAccess(() => props.connection);
  const [chosen, setChosen] = createStore<Record<string, boolean>>({});
  const entries = () => state.split().quarantined;
  const review = () => {
    const held = new Set(entries().map((entry) => entry.id));
    const enabled = new Set([...state.enabled()].filter((entry) => !held.has(entry)));
    for (const entry of entries()) if (chosen[entry.id]) enabled.add(entry.id);
    state.save.mutate({ enabled, reviewed: held });
  };
  return (
    <Show when={!state.loading() && entries().length > 0}>
      <section class="card ap-card" aria-labelledby="ap-new-actions">
        <header class="chead">
          <h3 id="ap-new-actions" class="disp">
            New actions
          </h3>
          <p>The app added these since it was set up. They stay off until you review them.</p>
        </header>
        <ul class="ap-rows">
          <For each={entries()}>
            {(entry) => (
              <li class="ap-action">
                <label class="ap-check">
                  <input type="checkbox" disabled={!props.canConfigure} checked={chosen[entry.id] ?? false} onChange={(event) => setChosen(entry.id, event.currentTarget.checked)} />
                  <span class="ap-row-main">
                    <span class="ap-row-name">{displayName(entry.toolName, entry.title)}</span>
                    <span class="ap-row-meta">
                      <span class="mono">{entry.toolName}</span> · {riskLabel(entry)}
                      {entry.quarantineReason ? ` · ${entry.quarantineReason}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.canConfigure}>
          <footer class="cfoot">
            <span class="ap-actions-end">
              <Button size="compact" variant="primary" disabled={state.save.isPending} onClick={review}>
                Turn on the ticked ones, leave the rest off
              </Button>
            </span>
          </footer>
        </Show>
      </section>
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// Reconnect and settings

/** Restores a connection that needs attention: sign in again, replace its key, or finish setup. */
function ReconnectCard(props: { connection: ToolConnection; methods: ConnectionMethodDef[]; canConfigure: boolean }) {
  const company = useCompany();
  const refresh = useRefreshTools();
  const slug = () => connectionSlug(props.connection);
  const method = () => {
    const key = props.connection.config?.connectionMethodKey;
    return props.methods.find((candidate) => candidate.key === key) ?? props.methods.find((candidate) => candidate.auth === props.connection.authKind) ?? null;
  };
  const fields = () => method()?.credentialFields ?? [];
  const [values, setValues] = createStore<Record<string, string>>({});
  const signIn = createMutation(() => ({
    mutationFn: async () => {
      const start = await toolsApi.startOAuth(props.connection.id, { asCurrentUser: props.connection.credentialPolicy === "per_user" });
      if (start.handoff) throw new Error("This app signs in through Paperclip Cloud, which this board can't hand off to yet.");
      window.location.assign(start.authorizationUrl);
    },
    onError: (error) => pushToast({ title: "Couldn't start sign-in", body: failureText(error, "Please try again."), tone: "error" }),
  }));
  const replaceKey = createMutation(() => ({
    mutationFn: () => toolsApi.reconnect(props.connection.id, { ...values }),
    onSuccess: () => pushToast({ title: "Reconnected", tone: "success" }),
    onError: (error) => pushToast({ title: "Couldn't reconnect", body: failureText(error, "Check the key and try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const isDraft = () => props.connection.status === "draft";
  const missing = () => fields().some((field) => field.required && !values[field.key]?.trim());

  return (
    <section class="card ap-card ap-reconnect" aria-label="Restore the connection">
      <header class="chead">
        <h3 class="disp">{isDraft() ? "Finish setting it up" : "It needs you"}</h3>
        <p>{connectionStateMessage(props.connection)}</p>
      </header>
      <div class="ap-card-body">
        <Switch fallback={<p class="cx-note">Only a connection manager can restore it.</p>}>
          <Match when={!props.canConfigure}>
            <p class="cx-note">Only a connection manager can restore it.</p>
          </Match>
          <Match when={isDraft() && slug()}>
            <A
              class={buttonClass({ variant: "primary", size: "compact" })}
              href={`/${company().issuePrefix}/apps/connect?source=${encodeURIComponent(slug()!)}&resume=${encodeURIComponent(props.connection.id)}`}
            >
              Finish setup
            </A>
          </Match>
          <Match when={props.connection.authKind === "oauth"}>
            <Button size="compact" variant="primary" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
              {signIn.isPending ? "Opening sign-in…" : "Sign in again"}
            </Button>
          </Match>
          <Match when={props.connection.authKind === "api_key" && fields().length > 0}>
            <form
              class="ap-reconnect-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!missing()) replaceKey.mutate();
              }}
            >
              <For each={fields()}>
                {(field) => (
                  <SettingsRow label={field.label} for={`ap-re-${field.key}`}>
                    <TextInput
                      id={`ap-re-${field.key}`}
                      type="password"
                      autocomplete="new-password"
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ""}
                      onInput={(event) => setValues(field.key, event.currentTarget.value)}
                    />
                  </SettingsRow>
                )}
              </For>
              <Button type="submit" size="compact" variant="primary" disabled={missing() || replaceKey.isPending}>
                {replaceKey.isPending ? "Checking…" : "Replace the key"}
              </Button>
            </form>
          </Match>
          <Match when={true}>
            <p class="cx-note">Check its settings, then run a health check from Settings.</p>
          </Match>
        </Switch>
      </div>
    </section>
  );
}

function connectionStateMessage(connection: ToolConnection) {
  if (connection.status === "draft") return "Setup stopped before it finished. Agents can't use it yet.";
  return connection.healthMessage ?? connection.lastError ?? (connection.authKind === "oauth" ? "Sign in again to restore access." : "Replace the key to restore access.");
}

function ConnectionSettings(props: { connection: ToolConnection; name: string; canConfigure: boolean }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshTools();
  const people = usePeopleQuery();
  const [name, setName] = createSignal(props.connection.name);
  createEffect(on(() => props.connection.name, (next) => setName(next), { defer: true }));
  const [confirming, setConfirming] = createSignal(false);
  const isAi = () => props.connection.connectionPurpose === "ai";
  const creator = () => {
    const userId = props.connection.createdByUserId;
    if (!userId) return props.connection.createdByAgentId ? "an agent" : null;
    const person = people.data?.users.find((user) => user.principalId === userId);
    return person?.user?.name ?? person?.user?.email ?? (userId === "local-board" ? "the board" : "a member");
  };

  const update = createMutation(() => ({
    mutationFn: (input: { name?: string; enabled?: boolean }) => toolsApi.updateConnection(props.connection.id, input),
    onSuccess: (_result, input) => pushToast({ title: input.name ? "Renamed" : input.enabled ? "Resumed" : "Paused", tone: "success" }),
    onError: (error) => pushToast({ title: "Couldn't save that", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const health = createMutation(() => ({
    mutationFn: () => toolsApi.healthCheck(props.connection.id),
    onSuccess: (result) =>
      pushToast({
        title: result.connection.healthStatus === "ok" || result.connection.healthStatus === "healthy" ? "It works" : "It needs attention",
        body: result.connection.healthMessage ?? undefined,
        tone: result.connection.healthStatus === "ok" || result.connection.healthStatus === "healthy" ? "success" : "error",
      }),
    onError: (error) => pushToast({ title: "The check failed", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const archive = createMutation(() => ({
    mutationFn: () => toolsApi.archiveConnection(props.connection.id),
    onSuccess: () => {
      pushToast({ title: `Disconnected ${props.name}`, body: "Its credentials were revoked.", tone: "success" });
      navigate(`/${company().issuePrefix}/apps`);
    },
    onError: (error) => pushToast({ title: "Couldn't disconnect", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const paused = () => props.connection.enabled === false || props.connection.status === "disabled";
  const nameDirty = () => name().trim() !== props.connection.name && name().trim().length > 0;

  return (
    <>
      <SettingsCard title="Connection">
        <SettingsRow label="Name" help="How it shows in Paperclip." for="ap-set-name">
          <div class="ap-inline">
            <TextInput id="ap-set-name" value={name()} maxLength={160} disabled={!props.canConfigure} onInput={(event) => setName(event.currentTarget.value)} />
            <Show when={nameDirty()}>
              <Button size="compact" variant="primary" disabled={update.isPending} onClick={() => update.mutate({ name: name().trim() })}>
                Save
              </Button>
            </Show>
          </div>
        </SettingsRow>
        <Show when={!isAi() && props.connection.status !== "draft"}>
          <SettingsRow label="Paused" help="A paused connection keeps its settings, but agents can't use it.">
            <Toggle
              checked={paused()}
              disabled={!props.canConfigure || update.isPending}
              onChange={(on) => update.mutate({ enabled: !on })}
              label="Paused"
              labelHidden
            />
          </SettingsRow>
        </Show>
        <SettingsRow label="Health" help={props.connection.healthCheckedAt ? `Last checked ${dateTime(props.connection.healthCheckedAt)}.` : "Not checked yet."}>
          <div class="ap-inline">
            <span class="cx-static">{healthLabel(props.connection)}</span>
            <Show when={props.canConfigure && !isAi()}>
              <Button size="compact" disabled={health.isPending} onClick={() => health.mutate()}>
                {health.isPending ? "Checking…" : "Check now"}
              </Button>
            </Show>
          </div>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Details">
        <SettingsRow label="Kind">
          <span class="cx-static">{kindLabel(props.connection)}</span>
        </SettingsRow>
        <Show when={hostedAt(props.connection)}>
          <SettingsRow label="Server">
            <span class="cx-static mono">{hostedAt(props.connection)}</span>
          </SettingsRow>
        </Show>
        <SettingsRow label="Added">
          <span class="cx-static">
            {dateTime(props.connection.createdAt)}
            {creator() ? ` by ${creator()}` : ""}
          </span>
        </SettingsRow>
        <Show when={props.connection.lastCatalogRefreshAt}>
          {(at) => (
            <SettingsRow label="Actions checked">
              <span class="cx-static">{dateTime(at())}</span>
            </SettingsRow>
          )}
        </Show>
      </SettingsCard>

      <Show
        when={!isAi()}
        fallback={
          <p class="card cx-note ap-flash">
            To remove an AI account, use <A href={`/${company().issuePrefix}/apps/ai`}>AI connections</A>.
          </p>
        }
      >
        <section class="card ap-card ap-danger" aria-labelledby="ap-danger">
          <header class="chead ap-chead">
            <div>
              <h3 id="ap-danger" class="disp">
                Disconnect
              </h3>
              <p>Removes the connection and revokes its credentials. Agents lose its tools at once.</p>
            </div>
            <Button size="compact" variant="danger" disabled={!props.canConfigure || archive.isPending} onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          </header>
        </section>
        <ConfirmDialog
          open={confirming()}
          onOpenChange={setConfirming}
          title={`Disconnect ${props.name}?`}
          body="Agents lose its tools at once, and its credentials are revoked. Connecting it again starts over."
          confirmLabel="Disconnect"
          danger
          onConfirm={() => archive.mutateAsync()}
        />
      </Show>
    </>
  );
}

function healthLabel(connection: ToolConnection) {
  switch (connection.healthStatus) {
    case "ok":
    case "healthy":
      return "Working";
    case "degraded":
      return "Degraded";
    case "failed":
    case "error":
      return "Failing";
    case "missing_secret":
      return "Missing its key";
    default:
      return "Unknown";
  }
}

function kindLabel(connection: ToolConnection) {
  const transport =
    connection.transport === "mcp_remote"
      ? "MCP server"
      : connection.transport === "rest_api"
        ? "API"
        : connection.transport === "runtime_auth"
          ? "AI account"
          : connection.transport === "local_stdio"
            ? "Local command"
            : connection.transport === "chat_sdk"
              ? "Chat endpoint"
              : "Voice";
  const auth = connection.authKind === "oauth" ? "signed in with OAuth" : connection.authKind === "api_key" ? "with a key" : "no sign-in";
  return `${transport}, ${auth}`;
}
