import type { SubscriptionAccountReport, SubscriptionCostReport } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronDown, ChevronRight } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { costsApi } from "@/api/costs";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { formatCents } from "@/projects/dashboard-model";
import { agoLabel } from "@/runs/run-model";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { formatTokens } from "./costs-model";
import type { CostScope } from "./CostReports";
import {
  accountPrice,
  centsToField,
  companyName,
  fieldToCents,
  priceSource,
  QUALITY_REASONS,
  qualityGroups,
  qualityLine,
  SUBSCRIPTION_CURRENCIES,
  subscriptionTotals,
  usageTokens,
} from "./usage-model";

/*
 * Two overview pieces of the old Costs page:
 *
 * - Subscriptions (`GET /costs/subscriptions`): the monthly fees of the AI subscriptions visible to
 *   you, and the range's usage on them. Once per visit the page asks connected accounts which plan
 *   they're on (`POST …/subscriptions/refresh`), as the old page does. Details lists each account;
 *   a price can be entered or corrected (`PATCH …/subscriptions/:id`), and two accounts that are the
 *   same subscription linked (`POST …/:id/link`).
 * - Missing costs (`GET /costs/data-quality`): when the range has runs without a price, a line that
 *   opens the affected runs by agent with what each reason means; a finished run's saved usage can
 *   be recorded again (`POST /costs/retry-accounting`), which doesn't rerun the agent.
 */

/** Companies whose subscription plans were checked during this visit. */
const checked = new Set<string>();

export function useSubscriptions(scope: () => CostScope) {
  const company = useCompany();
  const client = useQueryClient();
  const report = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "subscriptions", scope().keyFrom, scope().keyTo),
    queryFn: ({ signal }) => costsApi.subscriptions(company().id, scope().from, scope().to, signal),
    refetchInterval: 30_000,
  }));
  const [checkFailed, setCheckFailed] = createSignal(false);
  const check = async (companyId: string) => {
    setCheckFailed(false);
    try {
      await costsApi.refreshSubscriptions(companyId);
      void client.invalidateQueries({ queryKey: ["costs", companyId, "subscriptions"] });
    } catch {
      setCheckFailed(true);
    }
  };
  createEffect(() => {
    const id = company().id;
    if (!report.data?.canRefresh || checked.has(id)) return;
    checked.add(id);
    void check(id);
  });
  return { report, checkFailed, retryCheck: () => void check(company().id) };
}

export function SubscriptionsKpi(props: { report: SubscriptionCostReport | undefined; failed: boolean; checkFailed: boolean; onRetryCheck: () => void }) {
  const [open, setOpen] = createSignal(false);
  const totals = () => subscriptionTotals(props.report);
  const estimated = () => props.report?.monthlyTotals.reduce((sum, total) => sum + total.estimatedCount, 0) ?? 0;
  return (
    <div class="card org-kpi">
      <span class="org-kpi-label">Subscriptions</span>
      <span class="org-kpi-value disp">
        <Show when={totals()} fallback="—">
          {(lines) => <For each={lines()}>{(line) => <span class="act-kpi-line">{line}</span>}</For>}
        </Show>
      </span>
      <span class="org-kpi-note">
        <span>
          {props.report
            ? props.report.accounts.length === 0
              ? "No subscriptions you can see"
              : `${props.report.activeCount} active${props.report.unknownPriceCount ? `, ${props.report.unknownPriceCount} without a price` : ""}${estimated() ? " · estimated" : ""}`
            : props.failed
              ? "Couldn't load subscriptions"
              : "Loading…"}
        </span>
      </span>
      <Show when={props.report}>
        <button type="button" class="act-linkish act-kpi-link" onClick={() => setOpen(true)}>
          Details
        </button>
      </Show>
      <Show when={props.checkFailed}>
        <button type="button" class="act-linkish act-kpi-link" onClick={props.onRetryCheck} title="Paperclip couldn't ask the connected accounts which plan they're on.">
          Check plans again
        </button>
      </Show>
      <Show when={props.report}>{(report) => <SubscriptionsDialog open={open()} onOpenChange={setOpen} report={report()} />}</Show>
    </div>
  );
}

function SubscriptionsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; report: SubscriptionCostReport }) {
  const [editing, setEditing] = createSignal<SubscriptionAccountReport | null>(null);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) setEditing(null);
      }}
      width={680}
      title={editing() ? `${editing()!.name}: price` : "Subscriptions"}
      description="Monthly fees of the accounts you can see. Token counts cover this organization's work in the range."
    >
      <Show
        when={editing()}
        keyed
        fallback={
          <div class="act-subs">
            <Show when={props.report.accounts.length === 0}>
              <p class="org-muted">No subscriptions you can see yet. Connect an AI account under Apps, or run an agent on a connected subscription.</p>
            </Show>
            <For each={props.report.accounts}>
              {(account) => (
                <div class="act-sub">
                  <div class="act-cost-line">
                    <span class="act-report-model">
                      <span class="org-strong org-ellipsis">{account.name}</span>
                      <span class="org-muted org-ellipsis">
                        {account.shared ? "Shared" : (account.ownerName ?? "Personal")} · {companyName(account.provider)} · {account.price.plan}
                      </span>
                    </span>
                    <span class="act-cost-nums act-report-model">
                      <b>{accountPrice(account)}</b>
                      <span class="org-muted">{priceSource(account)}</span>
                    </span>
                  </div>
                  <span class="org-muted act-report-line">
                    {formatTokens(account.usage.inputTokens + account.usage.cachedInputTokens)} in · {formatTokens(account.usage.outputTokens)} out
                    {Number(account.usage.costCents) > 0 ? ` · ${formatCents(Number(account.usage.costCents))} in usage charges, apart from the fee` : ""}
                  </span>
                  <Show when={account.agents.length > 0}>
                    <span class="org-muted act-report-line">Used by {account.agents.map((agent) => agent.name).join(", ")}</span>
                  </Show>
                  <Show when={!account.identityVerified}>
                    <span class="org-muted act-report-line">Paperclip can't confirm which account this is. If two connections are the same subscription, link them.</span>
                  </Show>
                  <Show when={account.observedAt || account.refreshStatus === "unavailable"}>
                    <span class="org-muted act-report-line">
                      {account.observedAt ? `Plan checked ${agoLabel(account.observedAt)}` : "The provider doesn't say which plan this is; enter the price yourself."}
                      {account.observedAt && account.refreshStatus === "unavailable" ? " · the last check failed" : ""}
                    </span>
                  </Show>
                  <Show when={account.canEdit}>
                    <div>
                      <Button size="compact" onClick={() => setEditing(account)}>
                        Edit price
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={props.report.unattributedSubscription.eventCount > 0}>
              <p class="org-muted">Some subscription usage has no account recorded. It's in the totals.</p>
            </Show>
            <Show when={props.report.unknown.eventCount > 0}>
              <p class="org-muted">
                Other billing: {formatTokens(usageTokens(props.report.unknown))} tokens
                {Number(props.report.unknown.costCents) > 0 ? ` and ${formatCents(Number(props.report.unknown.costCents))} in charges` : ""}, counted with the runs' costs.
              </p>
            </Show>
            <p class="org-foot">A fee covers the whole account, including use outside Paperclip. Fees aren't charges and don't count against budgets. Currencies are added up separately.</p>
          </div>
        }
      >
        {(account) => <SubscriptionEditor account={account} accounts={props.report.accounts} onDone={() => setEditing(null)} />}
      </Show>
    </Dialog>
  );
}

function SubscriptionEditor(props: { account: SubscriptionAccountReport; accounts: readonly SubscriptionAccountReport[]; onDone: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [plan, setPlan] = createSignal(props.account.price.plan);
  const [amount, setAmount] = createSignal(centsToField(props.account.price.amountCents));
  const [currency, setCurrency] = createSignal(props.account.price.currency);
  const [cadence, setCadence] = createSignal(props.account.price.cadence);
  const [status, setStatus] = createSignal(props.account.price.status);
  const [target, setTarget] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const cents = () => fieldToCents(amount());
  const targets = createMemo(() => props.accounts.filter((row) => row.id !== props.account.id && row.provider === props.account.provider && row.canEdit));
  const refresh = () => void client.invalidateQueries({ queryKey: ["costs", company().id, "subscriptions"] });

  const save = async () => {
    const value = cents();
    if (value === undefined || !plan().trim()) return;
    setBusy(true);
    setError(null);
    try {
      await costsApi.updateSubscription(company().id, props.account.id, {
        expectedRevision: props.account.price.revision,
        plan: plan().trim(),
        amountCents: value,
        currency: currency() as (typeof SUBSCRIPTION_CURRENCIES)[number],
        cadence: cadence(),
        status: status(),
      });
      refresh();
      pushToast({ tone: "success", title: `Saved ${props.account.name}'s price` });
      props.onDone();
    } catch {
      setError("Couldn't save the price. Check the amount, or reopen the account if someone else changed it.");
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    const other = props.accounts.find((row) => row.id === target());
    if (!other) return;
    setBusy(true);
    setError(null);
    try {
      await costsApi.linkSubscriptions(company().id, props.account.id, other.id, props.account.price.revision, other.price.revision);
      refresh();
      pushToast({ tone: "success", title: "Linked the accounts", body: `${props.account.name} and ${other.name} now count as one subscription.` });
      props.onDone();
    } catch {
      setError("Couldn't link the accounts. Reopen the details and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sk-form act-sub-editor">
      <Field label="Plan" for="act-sub-plan">
        <TextInput id="act-sub-plan" value={plan()} maxLength={100} onInput={(event) => setPlan(event.currentTarget.value)} />
      </Field>
      <div class="act-sub-grid">
        <Field label="Price per billing period" for="act-sub-price" error={cents() === undefined ? "Use a number like 20 or 19.99." : undefined}>
          <TextInput id="act-sub-price" inputMode="decimal" value={amount()} placeholder="Unknown" onInput={(event) => setAmount(event.currentTarget.value)} />
        </Field>
        <Field label="Currency" for="act-sub-currency">
          <select id="act-sub-currency" class="input" value={currency()} onChange={(event) => setCurrency(event.currentTarget.value)}>
            <For each={SUBSCRIPTION_CURRENCIES}>{(code) => <option value={code}>{code}</option>}</For>
          </select>
        </Field>
        <Field label="Billed" for="act-sub-cadence">
          <select id="act-sub-cadence" class="input" value={cadence()} onChange={(event) => setCadence(event.currentTarget.value as "month" | "year")}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </Field>
        <Field label="Counting" for="act-sub-status">
          <select id="act-sub-status" class="input" value={status()} onChange={(event) => setStatus(event.currentTarget.value as "active" | "ended" | "excluded")}>
            <option value="active">Active</option>
            <option value="ended">The subscription ended</option>
            <option value="excluded">Don't count it in this organization</option>
          </select>
        </Field>
      </div>
      <p class="org-muted">The full price of one account or seat. A yearly price is divided by 12. Changes count from now; ending it here doesn't cancel anything with the provider.</p>
      <div class="org-dialog-foot">
        <Button variant="quiet" onClick={props.onDone} disabled={busy()}>
          Back
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy() || cents() === undefined || !plan().trim()}>
          {busy() ? "Saving…" : "Save price"}
        </Button>
      </div>
      <Show when={targets().length > 0}>
        <div class="act-sub-link">
          <Field label="The same subscription as another account?" for="act-sub-link" help="Linking counts them once, puts their usage together and keeps the chosen account's price. Only link the same subscription or seat.">
            <select id="act-sub-link" class="input" value={target()} onChange={(event) => setTarget(event.currentTarget.value)}>
              <option value="">Choose an account</option>
              <For each={targets()}>
                {(row) => (
                  <option value={row.id}>
                    {row.name} · {row.price.plan}
                  </option>
                )}
              </For>
            </select>
          </Field>
          <div>
            <Button size="compact" disabled={!target() || busy()} onClick={() => void link()}>
              Link accounts
            </Button>
          </div>
        </div>
      </Show>
      <Show when={error()}>
        <p class="field-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}

/** "3 run costs missing ›", opening the affected runs grouped by agent. */
export function QualityNotice(props: { scope: CostScope; summary: { unpricedEventCount: number; pendingRunCount: number; unknownBillingEventCount?: number } | undefined }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const [open, setOpen] = createSignal(false);
  const [retrying, setRetrying] = createSignal<string | null>(null);
  const line = () => qualityLine(props.summary);
  const report = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "data-quality", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.dataQuality(company().id, props.scope.from, props.scope.to, signal),
    enabled: open() && line() !== null,
    refetchInterval: open() ? 30_000 : false,
  }));
  const groups = createMemo(() => qualityGroups(report.data));
  createEffect(on(() => `${props.scope.keyFrom}:${props.scope.keyTo}`, () => setOpen(false), { defer: true }));
  const agentKey = (id: string) => agents.data?.find((agent) => agent.id === id)?.urlKey ?? id;

  const retry = async (runId: string) => {
    setRetrying(runId);
    try {
      const result = await costsApi.retryAccounting(company().id, runId);
      pushToast({ tone: result.accounted ? "success" : "info", title: result.accounted ? "Costs recorded" : "No new usage to record", body: "The agent wasn't rerun." });
      void client.invalidateQueries({ queryKey: ["costs", company().id] });
    } catch {
      pushToast({ tone: "error", title: "Couldn't record the costs", body: "Try again in a moment." });
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Show when={line()}>
      <div class="act-quality">
        <button type="button" class="act-linkish act-quality-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <Show when={open()} fallback={<ChevronRight size={13} aria-hidden="true" />}>
            <ChevronDown size={13} aria-hidden="true" />
          </Show>
          {line()}
        </button>
        <Show when={open()}>
          <div class="card org-card act-quality-body">
            <Switch>
              <Match when={report.isPending}>
                <p class="org-muted">Loading the runs…</p>
              </Match>
              <Match when={report.isError && !report.data}>
                <p class="org-muted">
                  Couldn't load them.{" "}
                  <button type="button" class="act-linkish" onClick={() => void report.refetch()}>
                    Try again
                  </button>
                </p>
              </Match>
              <Match when={groups().length === 0}>
                <p class="org-muted">Nothing's missing in this range any more.</p>
              </Match>
            </Switch>
            <For each={groups()}>
              {(group) => (
                <section class="act-quality-group">
                  <h3 class="act-report-sub act-quality-agent">
                    <Show when={group.agentId} fallback={<span>{group.name}</span>}>
                      {(id) => (
                        <A class="act-cost-agent" href={`/${company().issuePrefix}/agents/${agentKey(id())}/settings`}>
                          <AgentAvatar agent={{ id: id(), name: group.name, appearance: group.appearance }} size={20} />
                          <span>{group.name}</span>
                        </A>
                      )}
                    </Show>
                  </h3>
                  <ul class="act-cost-list">
                    <For each={group.items}>
                      {(item) => (
                        <li class="act-cost-row">
                          <div class="act-cost-line act-fin-line">
                            <TonePill tone={item.reason === "retryable" ? "cyan" : "amber"} compact>
                              {QUALITY_REASONS[item.reason].label}
                            </TonePill>
                            <span class="org-muted">{agoLabel(item.occurredAt)}</span>
                            <Show when={item.model}>
                              <span class="mono org-muted org-ellipsis">{item.model}</span>
                            </Show>
                            <Show when={item.reason === "retryable" && item.runId && report.data?.canRetry}>
                              <button type="button" class="act-linkish act-cost-nums" disabled={retrying() !== null} onClick={() => void retry(item.runId!)}>
                                {retrying() === item.runId ? "Recording…" : "Record now"}
                              </button>
                            </Show>
                          </div>
                          <p class="org-muted act-report-line">{QUALITY_REASONS[item.reason].description}</p>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
            <Show when={report.data?.hasMoreEvents || report.data?.hasMoreRuns}>
              <p class="org-foot">The 25 latest of each kind. Pick a shorter range to see more.</p>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
