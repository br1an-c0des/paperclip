import type { AiConnectionPool, AiConnectionPoolConfig, AiConnectionPoolMember, AiManagedConnectionSummary, AppDefinition, ToolConnection } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { aiConnectionPoolsApi } from "@/api/ai-connection-pools";
import { aiConnectionsApi } from "@/api/ai-connections";
import { queryKeys } from "@/api/queryKeys";
import { methodLabel, providerName, usageLimitValue, usagePercent } from "@/connectors/connection-model";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { PageHeader } from "@/ui/PageHeader";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { connectionState } from "../apps-model";
import { AppLogo, failureText, StateTag, useConnections, useGallery } from "../shared";
import {
  agentsUsingPool,
  configOf,
  emptyConfig,
  memberAccount,
  moveMember,
  pickable,
  poolApp,
  poolApps,
  poolFor,
  poolPluginKey,
  poolProblem,
  toggleMember,
  withProfile,
} from "./pool-model";
import "./Pools.css";

/*
 * AI connection pools (the old UI's AiConnectionPoolConnector). A pool plugin
 * (`enableAiConnectionRouters`) offers a gallery entry with `aiConnectionRouter`; a pool is a
 * connection that hands each new task to one of the AI connections in it, in order, or skipping
 * those near their usage limit. Agents pick a pool like any AI connection.
 *
 * - AI connections lists the pools and offers each pool plugin (PoolsCard).
 * - New pool (`/apps/connect?source=<pool slug>`): choose connections, then their order. It's
 *   created paused.
 * - A pool's page (`/apps/:connectionId/…`): its connections in order, on or off, usage-aware
 *   skipping, each member's model and effort, who uses it, rename and remove.
 *
 * Only a connection manager can see or change pools (`canManageConnections` from the AI connection
 * list); the pool list itself answers 403 otherwise.
 */

function useAccounts() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.aiConnections.list(company().id),
    queryFn: () => aiConnectionsApi.list(company().id),
  }));
}

function usePools(enabled: () => boolean) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.pools(company().id),
    queryFn: ({ signal }) => aiConnectionPoolsApi.list(company().id, signal),
    enabled: enabled(),
  }));
}

function useRefreshPools() {
  const company = useCompany();
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.tools.all(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.aiConnections.list(company().id) }),
    ]);
}

// ---------------------------------------------------------------------------------------------
// AI connections → Connection pools

/** The pools on AI connections, and a way to add one per pool plugin. Hidden when there are neither. */
export function PoolsCard() {
  const company = useCompany();
  const gallery = useGallery();
  const connections = useConnections();
  const base = () => `/${company().issuePrefix}/apps`;
  const plugins = createMemo(() => poolApps(gallery.data?.apps ?? []));
  const pools = createMemo(() =>
    (connections.data?.connections ?? []).filter((connection) => connection.status !== "archived" && poolPluginKey(connection)),
  );
  return (
    <Show when={plugins().length > 0 || pools().length > 0}>
      <section class="card cx-card" aria-labelledby="pl-card-title">
        <header class="chead ap-chead">
          <div>
            <h3 id="pl-card-title" class="disp">
              Connection pools
            </h3>
            <p>Hand each new task to the next of several AI connections, so one account's limits don't stop the work.</p>
          </div>
          <div class="pl-adds">
            <For each={plugins()}>
              {(app) => (
                <Show
                  when={app.availability?.available !== false}
                  fallback={<span class="cx-static" title={app.availability?.reason}>{app.name}: {app.availability?.reason ?? "unavailable"}</span>}
                >
                  <A class={buttonClass({ size: "compact" })} href={`${base()}/connect?source=${encodeURIComponent(app.slug)}`}>
                    <Plus size={14} aria-hidden="true" /> {plugins().length > 1 ? app.name : "Add a pool"}
                  </A>
                </Show>
              )}
            </For>
          </div>
        </header>
        <Show when={pools().length > 0} fallback={<p class="cx-empty">No pools yet.</p>}>
          <ul class="cx-rows">
            <For each={pools()}>
              {(connection) => (
                <li class="cx-row">
                  <div class="cx-row-main">
                    <A class="cx-row-name" href={`${base()}/${connection.id}/permissions`}>
                      {connection.name}
                    </A>
                    <p class="cx-row-meta">{poolApp(gallery.data?.apps ?? [], poolPluginKey(connection)!).name}</p>
                  </div>
                  <div class="cx-row-side">
                    <StateTag state={connectionState(connection)} />
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// New pool

export function NewPool(props: { app: AppDefinition }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshPools();
  const accounts = useAccounts();
  const [step, setStep] = createSignal<0 | 1>(0);
  const [draft, setDraft] = createSignal<AiConnectionPoolConfig>(emptyConfig(props.app.name));
  const base = () => `/${company().issuePrefix}/apps`;
  const pluginKey = () => props.app.aiConnectionRouter!.pluginKey;
  const unavailable = () => props.app.availability?.available === false;
  const canManage = () => accounts.data?.canManageConnections === true;

  const create = createMutation(() => ({
    mutationFn: () => aiConnectionPoolsApi.save(company().id, { pluginKey: pluginKey(), config: draft() }),
    onSuccess: (saved) => {
      void refresh();
      pushToast({ title: "Connection pool created", body: "It's paused until you turn it on.", tone: "success" });
      navigate(`${base()}/${saved.id}/permissions`);
    },
    onError: (error) => pushToast({ title: "Couldn't create the pool", body: failureText(error, "Please try again."), tone: "error" }),
  }));

  return (
    <section class="card ap-connect pl-new" aria-labelledby="pl-new-title">
      <header class="ap-connect-head">
        <AppLogo app={props.app} name={props.app.name} size={44} />
        <div>
          <h2 id="pl-new-title" class="disp ap-connect-title">
            Add a connection pool
          </h2>
          <p>{step() === 0 ? "Step 1 of 2: choose connections you already use." : "Step 2 of 2: new tasks go to them in this order."}</p>
        </div>
      </header>
      <Switch>
        <Match when={accounts.isPending}>
          <p class="cx-static" role="status">
            Loading connections…
          </p>
        </Match>
        <Match when={accounts.isError}>
          <p class="cx-note cx-note--error" role="alert">
            Couldn't load AI connections: {failureText(accounts.error, "please try again.")}
          </p>
        </Match>
        <Match when={!canManage()}>
          <p class="cx-note" role="alert">
            Only a connection manager can create connection pools.
          </p>
        </Match>
        <Match when={true}>
          <Show when={unavailable()}>
            <p class="cx-note cx-note--error" role="alert">
              {props.app.availability?.reason ?? "Turn on the connection pool plugin in Plugins."}
            </p>
          </Show>
          <Show
            when={step() === 1}
            fallback={
              <MemberPicker
                accounts={accounts.data?.connections ?? []}
                members={draft().members}
                disabled={unavailable() || create.isPending}
                onChange={(members) => setDraft({ ...draft(), members })}
                onRefresh={() => void accounts.refetch()}
              />
            }
          >
            <SettingsRow label="Name" for="pl-new-name">
              <TextInput id="pl-new-name" value={draft().name} onInput={(event) => setDraft({ ...draft(), name: event.currentTarget.value })} />
            </SettingsRow>
            <MemberOrder
              members={draft().members}
              accounts={accounts.data?.connections ?? []}
              disabled={create.isPending}
              onChange={(members) => setDraft({ ...draft(), members })}
            />
            <p class="cx-static">Created paused. Turn it on from its page when you're ready.</p>
          </Show>
        </Match>
      </Switch>
      <footer class="pl-foot">
        <Button variant="quiet" disabled={create.isPending} onClick={() => (step() === 1 ? setStep(0) : navigate(`${base()}/ai`))}>
          {step() === 1 ? "Back" : "Cancel"}
        </Button>
        <Button
          variant="primary"
          disabled={!canManage() || unavailable() || create.isPending || draft().members.length === 0 || (step() === 1 && poolProblem(draft()) !== null)}
          title={step() === 1 ? (poolProblem(draft()) ?? undefined) : undefined}
          onClick={() => (step() === 0 ? setStep(1) : create.mutate())}
        >
          {create.isPending ? "Creating…" : step() === 0 ? "Continue" : "Create pool"}
        </Button>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// A pool's page

export function PoolPage(props: { connection: ToolConnection }) {
  const company = useCompany();
  const navigate = useNavigate();
  const refresh = useRefreshPools();
  const gallery = useGallery();
  const accounts = useAccounts();
  const canManage = () => accounts.data?.canManageConnections === true;
  const pools = usePools(canManage);
  const agents = useAgentsQuery();
  const base = () => `/${company().issuePrefix}/apps`;
  const pluginKey = () => poolPluginKey(props.connection)!;
  const app = createMemo(() => poolApp(gallery.data?.apps ?? [], pluginKey()));
  const pool = createMemo(() => poolFor(pools.data, props.connection.id, pluginKey()));

  return (
    <>
      <PageHeader
        size="compact"
        mark={<AppLogo app={app()} name={props.connection.name} size={40} />}
        crumbs={
          <>
            <A href={base()}>Apps</A>
            <span aria-hidden="true">/</span>
            <A href={`${base()}/ai`}>AI connections</A>
          </>
        }
        title={pool()?.name ?? props.connection.name}
        numbers={<StateTag state={pool() ? (pool()!.enabled ? { kind: "connected", label: "On", tone: "green", message: null } : { kind: "paused", label: "Paused", tone: null, message: null }) : connectionState(props.connection)} />}
      />
      <Switch>
        <Match when={accounts.isPending || (canManage() && pools.isPending)}>
          <p class="ap-empty card" role="status">
            Loading the pool…
          </p>
        </Match>
        <Match when={accounts.isError || pools.isError}>
          <div class="ap-empty card" role="alert">
            <p>Couldn't load the pool: {failureText(accounts.error ?? pools.error, "please try again.")}</p>
            <Button
              size="compact"
              onClick={() => {
                void accounts.refetch();
                void pools.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        </Match>
        <Match when={!canManage()}>
          <p class="ap-empty card">Only a connection manager can see and change connection pools.</p>
        </Match>
        <Match when={!pool()}>
          <section class="card ap-later">
            <h2 class="disp">This pool is no longer available</h2>
            <p>
              Its plugin may have been removed. <A href={`${base()}/ai`}>Back to AI connections</A>
            </p>
          </section>
        </Match>
        <Match when={pool()} keyed>
          {(current) => (
            <PoolEditor
              pool={current}
              app={app()}
              accounts={accounts.data?.connections ?? []}
              usingAgents={agentsUsingPool(agents.data, props.connection.id)}
              agentsLoading={agents.isPending}
              onRemoved={() => {
                void refresh();
                navigate(`${base()}/ai`);
              }}
            />
          )}
        </Match>
      </Switch>
    </>
  );
}

function PoolEditor(props: {
  pool: AiConnectionPool;
  app: AppDefinition;
  accounts: AiManagedConnectionSummary[];
  usingAgents: ReturnType<typeof agentsUsingPool>;
  agentsLoading: boolean;
  onRemoved: () => void;
}) {
  const company = useCompany();
  const refresh = useRefreshPools();
  const [saved, setSaved] = createSignal(props.pool);
  const [draft, setDraft] = createSignal<AiConnectionPoolConfig>(configOf(props.pool));
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerMembers, setPickerMembers] = createSignal<AiConnectionPoolMember[]>([]);
  const [removing, setRemoving] = createSignal(false);
  const unavailable = () => props.app.availability?.available === false;
  const dirty = () => JSON.stringify(draft()) !== JSON.stringify(configOf(saved()));

  const inspection = createQuery(() => ({
    queryKey: [...queryKeys.tools.pools(company().id), saved().id, "inspection"],
    queryFn: ({ signal }) => aiConnectionPoolsApi.inspect(company().id, saved().id, signal),
    enabled: draft().mode === "usage_aware",
    retry: false,
  }));

  const save = createMutation(() => ({
    mutationFn: (config: AiConnectionPoolConfig) =>
      aiConnectionPoolsApi.save(company().id, {
        pluginKey: saved().pluginKey,
        id: saved().id,
        expectedRevision: saved().revision,
        config,
      }),
    onSuccess: (next) => {
      setSaved(next);
      setDraft(configOf(next));
      void refresh();
      pushToast({ title: "Connection pool saved", tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't save the pool", body: failureText(error, "Please try again."), tone: "error" }),
  }));

  createEffect(on(() => props.pool, (next) => {
    // A newer revision from elsewhere: take it unless there are unsaved edits.
    if (next.revision !== saved().revision && !dirty()) {
      setSaved(next);
      setDraft(configOf(next));
    }
  }, { defer: true }));

  const problem = () => poolProblem(draft());

  return (
    <>
      <Show when={unavailable()}>
        <p class="card cx-note cx-note--error ap-flash" role="alert">
          {props.app.availability?.reason ?? "Turn on the connection pool plugin in Plugins."}
        </p>
      </Show>
      <SettingsCard
        title="Connections"
        description="New tasks go to the next connection in this order. Changes apply to new tasks."
        footer={
          <>
            <Toggle
              checked={draft().enabled}
              disabled={unavailable() || save.isPending}
              onChange={(enabled) => setDraft({ ...draft(), enabled })}
              label="Pool on"
              description="Agents set to this pool run on its connections."
            />
            <span class="ap-actions-end">
              <Button variant="quiet" disabled={!dirty() || save.isPending} onClick={() => setDraft(configOf(saved()))}>
                Discard
              </Button>
              <Button
                variant="primary"
                disabled={!dirty() || unavailable() || save.isPending || problem() !== null}
                title={problem() ?? undefined}
                onClick={() => save.mutate(draft())}
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </span>
          </>
        }
      >
        <SettingsRow label="Name" for="pl-name">
          <TextInput id="pl-name" value={draft().name} disabled={unavailable()} onInput={(event) => setDraft({ ...draft(), name: event.currentTarget.value })} />
        </SettingsRow>
        <div class="pl-order-head">
          <span class="cap">In order</span>
          <Button
            size="compact"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={unavailable() || save.isPending}
            onClick={() => {
              setPickerMembers(draft().members);
              setPickerOpen(true);
            }}
          >
            Add connections
          </Button>
        </div>
        <MemberOrder
          members={draft().members}
          accounts={props.accounts}
          disabled={unavailable() || save.isPending}
          onChange={(members) => setDraft({ ...draft(), members })}
          usage={draft().mode === "usage_aware" ? inspection.data : undefined}
        />
      </SettingsCard>

      <SettingsCard title="Advanced" description="Skip connections near their usage limit, and pick each connection's model.">
        <div class="pl-advanced">
          <Toggle
            checked={draft().mode === "usage_aware"}
            disabled={unavailable() || save.isPending}
            onChange={(on) => setDraft({ ...draft(), mode: on ? "usage_aware" : "round_robin" })}
            label="Skip connections near their usage limit"
            description="Uses each provider's reported usage, where it reports one."
          />
          <Show when={draft().mode === "usage_aware"}>
            <SettingsRow label="Skip at" help="Percent of a usage limit." for="pl-threshold">
              <TextInput
                id="pl-threshold"
                type="number"
                min={1}
                max={100}
                step={1}
                value={String(draft().thresholdPercent)}
                onInput={(event) => setDraft({ ...draft(), thresholdPercent: Number(event.currentTarget.value) })}
              />
            </SettingsRow>
          </Show>
          <For each={draft().members}>
            {(member, index) => (
              <div class="pl-profile">
                <span class="pl-profile-name">{memberAccount(member, props.accounts)?.name ?? "Connection unavailable"}</span>
                <label class="field-stack">
                  <span class="field-label">Model</span>
                  <TextInput
                    aria-label={`Model for connection ${index() + 1}`}
                    value={member.profile.model}
                    disabled={unavailable()}
                    onInput={(event) => setDraft({ ...draft(), members: withProfile(draft().members, member.id, { model: event.currentTarget.value }) })}
                  />
                </label>
                <label class="field-stack">
                  <span class="field-label">Effort (optional)</span>
                  <TextInput
                    aria-label={`Effort for connection ${index() + 1}`}
                    value={member.profile.effort ?? ""}
                    disabled={unavailable()}
                    onInput={(event) => setDraft({ ...draft(), members: withProfile(draft().members, member.id, { effort: event.currentTarget.value }) })}
                  />
                </label>
              </div>
            )}
          </For>
        </div>
      </SettingsCard>

      <section class="card ap-card" aria-labelledby="pl-used-by">
        <header class="chead">
          <h3 id="pl-used-by" class="disp">
            Used by
          </h3>
          <p>Agents whose AI connection is this pool.</p>
        </header>
        <div class="ap-card-body">
          <Show when={!props.agentsLoading} fallback={<p class="cx-static">Loading agents…</p>}>
            <Show when={props.usingAgents.length > 0} fallback={<p class="cx-static">No agents yet. Choose the pool in an agent's Model and runtime settings.</p>}>
              <ul class="pl-agents">
                <For each={props.usingAgents}>
                  {(agent) => (
                    <li>
                      <A href={`/${company().issuePrefix}/agents/${agent.urlKey ?? agent.id}`} class="pl-agent">
                        <AgentAvatar agent={agent} size={24} />
                        {agent.name}
                      </A>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </section>

      <section class="card ap-card ap-danger" aria-labelledby="pl-remove">
        <header class="chead">
          <h3 id="pl-remove" class="disp">
            Remove the pool
          </h3>
          <p>The connections in it are kept. Agents using it need another AI connection.</p>
        </header>
        <div class="ap-card-body">
          <Button variant="danger" size="compact" disabled={save.isPending} onClick={() => setRemoving(true)}>
            Remove pool
          </Button>
        </div>
      </section>

      <Dialog
        open={pickerOpen()}
        onOpenChange={setPickerOpen}
        title="Add connections"
        width={560}
        footer={
          <>
            <Button variant="quiet" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDraft({ ...draft(), members: pickerMembers() });
                setPickerOpen(false);
              }}
            >
              Done
            </Button>
          </>
        }
      >
        <MemberPicker accounts={props.accounts} members={pickerMembers()} onChange={setPickerMembers} />
      </Dialog>
      <ConfirmDialog
        open={removing()}
        onOpenChange={setRemoving}
        title={`Remove ${saved().name}?`}
        body="The connections in this pool are kept."
        confirmLabel="Remove pool"
        danger
        onConfirm={async () => {
          try {
            await aiConnectionPoolsApi.remove(company().id, saved().id, saved().revision);
            pushToast({ title: "Connection pool removed", tone: "success" });
            props.onRemoved();
          } catch (error) {
            pushToast({ title: "Couldn't remove the pool", body: failureText(error, "Please try again."), tone: "error" });
            throw error;
          }
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces

function accountMeta(account: AiManagedConnectionSummary) {
  return [providerName(account.provider), methodLabel(account.method), account.ownership === "shared" ? "Shared" : "Personal"].join(" · ");
}

/** Tick the AI connections to pool. One per connection; only connected ones can be added. */
function MemberPicker(props: {
  accounts: AiManagedConnectionSummary[];
  members: AiConnectionPoolMember[];
  disabled?: boolean;
  onChange: (members: AiConnectionPoolMember[]) => void;
  onRefresh?: () => void;
}) {
  const company = useCompany();
  const [query, setQuery] = createSignal("");
  const filtered = () => {
    const q = query().trim().toLowerCase();
    return props.accounts.filter((account) => !q || `${account.name} ${providerName(account.provider)}`.toLowerCase().includes(q));
  };
  return (
    <div class="pl-picker">
      <TextInput type="search" aria-label="Search connections" placeholder="Search connections…" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
      <Show when={filtered().length > 0} fallback={<p class="cx-static">{props.accounts.length ? "No matching connections." : "No AI connections yet."}</p>}>
        <ul class="cx-options pl-options">
          <For each={filtered()}>
            {(account) => {
              const checked = () => props.members.some((member) => member.binding.connectionId === account.id && member.binding.grantId === account.grantId);
              return (
                <li>
                  <label class="cx-option" classList={{ "cx-option--on": checked() }}>
                    <input
                      type="checkbox"
                      checked={checked()}
                      disabled={props.disabled || !pickable(props.members, account)}
                      onChange={(event) => props.onChange(toggleMember(props.members, account, event.currentTarget.checked))}
                    />
                    <span class="cx-option-name">
                      {account.name}
                      <span class="cx-row-meta">{accountMeta(account)}</span>
                    </span>
                    <Show when={account.status !== "connected"}>
                      <span class="cx-option-note">Needs attention</span>
                    </Show>
                  </label>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
      <div class="pl-picker-foot">
        <A href={`/${company().issuePrefix}/apps/ai`} target="_blank" rel="noopener noreferrer">
          Connect a new account
        </A>
        <Show when={props.onRefresh}>
          <Button size="compact" variant="quiet" onClick={() => props.onRefresh?.()}>
            Refresh
          </Button>
        </Show>
      </div>
    </div>
  );
}

/** The pool's connections in order, with move and remove buttons, and usage when it skips by usage. */
function MemberOrder(props: {
  members: AiConnectionPoolMember[];
  accounts: AiManagedConnectionSummary[];
  disabled?: boolean;
  onChange: (members: AiConnectionPoolMember[]) => void;
  usage?: Record<string, { reason: string; checkedAt: string | null; usage?: import("@paperclipai/shared").AiConnectionUsage }>;
}) {
  return (
    <ol class="pl-order" aria-label="Connection order">
      <For each={props.members} fallback={<li class="pl-member cx-static">Add a connection to get started.</li>}>
        {(member, index) => {
          const account = () => memberAccount(member, props.accounts);
          const name = () => account()?.name ?? "connection";
          const seen = () => props.usage?.[member.id];
          return (
            <li class="pl-member">
              <span class="pl-index mono">{index() + 1}</span>
              <div class="pl-member-main">
                <span class="cx-row-name">{account()?.name ?? "Connection unavailable"}</span>
                <span class="cx-row-meta">{account() ? accountMeta(account()!) : "Restore access to this connection."}</span>
                <Show when={seen()}>
                  {(entry) => (
                    <span class="cx-row-meta">
                      {entry().usage?.status === "ok"
                        ? entry()
                            .usage!.limits.map((limit) => `${limit.label} ${usagePercent(limit) ?? usageLimitValue(limit)}${usagePercent(limit) !== null ? "%" : ""}`)
                            .join(" · ") || "No limits reported."
                        : entry().reason}
                    </span>
                  )}
                </Show>
              </div>
              <div class="pl-member-actions">
                <Button size="compact" variant="quiet" aria-label={`Move ${name()} up`} disabled={props.disabled || index() === 0} onClick={() => props.onChange(moveMember(props.members, index(), -1))}>
                  <ArrowUp size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="compact"
                  variant="quiet"
                  aria-label={`Move ${name()} down`}
                  disabled={props.disabled || index() === props.members.length - 1}
                  onClick={() => props.onChange(moveMember(props.members, index(), 1))}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="compact"
                  variant="quiet"
                  aria-label={`Remove ${name()}`}
                  disabled={props.disabled}
                  onClick={() => props.onChange(props.members.filter((item) => item.id !== member.id))}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        }}
      </For>
    </ol>
  );
}
