import { A, useSearchParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { ArrowRight, Ban, Clock, CornerDownRight, Lightbulb, Plus, Sparkles, Users, X, Zap } from "lucide-solid";
import { createMemo, createSignal, For, Index, Show, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useTaskPeople } from "@/tasks/people";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { Capsule, PriorityBars } from "@/ui/Status";
import type { Gradient } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";
import { useWorkload } from "./use-workload";
import {
  formatClock,
  formatDuration,
  formatHours,
  formatUsd,
  agentStates,
  groupAgents,
  heatmap,
  openWork,
  QUEUE_SHOWN,
  rosterIds,
  startOfDay,
  suggestion,
  todayLanes,
  waitingChains,
  windowFraction,
  type Chain,
  type ChainNode,
  type DayWindow,
  type HeatCell,
  type HeatFlag,
  type HeatRange,
  type Lane,
  type LaneBar,
  type NowState,
  type NowStateKey,
  type WorkloadAgent,
  type WorkloadScope,
  type WorkloadTask,
} from "./workload-model";
import "@/requests/RequestCard.css";
import "./Workload.css";

/*
 * Agent workload (boards 31–33), shared by a project's Agent workload tab and the company's
 * Workload page. The scope decides what counts and how bars are coloured (workload-model.ts).
 *
 * - One frame on top: who's waiting on whom (each chain's summary in a tooltip), open work per
 *   agent, and the "1 suggestion" pill that opens Paperclip's proposal as a popover.
 * - A range control (`?range=` in the URL, so board 32's week view has an address):
 *   - Today: run lanes on an hour grid with a "now" line, each agent's queue on the right. A run
 *     bar opens the run modal; a task opens in the task modal.
 *   - 7 and 30 days: a heatmap of busy time, an "All agents" row, and markers with tooltips.
 *
 * The company page groups agents by team (their role; the API has no teams) and colours by
 * project. On a phone the grid rows stack (mobile.md keeps workload on desktop, so it isn't
 * redesigned for the phone, only kept usable).
 */

export type WorkloadRange = "today" | HeatRange;

const RANGES: { value: WorkloadRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];

const RANGE_TITLE: Record<WorkloadRange, string> = { today: "Today", week: "Last 7 days", month: "Last 30 days" };

const STATE_STYLE: Record<NowStateKey, { gradient: Gradient; tone: string; live?: boolean; rank: number }> = {
  running: { gradient: "ion", tone: "var(--run-fg)", live: true, rank: 0 },
  queued: { gradient: "ion", tone: "var(--run-fg)", rank: 1 },
  elsewhere: { gradient: "ion", tone: "var(--run-fg)", rank: 2 },
  blocked: { gradient: "flare", tone: "var(--red-fg)", rank: 3 },
  error: { gradient: "flare", tone: "var(--red-fg)", rank: 4 },
  paused: { gradient: "ember", tone: "var(--amber-fg)", rank: 5 },
  idle: { gradient: "ash", tone: "var(--muted)", rank: 6 },
};

const HEAT_SCALE = [
  "color-mix(in srgb, var(--text) 8%, transparent)",
  "color-mix(in srgb, #8b2cf0 30%, var(--well))",
  "color-mix(in srgb, #8b2cf0 55%, var(--well))",
  "color-mix(in srgb, #6a4cf0 80%, var(--well))",
  "linear-gradient(160deg, #8b2cf0, #1f6fe0)",
];

const DAY = 24 * 60 * 60 * 1000;

function parseRange(value: string | undefined): WorkloadRange {
  return value === "week" || value === "month" ? value : "today";
}

export function WorkloadView(props: { scope: WorkloadScope; tasks: () => readonly WorkloadTask[] | undefined; scopeName: string }) {
  const company = useCompany();
  const [params, setParams] = useSearchParams<{ range?: string }>();
  const range = () => parseRange(params.range);
  const data = useWorkload({ scope: () => props.scope, tasks: props.tasks });
  const agentById = createMemo(() => new Map((data.agents.data ?? []).map((agent) => [agent.id, agent] as const)));

  const since = createMemo(() => {
    const today = startOfDay(data.input().now);
    return range() === "today" ? today : today - (range() === "week" ? 6 : 29) * DAY;
  });
  const roster = createMemo(() => rosterIds(data.input(), since()));
  const groups = createMemo(() => {
    if (props.scope.kind === "project") return [{ label: "", agentIds: roster() }];
    const agents = roster().flatMap((id) => agentById().get(id) ?? []);
    return groupAgents(agents, data.builtInIds());
  });
  const chains = createMemo(() => waitingChains(data.input()));
  const work = createMemo(() => openWork(data.input(), roster()));
  const tip = createMemo(() => suggestion(data.input(), roster()));

  // Ticks every second while an agent runs; the rows below are <Index>ed so they update in place.
  const today = createMemo(() => (range() === "today" ? todayLanes({ ...data.input(), now: data.liveNow() }, roster()) : null));
  const heat = createMemo(() => (range() === "today" ? null : heatmap(data.input(), roster(), range() as HeatRange)));
  const states = createMemo(() => (range() === "today" ? null : agentStates(data.input(), roster())));

  const rangeSub = () => {
    if (range() === "today") return props.scope.kind === "project" ? `Runs, schedules and blocked time for agents on ${props.scopeName}` : "Every agent in the company, coloured by project";
    return range() === "week" ? "How busy each agent was, in 4-hour blocks from midnight" : "How busy each agent was, day by day";
  };

  return (
    <div class="wl">
      <Show when={data.error()}>{(error) => <p class="card wl-empty" role="alert">Couldn't load the workload: {error().message}</p>}</Show>
      <div class="card wl-top">
        <section class="wl-top-col" aria-labelledby="wl-chains-h">
          <div class="wl-head">
            <h2 id="wl-chains-h" class="disp">
              Who's waiting on whom
            </h2>
            <span class="wl-sub">Follow a chain to find what's holding work up</span>
          </div>
          <Chains chains={chains()} ready={data.ready()} agentById={agentById()} />
        </section>
        <section class="wl-top-col wl-top-col--load" aria-labelledby="wl-load-h">
          <div class="wl-head">
            <h2 id="wl-load-h" class="disp">
              Open work
            </h2>
            <span class="wl-sub">{props.scope.kind === "project" ? "Tasks assigned in this project" : "Tasks assigned, by project"}</span>
            <Show when={tip()}>{(found) => <SuggestionPill suggestion={found()} agentById={agentById()} />}</Show>
          </div>
          <OpenWork rows={work().rows} legend={work().key} agentById={agentById()} ready={data.ready()} />
        </section>
      </div>

      <section class="card wl-lanes" aria-labelledby="wl-lanes-h">
        <div class="wl-lanes-head">
          <h2 id="wl-lanes-h" class="disp">
            {RANGE_TITLE[range()]}
          </h2>
          <Segmented label="Range" options={RANGES} value={range()} onChange={(value) => setParams({ range: value === "today" ? undefined : value }, { replace: true })} />
          <span class="wl-sub">{rangeSub()}</span>
          <div class="wl-legend">
            <Show when={today()}>
              {(found) => (
                <>
                  <For each={found().legend.slice(0, 6)}>
                    {(entry) => (
                      <span class="wl-key">
                        <span class="wl-key-bar" style={{ background: entry.gradient }} />
                        <span classList={{ mono: entry.mono }}>{entry.label}</span>
                      </span>
                    )}
                  </For>
                  <span class="wl-key">
                    <span class="wl-key-bar wl-key-bar--dashed" />
                    Scheduled
                  </span>
                </>
              )}
            </Show>
            <Show when={heat()}>
              {(found) => (
                <>
                  <span class="wl-key">
                    Idle
                    <For each={HEAT_SCALE}>{(bg) => <span class="wl-key-cell" style={{ background: bg }} />}</For>
                    Busy
                  </span>
                  <Show when={found().pausedShown}>
                    <span class="wl-key">
                      <span class="wl-key-cell wl-cell--paused" />
                      Paused
                    </span>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
        <Show when={heat()?.loadedFrom}>
          {(from) => <p class="wl-note">Runs before {new Date(from()).toLocaleDateString(undefined, { month: "short", day: "numeric" })} aren't loaded: the run list stops at the latest 1,000.</p>}
        </Show>

        <Show when={data.ready()} fallback={<p class="wl-empty">Loading the workload…</p>}>
          <Show
            when={roster().length > 0}
            fallback={
              <p class="wl-empty">
                {props.scope.kind === "project"
                  ? `No agent has worked on ${props.scopeName} ${range() === "today" ? "today" : RANGE_TITLE[range()].toLowerCase().replace("last", "in the last")}, and nothing open is assigned in it.`
                  : "The company has no agents yet."}
              </p>
            }
          >
            <Show when={today()}>
              {(found) => <TodayGrid window={found().window} lanes={found().lanes} groups={groups()} agentById={agentById()} prefix={company().issuePrefix} />}
            </Show>
            <Show when={heat()}>
              {(found) => <HeatGrid map={found()} states={states() ?? new Map()} groups={groups()} agentById={agentById()} prefix={company().issuePrefix} budgets={props.scope.kind === "company"} />}
            </Show>
          </Show>
        </Show>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared bits

function agentHref(prefix: string, agent: WorkloadAgent | undefined, id: string) {
  return `/${prefix}/agents/${encodeURIComponent(agent?.urlKey ?? id)}`;
}

function AgentMark(props: { agent: WorkloadAgent | undefined; id: string; size: 24 | 32 }) {
  return <AgentAvatar agent={props.agent ?? { id: props.id, name: "Agent" }} size={props.size} ring={false} />;
}

function useOpenTask() {
  const commands = useCommands();
  return (task: Pick<WorkloadTask, "id" | "identifier" | "title" | "projectId">) =>
    commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title, projectId: task.projectId });
}

// ---------------------------------------------------------------------------------------------
// Who's waiting on whom

const CHAINS_SHOWN = 4;

function Chains(props: { chains: Chain[]; ready: boolean; agentById: ReadonlyMap<string, WorkloadAgent> }) {
  return (
    <Show when={props.chains.length > 0} fallback={<p class="wl-quiet">{props.ready ? "Nothing is waiting on anyone right now." : "Loading…"}</p>}>
      <ul class="wl-chains">
        <For each={props.chains.slice(0, CHAINS_SHOWN)}>
          {(chain) => (
            <li>
              <Tooltip content={chain.summary} placement="bottom">
                {(trigger) => (
                  <div {...trigger} class="wl-chain" tabindex="0" aria-label={chain.summary}>
                    <For each={chain.nodes}>
                      {(node, index) => (
                        <>
                          <Show when={index() > 0}>
                            <ArrowRight class="wl-arrow" size={16} stroke-width={2} aria-hidden="true" />
                          </Show>
                          <ChainNodeView node={node} agent={node.agentId ? props.agentById.get(node.agentId) : undefined} />
                        </>
                      )}
                    </For>
                  </div>
                )}
              </Tooltip>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.chains.length > CHAINS_SHOWN}>
        <p class="wl-quiet">+{props.chains.length - CHAINS_SHOWN} more waiting</p>
      </Show>
    </Show>
  );
}

function ChainNodeView(props: { node: ChainNode; agent: WorkloadAgent | undefined }) {
  const people = useTaskPeople();
  const name = () => {
    if (props.node.kind === "agent") return props.agent?.name ?? "Agent";
    if (props.node.kind === "you") return "You";
    if (props.node.kind === "person") return people.personName(props.node.userId!);
    return "Nobody";
  };
  const label = () => props.node.label || name();
  return (
    <span class="wl-node" classList={{ "wl-node--held": props.node.held }} title={`${name()} · ${label()} · ${props.node.note}`}>
      <Show when={props.node.kind === "agent"} fallback={props.node.kind === "nobody" ? <span class="wl-nobody" aria-hidden="true" /> : <InitialsDisc name={props.node.userId ? people.personName(props.node.userId) : name()} seed={props.node.userId ?? name()} size={24} you={props.node.kind === "you"} />}>
        <AgentMark agent={props.agent} id={props.node.agentId!} size={24} />
      </Show>
      <span classList={{ mono: props.node.mono }}>{label()}</span>
      <small>{props.node.note}</small>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Open work

function OpenWork(props: {
  rows: ReturnType<typeof openWork>["rows"];
  legend: ReturnType<typeof openWork>["key"];
  agentById: ReadonlyMap<string, WorkloadAgent>;
  ready: boolean;
}) {
  const max = () => Math.max(1, ...props.rows.map((row) => row.total));
  return (
    <Show when={props.rows.length > 0} fallback={<p class="wl-quiet">{props.ready ? "No open work is assigned to an agent." : "Loading…"}</p>}>
      <ul class="wl-load-list">
        <For each={props.rows}>
          {(row) => {
            const agent = () => props.agentById.get(row.agentId);
            return (
              <li class="wl-load-row">
                <span class="wl-load-who">
                  <AgentMark agent={agent()} id={row.agentId} size={24} />
                  <span class="wl-ellipsis">{agent()?.name ?? "Agent"}</span>
                </span>
                <span class="wl-load" classList={{ "wl-load--none": row.total === 0 }} style={{ width: `${(row.total / max()) * 100}%` }} role="img" aria-label={row.segments.map((segment) => `${segment.label}: ${segment.count}`).join(", ") || "Nothing open"}>
                  <For each={row.segments}>{(segment) => <span title={`${segment.label}: ${segment.count}`} style={{ flex: `${segment.count} 1 0px`, background: segment.gradient }} />}</For>
                </span>
                <span class="wl-load-total">
                  <b>{row.total}</b> open
                </span>
              </li>
            );
          }}
        </For>
      </ul>
      <div class="wl-load-key">
        <For each={props.legend.slice(0, 8)}>
          {(entry) => (
            <span class="wl-key">
              <span class="wl-key-cell" style={{ background: entry.gradient }} />
              {entry.label}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------------------------
// The suggestion

function SuggestionPill(props: { suggestion: NonNullable<ReturnType<typeof suggestion>>; agentById: ReadonlyMap<string, WorkloadAgent> }) {
  const company = useCompany();
  const client = useQueryClient();
  const openTask = useOpenTask();
  const [busy, setBusy] = createSignal(false);
  const agentName = () => props.agentById.get(props.suggestion.agentId)?.name ?? "the agent";
  const assign = async (close: () => void) => {
    setBusy(true);
    try {
      await issuesApi.update(props.suggestion.task.id, { assigneeAgentId: props.suggestion.agentId, assigneeUserId: null });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      pushToast({ tone: "success", title: `${props.suggestion.task.identifier ?? "The task"} is with ${agentName()}` });
      close();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't assign the task", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  const [open, setOpen] = createSignal(false);
  return (
    <span class="wl-push">
      <Popover open={open()} onOpenChange={setOpen} placement="bottom-end">
        <Popover.Trigger as={Button} variant="suggestion" size="compact" icon={<Lightbulb size={14} aria-hidden="true" />}>
          1 suggestion
        </Popover.Trigger>
        <Popover.Content label="Suggestion from Paperclip" hideClose class="wl-tip-pop">
          <article class="rq rq--compact wl-tip" data-kind="proposal">
            <div class="rq-top">
              <span class="rq-kind">
                <Sparkles size={12} aria-hidden="true" />
                Proposal
              </span>
              <span class="rq-tag">Suggestion</span>
              <button
                type="button"
                class="rq-subj rq-subj--link wl-tip-subj"
                onClick={() => {
                  setOpen(false);
                  openTask(props.suggestion.task);
                }}
              >
                <span class="mono">{props.suggestion.task.identifier}</span> <span class="rq-subj-title">{props.suggestion.task.title}</span>
              </button>
              <span class="rq-life">
                <Clock size={12} aria-hidden="true" />
                Only a hint
              </span>
              <Popover.Close class="rq-menu" aria-label="Close">
                <X size={14} aria-hidden="true" />
              </Popover.Close>
            </div>
            <div class="rq-ask">
              <span class="wl-pc" aria-hidden="true">
                <Zap size={12} />
              </span>
              <b>Paperclip</b>
              <span>suggests a change</span>
              <span>· worked out from open tasks and recent runs</span>
            </div>
            <h3 class="disp">{props.suggestion.title}</h3>
            <p class="wl-tip-body">{props.suggestion.body}</p>
            <div class="rq-next">
              <CornerDownRight size={14} aria-hidden="true" />
              <span>{props.suggestion.next}</span>
            </div>
            <div class="rq-acts">
              <Button variant="primary" size="compact" disabled={busy()} onClick={() => void assign(() => setOpen(false))}>
                Assign to {agentName()}
              </Button>
              <Button
                size="compact"
                onClick={() => {
                  setOpen(false);
                  openTask(props.suggestion.task);
                }}
              >
                Pick someone else
              </Button>
              <Popover.Close as={Button} variant="quiet" size="compact">
                Not now
              </Popover.Close>
              <span class="rq-who">
                <Users size={13} aria-hidden="true" />
                People only
              </span>
            </div>
          </article>
        </Popover.Content>
      </Popover>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Today

type Group = { label: string; agentIds: string[] };

function AgentCell(props: { agent: WorkloadAgent | undefined; id: string; prefix: string; state?: { key: NowStateKey; label: string }; aside?: JSX.Element }) {
  const style = () => (props.state ? STATE_STYLE[props.state.key] : STATE_STYLE.idle);
  return (
    <div class="wl-agent">
      <AgentMark agent={props.agent} id={props.id} size={32} />
      <span class="wl-agent-text">
        <A class="wl-agent-name" href={agentHref(props.prefix, props.agent, props.id)}>
          {props.agent?.name ?? "Agent"}
        </A>
        <Show when={props.state}>
          {(state) => (
            <span class="wl-agent-state" style={{ color: style().tone }}>
              <Capsule gradient={style().gradient} size="tiny" live={style().live} />
              {state().label}
            </span>
          )}
        </Show>
      </span>
      {props.aside}
    </div>
  );
}

function TodayGrid(props: { window: DayWindow; lanes: Lane[]; groups: Group[]; agentById: ReadonlyMap<string, WorkloadAgent>; prefix: string }) {
  const laneById = createMemo(() => new Map(props.lanes.map((lane) => [lane.agentId, lane] as const)));
  const nowLeft = () => `${windowFraction(props.window, props.window.now) * 100}%`;
  const ticks = () => props.window.ticks.filter((tick) => Math.abs(tick.at - props.window.now) > 1.2 * 60 * 60 * 1000);
  const ordered = (group: Group) =>
    group.agentIds
      .flatMap((id) => laneById().get(id) ?? [])
      .sort((a, b) => STATE_STYLE[a.state.key].rank - STATE_STYLE[b.state.key].rank);
  return (
    <div class="wl-table">
      <div class="wl-grid wl-grid--head" aria-hidden="true">
        <div class="wl-col-head">Agent</div>
        <div class="wl-ticks">
          <For each={ticks()}>{(tick) => <span style={{ left: `${windowFraction(props.window, tick.at) * 100}%` }}>{tick.label}</span>}</For>
          <span class="wl-now-pill" style={{ left: nowLeft() }}>
            Now {formatClock(props.window.now).replace(/ (am|pm)$/, "")}
          </span>
        </div>
        <div class="wl-col-head">Up next</div>
      </div>
      <For each={props.groups}>
        {(group) => (
          <>
            <Show when={group.label}>
              <div class="wl-group">{group.label}</div>
            </Show>
            <Index each={ordered(group)}>
              {(lane) => <LaneRow lane={lane()} window={props.window} agent={props.agentById.get(lane().agentId)} prefix={props.prefix} nowLeft={nowLeft()} />}
            </Index>
          </>
        )}
      </For>
    </div>
  );
}

function LaneRow(props: { lane: Lane; window: DayWindow; agent: WorkloadAgent | undefined; prefix: string; nowLeft: string }) {
  const openTask = useOpenTask();
  return (
    <div class="wl-grid wl-row">
      <div class="wl-cell-agent">
        <AgentCell agent={props.agent} id={props.lane.agentId} prefix={props.prefix} state={props.lane.state} />
        <div class="wl-agent-sum">
          <b>{formatDuration(props.lane.busyMs)}</b> busy
          <Show when={props.lane.spendUsd !== null}> · {formatUsd(props.lane.spendUsd!)} today</Show>
        </div>
      </div>
      <div class="wl-track" role="list" aria-label={`${props.agent?.name ?? "Agent"} today`}>
        <Index each={props.lane.bars}>{(bar) => <Bar bar={bar()} window={props.window} />}</Index>
        <span class="wl-now" style={{ left: props.nowLeft }} aria-hidden="true" />
      </div>
      <div class="wl-cell-queue">
        <Show when={props.lane.queue.length > 0}>
          <ol class="wl-q">
            <Index each={props.lane.queue.slice(0, QUEUE_SHOWN)}>
              {(item) => (
                <li>
                  <button type="button" class="wl-q-item" onClick={() => openTask(item().task)}>
                    <PriorityBars priority={item().task.priority} />
                    <span class="mono wl-q-id">{item().task.identifier}</span>
                    <span class="wl-ellipsis">{item().task.title}</span>
                    <Show when={item().queued}>
                      <span class="wl-q-tag">queued</span>
                    </Show>
                  </button>
                </li>
              )}
            </Index>
          </ol>
        </Show>
        <Show when={props.lane.queueNote}>
          <div class="wl-q-note">{props.lane.queueNote}</div>
        </Show>
      </div>
    </div>
  );
}

function Bar(props: { bar: LaneBar; window: DayWindow }) {
  const commands = useCommands();
  const left = () => windowFraction(props.window, props.bar.start);
  const width = () => Math.max(0, windowFraction(props.window, props.bar.end) - left());
  // A label fits from about 1.3 hours on the 18-hour grid.
  const showLabel = () => width() >= 0.07;
  const style = () => ({
    left: `${left() * 100}%`,
    width: `${width() * 100}%`,
    background: props.bar.series && (props.bar.kind === "run" || props.bar.kind === "live") ? props.bar.series.gradient : undefined,
  });
  const icon = () => (props.bar.kind === "blocked" ? <Ban size={11} aria-hidden="true" /> : props.bar.kind === "scheduled" ? <Plus size={11} aria-hidden="true" /> : null);
  const action = () => {
    if (props.bar.runId && props.bar.kind !== "queued") return () => commands.openRunModal(props.bar.runId!);
    return null;
  };
  return (
    <Tooltip content={props.bar.tip}>
      {(trigger) => (
        <Show
          when={action()}
          fallback={
            <span {...trigger} role="listitem" tabindex="0" class={`wl-bar wl-bar--${props.bar.kind}`} style={style()} aria-label={props.bar.tip}>
              <Show when={showLabel()}>
                {icon()}
                <span class="wl-bar-label">{props.bar.label}</span>
              </Show>
            </span>
          }
        >
          {(run) => (
            <button {...trigger} type="button" role="listitem" class={`wl-bar wl-bar--${props.bar.kind}`} style={style()} aria-label={`${props.bar.tip}. Open the run`} onClick={run()}>
              <Show when={showLabel()}>
                <span class="wl-bar-label">{props.bar.label}</span>
              </Show>
            </button>
          )}
        </Show>
      )}
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------------------------
// 7 and 30 days

function HeatGrid(props: { map: ReturnType<typeof heatmap>; states: ReadonlyMap<string, NowState>; groups: Group[]; agentById: ReadonlyMap<string, WorkloadAgent>; prefix: string; budgets: boolean }) {
  const rowById = createMemo(() => new Map(props.map.rows.map((row) => [row.agentId, row] as const)));
  const columns = () => ({ "grid-template-columns": `repeat(${props.map.days.length}, minmax(0, 1fr))`, gap: props.map.range === "week" ? "8px" : "3px" });
  const totalDays = () => props.map.days.length;
  return (
    <div class="wl-table">
      <div class="wl-grid wl-grid--heat wl-grid--head" aria-hidden="true">
        <div class="wl-col-head">Agent</div>
        <div class="wl-hm wl-hm--head" style={columns()}>
          <For each={props.map.days}>
            {(day) => (
              <span class="wl-hm-day" classList={{ "wl-hm-day--today": day.today, "wl-hm-day--start": props.map.range === "month" }}>
                {day.label}
              </span>
            )}
          </For>
        </div>
        <div class="wl-col-head">{props.map.range === "week" ? "This week" : "Last 30 days"}</div>
      </div>
      <For each={props.groups}>
        {(group) => (
          <>
            <Show when={group.label}>
              <div class="wl-group">{group.label}</div>
            </Show>
            <For each={group.agentIds.flatMap((id) => rowById().get(id) ?? [])}>
              {(row) => {
                const agent = () => props.agentById.get(row.agentId);
                return (
                  <div class="wl-grid wl-grid--heat wl-row">
                    <div class="wl-cell-agent">
                      <AgentCell
                        agent={agent()}
                        id={row.agentId}
                        prefix={props.prefix}
                        state={props.states.get(row.agentId)}
                        aside={<For each={row.flags}>{(flag) => <Flag flag={flag} />}</For>}
                      />
                    </div>
                    <HeatCells days={row.days} style={columns()} label={`${agent()?.name ?? "Agent"}, busy time by ${props.map.range === "week" ? "block" : "day"}`} />
                    <div class="wl-heat-side">
                      <div>
                        <b>{formatHours(row.busyMs)}</b> busy
                        <Show when={row.costUsd !== null}> · {formatUsd(row.costUsd!)}</Show>
                      </div>
                      <div>
                        {row.activeDays} of {totalDays()} days active
                      </div>
                      <Show when={props.budgets && agent()?.budgetMonthlyCents}>
                        {(budget) => {
                          const spent = () => (agent()?.spentMonthlyCents ?? 0) / 100;
                          const cap = () => budget() / 100;
                          const share = () => Math.min(1, spent() / cap());
                          return (
                            <div class="wl-budget-row">
                              <span class="wl-budget" role="meter" aria-valuemin={0} aria-valuemax={cap()} aria-valuenow={spent()} aria-label="Budget this month">
                                <span style={{ width: `${share() * 100}%`, background: share() > 0.8 ? "linear-gradient(90deg, #f7b52f, #f2286f)" : "linear-gradient(90deg, #2fd12f, #22b5a5)" }} />
                              </span>
                              <span class="wl-num">
                                ${Math.round(spent())} of ${Math.round(cap())} this month
                              </span>
                            </div>
                          );
                        }}
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </>
        )}
      </For>
      <Show when={props.map.rows.length > 1}>
        <div class="wl-grid wl-grid--heat wl-row wl-row--total">
          <div class="wl-total-who">
            <b>All agents</b>
            <span>How many were busy at once</span>
          </div>
          <HeatCells days={props.map.total.days} style={columns()} label="All agents, how many were busy at once" />
          <div class="wl-heat-side">
            <div>
              <b>{formatHours(props.map.total.busyMs)}</b> busy
              <Show when={props.map.total.costUsd !== null}> · {formatUsd(props.map.total.costUsd!)}</Show>
            </div>
            <div>{props.map.total.agents} agents</div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function HeatCells(props: { days: HeatCell[][]; style: JSX.CSSProperties; label: string }) {
  return (
    <div class="wl-hm" style={props.style} role="img" aria-label={props.label}>
      <For each={props.days}>
        {(cells) => (
          <span class="wl-hm-col">
            <For each={cells}>
              {(cell) => (
                <span
                  class={`wl-cell wl-cell--${cell.kind}`}
                  title={cell.tip}
                  style={{ background: cell.kind === "busy" ? HEAT_SCALE[cell.level] : undefined }}
                />
              )}
            </For>
          </span>
        )}
      </For>
    </div>
  );
}

function Flag(props: { flag: HeatFlag }) {
  const style = () =>
    props.flag.kind === "busiest"
      ? { gradient: "linear-gradient(160deg, #f7b52f, #f5822a)", ring: "#f5822a", fg: "#111113", icon: <Zap size={12} stroke-width={2.6} aria-hidden="true" /> }
      : { gradient: "linear-gradient(160deg, #2fd12f, #22b5a5)", ring: "#22b5a5", fg: "#111113", icon: <Plus size={12} stroke-width={2.6} aria-hidden="true" /> };
  return (
    <Tooltip title={props.flag.title} content={props.flag.body} placement="right">
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          class="wl-flag"
          aria-label={`${props.flag.title}: ${props.flag.body}`}
          style={{ background: style().gradient, color: style().fg, "box-shadow": `0 0 0 3px color-mix(in srgb, ${style().ring} 30%, transparent)` }}
        >
          {style().icon}
        </button>
      )}
    </Tooltip>
  );
}
