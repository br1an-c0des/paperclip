import type { BudgetIncident, BudgetPolicySummary, BudgetWindowKind } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, CircleCheck, Plus } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { activeAgents } from "@/api/agents";
import { budgetsApi } from "@/api/budgets";
import { openProjects } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import {
  companyPolicy,
  dollars,
  incidentText,
  limitAction,
  monthName,
  ORG_WARN_OPTIONS,
  parseDollars,
  resetsLabel,
  rowDirty,
  rowDraft,
  rowRequest,
  scopeRows,
  shortDollars,
  suggestedRaise,
  usedPercent,
  type BudgetRowDraft,
  type ScopeKind,
} from "./budgets-model";
import { CardHead, CardNoteLine, failure, FootError, SectionTitle } from "./shared";

/*
 * Budgets (board 25): monthly limits for the organization, its agents and its projects, all in one
 * place, and the incidents when one was reached. Each card saves as a set. Spend charts stay in
 * Activity → Costs. A project budget the old UI set as lifetime keeps its window here.
 */

export function BudgetsSection() {
  const company = useCompany();
  const client = useQueryClient();
  const overview = createQuery(() => ({
    queryKey: queryKeys.projectSettings.budgets(company().id),
    queryFn: ({ signal }) => budgetsApi.overview(company().id, signal),
  }));
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.projectSettings.budgets(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.companies.all }),
      client.invalidateQueries({ queryKey: queryKeys.dashboard(company().id) }),
    ]);

  return (
    <>
      <SectionTitle title="Budgets">
        Monthly limits for the organization, its agents and its projects, all in one place. Spending charts stay in{" "}
        <A class="ps-link" href={`/${company().issuePrefix}/activity/costs`}>
          Activity → Costs
        </A>
        .
      </SectionTitle>
      <Show when={overview.isError}>
        <CardNoteLine alert>Couldn't load the budgets. {failure(overview.error, "")}</CardNoteLine>
      </Show>
      <OrganizationBudgetCard policy={companyPolicy(overview.data, company().id)} loaded={!!overview.data} onSaved={refresh} />
      <ScopesCard policies={overview.data?.policies} loaded={!!overview.data} onSaved={refresh} />
      <IncidentsCard incidents={overview.data?.activeIncidents ?? []} loaded={!!overview.data} onSaved={refresh} />
    </>
  );
}

function OrganizationBudgetCard(props: { policy: BudgetPolicySummary | null; loaded: boolean; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [draft, setDraft] = createStore<BudgetRowDraft>(rowDraft(null));
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  createEffect(on(() => JSON.stringify(rowDraft(props.policy)), () => setDraft(reconcile(rowDraft(props.policy)))));
  const dirty = () => rowDirty(props.policy, draft);
  const limitOn = () => (parseDollars(draft.amount) ?? 0) > 0;
  const percent = () => usedPercent(props.policy);
  const warnOptions = () => (ORG_WARN_OPTIONS.includes(draft.warnPercent) ? ORG_WARN_OPTIONS : [...ORG_WARN_OPTIONS, draft.warnPercent].sort((a, b) => a - b));

  const save = async () => {
    const request = rowRequest({ scopeType: "company", scopeId: company().id, windowKind: "calendar_month_utc" }, draft);
    if (!request) return setProblem("Enter the budget in dollars, such as 500 or 500.00.");
    setBusy(true);
    setProblem(null);
    try {
      await budgetsApi.upsertPolicy(company().id, request);
      await props.onSaved();
      pushToast({ tone: "success", title: limitOn() ? "Saved the organization budget" : "Turned the organization budget off" });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the budget."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title="Organization budget"
      footer={
        dirty() || problem() ? (
          <span class="ps-foot-end">
            <FootError message={problem()} />
            <Show when={dirty()}>
              <Button size="compact" variant="quiet" disabled={busy()} onClick={() => setDraft(reconcile(rowDraft(props.policy)))}>
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
      <SettingsRow label="Monthly budget" for="cs-org-budget" help="Leave it empty for no limit.">
        <div class="ps-money cs-field-160">
          <span aria-hidden="true">$</span>
          <TextInput
            id="cs-org-budget"
            inputmode="decimal"
            placeholder="0"
            autocomplete="off"
            value={draft.amount}
            invalid={parseDollars(draft.amount) === null}
            disabled={!props.loaded}
            onInput={(event) => {
              setProblem(null);
              setDraft("amount", event.currentTarget.value);
            }}
          />
        </div>
      </SettingsRow>
      <SettingsRow label="This month" help={resetsLabel(props.policy?.windowEnd)}>
        <div class="ps-spend">
          <span class="ps-muted-line">
            <span class="ps-spend-amount">{dollars(props.policy?.observedAmount ?? company().spentMonthlyCents)}</span> spent
            {percent() !== null ? ` · ${percent()}%` : ""}
          </span>
          <Show when={percent() !== null}>
            <div
              class="ps-meter"
              classList={{ "ps-meter--warn": props.policy?.status === "warning", "ps-meter--over": props.policy?.status === "hard_stop" }}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent()!}
              aria-label="Organization budget used"
            >
              <span style={{ width: `${percent()}%` }} />
            </div>
          </Show>
        </div>
      </SettingsRow>
      <Show when={limitOn()}>
        <SettingsRow label="Warn me at">
          <Segmented
            label="Warn at"
            options={warnOptions().map((value) => ({ value: String(value), label: `${value}%` }))}
            value={String(draft.warnPercent)}
            onChange={(value) => setDraft("warnPercent", Number(value))}
          />
        </SettingsRow>
        <SettingsRow label="When it is reached">
          <LimitMenu scope="company" hardStop={draft.hardStop} onChange={(value) => setDraft("hardStop", value)} />
        </SettingsRow>
      </Show>
    </SettingsCard>
  );
}

function LimitMenu(props: { scope: ScopeKind; hardStop: boolean; onChange: (hardStop: boolean) => void; label?: string }) {
  return (
    <Menu>
      <Menu.Trigger as={FieldButton} class="cs-field-200" aria-label={props.label ?? "When the limit is reached"}>
        {limitAction(props.scope, props.hardStop)}
      </Menu.Trigger>
      <Menu.Content label="When the limit is reached" width={280}>
        <Menu.Item onSelect={() => props.onChange(true)} description="New runs wait until the limit is raised" hint={props.hardStop ? <Check size={14} /> : undefined}>
          {limitAction(props.scope, true)}
        </Menu.Item>
        <Menu.Item onSelect={() => props.onChange(false)} description="Runs carry on past the limit" hint={props.hardStop ? undefined : <Check size={14} />}>
          Only warn
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

type Row = { key: string; scopeType: "agent" | "project"; scopeId: string; scopeName: string; windowKind: BudgetWindowKind; policy: BudgetPolicySummary | null };

function ScopesCard(props: { policies: BudgetPolicySummary[] | undefined; loaded: boolean; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const rows = createMemo(() => scopeRows(props.policies ? { companyId: "", policies: props.policies, activeIncidents: [], pausedAgentCount: 0, pausedProjectCount: 0, pendingApprovalCount: 0 } : undefined));
  // Scopes picked with "Add a budget" that have no policy yet.
  const [added, setAdded] = createSignal<Row[]>([]);
  const [drafts, setDrafts] = createStore<Record<string, BudgetRowDraft>>({});
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const toRow = (policy: BudgetPolicySummary): Row => ({
    key: `${policy.scopeType}:${policy.scopeId}:${policy.windowKind}`,
    scopeType: policy.scopeType as "agent" | "project",
    scopeId: policy.scopeId,
    scopeName: policy.scopeName,
    windowKind: policy.windowKind,
    policy,
  });
  const existing = createMemo(() => ({ agents: rows().agents.map(toRow), projects: rows().projects.map(toRow) }));
  const allRows = () => [...existing().agents, ...existing().projects, ...added()];
  const agentRows = () => [...existing().agents, ...added().filter((row) => row.scopeType === "agent")];
  const projectRows = () => [...existing().projects, ...added().filter((row) => row.scopeType === "project")];

  createEffect(
    on(
      () => JSON.stringify(props.policies ?? null),
      () => {
        setDrafts(reconcile(Object.fromEntries(allRows().map((row) => [row.key, rowDraft(row.policy)]))));
        setAdded((list) => list.filter((row) => !existing().agents.concat(existing().projects).some((entry) => entry.key === row.key)));
      },
    ),
  );
  const draftFor = (row: Row) => drafts[row.key] ?? rowDraft(row.policy);
  const changed = () => allRows().filter((row) => rowDirty(row.policy, draftFor(row)));

  const withBudget = (type: "agent" | "project") => new Set(allRows().filter((row) => row.scopeType === type).map((row) => row.scopeId));
  const addableAgents = () => activeAgents(agents.data).filter((agent) => agent.status !== "pending_approval" && !withBudget("agent").has(agent.id));
  const addableProjects = () => openProjects(projects.data ?? []).filter((project) => !withBudget("project").has(project.id));
  const add = (scopeType: "agent" | "project", scopeId: string, scopeName: string) => {
    const row: Row = { key: `${scopeType}:${scopeId}:calendar_month_utc`, scopeType, scopeId, scopeName, windowKind: "calendar_month_utc", policy: null };
    setAdded((list) => [...list, row]);
    setDrafts(row.key, { amount: "", warnPercent: 80, hardStop: true });
    queueMicrotask(() => document.getElementById(`cs-budget-${row.key}`)?.focus());
  };

  const discard = () => {
    setAdded([]);
    setDrafts(reconcile(Object.fromEntries([...existing().agents, ...existing().projects].map((row) => [row.key, rowDraft(row.policy)]))));
    setProblem(null);
  };
  const save = async () => {
    const requests = changed().map((row) => ({ row, request: rowRequest(row, draftFor(row)) }));
    const invalid = requests.find((entry) => !entry.request);
    if (invalid) return setProblem(`Enter ${invalid.row.scopeName}'s budget in dollars.`);
    setBusy(true);
    setProblem(null);
    try {
      for (const entry of requests) await budgetsApi.upsertPolicy(company().id, entry.request!);
      await props.onSaved();
      setAdded([]);
      pushToast({ tone: "success", title: requests.length === 1 ? `Saved ${requests[0]!.row.scopeName}'s budget` : `Saved ${requests.length} budgets` });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the budgets."));
      void props.onSaved();
    } finally {
      setBusy(false);
    }
  };

  const RowView = (row: Row) => {
    const draft = () => draftFor(row);
    const agent = () => (row.scopeType === "agent" ? agents.data?.find((entry) => entry.id === row.scopeId) : undefined);
    const percent = () => usedPercent(row.policy);
    return (
      <div class="cs-trow" role="row">
        <span role="cell" class="cs-person">
          <Show when={agent()} fallback={<InitialsDisc name={row.scopeName.slice(0, 1)} seed={row.scopeId} size={24} />}>
            {(found) => <AgentAvatar agent={found()} size={24} ring={false} />}
          </Show>
          <span class="cs-strong cs-ellipsis">{row.scopeName}</span>
          <Show when={row.policy?.paused}>
            <span class="cs-pill cs-pill--red">Paused</span>
          </Show>
        </span>
        <span role="cell" class="ps-money">
          <span aria-hidden="true">$</span>
          <TextInput
            id={`cs-budget-${row.key}`}
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            aria-label={`${row.scopeName}'s ${row.windowKind === "lifetime" ? "lifetime" : "monthly"} budget`}
            value={draft().amount}
            invalid={parseDollars(draft().amount) === null}
            onInput={(event) => {
              setProblem(null);
              setDrafts(row.key, { ...draft(), amount: event.currentTarget.value });
            }}
          />
          <Show when={row.windowKind === "lifetime"}>
            <span class="cs-muted cs-small">lifetime</span>
          </Show>
        </span>
        <span role="cell" class="cs-spend">
          <Show when={row.policy} fallback={<span class="cs-muted">New</span>}>
            {(policy) => (
              <>
                <span class="cs-tabular">
                  {dollars(policy().observedAmount)}
                  <Show when={percent() !== null}>
                    <span class="cs-muted"> · {percent()}%</span>
                  </Show>
                </span>
                <Show when={percent() !== null}>
                  <span class="ps-meter" classList={{ "ps-meter--warn": policy().status === "warning", "ps-meter--over": policy().status === "hard_stop" }} aria-hidden="true">
                    <span style={{ width: `${percent()}%` }} />
                  </span>
                </Show>
              </>
            )}
          </Show>
        </span>
        <span role="cell">
          <LimitMenu scope={row.scopeType} hardStop={draft().hardStop} label={`At ${row.scopeName}'s limit`} onChange={(value) => setDrafts(row.key, { ...draft(), hardStop: value })} />
        </span>
      </div>
    );
  };

  return (
    <section class="card settings-card" aria-labelledby="cs-budgets">
      <CardHead
        id="cs-budgets"
        title="Agents and projects"
        note="A run stops when its agent or its project reaches its budget, whichever comes first. Clear an amount to remove that budget."
        actions={
          <Menu placement="bottom-end">
            <Menu.Trigger as={Button} size="compact" disabled={!props.loaded}>
              <Plus size={14} aria-hidden="true" />
              Add a budget
            </Menu.Trigger>
            <Menu.Content label="Add a budget for" width={300}>
              <Menu.Group label="Agents">
                <For each={addableAgents()} fallback={<p class="nt-menu-note">Every agent has one.</p>}>
                  {(agent) => (
                    <Menu.Item icon={<AgentAvatar agent={agent} size={24} ring={false} />} onSelect={() => add("agent", agent.id, agent.name)}>
                      {agent.name}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Group>
              <Menu.Separator />
              <Menu.Group label="Projects">
                <For each={addableProjects()} fallback={<p class="nt-menu-note">Every project has one.</p>}>
                  {(project) => <Menu.Item onSelect={() => add("project", project.id, project.name)}>{project.name}</Menu.Item>}
                </For>
              </Menu.Group>
            </Menu.Content>
          </Menu>
        }
      />
      <Show when={allRows().length > 0} fallback={<Show when={props.loaded}><CardNoteLine>No agent or project has a budget yet.</CardNoteLine></Show>}>
        <div class="cs-table cs-table--budgets" role="table" aria-label="Agent and project budgets">
          <div class="cs-thead" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Monthly</span>
            <span role="columnheader">Spent in {monthName()}</span>
            <span role="columnheader">At the limit</span>
          </div>
          <Show when={agentRows().length > 0}>
            <div class="cs-tgroup" role="row">
              <span role="cell">Agents</span>
            </div>
            <For each={agentRows()}>{(row) => RowView(row)}</For>
          </Show>
          <Show when={projectRows().length > 0}>
            <div class="cs-tgroup" role="row">
              <span role="cell">Projects</span>
            </div>
            <For each={projectRows()}>{(row) => RowView(row)}</For>
          </Show>
        </div>
      </Show>
      <Show when={changed().length > 0 || problem()}>
        <footer class="cfoot">
          <span class="ps-foot-end">
            <FootError message={problem()} />
            <Show when={changed().length > 0}>
              <Button size="compact" variant="quiet" disabled={busy()} onClick={discard}>
                Discard
              </Button>
              <Button size="compact" variant="primary" disabled={busy()} onClick={() => void save()}>
                {busy() ? "Saving…" : changed().length === 1 ? "Save budget" : `Save ${changed().length} budgets`}
              </Button>
            </Show>
          </span>
        </footer>
      </Show>
    </section>
  );
}

function IncidentsCard(props: { incidents: BudgetIncident[]; loaded: boolean; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [amounts, setAmounts] = createStore<Record<string, string>>({});
  const [busy, setBusy] = createSignal<string | null>(null);
  const amountFor = (incident: BudgetIncident) => amounts[incident.id] ?? String(suggestedRaise(incident) / 100);

  const resolve = async (incident: BudgetIncident, action: "keep_paused" | "raise_budget_and_resume") => {
    const amount = action === "raise_budget_and_resume" ? parseDollars(amountFor(incident)) : null;
    if (action === "raise_budget_and_resume" && (!amount || amount <= incident.amountObserved)) {
      pushToast({ tone: "warn", title: `Raise it above ${shortDollars(incident.amountObserved)}, what's already spent.` });
      return;
    }
    setBusy(incident.id);
    try {
      await budgetsApi.resolveIncident(company().id, incident.id, action === "raise_budget_and_resume" ? { action, amount: amount! } : { action });
      await props.onSaved();
      pushToast({ tone: "success", title: action === "keep_paused" ? `${incident.scopeName} stays paused` : `Raised ${incident.scopeName}'s budget and resumed it` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't resolve the incident", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="card settings-card" aria-labelledby="cs-incidents">
      <CardHead
        id="cs-incidents"
        title="Incidents"
        actions={
          <A class="btn btn--quiet btn--compact" href={`/${company().issuePrefix}/activity/budgets`}>
            All incidents
          </A>
        }
      />
      <Show
        when={props.incidents.length > 0}
        fallback={
          <Show when={props.loaded}>
            <div class="cs-lrow">
              <CircleCheck size={16} class="cs-ok" aria-hidden="true" />
              <span class="cs-muted">No open incidents.</span>
            </div>
          </Show>
        }
      >
        <For each={props.incidents}>
          {(incident) => (
            <div class="cs-lrow cs-lrow--wrap">
              <div class="cs-grow">
                <div class="cs-strong">{incidentText(incident)}</div>
                <div class="cs-muted">
                  {new Date(incident.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {incident.approvalStatus ? ` · approval ${incident.approvalStatus}` : ""}
                </div>
              </div>
              <Show when={incident.thresholdType === "hard"}>
                <div class="cs-inline">
                  <div class="ps-money cs-field-120">
                    <span aria-hidden="true">$</span>
                    <TextInput
                      inputmode="decimal"
                      aria-label={`New budget for ${incident.scopeName}`}
                      value={amountFor(incident)}
                      onInput={(event) => setAmounts(incident.id, event.currentTarget.value)}
                    />
                  </div>
                  <Button size="compact" variant="primary" disabled={busy() === incident.id} onClick={() => void resolve(incident, "raise_budget_and_resume")}>
                    Raise and resume
                  </Button>
                  <Button size="compact" disabled={busy() === incident.id} onClick={() => void resolve(incident, "keep_paused")}>
                    Keep paused
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </section>
  );
}
