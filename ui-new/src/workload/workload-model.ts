import type { Agent, CompactIssue, IssuePriority, IssueStatus, Project } from "@paperclipai/shared";
import type { LiveRun } from "@/api/heartbeats";
import type { WorkloadRun } from "@/api/workload";
import { discGradient } from "@/ui/Avatar";
import { STATUS_META, gradientVar } from "@/ui/status-meta";

/*
 * Agent workload (boards 31–33), worked out from runs, live runs and assignments; there's no
 * workload API. The project tab and the company page share this model: a scope says which tasks and
 * runs count, and how run bars and open work are coloured (by task in a project, by project across
 * the company).
 *
 * - Who's waiting on whom: chains from a task's blockers, and from reviews waiting on a person.
 * - Open work: each agent's open assigned tasks, split by status (project) or by project (company).
 * - A suggestion: an unassigned task for the agent with the most room, behind the "1 suggestion" pill.
 * - Today: run lanes on an hour grid with a "now" line, blocked and paused stretches, scheduled
 *   heartbeats, and each agent's queue.
 * - 7 and 30 days: a heatmap of busy time in 4-hour blocks (week) or days (month), an "All agents"
 *   row, and markers for the busiest agent and the one with the most room.
 *
 * Times are local: the day starts at local midnight, as the boards draw it. Everything takes `now`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type WorkloadTask = Pick<
  CompactIssue,
  "id" | "identifier" | "title" | "status" | "priority" | "projectId" | "assigneeAgentId" | "assigneeUserId" | "updatedAt" | "createdAt" | "blockedBy"
>;

export type WorkloadAgent = Pick<Agent, "id" | "name" | "role" | "status"> &
  Partial<Pick<Agent, "urlKey" | "appearance" | "pausedAt" | "pauseReason" | "lastHeartbeatAt" | "runtimeConfig" | "budgetMonthlyCents" | "spentMonthlyCents">>;

export type WorkloadProject = Pick<Project, "id" | "name"> & { color?: string | null };

/** A project's tab counts its own tasks and the runs on them; the company page counts everything. */
export type WorkloadScope = { kind: "project"; projectId: string } | { kind: "company" };

export type WorkloadInput = {
  scope: WorkloadScope;
  agents: readonly WorkloadAgent[];
  /** The scope's tasks: a project's, or the whole company's. */
  tasks: readonly WorkloadTask[];
  /** The company's latest runs, newest first. */
  runs: readonly WorkloadRun[];
  /** Whether `runs` stopped at the server's limit, so older runs exist that aren't loaded. */
  runsTruncated: boolean;
  liveRuns: readonly LiveRun[];
  projects?: readonly WorkloadProject[];
  youId: string | null;
  now: number;
};

const OPEN: ReadonlySet<IssueStatus> = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);
const RESOLVED: ReadonlySet<IssueStatus> = new Set(["done", "cancelled"]);
const HIDDEN_AGENT: ReadonlySet<string> = new Set(["terminated", "pending_approval"]);
const PRIORITY_RANK: Record<IssuePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const QUEUE_STATUS_RANK: Partial<Record<IssueStatus, number>> = { in_progress: 0, todo: 1, in_review: 2, blocked: 3, backlog: 4 };

export const isOpenTask = (task: Pick<WorkloadTask, "status">) => OPEN.has(task.status);
const time = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : NaN);
const taskLabel = (task: Pick<WorkloadTask, "identifier" | "title">) => task.identifier ?? task.title;

/** Agents the workload shows at all: not terminated, not waiting for hire approval. */
export function visibleAgents<T extends Pick<WorkloadAgent, "status">>(agents: readonly T[]) {
  return agents.filter((agent) => !HIDDEN_AGENT.has(agent.status));
}

// ---------------------------------------------------------------------------------------------
// Formatting

/** "4h 30m", "45m", "0m". */
export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "4.5h", "12h", "0h": the heatmap's totals. */
export function formatHours(ms: number) {
  const hours = ms / HOUR;
  if (hours === 0) return "0h";
  if (hours < 0.1) return "<0.1h";
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10}h`;
}

/** "$2.10". */
export function formatUsd(usd: number) {
  return `$${usd >= 100 ? Math.round(usd) : usd.toFixed(2)}`;
}

/** "2:25 pm", "4 pm". */
export function formatClock(at: number) {
  const date = new Date(at);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours < 12 ? "am" : "pm";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${h12} ${suffix}` : `${h12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** "6a", "12p", "3p": hour-grid ticks. */
function tickLabel(hour: number) {
  if (hour === 0 || hour === 24) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local midnight of the day `at` falls in. */
export function startOfDay(at: number) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local midnight `days` days after the day `at` falls in (DST-safe). */
function addDays(at: number, days: number) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

function sinceLabel(at: number, now: number) {
  const today = startOfDay(now);
  if (at >= today) return formatClock(at);
  if (at >= addDays(today, -1)) return "yesterday";
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function ageLabel(ms: number) {
  const days = Math.floor(ms / DAY);
  if (days >= 2) return `${days} days`;
  if (days === 1) return "a day";
  const hours = Math.floor(ms / HOUR);
  if (hours >= 2) return `${hours} hours`;
  return hours === 1 ? "an hour" : "less than an hour";
}

// ---------------------------------------------------------------------------------------------
// Scope

/** The tasks the scope counts, by id. */
function scopeTasks(input: Pick<WorkloadInput, "scope" | "tasks">) {
  const tasks = input.scope.kind === "project" ? input.tasks.filter((task) => task.projectId === (input.scope as { projectId: string }).projectId) : input.tasks;
  return new Map(tasks.map((task) => [task.id, task] as const));
}

/** Runs the scope counts: on the project's tasks, or every run in the company. */
export function scopeRuns<T extends Pick<WorkloadRun, "issueId">>(scope: WorkloadScope, runs: readonly T[], taskIds: ReadonlySet<string>) {
  if (scope.kind === "company") return [...runs];
  return runs.filter((run) => !!run.issueId && taskIds.has(run.issueId));
}

/**
 * What colours a run bar and an open-work segment: the task in a project (several tasks side by
 * side), the project across the company. Gradients run sideways, as bars do.
 */
export type SeriesKey = { key: string; label: string; mono: boolean; gradient: string };

const SIDEWAYS = (css: string) => css.replace("160deg", "90deg");

export function projectGradient(project: WorkloadProject | undefined) {
  if (!project) return "linear-gradient(90deg, var(--ash-a), var(--ash-b))";
  if (project.color) return `linear-gradient(90deg, ${project.color}, color-mix(in srgb, ${project.color} 70%, #000))`;
  return SIDEWAYS(discGradient(project.id));
}

/** Gradients for tasks, in the order the boards use them. */
const TASK_GRADIENTS = [
  "linear-gradient(90deg, #8b2cf0, #1f6fe0)",
  "linear-gradient(90deg, #22b5a5, #4c7896)",
  "linear-gradient(90deg, #ff2bd6, #8b2cf0)",
  "linear-gradient(90deg, #f7b52f, #f5822a)",
  "linear-gradient(90deg, #ff2bd6, #f7b52f)",
  "linear-gradient(90deg, #2fd12f, #22b5a5)",
  "linear-gradient(90deg, #3b3df5, #22b5a5)",
];

/** Assigns each series a colour as it's first met; tasks cycle the board's gradients. */
function seriesPalette(input: Pick<WorkloadInput, "scope" | "projects">, tasks: ReadonlyMap<string, WorkloadTask>) {
  const projects = new Map((input.projects ?? []).map((project) => [project.id, project] as const));
  const seen = new Map<string, SeriesKey>();
  const forTask = (taskId: string | null | undefined): SeriesKey => {
    const task = taskId ? tasks.get(taskId) : undefined;
    if (input.scope.kind === "project") {
      const key = task?.id ?? "none";
      let entry = seen.get(key);
      if (!entry) {
        entry = task
          ? { key, label: taskLabel(task), mono: !!task.identifier, gradient: TASK_GRADIENTS[seen.size % TASK_GRADIENTS.length]! }
          : { key, label: "No task", mono: false, gradient: "linear-gradient(90deg, var(--ash-a), var(--ash-b))" };
        seen.set(key, entry);
      }
      return entry;
    }
    const projectId = task?.projectId ?? null;
    const key = projectId ?? (task ? "no-project" : "none");
    let entry = seen.get(key);
    if (!entry) {
      const project = projectId ? projects.get(projectId) : undefined;
      entry = { key, label: project?.name ?? (task ? "No project" : "No task"), mono: false, gradient: projectGradient(project) };
      seen.set(key, entry);
    }
    return entry;
  };
  return { forTask, used: () => [...seen.values()] };
}

/**
 * Which agents a view lists. The company page lists everyone; a project lists the agents with a
 * live run, open work or a run in it since `since`.
 */
export function rosterIds(input: WorkloadInput, since: number): string[] {
  const agents = visibleAgents(input.agents);
  if (input.scope.kind === "company") return agents.map((agent) => agent.id);
  const tasks = scopeTasks(input);
  const ids = new Set<string>();
  for (const run of input.liveRuns) if (run.issueId && tasks.has(run.issueId)) ids.add(run.agentId);
  for (const task of tasks.values()) if (task.assigneeAgentId && isOpenTask(task)) ids.add(task.assigneeAgentId);
  for (const run of scopeRuns(input.scope, input.runs, new Set(tasks.keys()))) {
    if (time(run.startedAt ?? run.createdAt) >= since) ids.add(run.agentId);
  }
  return agents.filter((agent) => ids.has(agent.id)).map((agent) => agent.id);
}

// ---------------------------------------------------------------------------------------------
// Groups (company page)

export type AgentGroup = { label: string; agentIds: string[] };

const TEAM_OF_ROLE: Record<string, string> = {
  ceo: "Leadership",
  cto: "Leadership",
  cmo: "Leadership",
  cfo: "Leadership",
  researcher: "Research",
  engineer: "Engineering",
  designer: "Engineering",
  qa: "Engineering",
  devops: "Engineering",
  security: "Engineering",
  pm: "Product",
  general: "General",
};
const TEAM_ORDER = ["Leadership", "Product", "Research", "Engineering", "General", "Built in"];

/**
 * The company page's groups (board 33): teams by role, with built-in agents last. The API has no
 * teams, so the role stands in. One group draws no heading.
 */
export function groupAgents(agents: readonly Pick<WorkloadAgent, "id" | "name" | "role">[], builtInIds: ReadonlySet<string>): AgentGroup[] {
  const groups = new Map<string, Pick<WorkloadAgent, "id" | "name">[]>();
  for (const agent of agents) {
    const team = builtInIds.has(agent.id) ? "Built in" : (TEAM_OF_ROLE[agent.role] ?? "General");
    groups.set(team, [...(groups.get(team) ?? []), agent]);
  }
  const ordered = TEAM_ORDER.filter((team) => groups.has(team)).map((team) => ({
    label: team,
    agentIds: groups
      .get(team)!
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => agent.id),
  }));
  if (ordered.length === 1) ordered[0]!.label = "";
  return ordered;
}

// ---------------------------------------------------------------------------------------------
// Who's waiting on whom

export type ChainNode = {
  /** An agent, a person, you, or nobody (an unassigned task). */
  kind: "agent" | "person" | "you" | "nobody";
  agentId: string | null;
  userId: string | null;
  /** A task identifier, or "You" and a person's name for a review. */
  label: string;
  mono: boolean;
  note: string;
  taskId: string | null;
  /** Drawn with a red ring: this one is held up, or is what holds the others up. */
  held: boolean;
};

export type Chain = { key: string; nodes: ChainNode[]; summary: string; involvesYou: boolean };

type Holder = Pick<WorkloadTask, "id" | "identifier" | "title" | "status" | "assigneeAgentId" | "assigneeUserId">;

function holderNode(task: Holder, note: string, youId: string | null, held = false): ChainNode {
  const base = { label: task.identifier ?? task.title, mono: !!task.identifier, note, taskId: task.id, held };
  if (task.assigneeAgentId) return { ...base, kind: "agent", agentId: task.assigneeAgentId, userId: null };
  if (task.assigneeUserId) return { ...base, kind: task.assigneeUserId === youId ? "you" : "person", agentId: null, userId: task.assigneeUserId };
  return { ...base, kind: "nobody", agentId: null, userId: null };
}

function statusNote(task: Pick<Holder, "id" | "status">, running: ReadonlySet<string>) {
  if (running.has(task.id)) return "running";
  return STATUS_META[task.status]?.label.toLowerCase() ?? task.status;
}

/**
 * Chains of who waits on whom (board 31's top left):
 *
 * - A task held up by another: the blocker (and what blocks it, when the server names a deeper
 *   one), then the blocked task. The blocked task is ringed red.
 * - A review waiting on a person: the agent that last ran the task, then the reviewer.
 *
 * Chains that involve you come first, then by the waiting task's priority.
 */
export function waitingChains(input: WorkloadInput): Chain[] {
  const tasks = scopeTasks(input);
  const running = new Set(input.liveRuns.filter((run) => run.status === "running" && run.issueId).map((run) => run.issueId!));
  const lastRunAgent = new Map<string, string>();
  for (const run of input.runs) if (run.issueId && !lastRunAgent.has(run.issueId)) lastRunAgent.set(run.issueId, run.agentId);
  const chains: (Chain & { rank: number })[] = [];

  for (const task of tasks.values()) {
    if (!isOpenTask(task)) continue;
    const blocker = (task.blockedBy ?? []).find((candidate) => !RESOLVED.has(candidate.status));
    if (blocker) {
      const deeper = (blocker.terminalBlockers ?? []).find((candidate) => !RESOLVED.has(candidate.status) && candidate.id !== blocker.id);
      const nodes: ChainNode[] = [];
      if (deeper) nodes.push(holderNode(deeper, statusNote(deeper, running), input.youId, !deeper.assigneeAgentId && !deeper.assigneeUserId));
      const blockerNode = holderNode(blocker, statusNote(blocker, running), input.youId, !blocker.assigneeAgentId && !blocker.assigneeUserId);
      nodes.push(blockerNode, holderNode(task, "blocked", input.youId, true));
      const root = deeper ?? blocker;
      let summary = `${taskLabel(task)} starts when ${taskLabel(blocker)} is done.`;
      if (deeper) summary = `${taskLabel(task)} waits on ${taskLabel(blocker)}, which waits on ${taskLabel(deeper)}.`;
      if (!root.assigneeAgentId && !root.assigneeUserId) summary += ` Nobody is assigned to ${taskLabel(root)}.`;
      else if (root.assigneeUserId && root.assigneeUserId === input.youId) summary += ` ${taskLabel(root)} is with you.`;
      chains.push({
        key: `blocked:${task.id}`,
        nodes,
        summary,
        involvesYou: nodes.some((node) => node.kind === "you"),
        rank: PRIORITY_RANK[task.priority] ?? 2,
      });
      continue;
    }
    if (task.status === "in_review" && task.assigneeUserId) {
      const agentId = lastRunAgent.get(task.id);
      if (!agentId) continue;
      const you = task.assigneeUserId === input.youId;
      const nodes: ChainNode[] = [
        { kind: "agent", agentId, userId: null, label: taskLabel(task), mono: !!task.identifier, note: "in review", taskId: task.id, held: false },
        { kind: you ? "you" : "person", agentId: null, userId: task.assigneeUserId, label: you ? "You" : "", mono: false, note: "review", taskId: task.id, held: you },
      ];
      chains.push({
        key: `review:${task.id}`,
        nodes,
        summary: you ? `Your review is the next step for ${taskLabel(task)}.` : `${taskLabel(task)} waits on a review.`,
        involvesYou: you,
        rank: PRIORITY_RANK[task.priority] ?? 2,
      });
    }
  }
  return chains
    .sort((a, b) => Number(b.involvesYou) - Number(a.involvesYou) || a.rank - b.rank || a.key.localeCompare(b.key))
    .map(({ rank: _rank, ...chain }) => chain);
}

// ---------------------------------------------------------------------------------------------
// Open work

export type OpenWorkSegment = { key: string; label: string; count: number; gradient: string };
export type OpenWorkRow = { agentId: string; total: number; segments: OpenWorkSegment[] };

const OPEN_STATUS_ORDER: IssueStatus[] = ["in_progress", "in_review", "todo", "blocked", "backlog"];

/**
 * Each listed agent's open assigned tasks (board 31's top right): by status in a project, by project
 * across the company. Busiest first; the company page keeps agents with nothing open, at the end.
 */
export function openWork(input: WorkloadInput, agentIds: readonly string[]): { rows: OpenWorkRow[]; key: OpenWorkSegment[] } {
  const tasks = [...scopeTasks(input).values()].filter((task) => isOpenTask(task) && task.assigneeAgentId);
  const projects = new Map((input.projects ?? []).map((project) => [project.id, project] as const));
  const segmentOf = (task: WorkloadTask): Omit<OpenWorkSegment, "count"> => {
    if (input.scope.kind === "project") {
      return { key: task.status, label: STATUS_META[task.status].label, gradient: gradientVar(STATUS_META[task.status].gradient) };
    }
    const project = task.projectId ? projects.get(task.projectId) : undefined;
    return { key: task.projectId ?? "none", label: project?.name ?? "No project", gradient: projectGradient(project) };
  };
  const order = (key: string) => {
    if (input.scope.kind === "project") return OPEN_STATUS_ORDER.indexOf(key as IssueStatus);
    return key === "none" ? Number.MAX_SAFE_INTEGER : (input.projects ?? []).findIndex((project) => project.id === key);
  };
  const legend = new Map<string, OpenWorkSegment>();
  const rows: OpenWorkRow[] = [];
  for (const agentId of agentIds) {
    const counts = new Map<string, OpenWorkSegment>();
    for (const task of tasks) {
      if (task.assigneeAgentId !== agentId) continue;
      const segment = segmentOf(task);
      const entry = counts.get(segment.key) ?? { ...segment, count: 0 };
      entry.count += 1;
      counts.set(segment.key, entry);
      const key = legend.get(segment.key) ?? { ...segment, count: 0 };
      key.count += 1;
      legend.set(segment.key, key);
    }
    const segments = [...counts.values()].sort((a, b) => order(a.key) - order(b.key));
    const total = segments.reduce((sum, segment) => sum + segment.count, 0);
    if (total === 0 && input.scope.kind === "project") continue;
    rows.push({ agentId, total, segments });
  }
  return {
    rows: rows.sort((a, b) => b.total - a.total),
    key: [...legend.values()].sort((a, b) => order(a.key) - order(b.key)),
  };
}

// ---------------------------------------------------------------------------------------------
// Today: lanes

export type BarKind = "run" | "live" | "queued" | "blocked" | "paused" | "scheduled";

export type LaneBar = {
  kind: BarKind;
  start: number;
  end: number;
  label: string;
  tip: string;
  /** Run bars: the colour and what it stands for. */
  series: SeriesKey | null;
  runId: string | null;
  taskId: string | null;
};

export type NowStateKey = "running" | "elsewhere" | "queued" | "blocked" | "paused" | "error" | "idle";
export type NowState = { key: NowStateKey; label: string; runId: string | null; taskId: string | null };

export type QueueItem = { task: WorkloadTask; queued: boolean };

export type Lane = {
  agentId: string;
  state: NowState;
  bars: LaneBar[];
  busyMs: number;
  /** Run costs the harness reported today; null when none did. */
  spendUsd: number | null;
  queue: QueueItem[];
  queueNote: string;
};

export type DayWindow = { start: number; end: number; now: number; ticks: { at: number; label: string }[] };

/** Most of a queue the lane lists; the rest is "+N more". */
export const QUEUE_SHOWN = 3;

function heartbeatInterval(agent: WorkloadAgent) {
  const heartbeat = (agent.runtimeConfig as { heartbeat?: { enabled?: boolean; intervalSec?: number } } | undefined)?.heartbeat;
  if (!heartbeat?.enabled || !heartbeat.intervalSec || heartbeat.intervalSec < 60) return null;
  return heartbeat.intervalSec * 1000;
}

function overlap(start: number, end: number, from: number, to: number) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

/** A run's span: started (or created, when queued) to finished, or to `now` while it runs. */
function runSpan(run: WorkloadRun, live: ReadonlySet<string>, now: number) {
  const start = time(run.startedAt);
  if (Number.isNaN(start)) return null;
  const finished = time(run.finishedAt);
  const end = Number.isNaN(finished) ? (live.has(run.id) || run.status === "running" ? now : start) : finished;
  return { start, end: Math.max(start, end) };
}

function runCost(run: WorkloadRun) {
  if (run.costUsd === null || run.costUsd === undefined || run.costUsd === "") return null;
  const value = Number(run.costUsd);
  return Number.isFinite(value) ? value : null;
}

/**
 * The hour grid for today (board 31): from 6 am, or the hour of the day's first bar if earlier, to
 * midnight, with a tick every 3 hours.
 */
export function dayWindow(now: number, earliest?: number): DayWindow {
  const midnight = startOfDay(now);
  let startHour = 6;
  if (earliest !== undefined && Number.isFinite(earliest) && earliest < midnight + 6 * HOUR) {
    startHour = Math.max(0, Math.floor((Math.max(earliest, midnight) - midnight) / HOUR));
  }
  const start = midnight + startHour * HOUR;
  const end = addDays(midnight, 1);
  const ticks: { at: number; label: string }[] = [];
  for (let hour = Math.ceil(startHour / 3) * 3; hour < 24; hour += 3) ticks.push({ at: midnight + hour * HOUR, label: tickLabel(hour) });
  return { start, end, now, ticks };
}

/** Where `at` sits on the window, as a fraction from 0 to 1. */
export function windowFraction(window: Pick<DayWindow, "start" | "end">, at: number) {
  return Math.min(1, Math.max(0, (at - window.start) / (window.end - window.start)));
}

function nowState(
  agent: WorkloadAgent,
  live: readonly LiveRun[],
  scopeTaskIds: ReadonlySet<string>,
  tasks: ReadonlyMap<string, WorkloadTask>,
  assigned: readonly WorkloadTask[],
  lastFinished: number | null,
  now: number,
): NowState {
  const mine = live.filter((run) => run.agentId === agent.id);
  const inScope = (run: LiveRun) => !run.issueId || scopeTaskIds.has(run.issueId);
  const runningHere = mine.find((run) => run.status === "running" && inScope(run));
  if (runningHere) {
    const task = runningHere.issueId ? tasks.get(runningHere.issueId) : undefined;
    return { key: "running", label: task ? `Running ${taskLabel(task)}` : "Running", runId: runningHere.id, taskId: task?.id ?? null };
  }
  const runningElsewhere = mine.find((run) => run.status === "running");
  if (runningElsewhere) return { key: "elsewhere", label: "Running elsewhere", runId: runningElsewhere.id, taskId: null };
  if (agent.status === "paused") return { key: "paused", label: agent.pauseReason === "budget" ? "Paused: over budget" : "Paused", runId: null, taskId: null };
  if (agent.status === "error") return { key: "error", label: "Error", runId: null, taskId: null };
  const queued = mine.find((run) => inScope(run));
  if (queued) {
    const task = queued.issueId ? tasks.get(queued.issueId) : undefined;
    return { key: "queued", label: task ? `Queued ${taskLabel(task)}` : "Queued", runId: queued.id, taskId: task?.id ?? null };
  }
  const blocked = assigned.find((task) => task.status === "blocked");
  if (blocked) return { key: "blocked", label: "Blocked", runId: null, taskId: blocked.id };
  return { key: "idle", label: lastFinished === null ? "Idle" : `Idle since ${sinceLabel(lastFinished, now)}`, runId: null, taskId: null };
}

/** Open tasks in the order an agent would pick them up: queued runs first, then status and priority. */
function queueFor(assigned: readonly WorkloadTask[], queuedTaskIds: ReadonlySet<string>, currentTaskId: string | null): QueueItem[] {
  return assigned
    .filter((task) => task.id !== currentTaskId)
    .map((task) => ({ task, queued: queuedTaskIds.has(task.id) }))
    .sort(
      (a, b) =>
        Number(b.queued) - Number(a.queued) ||
        (QUEUE_STATUS_RANK[a.task.status] ?? 9) - (QUEUE_STATUS_RANK[b.task.status] ?? 9) ||
        (PRIORITY_RANK[a.task.priority] ?? 2) - (PRIORITY_RANK[b.task.priority] ?? 2) ||
        time(a.task.createdAt) - time(b.task.createdAt),
    );
}

/** When each agent last finished a run anywhere in the company, for "Idle since". */
function lastFinishedByAgent(runs: readonly WorkloadRun[]) {
  const lastFinished = new Map<string, number>();
  for (const run of runs) {
    const finished = time(run.finishedAt);
    if (!Number.isNaN(finished) && finished > (lastFinished.get(run.agentId) ?? -Infinity)) lastFinished.set(run.agentId, finished);
  }
  return lastFinished;
}

/** What each listed agent is doing now, as the lanes' state line says it; the heatmap rows show it too. */
export function agentStates(input: WorkloadInput, agentIds: readonly string[]): Map<string, NowState> {
  const tasks = scopeTasks(input);
  const taskIds = new Set(tasks.keys());
  const lastFinished = lastFinishedByAgent(input.runs);
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent] as const));
  const states = new Map<string, NowState>();
  for (const agentId of agentIds) {
    const agent = agentById.get(agentId);
    if (!agent) continue;
    const assigned = [...tasks.values()].filter((task) => task.assigneeAgentId === agentId && isOpenTask(task));
    states.set(agentId, nowState(agent, input.liveRuns, taskIds, tasks, assigned, lastFinished.get(agentId) ?? null, input.now));
  }
  return states;
}

/**
 * Today's lanes (board 31, Today): for each listed agent, its runs in the scope as bars (the live
 * one glowing, up to `now`), a blocked stretch while its task waits on another, a paused stretch,
 * queued runs and scheduled heartbeats as dashed bars after the "now" line, and its queue.
 *
 * The API keeps no status history, so a blocked stretch starts at the task's last update (or the
 * window's start), which is when it most likely became blocked, or after the agent's last run today
 * if that ended later.
 */
export function todayLanes(input: WorkloadInput, agentIds: readonly string[]): { window: DayWindow; lanes: Lane[]; legend: SeriesKey[] } {
  const now = input.now;
  const midnight = startOfDay(now);
  const tasks = scopeTasks(input);
  const taskIds = new Set(tasks.keys());
  const palette = seriesPalette(input, tasks);
  const liveIds = new Set(input.liveRuns.map((run) => run.id));
  const runs = scopeRuns(input.scope, input.runs, taskIds).filter((run) => !(liveIds.has(run.id) && run.status === "queued"));
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent] as const));

  const spans = runs.flatMap((run) => {
    const span = runSpan(run, liveIds, now);
    return span && span.end >= midnight && span.start <= now ? [{ run, ...span }] : [];
  });
  const window = dayWindow(now, spans.length ? Math.min(...spans.map((span) => span.start)) : undefined);

  const lastFinished = lastFinishedByAgent(input.runs);

  const lanes: Lane[] = [];
  for (const agentId of agentIds) {
    const agent = agentById.get(agentId);
    if (!agent) continue;
    const assigned = [...tasks.values()].filter((task) => task.assigneeAgentId === agentId && isOpenTask(task));
    const state = nowState(agent, input.liveRuns, taskIds, tasks, assigned, lastFinished.get(agentId) ?? null, now);
    const bars: LaneBar[] = [];
    let busyMs = 0;
    let spend: number | null = null;

    for (const span of spans) {
      if (span.run.agentId !== agentId) continue;
      const live = span.run.status === "running" || (liveIds.has(span.run.id) && Number.isNaN(time(span.run.finishedAt)));
      const end = live ? now : span.end;
      busyMs += overlap(span.start, end, midnight, now);
      const cost = runCost(span.run);
      if (cost !== null) spend = (spend ?? 0) + cost;
      const series = palette.forTask(span.run.issueId);
      const task = span.run.issueId ? tasks.get(span.run.issueId) : undefined;
      const what = task ? `${taskLabel(task)} · ` : "";
      bars.push({
        kind: live ? "live" : "run",
        start: Math.max(span.start, window.start),
        end: Math.max(end, Math.max(span.start, window.start)),
        label: task ? taskLabel(task) : "Run",
        tip: live ? `${what}running ${formatDuration(now - span.start)}` : `${what}${formatClock(span.start)} · ${formatDuration(end - span.start)}`,
        series,
        runId: span.run.id,
        taskId: task?.id ?? null,
      });
    }

    // The live list also carries runs the history hasn't caught up with yet.
    for (const run of input.liveRuns) {
      if (run.agentId !== agentId || run.status !== "running" || bars.some((bar) => bar.runId === run.id)) continue;
      if (run.issueId ? !taskIds.has(run.issueId) : input.scope.kind === "project") continue;
      const start = time(run.startedAt ?? run.createdAt);
      if (Number.isNaN(start)) continue;
      busyMs += overlap(start, now, midnight, now);
      const task = run.issueId ? tasks.get(run.issueId) : undefined;
      bars.push({
        kind: "live",
        start: Math.max(start, window.start),
        end: now,
        label: task ? taskLabel(task) : "Run",
        tip: `${task ? `${taskLabel(task)} · ` : ""}running ${formatDuration(now - start)}`,
        series: palette.forTask(run.issueId),
        runId: run.id,
        taskId: task?.id ?? null,
      });
    }

    if (state.key === "blocked" && state.taskId) {
      const task = tasks.get(state.taskId)!;
      const blocker = (task.blockedBy ?? []).find((candidate) => !RESOLVED.has(candidate.status));
      // From its last update, but not over a run it made after that.
      const lastRunEnd = Math.max(window.start, ...bars.filter((bar) => bar.kind === "run").map((bar) => bar.end));
      const since = Math.min(now, Math.max(lastRunEnd, time(task.updatedAt) || window.start));
      bars.push({
        kind: "blocked",
        start: since,
        end: now,
        label: blocker ? `Waiting on ${taskLabel(blocker)}` : "Blocked",
        tip: `${taskLabel(task)} is blocked${blocker ? ` by ${taskLabel(blocker)}` : ""} · last update ${sinceLabel(time(task.updatedAt), now)}`,
        series: null,
        runId: null,
        taskId: task.id,
      });
    }

    if (agent.status === "paused") {
      const pausedAt = time(agent.pausedAt);
      const since = Number.isNaN(pausedAt) ? window.start : Math.max(window.start, pausedAt);
      bars.push({
        kind: "paused",
        start: since,
        end: window.end,
        label: "Paused",
        tip: Number.isNaN(pausedAt) ? "Paused" : `Paused since ${sinceLabel(pausedAt, now)}`,
        series: null,
        runId: null,
        taskId: null,
      });
    }

    // Queued runs wait at the "now" line.
    const queuedRuns = input.liveRuns.filter((run) => run.agentId === agentId && run.status !== "running" && (!run.issueId || taskIds.has(run.issueId)));
    if (input.scope.kind === "company" || queuedRuns.some((run) => run.issueId)) {
      let at = now;
      for (const run of queuedRuns) {
        if (input.scope.kind === "project" && !run.issueId) continue;
        const task = run.issueId ? tasks.get(run.issueId) : undefined;
        bars.push({
          kind: "queued",
          start: at,
          end: Math.min(window.end, at + 40 * MINUTE),
          label: task ? `${taskLabel(task)} next` : "Queued",
          tip: `Queued${task ? ` · ${taskLabel(task)}` : ""} · waiting for a slot`,
          series: null,
          runId: run.id,
          taskId: task?.id ?? null,
        });
        at += 45 * MINUTE;
      }
    }

    const interval = heartbeatInterval(agent);
    if (interval && agent.status !== "paused") {
      const last = time(agent.lastHeartbeatAt);
      let next = Number.isNaN(last) ? now : last + interval;
      while (next < now) next += interval;
      const length = Math.max(15 * MINUTE, Math.min(interval * 0.4, 90 * MINUTE));
      for (let count = 0; next < window.end && count < 8; count += 1, next += interval) {
        bars.push({
          kind: "scheduled",
          start: next,
          end: Math.min(window.end, next + length),
          label: "Heartbeat",
          tip: `Heartbeat every ${formatDuration(interval)} · next at ${formatClock(next)}`,
          series: null,
          runId: null,
          taskId: null,
        });
      }
    }

    const queuedTaskIds = new Set(queuedRuns.flatMap((run) => (run.issueId ? [run.issueId] : [])));
    const queue = queueFor(assigned, queuedTaskIds, state.key === "running" || state.key === "queued" ? state.taskId : null);
    lanes.push({ agentId, state, bars: bars.sort((a, b) => a.start - b.start), busyMs, spendUsd: spend, queue, queueNote: queueNote(agentId, queue, state, tasks, input) });
  }
  return { window, lanes, legend: palette.used().filter((entry) => entry.key !== "none") };
}

/**
 * The line under a queue: what's left beyond the shown items, or that it's empty, and a task the
 * agent last worked on that now waits on your review.
 */
function queueNote(agentId: string, queue: readonly QueueItem[], state: NowState, tasks: ReadonlyMap<string, WorkloadTask>, input: WorkloadInput) {
  const parts: string[] = [];
  if (queue.length > QUEUE_SHOWN) parts.push(`+${queue.length - QUEUE_SHOWN} more`);
  else if (queue.every((item) => item.task.id === state.taskId)) parts.push(state.taskId ? "Nothing else queued" : "Queue is empty");
  if (input.youId) {
    const lastRunAgent = new Map<string, string>();
    for (const run of input.runs) if (run.issueId && !lastRunAgent.has(run.issueId)) lastRunAgent.set(run.issueId, run.agentId);
    const review = [...tasks.values()].find(
      (task) => task.status === "in_review" && task.assigneeUserId === input.youId && lastRunAgent.get(task.id) === agentId,
    );
    if (review) parts.push(`${taskLabel(review)} is in review with you`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------
// 7 and 30 days: heatmap

export type HeatRange = "week" | "month";
export type HeatCellKind = "busy" | "ahead" | "paused" | "unloaded";
export type HeatCell = { start: number; end: number; kind: HeatCellKind; level: 0 | 1 | 2 | 3 | 4; busyMs: number; tip: string };
export type HeatDay = { start: number; label: string; today: boolean };
export type FlagKind = "busiest" | "spare";
export type HeatFlag = { kind: FlagKind; title: string; body: string };
export type HeatRow = {
  agentId: string;
  /** One entry per day; each holds its blocks (6 a day for a week, 1 for a month). */
  days: HeatCell[][];
  busyMs: number;
  costUsd: number | null;
  activeDays: number;
  flags: HeatFlag[];
  openCount: number;
};
export type Heatmap = {
  range: HeatRange;
  days: HeatDay[];
  rows: HeatRow[];
  total: { days: HeatCell[][]; busyMs: number; costUsd: number | null; agents: number };
  /** When the loaded runs begin, if the range reaches further back than that. */
  loadedFrom: number | null;
  pausedShown: boolean;
};

const BLOCKS = ["12–4 am", "4–8 am", "8 am–12 pm", "12–4 pm", "4–8 pm", "8 pm–12 am"];

/** The heatmap's busy levels: the share of a 4-hour block, or hours in a day. */
export function heatLevel(range: HeatRange, busyMs: number): 0 | 1 | 2 | 3 | 4 {
  if (busyMs <= 0) return 0;
  if (range === "week") {
    const share = busyMs / (4 * HOUR);
    return share < 0.25 ? 1 : share < 0.5 ? 2 : share < 0.75 ? 3 : 4;
  }
  const hours = busyMs / HOUR;
  return hours < 2.5 ? 1 : hours < 5 ? 2 : hours < 9 ? 3 : 4;
}

/** The days a range covers, oldest first, ending today. */
export function heatDays(range: HeatRange, now: number): HeatDay[] {
  const count = range === "week" ? 7 : 30;
  const today = startOfDay(now);
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(today, index - count + 1);
    const date = new Date(start);
    const isToday = index === count - 1;
    let label = "";
    if (isToday) label = "Today";
    else if (range === "week") label = `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
    else if (index % 7 === 0 && index < count - 3) label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
    return { start, label, today: isToday };
  });
}

function dayName(day: HeatDay, range: HeatRange) {
  if (day.today) return "Today";
  const date = new Date(day.start);
  return range === "week" ? `${WEEKDAYS[date.getDay()]} ${date.getDate()}` : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/**
 * The heatmap (boards 31 and 32 at 7 and 30 days): busy time per block from the scope's runs.
 * Blocks still ahead today are outlined; a paused agent's blocks since it was paused are hatched
 * grey; blocks older than the loaded runs say so. The API keeps no status history, so there are no
 * blocked blocks.
 */
export function heatmap(input: WorkloadInput, agentIds: readonly string[], range: HeatRange): Heatmap {
  const now = input.now;
  const days = heatDays(range, now);
  const blocks = range === "week" ? 6 : 1;
  const blockMs = range === "week" ? 4 * HOUR : DAY;
  const from = days[0]!.start;
  const tasks = scopeTasks(input);
  const taskIds = new Set(tasks.keys());
  const liveIds = new Set(input.liveRuns.map((run) => run.id));
  const runs = scopeRuns(input.scope, input.runs, taskIds);
  const oldest = input.runs.length ? Math.min(...input.runs.map((run) => time(run.createdAt)).filter((value) => !Number.isNaN(value))) : null;
  const loadedFrom = input.runsTruncated && oldest !== null && oldest > from ? oldest : null;
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent] as const));
  const spans = runs.flatMap((run) => {
    const span = runSpan(run, liveIds, now);
    return span && span.end >= from ? [{ run, ...span }] : [];
  });

  const cellStart = (dayIndex: number, block: number) => (range === "week" ? days[dayIndex]!.start + block * blockMs : days[dayIndex]!.start);
  const cellEnd = (dayIndex: number, block: number) => (range === "week" ? cellStart(dayIndex, block) + blockMs : addDays(days[dayIndex]!.start, 1));
  const cellTip = (dayIndex: number, block: number) => (range === "week" ? `${dayName(days[dayIndex]!, range)}, ${BLOCKS[block]}` : dayName(days[dayIndex]!, range));

  let pausedShown = false;
  const rows: HeatRow[] = [];
  for (const agentId of agentIds) {
    const agent = agentById.get(agentId);
    if (!agent) continue;
    const mine = spans.filter((span) => span.run.agentId === agentId);
    const pausedAt = agent.status === "paused" ? time(agent.pausedAt) : NaN;
    let busyTotal = 0;
    let activeDays = 0;
    const grid = days.map((_, dayIndex) => {
      let active = false;
      const cells = Array.from({ length: blocks }, (_, block): HeatCell => {
        const start = cellStart(dayIndex, block);
        const end = cellEnd(dayIndex, block);
        const name = `${agent.name} · ${cellTip(dayIndex, block)}`;
        if (start > now) return { start, end, kind: "ahead", level: 0, busyMs: 0, tip: `${name}: still ahead` };
        if (loadedFrom !== null && end <= loadedFrom) return { start, end, kind: "unloaded", level: 0, busyMs: 0, tip: `${name}: runs this old aren't loaded` };
        const busyMs = mine.reduce((sum, span) => sum + overlap(span.start, span.end, start, Math.min(end, now)), 0);
        busyTotal += busyMs;
        if (busyMs > 0) active = true;
        if (busyMs === 0 && !Number.isNaN(pausedAt) && end > pausedAt) {
          pausedShown = true;
          return { start, end, kind: "paused", level: 0, busyMs, tip: `${name}: paused` };
        }
        const level = heatLevel(range, busyMs);
        return { start, end, kind: "busy", level, busyMs, tip: `${name}: ${busyMs > 0 ? `${formatDuration(busyMs)} busy` : "idle"}` };
      });
      if (active) activeDays += 1;
      return cells;
    });
    const costs = mine.filter((span) => span.start >= from).map((span) => runCost(span.run)).filter((cost): cost is number => cost !== null);
    const openCount = [...tasks.values()].filter((task) => task.assigneeAgentId === agentId && isOpenTask(task)).length;
    rows.push({ agentId, days: grid, busyMs: busyTotal, costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null, activeDays, flags: [], openCount });
  }

  // How many were busy at once.
  const totalDays = days.map((_, dayIndex) =>
    Array.from({ length: blocks }, (_, block): HeatCell => {
      const start = cellStart(dayIndex, block);
      const end = cellEnd(dayIndex, block);
      const name = cellTip(dayIndex, block);
      if (start > now) return { start, end, kind: "ahead", level: 0, busyMs: 0, tip: `${name}: still ahead` };
      if (loadedFrom !== null && end <= loadedFrom) return { start, end, kind: "unloaded", level: 0, busyMs: 0, tip: `${name}: runs this old aren't loaded` };
      const busy = rows.filter((row) => row.days[dayIndex]![block]!.busyMs > 0).length;
      const busyMs = rows.reduce((sum, row) => sum + row.days[dayIndex]![block]!.busyMs, 0);
      const level = rows.length && busy ? (Math.min(4, Math.max(1, Math.ceil((busy / rows.length) * 4))) as 1 | 2 | 3 | 4) : 0;
      return { start, end, kind: "busy", level, busyMs, tip: `${name}: ${busy} of ${rows.length} ${rows.length === 1 ? "agent" : "agents"} busy` };
    }),
  );
  const rowCosts = rows.map((row) => row.costUsd).filter((cost): cost is number => cost !== null);
  markFlags(rows, agentById, range);
  return {
    range,
    days,
    rows,
    total: { days: totalDays, busyMs: rows.reduce((sum, row) => sum + row.busyMs, 0), costUsd: rowCosts.length ? rowCosts.reduce((a, b) => a + b, 0) : null, agents: rows.length },
    loadedFrom,
    pausedShown,
  };
}

/** Below this much busy time on average, nobody is busy enough for markers to mean anything. */
const FLAG_FLOOR_MS = 30 * 60_000;

/**
 * Row markers (board 31 at 7 and 30 days): the busiest agent, and the one with the most room among
 * those that can take work (not paused or in error). Only with two agents or more, once the
 * average reaches half an hour, and only when they stand out: the busiest at 1.25× the average or
 * more, the most spare at three quarters of it or less.
 */
function markFlags(rows: HeatRow[], agents: ReadonlyMap<string, WorkloadAgent>, range: HeatRange) {
  if (rows.length < 2) return;
  const span = range === "week" ? "this week" : "in 30 days";
  const average = rows.reduce((sum, row) => sum + row.busyMs, 0) / rows.length;
  if (average < FLAG_FLOOR_MS) return;
  const busiest = rows.slice().sort((a, b) => b.busyMs - a.busyMs)[0]!;
  if (busiest.busyMs >= average * 1.25) {
    busiest.flags.push({
      kind: "busiest",
      title: "Busiest",
      body: `${formatHours(busiest.busyMs)} of runs ${span}, ${(busiest.busyMs / average).toFixed(1)}× the average agent.`,
    });
  }
  const pool = rows.filter((row) => row !== busiest && !["paused", "error"].includes(agents.get(row.agentId)?.status ?? ""));
  const spare = pool.sort((a, b) => a.busyMs - b.busyMs || a.openCount - b.openCount)[0];
  if (spare && spare.busyMs <= average * 0.75) {
    const assigned = spare.openCount === 0 ? "Nothing open is assigned to it." : `It has ${spare.openCount} open ${spare.openCount === 1 ? "task" : "tasks"}.`;
    spare.flags.push({ kind: "spare", title: "Most spare capacity", body: `Only ${formatHours(spare.busyMs)} busy ${span}. ${assigned}` });
  }
}

// ---------------------------------------------------------------------------------------------
// The suggestion

export type Suggestion = { task: WorkloadTask; agentId: string; title: string; body: string; next: string };

/**
 * Paperclip's one suggestion (board 31, behind the "1 suggestion" pill), worked out here from open
 * work and today's runs: the oldest, most urgent unassigned todo in the scope, for the listed agent
 * with the least open work that isn't running, paused or in error. None when everyone has three or
 * more open tasks.
 */
export function suggestion(input: WorkloadInput, agentIds: readonly string[]): Suggestion | null {
  const tasks = [...scopeTasks(input).values()];
  const task = tasks
    .filter((candidate) => candidate.status === "todo" && !candidate.assigneeAgentId && !candidate.assigneeUserId)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || time(a.createdAt) - time(b.createdAt))[0];
  if (!task) return null;
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent] as const));
  const busyNow = new Set(input.liveRuns.map((run) => run.agentId));
  const openCount = (agentId: string) => tasks.filter((candidate) => candidate.assigneeAgentId === agentId && isOpenTask(candidate)).length;
  const candidates = agentIds
    .map((agentId) => agentById.get(agentId))
    .filter((agent): agent is WorkloadAgent => !!agent && !busyNow.has(agent.id) && !["paused", "error", "terminated", "pending_approval"].includes(agent.status))
    .map((agent) => ({ agent, open: openCount(agent.id) }))
    .filter((candidate) => candidate.open < 3)
    .sort((a, b) => a.open - b.open || a.agent.name.localeCompare(b.agent.name));
  const pick = candidates[0];
  if (!pick) return null;
  const label = taskLabel(task);
  const lastRun = input.runs.find((run) => run.agentId === pick.agent.id && run.finishedAt);
  const idle = lastRun ? `has been idle since ${sinceLabel(time(lastRun.finishedAt), input.now)}` : "isn't running anything";
  const load = pick.open === 0 ? "with nothing open assigned" : `with ${pick.open} open ${pick.open === 1 ? "task" : "tasks"}`;
  return {
    task,
    agentId: pick.agent.id,
    title: `Give ${label} to ${pick.agent.name}?`,
    body: `${pick.agent.name} ${idle}, ${load}. "${task.title}" has had no assignee for ${ageLabel(input.now - time(task.createdAt))}.`,
    next: `Assigning moves ${label} to ${pick.agent.name}, which picks it up on its next run.`,
  };
}
