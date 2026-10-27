import type { AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, PauseCircle } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { budgetsApi } from "@/api/budgets";
import { costsApi } from "@/api/costs";
import { queryKeys } from "@/api/queryKeys";
import { runPath, runsApi } from "@/api/runs";
import { budgetDirty, budgetDraft, budgetProblem, currentPolicy, parseDollars, WARN_OPTIONS, windowLabel, type BudgetDraft } from "@/projects/settings/settings-model";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { agentBudgetRequests, agentPolicies, formatCents, formatTokens, monthRange, runUsage, toNumber } from "../agent-model";
import { dateTime, failure, FootError, refreshAgent, SectionTitle } from "../shared";
import { runStatusTone } from "./RunnerStateCard";

/*
 * Budget (board 30's outline): the agent's spending limit, as a budget policy scoped to the agent
 * (`POST /companies/:id/budgets/policies`, billed cents), with the project budget's controls; and
 * its usage: this month's spend and tokens by model (`/costs/by-agent`, `/costs/by-agent-model`)
 * and its recent runs. Subscription runs cost nothing extra, so their tokens are shown apart.
 */

export function BudgetSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const overview = createQuery(() => ({
    queryKey: queryKeys.projectSettings.budgets(company().id),
    queryFn: ({ signal }) => budgetsApi.overview(company().id, signal),
  }));
  const policies = createMemo(() => agentPolicies(overview.data, props.agent.id));
  const policy = createMemo(() => currentPolicy(policies()));
  const [draft, setDraft] = createStore<BudgetDraft>(budgetDraft(null));
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  createEffect(on(() => JSON.stringify(budgetDraft(policy())), () => setDraft(reconcile(budgetDraft(policy())))));
  const dirty = () => budgetDirty(policy(), draft);
  const limitOn = () => (parseDollars(draft.amount) ?? 0) > 0;

  const save = async () => {
    const found = budgetProblem(draft);
    if (found) return setProblem(found);
    setBusy(true);
    setProblem(null);
    try {
      for (const request of agentBudgetRequests(props.agent.id, policies(), { ...draft })) await budgetsApi.upsertPolicy(company().id, request);
      await Promise.all([client.invalidateQueries({ queryKey: queryKeys.projectSettings.budgets(company().id) }), refreshAgent(client, company().id, props.agent.id)]);
      pushToast({ tone: "success", title: limitOn() ? "Saved the budget" : "Turned the budget off" });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the budget."));
      void client.invalidateQueries({ queryKey: queryKeys.projectSettings.budgets(company().id) });
    } finally {
      setBusy(false);
    }
  };
  const percent = () => {
    const current = policy();
    return current && current.amount > 0 ? Math.min(100, Math.max(0, current.utilizationPercent)) : null;
  };
  const tone = () => (policy()?.status === "hard_stop" ? "over" : policy()?.status === "warning" ? "warn" : "ok");

  return (
    <>
      <SectionTitle title="Budget">How much {props.agent.name} may spend, and what it has used.</SectionTitle>
      <SettingsCard
        title={draft.windowKind === "lifetime" ? "Lifetime limit" : "Monthly limit"}
        description="What this agent may spend across every project. Company-wide budgets are set in company settings."
        footer={
          dirty() || problem() ? (
            <span class="ps-foot-end">
              <FootError message={problem()} />
              <Show when={dirty()}>
                <Button size="compact" variant="quiet" disabled={busy()} onClick={() => setDraft(reconcile(budgetDraft(policy())))}>
                  Discard
                </Button>
                <Button size="compact" variant="primary" disabled={busy()} onClick={() => void save()}>
                  {busy() ? "Saving…" : "Save budget"}
                </Button>
              </Show>
            </span>
          ) : undefined
        }
      >
        <Show when={props.agent.pausedAt && props.agent.pauseReason === "budget"}>
          <div class="ps-banner ps-banner--red" role="status">
            <PauseCircle size={16} aria-hidden="true" />
            {props.agent.name} is paused: it reached its budget. Raise the limit, then resume it.
          </div>
        </Show>
        <Show when={overview.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the budget. {failure(overview.error, "")}
          </p>
        </Show>
        <SettingsRow label="Period">
          <Segmented
            label="Budget period"
            options={[
              { value: "calendar_month_utc", label: "Monthly" },
              { value: "lifetime", label: "Lifetime" },
            ]}
            value={draft.windowKind}
            onChange={(value) => setDraft("windowKind", value)}
          />
        </SettingsRow>
        <SettingsRow label="Limit" help="Leave it empty for no limit." for="ag-budget-amount">
          <div class="ps-money">
            <span aria-hidden="true">$</span>
            <TextInput
              id="ag-budget-amount"
              inputmode="decimal"
              placeholder="0.00"
              autocomplete="off"
              value={draft.amount}
              invalid={parseDollars(draft.amount) === null}
              onInput={(event) => {
                setProblem(null);
                setDraft("amount", event.currentTarget.value);
              }}
            />
          </div>
        </SettingsRow>
        <Show when={policy()}>
          {(current) => (
            <SettingsRow label={windowLabel(current().windowKind)}>
              <div class="ps-spend">
                <div class="ps-inline">
                  <span class="ps-spend-amount">{formatCents(current().observedAmount)}</span>
                  <span class="ps-muted-line">spent{percent() !== null ? ` · ${percent()}%` : ""}</span>
                </div>
                <Show when={percent() !== null}>
                  <div class="ps-meter" classList={{ "ps-meter--warn": tone() === "warn", "ps-meter--over": tone() === "over" }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent()!} aria-label="Budget used">
                    <span style={{ width: `${percent()}%` }} />
                  </div>
                </Show>
              </div>
            </SettingsRow>
          )}
        </Show>
        <Show when={limitOn()}>
          <SettingsRow label="Warn me at">
            <Menu>
              <Menu.Trigger as={FieldButton} class="ps-field-240" aria-label={`Warn at ${draft.warnPercent}% of the limit`}>
                {draft.warnPercent}% of the limit
              </Menu.Trigger>
              <Menu.Content label="Warn at" width={220}>
                <For each={WARN_OPTIONS.includes(draft.warnPercent) ? WARN_OPTIONS : [...WARN_OPTIONS, draft.warnPercent].sort((a, b) => a - b)}>
                  {(value) => (
                    <Menu.Item onSelect={() => setDraft("warnPercent", value)} hint={value === draft.warnPercent ? <Check size={14} /> : undefined}>
                      {value}% of the limit
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </SettingsRow>
          <SettingsRow label="When the limit is reached">
            <Menu>
              <Menu.Trigger as={FieldButton} class="ps-field-320" aria-label="When the limit is reached">
                {draft.hardStop ? `Pause ${props.agent.name}` : "Only warn me"}
              </Menu.Trigger>
              <Menu.Content label="When the limit is reached" width={300}>
                <Menu.Item onSelect={() => setDraft("hardStop", true)} description="New runs wait until the limit is raised" hint={draft.hardStop ? <Check size={14} /> : undefined}>
                  Pause {props.agent.name}
                </Menu.Item>
                <Menu.Item onSelect={() => setDraft("hardStop", false)} description="Runs carry on past the limit" hint={draft.hardStop ? undefined : <Check size={14} />}>
                  Only warn me
                </Menu.Item>
              </Menu.Content>
            </Menu>
          </SettingsRow>
        </Show>
      </SettingsCard>
      <UsageCard agent={props.agent} />
    </>
  );
}

/** This month's spend and tokens by model, and the agent's recent runs. */
function UsageCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const range = monthRange();
  const byAgent = createQuery(() => ({
    queryKey: queryKeys.agents.costs(company().id, range.from.slice(0, 10), "now"),
    queryFn: ({ signal }) => costsApi.byAgent(company().id, range.from, undefined, signal),
    retry: false,
  }));
  const byModel = createQuery(() => ({
    queryKey: queryKeys.agents.costsByModel(company().id, range.from.slice(0, 10), "now"),
    queryFn: ({ signal }) => costsApi.byAgentModel(company().id, range.from, undefined, signal),
    retry: false,
  }));
  const runs = createQuery(() => ({
    queryKey: queryKeys.agents.runs(company().id, props.agent.id),
    queryFn: ({ signal }) => runsApi.list(company().id, { agentId: props.agent.id, limit: 20, summary: true }, signal),
    retry: false,
  }));
  const mine = createMemo(() => (byAgent.data ?? []).find((row) => row.agentId === props.agent.id));
  const models = createMemo(() => (byModel.data ?? []).filter((row) => row.agentId === props.agent.id).sort((a, b) => b.costCents - a.costCents || b.inputTokens - a.inputTokens));
  const recent = createMemo(() => runUsage(runs.data));

  return (
    <SettingsCard title="Usage this month" description="From the cost ledger, since the first of the month (UTC).">
      <Show when={byAgent.isError}>
        <p class="ps-list-note" role="alert">
          Couldn't load the costs. {failure(byAgent.error, "")}
        </p>
      </Show>
      <SettingsRow label="Spend">
        <Show when={mine()} fallback={<span class="ag-static-text">{byAgent.isLoading ? "Loading…" : "Nothing spent this month."}</span>}>
          {(row) => (
            <div class="ag-stats">
              <span>
                <b>{formatCents(row().costCents)}</b> billed
              </span>
              <span>
                <b>{row().apiRunCount}</b> API {row().apiRunCount === 1 ? "run" : "runs"}
              </span>
              <span>
                <b>{row().subscriptionRunCount}</b> subscription {row().subscriptionRunCount === 1 ? "run" : "runs"}
              </span>
            </div>
          )}
        </Show>
      </SettingsRow>
      <Show when={mine()}>
        {(row) => (
          <SettingsRow label="Tokens" help="Subscription tokens are included in the plan.">
            <div class="ag-stats">
              <span>
                <b>{formatTokens(row().inputTokens)}</b> input
              </span>
              <span>
                <b>{formatTokens(row().cachedInputTokens)}</b> cached
              </span>
              <span>
                <b>{formatTokens(row().outputTokens)}</b> output
              </span>
            </div>
          </SettingsRow>
        )}
      </Show>
      <Show when={models().length > 0}>
        <SettingsRow label="By model">
          <ul class="ps-list">
            <For each={models()}>
              {(row) => (
                <li class="ps-list-row">
                  <span class="ps-list-name">
                    <b class="mono">{row.model}</b>
                    <span class="ps-list-meta">
                      {row.provider} · {row.billingType.replace(/_/g, " ")} · {formatTokens(row.inputTokens + row.cachedInputTokens + row.outputTokens)} tokens
                    </span>
                  </span>
                  <span>{formatCents(row.costCents)}</span>
                </li>
              )}
            </For>
          </ul>
        </SettingsRow>
      </Show>
      <SettingsRow label="Recent runs" help={runs.data ? `The last ${recent().count}: ${formatTokens(recent().input + recent().cached + recent().output)} tokens${recent().failed ? `, ${recent().failed} failed` : ""}.` : undefined}>
        <Show when={(runs.data ?? []).length > 0} fallback={<span class="ag-static-text">{runs.isLoading ? "Loading…" : runs.isError ? failure(runs.error, "Couldn't load the runs.") : "No runs yet."}</span>}>
          <ul class="ps-list ag-runs">
            <For each={(runs.data ?? []).slice(0, 8)}>
              {(run) => (
                <li class="ps-list-row">
                  <TonePill tone={runStatusTone(run.status)} compact>
                    {run.status.replace(/_/g, " ")}
                  </TonePill>
                  <span class="ps-list-name">
                    <A class="ps-link mono" href={runPath(company().issuePrefix, props.agent.urlKey, run.id)}>
                      {run.id.slice(0, 8)}
                    </A>
                    <span class="ps-list-meta">
                      {dateTime(run.startedAt ?? run.createdAt)} · {run.invocationSource.replace(/_/g, " ")} · {formatTokens(toNumber(run.inputTokens) + toNumber(run.cachedInputTokens) + toNumber(run.outputTokens))} tokens
                    </span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </SettingsRow>
    </SettingsCard>
  );
}
