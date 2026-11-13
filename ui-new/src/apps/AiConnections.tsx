import type { AiConnectionList } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Crown, RefreshCw } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { aiConnectionsApi } from "@/api/ai-connections";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  canMakeDefault,
  canReconnect,
  localLoginSupported,
  methodLabel,
  ownerLabel,
  providerName,
  STATUS_META,
  usageError,
  usageLimitValue,
  usagePercent,
  type Connection,
} from "@/connectors/connection-model";
import { ConnectionSetup } from "@/connectors/ConnectionSetup";
import { canLookUpIdentity, identityMessage, identityRetryable } from "./ai-identity-model";
import { PoolsCard } from "./pools/Pools";

/*
 * Connections → AI connections (`/:prefix/connections/ai`): the company's AI accounts, which agents run on. This
 * was the temporary Connectors page (decision 23), folded into Connections (then Apps); `/:prefix/connectors` sends you
 * here. There's no board: it's built from the design system's components.
 *
 * Lists every connection you can use (`GET ai-connections`), lets you make your own personal one
 * your default (`PUT default`), checks usage where the provider reports it (`GET :id/usage`), shows
 * runs using it (`GET :id/active-runs`), and adds or reconnects a Claude account (ConnectionSetup,
 * which New agent uses too). A Claude subscription's Account panel asks the provider which account
 * and organization it signs in as (`GET :id/identity`, ai-identity-model.ts).
 */

export function AiConnections() {
  const company = useCompany();
  const client = useQueryClient();
  const list = createQuery(() => ({
    queryKey: queryKeys.aiConnections.list(company().id),
    queryFn: () => aiConnectionsApi.list(company().id),
  }));
  const health = createQuery(() => ({ queryKey: queryKeys.health, queryFn: healthApi.get }));
  const [setupOpen, setSetupOpen] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal<Connection | undefined>();

  const connections = () => list.data?.connections ?? [];
  const connectedCount = () => connections().filter((c) => c.status === "connected").length;
  const attentionCount = () => connections().filter((c) => c.status !== "connected").length;

  // One default per provider (#19845): a failed change stays on its row with Retry until it's
  // tried again or another one succeeds.
  const [failed, setFailed] = createSignal<{ grantId: string; message: string } | null>(null);
  const makeDefault = createMutation(() => ({
    mutationFn: (connection: Connection) => aiConnectionsApi.setDefault(company().id, connection.grantId),
    onSuccess: (_result: unknown, connection: Connection) => {
      pushToast({ title: `${connection.name} is now your ${providerName(connection.provider)} default`, tone: "success" });
      return client.invalidateQueries({ queryKey: queryKeys.aiConnections.list(company().id) });
    },
    onError: (error: Error, connection: Connection) => setFailed({ grantId: connection.grantId, message: error.message }),
  }));
  const providerPending = (connection: Connection) => makeDefault.isPending && makeDefault.variables?.provider === connection.provider;

  const openSetup = (connection?: Connection) => {
    setReconnecting(connection);
    setSetupOpen(true);
  };

  return (
    <>
      <section class="card cx-card" aria-labelledby="cx-ai-title">
        <header class="chead ap-chead">
          <div>
            <h3 id="cx-ai-title" class="disp">
              AI connections
            </h3>
            <p>
              The accounts agents run on.
              <Show when={list.data && connections().length > 0}>
                {" "}
                {connectedCount()} connected
                <Show when={attentionCount() > 0}>, {attentionCount()} need attention</Show>.
              </Show>
            </p>
          </div>
          <Button variant="primary" size="compact" disabled={!list.data} onClick={() => openSetup()}>
            Connect Claude
          </Button>
        </header>
        <Switch>
          <Match when={list.isPending}>
            <p class="cx-empty" role="status">
              Loading connections…
            </p>
          </Match>
          <Match when={list.isError}>
            <div class="cx-empty" role="alert">
              <p>Could not load connections: {(list.error as Error).message}</p>
              <Button size="compact" onClick={() => void list.refetch()}>
                Retry
              </Button>
            </div>
          </Match>
          <Match when={connections().length === 0}>
            <div class="cx-empty">
              <p>No AI connections yet. Connect a Claude account so agents can run.</p>
            </div>
          </Match>
          <Match when={list.data}>
            {(data) => (
              <ul class="cx-rows">
                <For each={connections()}>
                  {(connection) => (
                    <ConnectionRow
                      connection={connection}
                      list={data()}
                      defaultPending={providerPending(connection)}
                      defaultSaving={makeDefault.isPending && makeDefault.variables?.grantId === connection.grantId}
                      defaultError={failed()?.grantId === connection.grantId ? failed()!.message : null}
                      onMakeDefault={() => {
                        setFailed(null);
                        makeDefault.mutate(connection);
                      }}
                      onReconnect={() => openSetup(connection)}
                    />
                  )}
                </For>
              </ul>
            )}
          </Match>
        </Switch>
      </section>

      <PoolsCard />

      <Show when={list.data}>
        {(data) => (
          <ConnectionSetup
            open={setupOpen()}
            onOpenChange={setSetupOpen}
            list={data()}
            reconnect={reconnecting()}
            subscriptionSupported={localLoginSupported(health.data)}
            onSaved={(name) => {
              setSetupOpen(false);
              pushToast({ title: reconnecting() ? `Reconnected ${name}` : `Connected ${name}`, tone: "success" });
            }}
          />
        )}
      </Show>
    </>
  );
}

function ConnectionRow(props: {
  connection: Connection;
  list: AiConnectionList;
  /** A default change for this provider is saving. */
  defaultPending: boolean;
  /** This account's own default change is saving. */
  defaultSaving: boolean;
  defaultError: string | null;
  onMakeDefault: () => void;
  onReconnect: () => void;
}) {
  const company = useCompany();
  const [usageOpen, setUsageOpen] = createSignal(false);
  const [accountOpen, setAccountOpen] = createSignal(false);
  const status = () => STATUS_META[props.connection.status];
  const runs = createQuery(() => ({
    queryKey: queryKeys.aiConnections.activeRuns(company().id, props.connection.id),
    queryFn: () => aiConnectionsApi.activeRuns(company().id, props.connection.id),
    enabled: props.connection.status !== "revoked",
  }));
  const meta = () =>
    [
      providerName(props.connection.provider),
      methodLabel(props.connection.method),
      props.connection.accountLabel,
      ownerLabel(props.connection, props.list.currentUserId),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <li class="cx-row">
      <div class="cx-row-main">
        <div class="cx-row-title">
          <span class="cx-row-name">{props.connection.name}</span>
          <Show when={props.connection.isDefault}>
            <TonePill tone={props.connection.status === "connected" ? "violet" : "red"} compact icon={<Crown size={12} aria-hidden="true" />}>
              {props.connection.status === "connected" ? `Your ${providerName(props.connection.provider)} default` : "Default unavailable"}
            </TonePill>
          </Show>
        </div>
        <p class="cx-row-meta">{meta()}</p>
        <Show when={props.connection.unavailableReason}>
          {(reason) => <p class="cx-row-reason">{reason()}</p>}
        </Show>
        <Show when={props.defaultError}>
          {(message) => (
            <div class="cx-row-failed" role="alert">
              <span>
                Couldn't change your {providerName(props.connection.provider)} default. {message()}
              </span>
              <Button size="compact" disabled={props.defaultPending} onClick={props.onMakeDefault}>
                Retry
              </Button>
            </div>
          )}
        </Show>
        <Show when={(runs.data?.length ?? 0) > 0}>
          <p class="cx-row-runs">
            In use by {runs.data!.map((run) => `${run.agentName} (${run.status})`).join(", ")}
          </p>
        </Show>
      </div>
      <div class="cx-row-side">
        <TonePill tone={status().tone} compact>
          {status().label}
        </TonePill>
        <div class="cx-row-actions">
          <Show when={canMakeDefault(props.connection, props.list.currentUserId)}>
            <Button size="compact" disabled={props.defaultPending} icon={<Crown size={14} aria-hidden="true" />} onClick={props.onMakeDefault}>
              {props.defaultSaving ? "Setting…" : `Set as default for ${providerName(props.connection.provider)}`}
            </Button>
          </Show>
          <Show when={canReconnect(props.connection, props.list)}>
            <Button size="compact" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={props.onReconnect}>
              Reconnect
            </Button>
          </Show>
          <Show when={canLookUpIdentity(props.connection)}>
            <Button size="compact" variant="quiet" aria-expanded={accountOpen()} onClick={() => setAccountOpen((open) => !open)}>
              {accountOpen() ? "Hide account" : "Account"}
            </Button>
          </Show>
          <Show when={props.connection.usageProbeSupported}>
            <Button size="compact" variant="quiet" aria-expanded={usageOpen()} onClick={() => setUsageOpen((open) => !open)}>
              {usageOpen() ? "Hide usage" : "Usage"}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={accountOpen()}>
        <AccountPanel connection={props.connection} list={props.list} />
      </Show>
      <Show when={usageOpen()}>
        <UsagePanel connection={props.connection} />
      </Show>
    </li>
  );
}

/** The account the connection signs in as, from the provider; read when the panel opens. */
function AccountPanel(props: { connection: Connection; list: AiConnectionList }) {
  const company = useCompany();
  const identity = createQuery(() => ({
    queryKey: queryKeys.aiConnections.identity(company().id, props.connection.id, props.connection.grantId),
    queryFn: ({ signal }) => aiConnectionsApi.accountIdentity(company().id, props.connection.id, props.connection.grantId, signal),
    enabled: canLookUpIdentity(props.connection),
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const accountLabel = () => identity.data?.accountLabel ?? props.connection.accountLabel ?? null;
  const message = () => identityMessage(identity.data, identity.error);
  const retryable = () => identityRetryable(identity.data, identity.error);
  return (
    <section class="cx-usage" aria-label={`Account for ${props.connection.name}`}>
      <dl class="ap-account">
        <dt>{providerName(props.connection.provider)} account</dt>
        <dd>{accountLabel() ?? (identity.isPending ? "Checking…" : "Not available")}</dd>
        <Show when={identity.data?.organizationLabel}>
          {(organization) => (
            <>
              <dt>Organization</dt>
              <dd>{organization()}</dd>
            </>
          )}
        </Show>
        <dt>Sign-in method</dt>
        <dd>{methodLabel(props.connection.method)}</dd>
        <dt>Access</dt>
        <dd>{ownerLabel(props.connection, props.list.currentUserId)}</dd>
      </dl>
      <Show when={identity.isPending}>
        <p class="cap" role="status">
          Checking the account with the provider…
        </p>
      </Show>
      <Show when={message()}>
        {(text) => (
          <p class="cx-note" role={retryable() ? "alert" : undefined}>
            {text()}
          </p>
        )}
      </Show>
      <Show when={retryable()}>
        <div>
          <Button size="compact" disabled={identity.isFetching} onClick={() => void identity.refetch()}>
            {identity.isFetching ? "Checking…" : "Check again"}
          </Button>
        </div>
      </Show>
    </section>
  );
}

/** Usage limits from the provider, checked on request (it calls the provider each time). */
function UsagePanel(props: { connection: Connection }) {
  const company = useCompany();
  const probe = createMutation(() => ({
    mutationFn: () => aiConnectionsApi.probeUsage(company().id, props.connection.id, props.connection.grantId),
  }));
  const usage = () => probe.data;
  return (
    <section class="cx-usage" aria-label={`Usage for ${props.connection.name}`}>
      <div class="cx-usage-head">
        <Show when={usage()?.status === "ok"} fallback={<span class="cap">Usage limits as the provider reports them.</span>}>
          <span class="cap">
            Checked {new Date(usage()!.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {usage()!.planType ? ` · ${usage()!.planType}` : ""}
          </span>
        </Show>
        <Button
          size="compact"
          disabled={probe.isPending || props.connection.status !== "connected"}
          onClick={() => probe.mutate()}
        >
          {probe.isPending ? "Checking…" : usage()?.status === "ok" ? "Refresh" : "Check usage"}
        </Button>
      </div>
      <Show when={probe.error}>
        {(error) => (
          <p class="cx-note cx-note--error" role="alert">
            {(error() as Error).message}
          </p>
        )}
      </Show>
      <Show when={usage() && usage()!.status !== "ok"}>
        <p class="cx-note">{usageError(usage()!)}</p>
      </Show>
      <Show when={usage()?.status === "ok"}>
        <Show when={usage()!.limits.length > 0} fallback={<p class="cap">No limits reported.</p>}>
          <ul class="cx-limits">
            <For each={usage()!.limits}>
              {(limit) => {
                const percent = () => usagePercent(limit);
                return (
                  <li class="cx-limit">
                    <div class="cx-limit-row">
                      <span>{limit.label}</span>
                      <span class="mono">{usageLimitValue(limit)}</span>
                    </div>
                    <Show when={percent() !== null}>
                      <span class="cx-meter" aria-hidden="true">
                        <i style={{ width: `${percent()}%` }} classList={{ hot: (percent() ?? 0) >= 90 }} />
                      </span>
                    </Show>
                    <Show when={limit.resetsAt}>
                      {(at) => <span class="cap">Resets {new Date(at()).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}
