import { A } from "@solidjs/router";
import { Ellipsis, Eye, MessageCircle, Plus, Settings, Users } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useCompany } from "@/lib/company";
import { useYouName } from "@/lib/session";
import { useNeedsYouCount } from "@/inbox/needs-you";
import { formatCents, monthWindow } from "@/projects/dashboard-model";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Capsule } from "@/ui/Status";
import { Menu } from "@/ui/Menu";
import { gradientVar } from "@/ui/status-meta";
import type { AgentActions } from "./actions";
import { buildOrgTree, directReports, ORG_STATE, roleTitle, shortAgo, spendMeter, taskRef, treeSize, type OrgTreeNode } from "./org-model";
import type { OrgAgent, OrgData } from "./queries";
import { RUN_WINDOW_DAYS, useMinute } from "./queries";

/*
 * Board 19's org chart card: the reporting tree under you (the board), each agent a button that
 * picks it for the inspector on the right, a legend, and the built-in agents outside the reporting
 * lines. The inspector says what the selected agent is doing, its spend, runs, harness and reports,
 * and offers chat, settings, and pause or resume.
 */

function StateDot(props: { row: OrgAgent }) {
  const meta = () => ORG_STATE[props.row.state];
  return (
    <span
      class="org-dot"
      classList={{ "org-dot--idle": props.row.state === "idle" }}
      style={props.row.state === "idle" ? undefined : { background: gradientVar(meta().gradient) }}
      aria-hidden="true"
    />
  );
}

/** The short status under a node's title: "TRA-38 · 14m", "Idle · 2h", "Blocked · TRA-45". */
function nodeLine(row: OrgAgent, now: Date, data: OrgData) {
  if (row.state === "running") return data.detailAt(row, now.getTime()).text;
  if (row.state === "blocked" && row.detail.task) return `Blocked · ${taskRef(row.detail.task)}`;
  if (row.state === "idle") return row.agent.lastHeartbeatAt ? `Idle · ${shortAgo(row.agent.lastHeartbeatAt, now)}` : "Idle";
  return ORG_STATE[row.state].label;
}

export function OrgChartCard(props: { data: OrgData; actions: AgentActions }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const needsYou = useNeedsYouCount();
  const youName = useYouName();

  const tree = createMemo(() => buildOrgTree(props.data.tree.data, props.data.agents.data ?? [], props.data.builtInIds()));
  const drawn = createMemo(() => treeSize(tree()));
  const builtIns = createMemo(() => props.data.rows().filter((row) => row.builtIn));
  const [picked, setPicked] = createSignal<string | null>(null);
  /** The picked agent, or the first one working, or the top of the tree. */
  const selectedId = createMemo(() => {
    const id = picked();
    if (id && props.data.byId().has(id)) return id;
    const working = props.data.rows().find((row) => row.state === "running" && !row.builtIn);
    return working?.agent.id ?? tree()[0]?.agent.id ?? null;
  });
  const selected = () => {
    const id = selectedId();
    return id ? props.data.byId().get(id) : undefined;
  };

  const counts = createMemo(() => {
    const rows = props.data.rows().filter((row) => !row.builtIn && row.state !== "pending");
    const by = (state: string) => rows.filter((row) => row.state === state).length;
    return [
      `${rows.length} ${rows.length === 1 ? "agent" : "agents"}`,
      by("running") ? `${by("running")} working` : null,
      by("blocked") + by("error") ? `${by("blocked") + by("error")} blocked` : null,
      by("paused") ? `${by("paused")} paused` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  const minute = useMinute();

  const Node = (nodeProps: { node: OrgTreeNode<{ id: string }> }) => {
    const row = () => props.data.byId().get(nodeProps.node.agent.id);
    return (
      <li>
        <Show when={row()}>
          {(r) => (
            <button
              type="button"
              class="onode"
              aria-pressed={selectedId() === r().agent.id}
              onClick={() => setPicked(r().agent.id)}
            >
              <span class="onode-av">
                <AgentAvatar agent={r().agent} size={32} ring={r().state === "running"} />
                <StateDot row={r()} />
              </span>
              <span class="onode-name">{r().agent.name}</span>
              <span class="onode-sub">{roleTitle(r().agent)}</span>
              <span class="onode-line" style={{ color: r().state === "idle" ? undefined : ORG_STATE[r().state].fg }}>
                {nodeLine(r(), new Date(minute()), props.data)}
              </span>
            </button>
          )}
        </Show>
        <Show when={nodeProps.node.reports.length > 0}>
          <ul>
            <For each={nodeProps.node.reports}>{(child) => <Node node={child} />}</For>
          </ul>
        </Show>
      </li>
    );
  };

  return (
    <section class="card org-chart-card" aria-labelledby="org-chart-h">
      <div class="org-card-head">
        <h2 class="disp" id="org-chart-h">
          Org chart
        </h2>
        <span class="org-muted">{counts()}</span>
        <div class="org-push org-row">
          <A class={buttonClass({ size: "compact" })} href={`${base()}/agents/new`}>
            <Plus size={14} stroke-width={2.2} aria-hidden="true" />
            Hire agent
          </A>
          <A class={buttonClass({ size: "compact" })} href={`${base()}/agents`}>
            <Users size={14} aria-hidden="true" />
            Manage agents
          </A>
        </div>
      </div>
      <div class="org-chart-body">
        <div class="org-chart-main">
          <Show
            when={drawn() > 0}
            fallback={
              <p class="org-empty">
                <Show when={props.data.agents.isPending} fallback="No agents yet. Hire one to start the organization.">
                  Loading the organization…
                </Show>
              </p>
            }
          >
            <div class="org-scroll">
              <div class="org" role="group" aria-label="Reporting lines">
                <ul>
                  <li>
                    <div class="onode onode--you">
                      <InitialsDisc name={youName()} you size={32} />
                      <span class="onode-name">{youName()}</span>
                      <span class="onode-sub">Board · you</span>
                      <Show when={(needsYou() ?? 0) > 0}>
                        <A class="onode-line onode-needs" href={`${base()}/inbox`}>
                          {needsYou()} {needsYou() === 1 ? "needs" : "need"} you
                        </A>
                      </Show>
                    </div>
                    <ul>
                      <For each={tree()}>{(node) => <Node node={node} />}</For>
                    </ul>
                  </li>
                </ul>
              </div>
            </div>
          </Show>
          <div class="org-legend">
            <span>
              <Capsule gradient="ion" size="tiny" live />
              Working
            </span>
            <span>
              <span class="org-legend-idle" aria-hidden="true" />
              Idle
            </span>
            <span>
              <Capsule gradient="flare" size="tiny" />
              Blocked
            </span>
            <span>
              <Capsule gradient="ember" size="tiny" />
              Paused
            </span>
            <span class="org-push">Select an agent to see what it's doing.</span>
          </div>
          <Show when={builtIns().length > 0 || props.data.builtInsAvailable().length > 0}>
            <div class="org-builtins">
              <span class="org-muted">Built-in, outside the reporting lines</span>
              <For each={builtIns()}>
                {(row) => (
                  <button type="button" class="org-builtin" aria-pressed={selectedId() === row.agent.id} onClick={() => setPicked(row.agent.id)}>
                    <AgentAvatar agent={row.agent} size={20} />
                    <span>{row.agent.name}</span>
                    <span class="org-muted">{ORG_STATE[row.state].label}</span>
                  </button>
                )}
              </For>
              <Show when={props.data.builtInsAvailable().length > 0}>
                <A class="org-link" href={`${base()}/agents?filter=builtin`}>
                  {props.data.builtInsAvailable().length} more available
                </A>
              </Show>
            </div>
          </Show>
        </div>
        <Show when={selected()}>{(row) => <Inspector row={row()} data={props.data} actions={props.actions} />}</Show>
      </div>
    </section>
  );
}

function Inspector(props: { row: OrgAgent; data: OrgData; actions: AgentActions }) {
  const company = useCompany();
  const base = () => `/${company().issuePrefix}`;
  const agentHref = () => `${base()}/agents/${props.row.agent.urlKey}`;
  const meta = () => ORG_STATE[props.row.state];
  const manager = () => {
    const id = props.row.agent.reportsTo;
    if (!id) return "you";
    return props.data.byId().get(id)?.agent.name ?? "someone no longer here";
  };
  const reports = () => {
    const names = directReports(props.row.agent.id, props.data.agents.data ?? []);
    return names.length ? names.join(", ") : "None";
  };
  const open = () => props.data.index().byAgent.get(props.row.agent.id) ?? [];
  const meter = () => spendMeter(props.row.spendCents, props.row.budgetCents);
  const paused = () => props.row.agent.status === "paused";
  const minute = useMinute();
  const detail = () => props.data.detailAt(props.row, minute());

  return (
    <aside class="org-insp" aria-label="Selected agent">
      <div class="org-insp-head">
        <AgentAvatar agent={props.row.agent} size={40} ring={props.row.state === "running"} />
        <div class="org-insp-name">
          <h3 class="disp">
            <A href={agentHref()}>{props.row.agent.name}</A>
          </h3>
          <div class="org-muted">
            {roleTitle(props.row.agent)} · reports to {manager()}
          </div>
        </div>
        <Menu placement="bottom-end">
          <Menu.Trigger class={buttonClass({ variant: "icon", size: "compact", ghost: true })} aria-label={`More actions for ${props.row.agent.name}`}>
            <Ellipsis size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Content label={`${props.row.agent.name} actions`} width={220}>
            <Menu.Item onSelect={() => void props.actions.wake([props.row.agent])} disabled={paused() || props.row.state === "pending"}>
              Run now
            </Menu.Item>
            <Menu.Item onSelect={() => void (paused() ? props.actions.resume([props.row.agent]) : props.actions.pause([props.row.agent]))} disabled={props.row.state === "pending"}>
              {paused() ? "Resume" : "Pause"}
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </div>
      <div class="org-insp-state">
        <span role="status" class={`org-state-pill org-state-pill--${props.row.state}`}>
          <Capsule gradient={meta().gradient} size="tiny" live={props.row.state === "running"} />
          {meta().label}
        </span>
        <span class="org-insp-detail">{detail().text}</span>
      </div>
      <Show when={props.row.state === "running" && props.row.detail.runId}>
        <div class="org-now">
          <span class="org-now-head">
            <Capsule gradient="ion" size="tiny" live />
            Working now
          </span>
          <Show when={props.row.detail.task}>
            {(task) => (
              <A class="org-now-task" href={`${base()}/issues/${taskRef(task())}`}>
                <span class="mono">{taskRef(task())}</span>
                <span>{task().title}</span>
              </A>
            )}
          </Show>
          <A class={buttonClass({ size: "compact" })} href={`${base()}/agents/${props.row.agent.urlKey}/runs/${props.row.detail.runId}`}>
            <Eye size={14} aria-hidden="true" />
            Watch run
          </A>
        </div>
      </Show>
      <div class="org-kvs">
        <div class="org-kv">
          <span>{monthWindow(new Date()).name} spend</span>
          <span>
            {formatCents(props.row.spendCents)}
            <Show when={props.row.budgetCents > 0}> of {formatCents(props.row.budgetCents, true)}</Show>
          </span>
        </div>
        <Show when={props.row.budgetCents > 0}>
          <span class="org-meter" role="img" aria-label={`${meter().percent}% of the budget`}>
            <span classList={{ "org-meter--warn": meter().warn }} style={{ width: `${meter().percent}%` }} />
          </span>
        </Show>
        <div class="org-kv">
          <span>Runs, last {RUN_WINDOW_DAYS} days</span>
          <span>
            {props.row.runs.total}
            <Show when={props.row.success !== null}> · {props.row.success}% succeeded</Show>
          </span>
        </div>
        <div class="org-kv">
          <span>Harness and model</span>
          <span>
            {props.row.harness} · {props.row.model}
          </span>
        </div>
        <div class="org-kv">
          <span>Direct reports</span>
          <span>{reports()}</span>
        </div>
        <div class="org-kv">
          <span>Assigned tasks</span>
          <span>
            {open().length} open
            <Show when={open().some((task) => task.status === "blocked")}>, {open().filter((task) => task.status === "blocked").length} blocked</Show>
          </span>
        </div>
      </div>
      <div class="org-insp-actions">
        <A class={buttonClass({ size: "compact" })} href={agentHref()}>
          <MessageCircle size={14} aria-hidden="true" />
          Open chat
        </A>
        <A class={buttonClass({ size: "compact" })} href={`${agentHref()}/settings`}>
          <Settings size={14} aria-hidden="true" />
          Settings
        </A>
        <Show when={props.row.state !== "pending"}>
          <Button
            size="compact"
            disabled={props.actions.busy() !== null}
            onClick={() => void (paused() ? props.actions.resume([props.row.agent]) : props.actions.pause([props.row.agent]))}
          >
            {paused() ? "Resume" : "Pause"}
          </Button>
        </Show>
      </div>
    </aside>
  );
}
