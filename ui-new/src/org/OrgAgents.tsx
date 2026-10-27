import type { Agent } from "@paperclipai/shared";
import { A, Navigate, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { ArrowUpDown, Check, Crown, Ellipsis, MessageCircle, Network, Pencil, Search } from "lucide-solid";
import { createQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { orgApi } from "@/api/org";
import { queryKeys } from "@/api/queryKeys";
import { isCompact } from "@/layout/breakpoints";
import { useCompany } from "@/lib/company";
import { formatCents, monthWindow } from "@/projects/dashboard-model";
import { parseDollars } from "@/projects/settings/settings-model";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Capsule } from "@/ui/Status";
import { gradientVar } from "@/ui/status-meta";
import { actionTargets, useAgentActions } from "./actions";
import { BulkEditDialog } from "./BulkEditDialog";
import { bulkDisabledReason, harnessGroups, harnessLabel } from "./bulk-model";
import { OrgHeader } from "./OrgHeader";
import {
  filterCounts,
  isOrgFilter,
  legacyFilter,
  managerChoices,
  matchesFilter,
  matchesSearch,
  ORG_FILTERS,
  ORG_SORTS,
  ORG_STATE,
  roleTitle,
  sortRows,
  spendMeter,
  type OrgFilter,
  type OrgSort,
} from "./org-model";
import { useOrgData, RUN_WINDOW_DAYS, type OrgAgent } from "./queries";
import "./Org.css";

/*
 * `/:prefix/agents`, Manage agents (board 20): every agent in a table with filters (all, working,
 * needs attention, paused, idle, built-in), search and sort, and a toolbar for the selection: pause,
 * resume, wake now, change manager, set budget, and upstream's bulk edit of AI connection and
 * default model. Rows link to the agent's page. On a phone it's board M8: this month's spend, the
 * filters, and one stacked row per agent.
 *
 * The filter is in the address (`?filter=paused`) so the dashboard and old links can open it; the
 * old UI's `/agents/:tab` pages redirect here (`AgentsTabRedirect`).
 */

export function AgentsTabRedirect() {
  const params = useParams<{ tab: string }>();
  const company = useCompany();
  const filter = legacyFilter(params.tab);
  return <Navigate href={`/${company().issuePrefix}/agents${filter === "all" ? "" : `?filter=${filter}`}`} />;
}

export function OrgAgents() {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const data = useOrgData();
  const actions = useAgentActions();
  const [search, setSearch] = useSearchParams<{ filter?: string }>();
  const filter = (): OrgFilter => (isOrgFilter(search.filter) ? search.filter : "all");
  const setFilter = (value: OrgFilter) => setSearch({ filter: value === "all" ? undefined : value }, { replace: true });
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<OrgSort>("status");
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = createSignal<{ harness: string; agents: Agent[] } | null>(null);
  const [budgetOpen, setBudgetOpen] = createSignal(false);

  const counts = createMemo(() => filterCounts(data.rows()));
  const searched = createMemo(() => data.rows().filter((row) => matchesSearch(row.agent, query())));
  const shown = createMemo(() => sortRows(searched().filter((row) => matchesFilter(row.state, row.builtIn, filter())).map((row) => ({ ...row, name: row.agent.name })), sort()));
  const team = createMemo(() => shown().filter((row) => !row.builtIn));
  const builtIns = createMemo(() => shown().filter((row) => row.builtIn));

  const selectable = createMemo(() => shown().filter((row) => row.state !== "pending"));
  const selectedRows = createMemo(() => data.rows().filter((row) => selected().has(row.agent.id)));
  const selectedAgents = () => selectedRows().map((row) => row.agent);
  const hiddenSelected = () => selectedRows().filter((row) => !shown().some((visible) => visible.agent.id === row.agent.id)).length;
  const allChecked = () => selectable().length > 0 && selectable().every((row) => selected().has(row.agent.id));
  const someChecked = () => selectable().some((row) => selected().has(row.agent.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      if (allChecked()) for (const row of selectable()) next.delete(row.agent.id);
      else for (const row of selectable()) next.add(row.agent.id);
      return next;
    });
  const clear = () => setSelected(new Set<string>());

  /** The bulk edit works one harness at a time, on agents whose connection Paperclip manages. */
  const editGroups = createMemo(() => harnessGroups(selectedAgents().filter((agent) => !bulkDisabledReason(agent))));
  const managers = createMemo(() => managerChoices(selected(), data.agents.data ?? []));

  const month = () => monthWindow(new Date()).name;
  /** The company budget for the phone spend card, from the summary the Org dashboard reads. */
  const summary = createQuery(() => ({
    queryKey: queryKeys.dashboard(company().id),
    queryFn: ({ signal }) => orgApi.dashboard(company().id, signal),
    enabled: isCompact(),
  }));
  const totals = createMemo(() => {
    const rows = data.rows();
    return {
      spend: rows.reduce((sum, row) => sum + row.spendCents, 0),
      running: rows.filter((row) => row.state === "running").length,
      blocked: rows.filter((row) => row.state === "blocked" || row.state === "error").length,
      paused: rows.filter((row) => row.state === "paused").length,
    };
  });

  return (
    <div class="org-page">
      <Show when={!isCompact()} fallback={<h1 class="org-phone-title disp">Agents</h1>}>
        <OrgHeader />
      </Show>

      <Show when={isCompact()}>
        <section class="card org-phone-spend" aria-label="This month">
          <span class="org-cap">{month()} spend</span>
          <span class="org-phone-spend-line">
            <span class="org-phone-spend-value disp">{formatCents(totals().spend)}</span>
            <Show when={(summary.data?.costs.monthBudgetCents ?? 0) > 0}>
              <span class="org-muted">of {formatCents(summary.data?.costs.monthBudgetCents ?? 0, true)} company budget</span>
            </Show>
          </span>
          <div class="org-phone-counts">
            <span>
              <Capsule gradient="ion" size="tiny" live={totals().running > 0} />
              <b>{totals().running}</b> running
            </span>
            <span>
              <Capsule gradient="flare" size="tiny" />
              <b>{totals().blocked}</b> blocked
            </span>
            <span>
              <Capsule gradient="ember" size="tiny" />
              <b>{totals().paused}</b> paused
            </span>
          </div>
        </section>
      </Show>

      <div class="org-toolbar">
        <div class="org-filters" role="group" aria-label="Filter agents">
          <For each={ORG_FILTERS.filter((entry) => entry.value !== "builtin" || counts().builtin > 0 || filter() === "builtin")}>
            {(entry) => (
              <button type="button" class="org-ftab" aria-pressed={filter() === entry.value} onClick={() => setFilter(entry.value)}>
                {entry.label}
                <span class="org-ftab-count">{counts()[entry.value]}</span>
              </button>
            )}
          </For>
        </div>
        <div class="org-toolbar-end">
          <label class="org-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search agents" aria-label="Search agents" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <Menu placement="bottom-end">
            <Menu.Trigger class={buttonClass({ size: "compact" })}>
              <ArrowUpDown size={14} aria-hidden="true" />
              Sort: {ORG_SORTS.find((entry) => entry.value === sort())!.label.toLowerCase()}
            </Menu.Trigger>
            <Menu.Content label="Sort agents" width={200}>
              <For each={ORG_SORTS}>
                {(entry) => (
                  <Menu.Item onSelect={() => setSort(entry.value)} hint={sort() === entry.value ? <Check size={14} aria-hidden="true" /> : undefined}>
                    {entry.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
          <Show when={!isCompact()}>
            <A class={buttonClass({ size: "compact" })} href={`${base()}/dashboard`}>
              <Network size={14} aria-hidden="true" />
              Org chart
            </A>
          </Show>
        </div>
      </div>

      <Show when={selectedRows().length > 0}>
        <div role="toolbar" aria-label="Selected agents" class="org-selbar">
          <span class="org-strong">
            {selectedRows().length} {selectedRows().length === 1 ? "agent" : "agents"} selected
          </span>
          <Show when={hiddenSelected() > 0}>
            <span class="org-muted">{hiddenSelected()} hidden by the filter</span>
          </Show>
          <span class="org-selbar-rule" aria-hidden="true" />
          <Button size="compact" disabled={actions.busy() !== null || actionTargets("pause", selectedAgents()).length === 0} onClick={() => void actions.pause(selectedAgents())}>
            Pause
          </Button>
          <Button size="compact" disabled={actions.busy() !== null || actionTargets("resume", selectedAgents()).length === 0} onClick={() => void actions.resume(selectedAgents())}>
            Resume
          </Button>
          <Button size="compact" disabled={actions.busy() !== null || actionTargets("wake", selectedAgents()).length === 0} onClick={() => void actions.wake(selectedAgents())}>
            Wake now
          </Button>
          <Menu>
            <Menu.Trigger class={buttonClass({ size: "compact" })} disabled={actions.busy() !== null}>
              Change manager
            </Menu.Trigger>
            <Menu.Content label="Reports to" width={260}>
              <Menu.Group label="Reports to">
                <Menu.Item onSelect={() => void actions.setManager(selectedAgents(), null)}>You (the board)</Menu.Item>
                <For each={managers()}>
                  {(agent) => (
                    <Menu.Item onSelect={() => void actions.setManager(selectedAgents(), agent.id)} icon={<AgentAvatar agent={agent} size={20} />}>
                      {agent.name}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Group>
            </Menu.Content>
          </Menu>
          <Button size="compact" disabled={actions.busy() !== null} onClick={() => setBudgetOpen(true)}>
            Set budget
          </Button>
          <For each={editGroups()}>
            {(group) => (
              <Button size="compact" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(group)}>
                {editGroups().length === 1 ? "Edit connection and model" : `Edit ${group.agents.length} ${harnessLabel(group.harness)}`}
              </Button>
            )}
          </For>
          <Button size="compact" variant="quiet" class="org-push" onClick={clear}>
            Clear
          </Button>
        </div>
      </Show>

      <section class="card org-table" aria-label="Agents">
        <div class="org-tr org-th" role="row">
          <button
            type="button"
            role="checkbox"
            class="org-cbox"
            aria-checked={allChecked() ? true : someChecked() ? "mixed" : false}
            aria-label="Select every agent shown"
            disabled={selectable().length === 0}
            onClick={toggleAll}
          >
            <Show when={allChecked() || someChecked()}>
              <Check size={11} stroke-width={3.2} aria-hidden="true" />
            </Show>
          </button>
          <span>Agent</span>
          <span>Status</span>
          <span class="org-col-wide">Reports to</span>
          <span class="org-col-wide">Harness and model</span>
          <span class="org-col-wide">Runs, {RUN_WINDOW_DAYS} days</span>
          <span class="org-col-spend">{month()} spend</span>
          <span />
        </div>
        <Switch>
          <Match when={data.agents.isPending}>
            <p class="org-empty">Loading agents…</p>
          </Match>
          <Match when={shown().length === 0}>
            <p class="org-empty">{data.rows().length === 0 ? "No agents yet. Hire one to get started." : "No agents match this filter."}</p>
          </Match>
        </Switch>
        <For each={team()}>{(row) => <AgentRow row={row} data={data} checked={selected().has(row.agent.id)} onToggle={() => toggle(row.agent.id)} actions={actions} />}</For>
        <Show when={builtIns().length > 0}>
          <div class="org-group-head">
            <h3 class="disp">Built-in agents</h3>
            <span class="org-muted">
              Run Paperclip's routines for the whole organization.
              <Show when={data.builtInsAvailable().length > 0}> {data.builtInsAvailable().length} more can be added.</Show>
            </span>
          </div>
          <For each={builtIns()}>{(row) => <AgentRow row={row} data={data} checked={selected().has(row.agent.id)} onToggle={() => toggle(row.agent.id)} actions={actions} />}</For>
        </Show>
      </section>

      <p class="org-foot">
        A hire waits here until someone approves it in the Inbox. The crown marks your primary agent, the default for new tasks and chat.
      </p>

      <Show when={editing()}>
        {(group) => (
          <BulkEditDialog
            harness={group().harness}
            agents={group().agents}
            totalSelected={selectedRows().length}
            onClose={(updatedIds) => {
              setEditing(null);
              if (updatedIds.length > 0) setSelected((current) => new Set([...current].filter((id) => !updatedIds.includes(id))));
            }}
          />
        )}
      </Show>
      <BudgetDialog open={budgetOpen()} onOpenChange={setBudgetOpen} agents={selectedAgents()} onSave={(cents) => actions.setBudget(selectedAgents(), cents)} />
    </div>
  );
}

function AgentRow(props: { row: OrgAgent; data: ReturnType<typeof useOrgData>; checked: boolean; onToggle: () => void; actions: ReturnType<typeof useAgentActions> }) {
  const company = useCompany();
  const navigate = useNavigate();
  const base = () => `/${company().issuePrefix}`;
  const agent = () => props.row.agent;
  const href = () => `${base()}/agents/${agent().urlKey}`;
  const meta = () => ORG_STATE[props.row.state];
  const pending = () => props.row.state === "pending";
  const manager = () => {
    const id = agent().reportsTo;
    if (!id) return props.row.builtIn ? "None" : "You (board)";
    return props.data.byId().get(id)?.agent.name ?? "Someone no longer here";
  };
  const meter = () => spendMeter(props.row.spendCents, props.row.budgetCents);
  const paused = () => agent().status === "paused";

  return (
    <div class="org-tr org-arow" classList={{ "org-arow--checked": props.checked }} role="row">
      <button
        type="button"
        role="checkbox"
        class="org-cbox"
        aria-checked={props.checked}
        aria-label={`Select ${agent().name}`}
        disabled={pending()}
        title={pending() ? "Approve the hire in the Inbox first" : undefined}
        onClick={props.onToggle}
      >
        <Show when={props.checked}>
          <Check size={11} stroke-width={3.2} aria-hidden="true" />
        </Show>
      </button>
      <div class="org-agent">
        <span class="org-agent-av" classList={{ "org-agent-av--pending": pending() }}>
          <AgentAvatar agent={agent()} size={32} ring={props.row.state === "running"} />
          <span
            class="org-dot"
            classList={{ "org-dot--idle": props.row.state === "idle" }}
            style={props.row.state === "idle" ? undefined : { background: gradientVar(meta().gradient) }}
            aria-hidden="true"
          />
        </span>
        <div class="org-agent-text">
          <div class="org-agent-name">
            <A href={href()}>{agent().name}</A>
            <Show when={props.row.primary}>
              <span class="org-crown" title="Your primary agent">
                <Crown size={13} aria-label="Your primary agent" />
              </span>
            </Show>
          </div>
          <div class="org-muted org-ellipsis">
            {roleTitle(agent())}
            <span class="org-phone-only"> · {props.row.model}</span>
          </div>
        </div>
      </div>
      <div class="org-status">
        <div class="org-status-label" style={{ color: meta().fg }}>
          {meta().label}
        </div>
        <Show when={props.row.detail.href} fallback={<span class="org-muted org-ellipsis">{props.row.detail.text}</span>}>
          {(link) => (
            <A class="org-muted org-ellipsis org-detail-link" href={`${base()}${link()}`}>
              {props.row.detail.text}
            </A>
          )}
        </Show>
      </div>
      <span class="org-col-wide org-ellipsis org-body">{manager()}</span>
      <div class="org-col-wide org-hm">
        <div class="org-body org-ellipsis">{props.row.harness}</div>
        <div class="org-muted org-ellipsis">{props.row.model}</div>
      </div>
      <div class="org-col-wide org-num">
        <div class="org-body">{props.row.runs.total}</div>
        <div class="org-muted">{props.row.success === null ? (props.row.runs.total ? "running" : "no runs") : `${props.row.success}% ok`}</div>
      </div>
      <div class="org-col-spend org-spendcell">
        <span class="org-num org-body">
          {formatCents(props.row.spendCents)}
          <Show when={props.row.budgetCents > 0}>
            {" "}
            <span class="org-muted">of {formatCents(props.row.budgetCents, true)}</span>
          </Show>
        </span>
        <Show when={props.row.budgetCents > 0}>
          <span class="org-meter" aria-hidden="true">
            <span classList={{ "org-meter--warn": meter().warn }} style={{ width: `${meter().percent}%` }} />
          </span>
        </Show>
      </div>
      <div class="org-row-actions">
        <A class={buttonClass({ variant: "icon", size: "compact", ghost: true })} href={href()} aria-label={`Chat with ${agent().name}`}>
          <MessageCircle size={15} aria-hidden="true" />
        </A>
        <Menu placement="bottom-end">
          <Menu.Trigger class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label={`More actions for ${agent().name}`}>
            <Ellipsis size={15} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label={`${agent().name} actions`} width={220}>
            <Show
              when={!pending()}
              fallback={
                <Menu.Item onSelect={() => navigate(`${base()}/inbox`)}>Review the hire in the Inbox</Menu.Item>
              }
            >
              <Menu.Item onSelect={() => void props.actions.wake([agent()])} disabled={paused()}>
                Wake now
              </Menu.Item>
              <Menu.Item onSelect={() => void (paused() ? props.actions.resume([agent()]) : props.actions.pause([agent()]))}>{paused() ? "Resume" : "Pause"}</Menu.Item>
              <Menu.Separator />
              <Menu.Item onSelect={() => navigate(`${href()}/settings`)}>Settings</Menu.Item>
            </Show>
          </Menu.Content>
        </Menu>
      </div>
    </div>
  );
}

function BudgetDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; agents: Agent[]; onSave: (cents: number) => Promise<string[]> }) {
  const [value, setValue] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const cents = () => (value().trim() === "" ? null : parseDollars(value()));
  const save = async () => {
    const amount = cents();
    if (amount === null) return;
    setSaving(true);
    try {
      await props.onSave(amount);
      props.onOpenChange(false);
      setValue("");
    } finally {
      setSaving(false);
    }
  };
  const count = () => `${props.agents.length} ${props.agents.length === 1 ? "agent" : "agents"}`;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      width={440}
      title="Set monthly budget"
      description={`What each of the ${count()} may spend per calendar month (UTC). At the limit Paperclip pauses the agent. Enter 0 to turn the limit off.`}
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)} disabled={saving()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={cents() === null || saving()} onClick={() => void save()}>
            {saving() ? "Saving…" : `Set for ${count()}`}
          </Button>
        </div>
      }
    >
      <label class="org-budget-field">
        <span class="org-strong">Monthly limit, in dollars</span>
        <TextInput inputmode="decimal" placeholder="40.00" value={value()} onInput={(event) => setValue(event.currentTarget.value)} invalid={value() !== "" && cents() === null} />
      </label>
    </Dialog>
  );
}
