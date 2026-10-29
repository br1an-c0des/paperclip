import type { DecisionHistoryEntry, FastResponseHistoryEntry } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { costsApi } from "@/api/costs";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { formatCents } from "@/projects/dashboard-model";
import { agoLabel } from "@/runs/run-model";
import { InitialsDisc } from "@/ui/Avatar";
import { TonePill } from "@/ui/Status";
import { formatTokens, type RangePreset } from "./costs-model";
import {
  billerCards,
  budgetShare,
  callFeature,
  callPerson,
  callStatus,
  companyName,
  durationLabel,
  entirelyUnpriced,
  estimateLabel,
  financeEventLabel,
  financeKindLabel,
  historyBusy,
  money,
  overPace,
  preciseMoney,
  providerCards,
  quotaProblem,
  quotaSourceLabel,
  quotaWindowLine,
  resetLabel,
  retainQuota,
  weekRange,
  type BillerCard,
  type ProviderCard,
} from "./usage-model";

/*
 * The Costs tab's reports beyond the overview, as the old Costs page's tabs show them:
 *
 * - By person (`/costs/by-user`): a card on the overview.
 * - Providers (`/costs/by-provider`, this week's too, `/costs/window-spend`, `/costs/quota-windows`):
 *   a card per provider with its spend against the company budget, the rolling 5-hour, 24-hour and
 *   7-day windows, how much ran on a subscription, its models, and each subscription account's quota.
 * - Billers (`/costs/by-biller`, this week's too): a card per biller with the providers it billed
 *   for and the billing types.
 * - Finance (`/costs/finance-summary`, `finance-by-biller`, `finance-by-kind`, `finance-events`):
 *   the ledger of charges, fees and credits reported by providers, apart from run estimates.
 * - Decisions and Fast responses (`/decision-model/history`, `/fast-response/history`): recent
 *   calls, polled while one is running.
 *
 * The rolling windows, quota and this week's spend don't follow the range; everything else does.
 */

export type CostScope = { from?: string; to?: string; keyFrom?: string; keyTo?: string; preset: RangePreset; budgetCents: number };

const REFRESH = 30_000;

/** A cost and its estimate badge, or a dash when nothing in the group had a price. */
function Amount(props: { costCents: number; eventCount?: number; estimatedEventCount?: number; unpricedEventCount?: number }) {
  return (
    <span class="act-amount">
      <b>{entirelyUnpriced(props) ? "—" : formatCents(props.costCents)}</b>
      <Show when={estimateLabel(props)}>
        {(label) => (
          <span class="act-estimate" title="Worked out from token counts and published rates; the provider's bill may differ.">
            {label()}
          </span>
        )}
      </Show>
    </span>
  );
}

export function ByPersonCard(props: { scope: CostScope }) {
  const company = useCompany();
  const report = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "by-user", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.byUser(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const rows = () => report.data?.rows ?? [];
  return (
    <section class="card org-card act-cost-card" aria-labelledby="act-by-person">
      <div class="org-card-row">
        <h2 class="disp" id="act-by-person">
          By person
        </h2>
        <span class="org-muted org-push">Runs · tokens in / out · spend</span>
      </div>
      <Switch>
        <Match when={report.isPending}>
          <p class="org-muted org-pad">Loading…</p>
        </Match>
        <Match when={report.isError && !report.data}>
          <p class="org-muted org-pad">Couldn't load spend by person.</p>
        </Match>
        <Match when={rows().length === 0}>
          <p class="org-muted org-pad">No usage in this range.</p>
        </Match>
      </Switch>
      <ul class="act-cost-list">
        <For each={rows()}>
          {(row) => (
            <li class="act-cost-row">
              <div class="act-cost-line">
                <Show when={row.userId} fallback={<span class="org-muted">No one</span>}>
                  <span class="act-cost-agent">
                    <InitialsDisc name={row.userName ?? "Someone"} seed={row.userId!} size={20} />
                    <span class="org-ellipsis">{row.userName ?? "A former member"}</span>
                  </span>
                </Show>
                <span class="act-cost-nums">
                  <span class="org-muted">
                    {row.runCount} {row.runCount === 1 ? "run" : "runs"} · {formatTokens(row.inputTokens + row.cachedInputTokens)} / {formatTokens(row.outputTokens)} ·{" "}
                  </span>
                  <Amount {...row} />
                </span>
              </div>
            </li>
          )}
        </For>
      </ul>
      <Show when={rows().some((row) => row.userId === null)}>
        <p class="org-foot">“No one” is work with no responsible person here, such as routines and agents' own tasks.</p>
      </Show>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Providers

export function ProvidersView(props: { scope: CostScope }) {
  const company = useCompany();
  const week = () => weekRange(new Date());
  const rows = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "by-provider", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.byProvider(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const weekRows = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "by-provider", week().from, week().to),
    queryFn: ({ signal }) => costsApi.byProvider(company().id, week().from, week().to, signal),
    refetchInterval: REFRESH,
  }));
  const windows = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "window-spend"),
    queryFn: ({ signal }) => costsApi.windowSpend(company().id, signal),
    refetchInterval: REFRESH,
  }));
  const quota = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "quota-windows"),
    queryFn: ({ signal }) => costsApi.quotaWindows(company().id, signal),
    refetchInterval: 300_000,
    staleTime: 60_000,
    structuralSharing: (previous: unknown, incoming: unknown) => retainQuota(previous as never, incoming as never) as never,
  }));
  const cards = createMemo(() => providerCards(rows.data, windows.data, weekRows.data, quota.data));

  return (
    <div class="act-section">
      <Switch>
        <Match when={rows.isPending}>
          <section class="card act-card">
            <p class="org-empty">Loading…</p>
          </section>
        </Match>
        <Match when={cards().length === 0}>
          <section class="card act-card">
            <p class="org-empty">No usage in this range.</p>
          </section>
        </Match>
      </Switch>
      <div class="act-report-grid">
        <For each={cards()}>{(card) => <ProviderCardView card={card} scope={props.scope} quotaLoading={quota.isPending} quotaFailed={quota.isError} />}</For>
      </div>
      <p class="org-foot">Subscription quota comes from each provider and is checked every few minutes. Budgets cap spend; quota is the provider's own limit.</p>
    </div>
  );
}

function ProviderCardView(props: { card: ProviderCard; scope: CostScope; quotaLoading: boolean; quotaFailed: boolean }) {
  const share = () => (props.scope.preset === "mtd" ? budgetShare(props.card.costCents, props.card.weekCents, props.scope.budgetCents) : null);
  return (
    <section class="card org-card act-report" aria-label={props.card.name}>
      <div class="act-report-head">
        <div class="act-report-title">
          <h2 class="disp">{props.card.name}</h2>
          <span class="org-muted">
            {formatTokens(props.card.inputTokens)} in · {formatTokens(props.card.outputTokens)} out
            {props.card.apiRuns + props.card.subscriptionRuns > 0
              ? ` · ${[props.card.apiRuns ? `${props.card.apiRuns} API` : "", props.card.subscriptionRuns ? `${props.card.subscriptionRuns} subscription` : ""].filter(Boolean).join(" / ")} runs`
              : ""}
          </span>
        </div>
        <span class="act-report-total">
          <Amount {...props.card} />
          <Show when={props.card.unpricedEventCount > 0}>
            <span class="act-estimate">{props.card.unpricedEventCount} without a price</span>
          </Show>
        </span>
      </div>

      <Show when={share()}>
        {(current) => (
          <div class="act-report-block">
            <Meter label="This month" left={formatCents(props.card.costCents)} right={`${current().period}% of the company budget`} percent={current().period} warn={overPace(props.card.costCents, props.scope.budgetCents, new Date())} />
            <Meter label="This week" left={formatCents(props.card.weekCents)} right={`about ${formatCents(current().weeklyCents)} a week`} percent={current().week} warn={current().week >= 100} />
          </div>
        )}
      </Show>

      <Show when={props.card.windows.length > 0}>
        <div class="act-report-block">
          <h3 class="act-report-sub">Rolling windows</h3>
          <For each={props.card.windows}>
            {(window) => <Meter label={window.window} left={`${formatTokens(window.tokens)} tokens`} right={formatCents(window.costCents)} percent={window.percent} />}
          </For>
        </div>
      </Show>

      <Show when={props.card.subscriptionRuns > 0}>
        <div class="act-report-block">
          <h3 class="act-report-sub">Subscription</h3>
          <Meter label={`${props.card.subscriptionShare}% of tokens`} left={`${props.card.subscriptionRuns} runs`} right={`${formatTokens(props.card.subscriptionTokens)} tokens`} percent={props.card.subscriptionShare} />
        </div>
      </Show>

      <Show when={props.card.models.length > 0}>
        <div class="act-report-block">
          <h3 class="act-report-sub">Models</h3>
          <ul class="act-cost-list act-report-models">
            <For each={props.card.models}>
              {(model) => (
                <li class="act-cost-row">
                  <div class="act-cost-line">
                    <span class="act-report-model">
                      <span class="mono org-ellipsis">{model.model}</span>
                      <span class="org-muted org-ellipsis">
                        {model.biller} · {model.billing}
                      </span>
                    </span>
                    <span class="act-cost-nums">
                      <span class="org-muted">{formatTokens(model.tokens)} · </span>
                      <b>{formatCents(model.costCents)}</b>
                    </span>
                  </div>
                  <span class="org-meter act-share" aria-hidden="true" title={`${model.tokenShare}% of tokens, ${model.costShare}% of spend`}>
                    <span style={{ width: `${model.tokenShare}%` }} />
                    <span class="act-share-cost" style={{ width: `${model.costShare}%` }} />
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={props.card.quota.length > 0 || (props.quotaLoading && ["anthropic", "openai"].includes(props.card.provider))}>
        <div class="act-report-block">
          <h3 class="act-report-sub">Subscription quota</h3>
          <Show when={!props.quotaLoading} fallback={<p class="org-muted">Checking…</p>}>
            <For each={props.card.quota}>
              {(account) => (
                <div class="act-quota">
                  <div class="act-cost-line">
                    <span class="org-strong org-ellipsis">{account.accountLabel ?? "Subscription account"}</span>
                    <Show when={account.source}>{(source) => <span class="org-muted act-cost-nums">{quotaSourceLabel(source())}</span>}</Show>
                  </div>
                  <Show when={props.quotaFailed || quotaProblem(account)}>
                    <p class="org-muted act-quota-note">{props.quotaFailed ? "Couldn't load quota. It's checked again in a few minutes." : quotaProblem(account)}</p>
                  </Show>
                  <For each={account.windows}>
                    {(window) => {
                      const line = quotaWindowLine(window);
                      return (
                        <Show
                          when={line.percent !== null}
                          fallback={
                            <div class="act-cost-line">
                              <span>{window.label}</span>
                              <span class="org-muted act-cost-nums">{line.left}</span>
                            </div>
                          }
                        >
                          <Meter label={window.label} left={line.left} right={window.resetsAt ? resetLabel(window.resetsAt) : ""} percent={line.percent ?? 0} warn={(line.percent ?? 0) >= 90} />
                        </Show>
                      );
                    }}
                  </For>
                  <Show when={account.capturedAt}>{(at) => <span class="org-muted act-quota-note">Checked {agoLabel(at())}</span>}</Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </section>
  );
}

function Meter(props: { label: string; left: string; right: string; percent: number; warn?: boolean }) {
  return (
    <div class="act-meter">
      <div class="act-cost-line">
        <span class="act-meter-label">{props.label}</span>
        <span class="org-muted">{props.left}</span>
        <span class="act-cost-nums org-muted">{props.right}</span>
      </div>
      <span class="org-meter" aria-hidden="true">
        <span classList={{ "org-meter--warn": props.warn }} style={{ width: `${Math.max(0, Math.min(100, props.percent))}%` }} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Billers

export function BillersView(props: { scope: CostScope }) {
  const company = useCompany();
  const week = () => weekRange(new Date());
  const billers = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "by-biller", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.byBiller(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const weekBillers = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "by-biller", week().from, week().to),
    queryFn: ({ signal }) => costsApi.byBiller(company().id, week().from, week().to, signal),
    refetchInterval: REFRESH,
  }));
  const providers = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "by-provider", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.byProvider(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const cards = createMemo(() => billerCards(billers.data, providers.data, weekBillers.data));
  return (
    <div class="act-section">
      <Switch>
        <Match when={billers.isPending}>
          <section class="card act-card">
            <p class="org-empty">Loading…</p>
          </section>
        </Match>
        <Match when={cards().length === 0}>
          <section class="card act-card">
            <p class="org-empty">No usage in this range.</p>
          </section>
        </Match>
      </Switch>
      <div class="act-report-grid">
        <For each={cards()}>{(card) => <BillerCardView card={card} scope={props.scope} />}</For>
      </div>
      <p class="org-foot">The biller is who sends the bill. It differs from the provider when a router such as OpenRouter resells a model.</p>
    </div>
  );
}

function BillerCardView(props: { card: BillerCard; scope: CostScope }) {
  const share = () => (props.scope.preset === "mtd" && props.scope.budgetCents > 0 ? Math.min(100, Math.round((props.card.costCents / props.scope.budgetCents) * 100)) : null);
  return (
    <section class="card org-card act-report" aria-label={props.card.name}>
      <div class="act-report-head">
        <div class="act-report-title">
          <h2 class="disp">{props.card.name}</h2>
          <span class="org-muted">
            {formatTokens(props.card.inputTokens)} in · {formatTokens(props.card.outputTokens)} out · {props.card.providerCount} {props.card.providerCount === 1 ? "provider" : "providers"} ·{" "}
            {props.card.modelCount} {props.card.modelCount === 1 ? "model" : "models"}
          </span>
        </div>
        <span class="act-report-total">
          <Amount {...props.card} />
        </span>
      </div>
      <Show when={share() !== null}>
        <div class="act-report-block">
          <Meter label="This month" left={formatCents(props.card.costCents)} right={`${share()}% of the company budget`} percent={share()!} />
        </div>
      </Show>
      <p class="org-muted act-report-line">
        {props.card.apiRuns} metered {props.card.apiRuns === 1 ? "run" : "runs"} · {props.card.subscriptionRuns} subscription {props.card.subscriptionRuns === 1 ? "run" : "runs"} · {formatCents(props.card.weekCents)} this week
      </p>
      <Show when={props.card.billing.length > 0}>
        <div class="act-report-block">
          <h3 class="act-report-sub">Billing</h3>
          <For each={props.card.billing}>
            {(entry) => (
              <div class="act-cost-line">
                <span>{entry.label}</span>
                <span class="act-cost-nums">{formatCents(entry.costCents)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.card.providers.length > 0}>
        <div class="act-report-block">
          <h3 class="act-report-sub">Providers</h3>
          <For each={props.card.providers}>
            {(entry) => (
              <div class="act-cost-line">
                <span>{entry.name}</span>
                <span class="act-cost-nums">
                  <span class="org-muted">{formatTokens(entry.tokens)} · </span>
                  {formatCents(entry.costCents)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Finance

export function FinanceView(props: { scope: CostScope }) {
  const company = useCompany();
  const summary = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "finance-summary", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.financeSummary(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const byBiller = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "finance-by-biller", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.financeByBiller(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const byKind = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "finance-by-kind", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.financeByKind(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: REFRESH,
  }));
  const events = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, "finance-events", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }) => costsApi.financeEvents(company().id, props.scope.from, props.scope.to, 50, signal),
    refetchInterval: REFRESH,
  }));
  const otherCurrencies = () => (summary.data?.currencies ?? []).filter((row) => row.currency !== "USD");

  return (
    <div class="act-section">
      <FinanceSummaryKpis summary={summary.data} loading={summary.isPending} />
      <Show when={otherCurrencies().length > 0}>
        <p class="org-muted">
          The totals are in US dollars only. Also recorded, without conversion:{" "}
          {otherCurrencies()
            .map((row) => `${money(row.netCents, row.currency)} net`)
            .join(", ")}
          .
        </p>
      </Show>
      <div class="act-cost-grid">
        <section class="card org-card" aria-labelledby="act-fin-biller">
          <div class="org-card-row">
            <h2 class="disp" id="act-fin-biller">
              By biller
            </h2>
            <span class="org-muted org-push">Net · debits · credits</span>
          </div>
          <Show when={(byBiller.data ?? []).length > 0} fallback={<p class="org-muted org-pad">{byBiller.isPending ? "Loading…" : "Nothing recorded in this range."}</p>}>
            <ul class="act-cost-list">
              <For each={byBiller.data}>
                {(row) => (
                  <li class="act-cost-row">
                    <div class="act-cost-line">
                      <span class="org-strong">{companyName(row.biller)}</span>
                      <span class="org-muted">
                        {row.eventCount} {row.eventCount === 1 ? "entry" : "entries"} · {row.kindCount} {row.kindCount === 1 ? "kind" : "kinds"}
                      </span>
                      <span class="act-cost-nums">
                        <b>{money(row.netCents, row.currency)}</b>{" "}
                        <span class="org-muted">
                          · {money(row.debitCents, row.currency)} · {money(row.creditCents, row.currency)}
                        </span>
                      </span>
                    </div>
                    <Show when={row.estimatedDebitCents > 0}>
                      <span class="org-muted act-report-line">{money(row.estimatedDebitCents, row.currency)} of it estimated</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
        <section class="card org-card" aria-labelledby="act-fin-kind">
          <div class="org-card-row">
            <h2 class="disp" id="act-fin-kind">
              By kind
            </h2>
            <span class="org-muted org-push">Net · debits · credits</span>
          </div>
          <Show when={(byKind.data ?? []).length > 0} fallback={<p class="org-muted org-pad">{byKind.isPending ? "Loading…" : "Nothing recorded in this range."}</p>}>
            <ul class="act-cost-list">
              <For each={byKind.data}>
                {(row) => (
                  <li class="act-cost-row">
                    <div class="act-cost-line">
                      <span class="org-strong">{financeKindLabel(row.eventKind)}</span>
                      <span class="org-muted">
                        {row.billerCount} {row.billerCount === 1 ? "biller" : "billers"}
                      </span>
                      <span class="act-cost-nums">
                        <b>{money(row.netCents, row.currency)}</b>{" "}
                        <span class="org-muted">
                          · {money(row.debitCents, row.currency)} · {money(row.creditCents, row.currency)}
                        </span>
                      </span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>
      <section class="card org-card" aria-labelledby="act-fin-events">
        <div class="org-card-row">
          <h2 class="disp" id="act-fin-events">
            Recent entries
          </h2>
          <span class="org-muted org-push">Charges, fees and credits, apart from run estimates</span>
        </div>
        <Show
          when={(events.data ?? []).length > 0}
          fallback={<p class="org-muted org-pad">{events.isPending ? "Loading…" : "Nothing recorded in this range. Entries arrive through the API, the CLI or a provider integration."}</p>}
        >
          <ul class="act-cost-list">
            <For each={events.data}>
              {(row) => (
                <li class="act-cost-row">
                  <div class="act-cost-line act-fin-line">
                    <TonePill tone={row.direction === "credit" ? "green" : "violet"} compact>
                      {row.direction === "credit" ? "Credit" : "Debit"}
                    </TonePill>
                    <span class="org-strong org-ellipsis">{financeEventLabel(row)}</span>
                    <span class="org-muted org-ellipsis">
                      {companyName(row.biller)}
                      {row.provider && row.provider !== row.biller ? ` → ${companyName(row.provider)}` : ""}
                      {row.model ? ` · ${row.model}` : ""}
                    </span>
                    <span class="act-cost-nums">
                      <b>{money(row.amountCents, row.currency)}</b>
                      <Show when={row.estimated}>
                        <span class="act-estimate">Estimated</span>
                      </Show>
                    </span>
                  </div>
                  <span class="org-muted act-report-line">
                    {agoLabel(row.occurredAt)}
                    {row.description ? ` · ${row.description}` : ""}
                    {row.externalInvoiceId ? ` · invoice ${row.externalInvoiceId}` : ""}
                    {row.region ? ` · ${row.region}` : ""}
                    {row.pricingTier ? ` · ${row.pricingTier}` : ""}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}

/** Recorded charges: net, debits, credits, the estimated part, and how many entries. */
export function FinanceSummaryKpis(props: { summary: { netCents: number; debitCents: number; creditCents: number; estimatedDebitCents: number; eventCount: number } | undefined; loading: boolean }) {
  return (
    <div class="org-kpis act-kpis">
      <div class="card org-kpi">
        <span class="org-kpi-label">Net charges</span>
        <span class="org-kpi-value disp">{props.summary ? formatCents(props.summary.netCents) : "—"}</span>
        <span class="org-kpi-note">{props.summary ? `${props.summary.eventCount} ledger entries` : props.loading ? "Loading…" : "Couldn't load"}</span>
      </div>
      <div class="card org-kpi">
        <span class="org-kpi-label">Debits</span>
        <span class="org-kpi-value disp">{props.summary ? formatCents(props.summary.debitCents) : "—"}</span>
        <span class="org-kpi-note">{props.summary ? `${formatCents(props.summary.estimatedDebitCents)} estimated` : ""}</span>
      </div>
      <div class="card org-kpi">
        <span class="org-kpi-label">Credits</span>
        <span class="org-kpi-value disp">{props.summary ? formatCents(props.summary.creditCents) : "—"}</span>
        <span class="org-kpi-note">Refunds and credit purchases</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Decision-model and fast-response calls

export function CallHistory(props: { kind: "decisions" | "fast-responses"; scope: CostScope }) {
  const company = useCompany();
  const fast = () => props.kind === "fast-responses";
  const history = createQuery(() => ({
    queryKey: queryKeys.activity.costReport(company().id, fast() ? "fast-response-history" : "decision-history", props.scope.keyFrom, props.scope.keyTo),
    queryFn: ({ signal }): Promise<(DecisionHistoryEntry & Partial<Pick<FastResponseHistoryEntry, "publicationStatus" | "connectionName">>)[]> =>
      fast() ? costsApi.fastResponseHistory(company().id, props.scope.from, props.scope.to, signal) : costsApi.decisionHistory(company().id, props.scope.from, props.scope.to, signal),
    refetchInterval: (query) => (historyBusy(query.state.data) ? (fast() ? 3_000 : 5_000) : false),
  }));
  const settingsHref = () => `/${company().issuePrefix}/company/settings/connections`;

  return (
    <section class="card act-card" aria-label={fast() ? "Fast responses" : "Decision-model calls"}>
      <Switch>
        <Match when={history.isPending}>
          <p class="org-empty">Loading…</p>
        </Match>
        <Match when={history.isError}>
          <p class="org-empty">Couldn't load the calls. {history.error instanceof Error ? history.error.message : ""}</p>
        </Match>
        <Match when={(history.data ?? []).length === 0}>
          <p class="org-empty">
            {fast() ? "No fast responses in this range." : "No decision-model calls in this range."}{" "}
            <A class="org-link" href={settingsHref()}>
              {fast() ? "Set up fast responses" : "Set up a decision model"}
            </A>{" "}
            in company settings → Connections, and run its test.
          </p>
        </Match>
      </Switch>
      <Show when={(history.data ?? []).length > 0}>
        <p class="org-muted act-calls-note">The latest calls. Their inputs aren't kept.</p>
        <div class="act-calls-scroll">
          <table class="act-calls">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">For</th>
                <th scope="col">Task</th>
                <Show when={fast()}>
                  <th scope="col">Connection</th>
                </Show>
                <th scope="col">Model</th>
                <th scope="col">Status</th>
                <th scope="col" class="act-num">
                  Time
                </th>
                <th scope="col" class="act-num">
                  Tokens in / out
                </th>
                <th scope="col" class="act-num">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={history.data}>
                {(row) => (
                  <tr>
                    <td>
                      <span class="act-call-when">{agoLabel(row.startedAt)}</span>
                      <span class="org-muted">{callFeature(row.feature)}</span>
                    </td>
                    <td>{callPerson(row)}</td>
                    <td>
                      <Show when={row.issueId} fallback={<span class="org-muted">—</span>}>
                        <A class="org-link" href={`/${company().issuePrefix}/issues/${row.issueIdentifier ?? row.issueId}`}>
                          {row.issueIdentifier ?? "Open"}
                        </A>
                      </Show>
                    </td>
                    <Show when={fast()}>
                      <td>{row.connectionName ?? (row.connectionId ? "A removed connection" : "—")}</td>
                    </Show>
                    <td class="mono">{row.model}</td>
                    <td>
                      <span>{callStatus(row.status)}</span>
                      <Show when={row.publicationStatus}>
                        <span class="org-muted">{row.publicationStatus}</span>
                      </Show>
                      <Show when={row.errorCode}>
                        <span class="org-muted">{row.errorCode!.replaceAll("_", " ")}</span>
                      </Show>
                    </td>
                    <td class="act-num mono">{durationLabel(row.durationMs)}</td>
                    <td class="act-num mono">
                      {row.inputTokens === null ? "—" : formatTokens(row.inputTokens)} / {row.outputTokens === null ? "—" : formatTokens(row.outputTokens)}
                    </td>
                    <td class="act-num mono">
                      <span>{row.costCents === null ? "Unknown" : preciseMoney(row.costCents)}</span>
                      <Show when={row.costStatus && row.costStatus !== "unpriced"}>
                        <span class="org-muted">{row.costStatus === "estimated" ? "Estimated" : "Reported"}</span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
