import { A, useLocation, useSearchParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { ChevronDown, ChevronRight } from "lucide-solid";
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { budgetsApi } from "@/api/budgets";
import { costsApi } from "@/api/costs";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { formatCents } from "@/projects/dashboard-model";
import { useMinute } from "@/org/queries";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar } from "@/ui/Avatar";
import { TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import {
  agentCostRows,
  barPercent,
  budgetHref,
  budgetRows,
  costRange,
  formatTokens,
  isRangePreset,
  pricingNote,
  projectCostRows,
  RANGE_PRESETS,
  type AgentCostRow,
  type RangePreset,
} from "./costs-model";

/*
 * Costs (`/:prefix/activity/costs`): what the organization spent over a range, as the old Costs
 * page's Overview and Budgets show it: the range's spend and tokens against the company budget
 * (`/costs/summary`), spend by agent with each agent's models (`/costs/by-agent`,
 * `/costs/by-agent-model`), by project (`/costs/by-project`), and the budgets in force with any
 * open incidents (`/budgets/overview`). Ranges: this month, 7 or 30 days, this year, all time, or
 * custom days, kept in the address (`?range=`, `?from=`, `?to=`).
 *
 * Budgets are set where they apply (agent, project and company settings); the cards link there,
 * and incidents are resolved from the Inbox. Not ported from the old page: providers and billers,
 * the finance ledger, subscriptions and quota windows, spend by person, data quality, and the
 * decision and fast-response histories.
 */

export function Costs() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const location = useLocation();
  const people = useTaskPeople();
  const minute = useMinute();
  const [search, setSearch] = useSearchParams<{ range?: string; from?: string; to?: string }>();
  const preset = (): RangePreset => (isRangePreset(search.range) ? search.range : "mtd");
  const range = createMemo(() => costRange(preset(), new Date(minute()), { from: search.from, to: search.to }));
  // The range's lower bound moves with the clock for rolling windows; key the cache by the preset so polling doesn't pile up entries.
  const keyFrom = () => (preset() === "custom" ? range()?.from : preset());
  const keyTo = () => (preset() === "custom" ? range()?.to : undefined);
  const ready = () => range() !== null;

  const summary = createQuery(() => ({
    queryKey: queryKeys.activity.costSummary(company().id, keyFrom(), keyTo()),
    queryFn: ({ signal }) => costsApi.summary(company().id, range()?.from, range()?.to, signal),
    enabled: ready(),
  }));
  const byAgent = createQuery(() => ({
    queryKey: queryKeys.agents.costs(company().id, keyFrom() ?? "all", keyTo() ?? "now"),
    queryFn: ({ signal }) => costsApi.byAgent(company().id, range()?.from, range()?.to, signal),
    enabled: ready(),
  }));
  const byModel = createQuery(() => ({
    queryKey: queryKeys.agents.costsByModel(company().id, keyFrom() ?? "all", keyTo() ?? "now"),
    queryFn: ({ signal }) => costsApi.byAgentModel(company().id, range()?.from, range()?.to, signal),
    enabled: ready(),
  }));
  const byProject = createQuery(() => ({
    queryKey: queryKeys.costs(company().id, keyFrom(), keyTo()),
    queryFn: ({ signal }) => costsApi.byProject(company().id, range()?.from, range()?.to, signal),
    enabled: ready(),
  }));
  const budgets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.budgets(company().id),
    queryFn: ({ signal }) => budgetsApi.overview(company().id, signal),
    staleTime: 15_000,
  }));

  const agents = createMemo(() => agentCostRows(byAgent.data, byModel.data));
  const projects = createMemo(() => projectCostRows(byProject.data));
  const budgetList = createMemo(() => budgetRows(budgets.data?.policies));
  const totalTokens = () => agents().reduce((sum, row) => sum + row.tokens, 0);
  const runsLine = () => {
    const api = agents().reduce((sum, row) => sum + row.apiRuns, 0);
    const sub = agents().reduce((sum, row) => sum + row.subscriptionRuns, 0);
    return [api ? `${api} billed per request` : null, sub ? `${sub} on a subscription` : null].filter(Boolean).join(" · ") || "No runs in this range";
  };
  const companyBudget = () => summary.data?.budgetCents ?? 0;

  onMount(() => {
    if (location.hash === "#budgets") requestAnimationFrame(() => document.getElementById("budgets")?.scrollIntoView({ block: "start" }));
  });

  return (
    <section class="act-section" aria-label="Costs">
      <div class="act-toolbar">
        <Segmented
          label="Range"
          options={RANGE_PRESETS}
          value={preset()}
          onChange={(value) => setSearch({ range: value === "mtd" ? undefined : value, ...(value === "custom" ? {} : { from: undefined, to: undefined }) }, { replace: true })}
        />
        <Show when={preset() === "custom"}>
          <label class="act-date">
            <span>From</span>
            <TextInput type="date" value={search.from ?? ""} max={search.to || undefined} onChange={(event) => setSearch({ from: event.currentTarget.value || undefined }, { replace: true })} />
          </label>
          <label class="act-date">
            <span>To</span>
            <TextInput type="date" value={search.to ?? ""} min={search.from || undefined} onChange={(event) => setSearch({ to: event.currentTarget.value || undefined }, { replace: true })} />
          </label>
        </Show>
      </div>

      <Show when={ready()} fallback={<section class="card act-card"><p class="org-empty">Pick the first and last day to see that range.</p></section>}>
        <div class="org-kpis act-kpis">
          <div class="card org-kpi">
            <span class="org-kpi-label">Spend</span>
            <span class="org-kpi-value disp">{summary.data ? formatCents(summary.data.spendCents) : "—"}</span>
            <span class="org-kpi-note">{pricingNote(summary.data) ?? `${summary.data?.eventCount ?? 0} usage reports`}</span>
          </div>
          <div class="card org-kpi">
            <span class="org-kpi-label">Tokens</span>
            <span class="org-kpi-value disp">{byAgent.data ? formatTokens(totalTokens()) : "—"}</span>
            <span class="org-kpi-note">{runsLine()}</span>
          </div>
          <div class="card org-kpi">
            <span class="org-kpi-label">Company budget</span>
            <span class="org-kpi-value disp">{companyBudget() > 0 ? (preset() === "mtd" ? `${summary.data?.utilizationPercent ?? 0}%` : formatCents(companyBudget(), true)) : "None"}</span>
            <span class="org-kpi-note">
              {companyBudget() > 0
                ? preset() === "mtd"
                  ? `${formatCents(summary.data?.spendCents ?? 0)} of ${formatCents(companyBudget(), true)} this month`
                  : "A month's limit"
                : "No monthly limit set"}
            </span>
          </div>
          <div class="card org-kpi">
            <span class="org-kpi-label">Budget incidents</span>
            <span class="org-kpi-value disp" classList={{ "org-amber": (budgets.data?.activeIncidents.length ?? 0) > 0 }}>
              {budgets.data?.activeIncidents.length ?? "—"}
            </span>
            <span class="org-kpi-note">
              {budgets.data ? `${budgets.data.pausedAgentCount} agents and ${budgets.data.pausedProjectCount} projects paused` : ""}
            </span>
          </div>
        </div>

        <div class="act-cost-grid">
          <section class="card org-card act-cost-card" aria-labelledby="act-by-agent">
            <div class="org-card-row">
              <h2 class="disp" id="act-by-agent">
                By agent
              </h2>
              <span class="org-muted org-push">Spend · tokens</span>
            </div>
            <Switch>
              <Match when={byAgent.isPending}>
                <p class="org-muted org-pad">Loading…</p>
              </Match>
              <Match when={agents().length === 0}>
                <p class="org-muted org-pad">No usage in this range.</p>
              </Match>
            </Switch>
            <ul class="act-cost-list">
              <For each={agents()}>{(row) => <AgentCost row={row} max={Math.max(...agents().map((entry) => entry.costCents))} maxTokens={Math.max(...agents().map((entry) => entry.tokens))} base={base()} people={people} />}</For>
            </ul>
          </section>

          <section class="card org-card act-cost-card" aria-labelledby="act-by-project">
            <div class="org-card-row">
              <h2 class="disp" id="act-by-project">
                By project
              </h2>
              <span class="org-muted org-push">Spend · tokens</span>
            </div>
            <Switch>
              <Match when={byProject.isPending}>
                <p class="org-muted org-pad">Loading…</p>
              </Match>
              <Match when={projects().length === 0}>
                <p class="org-muted org-pad">No usage in this range.</p>
              </Match>
            </Switch>
            <ul class="act-cost-list">
              <For each={projects()}>
                {(row) => {
                  const maxTokens = () => Math.max(...projects().map((entry) => entry.tokens));
                  return (
                    <li class="act-cost-row">
                      <div class="act-cost-line">
                        <Show when={row.projectId} fallback={<span class="org-muted">{row.name}</span>}>
                          {(id) => (
                            <A class="act-target org-ellipsis" href={`${base()}/projects/${id()}`}>
                              {row.name}
                            </A>
                          )}
                        </Show>
                        <span class="act-cost-nums">
                          <b>{formatCents(row.costCents)}</b> <span class="org-muted">· {formatTokens(row.tokens)}</span>
                        </span>
                      </div>
                      <span class="org-meter" aria-hidden="true">
                        <span style={{ width: `${barPercent(row.tokens, maxTokens())}%` }} />
                      </span>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>
        </div>
      </Show>

      <section class="card org-card" id="budgets" aria-labelledby="act-budgets">
        <div class="org-card-row">
          <h2 class="disp" id="act-budgets">
            Budgets
          </h2>
          <A class="org-link org-push" href={`${base()}/company/settings/budgets`}>
            Company budget
          </A>
        </div>
        <Show when={(budgets.data?.activeIncidents.length ?? 0) > 0}>
          <p class="act-incidents">
            <TonePill tone="amber" compact>
              {budgets.data!.activeIncidents.length} open {budgets.data!.activeIncidents.length === 1 ? "incident" : "incidents"}
            </TonePill>{" "}
            {budgets.data!.activeIncidents.map((incident) => incident.scopeName).join(", ")} crossed a limit.{" "}
            <A class="org-link" href={`${base()}/inbox`}>
              Resolve in the Inbox
            </A>
          </p>
        </Show>
        <Switch>
          <Match when={budgets.isPending}>
            <p class="org-muted org-pad">Loading…</p>
          </Match>
          <Match when={budgetList().length === 0}>
            <p class="org-muted org-pad">No budgets set. Set one in an agent's or project's settings, or for the whole company.</p>
          </Match>
        </Switch>
        <ul class="act-cost-list act-budgets">
          <For each={budgetList()}>
            {(row) => (
              <li class="act-cost-row">
                <div class="act-cost-line">
                  <span class="act-budget-name">
                    <A class="act-target org-ellipsis" href={`${base()}${budgetHref(row, (id) => people.agent(id)?.urlKey)}`}>
                      {row.name}
                    </A>
                    <span class="org-muted">
                      {row.scope === "company" ? "Organization" : row.scope === "agent" ? "Agent" : "Project"} · {row.window}
                    </span>
                    <Show when={row.paused}>
                      <TonePill tone="red" compact>
                        Paused
                      </TonePill>
                    </Show>
                  </span>
                  <span class="act-cost-nums">
                    <b>{formatCents(row.spentCents)}</b> <span class="org-muted">of {formatCents(row.limitCents, true)}</span>
                  </span>
                </div>
                <span class="org-meter" aria-hidden="true">
                  <span classList={{ "org-meter--warn": row.status !== "ok" }} style={{ width: `${row.percent}%` }} />
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>
    </section>
  );
}

function AgentCost(props: { row: AgentCostRow; max: number; maxTokens: number; base: string; people: ReturnType<typeof useTaskPeople> }) {
  const [open, setOpen] = createSignal(false);
  const agent = () => (props.row.agentId ? props.people.agent(props.row.agentId) : undefined);
  return (
    <li class="act-cost-row">
      <div class="act-cost-line">
        <button
          type="button"
          class="act-expand"
          aria-expanded={open()}
          aria-label={`${open() ? "Hide" : "Show"} ${props.row.name}'s models`}
          disabled={props.row.models.length === 0}
          onClick={() => setOpen(!open())}
        >
          <Show when={open()} fallback={<ChevronRight size={14} aria-hidden="true" />}>
            <ChevronDown size={14} aria-hidden="true" />
          </Show>
        </button>
        <Show when={agent()} fallback={<span class="org-muted">{props.row.name}</span>}>
          {(found) => (
            <A class="act-cost-agent" href={`${props.base}/agents/${found().urlKey}`}>
              <AgentAvatar agent={found()} size={20} />
              <span class="act-target org-ellipsis">{found().name}</span>
            </A>
          )}
        </Show>
        <span class="act-cost-nums">
          <b>{formatCents(props.row.costCents)}</b> <span class="org-muted">· {formatTokens(props.row.tokens)}</span>
        </span>
      </div>
      <span class="org-meter" aria-hidden="true">
        <span style={{ width: `${props.max > 0 ? barPercent(props.row.costCents, props.max) : barPercent(props.row.tokens, props.maxTokens)}%` }} />
      </span>
      <Show when={open()}>
        <ul class="act-models">
          <For each={props.row.models}>
            {(model) => (
              <li>
                <span class="mono org-ellipsis">{model.model}</span>
                <span class="org-muted org-ellipsis">
                  {model.provider} · {model.billing}
                </span>
                <span class="act-cost-nums">
                  {formatCents(model.costCents)} <span class="org-muted">· {formatTokens(model.tokens)}</span>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}
