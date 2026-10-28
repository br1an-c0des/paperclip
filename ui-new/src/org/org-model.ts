import type { ActivityEvent, Agent, CompactIssue, DashboardRunActivityDay } from "@paperclipai/shared";
import type { LiveRun } from "@/api/heartbeats";
import type { OrgNode } from "@/api/org";
import type { RunSummary } from "@/api/runs";
import { runtimeIdentity } from "@/agents/agent-model";
import { isAgentBlocked } from "@/lib/agent-state";
import type { Gradient } from "@/ui/status-meta";
import { agentDefaultModel } from "./bulk-model";

/*
 * The organization pages' view model (boards 19 and 20), kept apart from the components so it can be
 * tested: what each agent is doing, the reporting tree, the roster's filters and sort, who can be a
 * manager, run and spend numbers, and recent activity in words.
 */

// ---------------------------------------------------------------------------------------------
// What an agent is doing

/**
 * The state the org pages show. `blocked` isn't an agent status: it's an idle agent whose assigned
 * work is all blocked, as board 19 draws "Blocked · TRA-45".
 */
export type OrgState = "running" | "blocked" | "error" | "paused" | "pending" | "idle";

export const ORG_STATE: Record<OrgState, { label: string; fg: string; gradient: Gradient }> = {
  running: { label: "Working", fg: "var(--run-fg)", gradient: "ion" },
  blocked: { label: "Blocked", fg: "var(--red-fg)", gradient: "flare" },
  error: { label: "Error", fg: "var(--red-fg)", gradient: "flare" },
  paused: { label: "Paused", fg: "var(--amber-fg)", gradient: "ember" },
  pending: { label: "Waiting for approval", fg: "var(--violet-fg)", gradient: "orchid" },
  idle: { label: "Idle", fg: "var(--body)", gradient: "ash" },
};

/** Open work by assignee, and the company's tasks by id, from the company task list. */
export type TaskIndex = { byAgent: Map<string, CompactIssue[]>; byId: Map<string, CompactIssue> };

const CLOSED = new Set(["done", "cancelled"]);

export function taskIndex(tasks: readonly CompactIssue[] | undefined): TaskIndex {
  const byAgent = new Map<string, CompactIssue[]>();
  const byId = new Map<string, CompactIssue>();
  for (const task of tasks ?? []) {
    byId.set(task.id, task);
    if (!task.assigneeAgentId || CLOSED.has(task.status)) continue;
    byAgent.set(task.assigneeAgentId, [...(byAgent.get(task.assigneeAgentId) ?? []), task]);
  }
  return { byAgent, byId };
}

/** Each agent's running run, the first one when it has several. Queued runs aren't running. */
export function liveRunByAgent(runs: readonly LiveRun[] | undefined) {
  const map = new Map<string, LiveRun>();
  for (const run of runs ?? []) if (run.status === "running" && !map.has(run.agentId)) map.set(run.agentId, run);
  return map;
}

export function orgState(agent: Pick<Agent, "id" | "status">, live: ReadonlyMap<string, LiveRun>, tasks: TaskIndex): OrgState {
  if (agent.status === "pending_approval") return "pending";
  if (agent.status === "paused") return "paused";
  if (agent.status === "error") return "error";
  if (live.has(agent.id) || agent.status === "running") return "running";
  if (isAgentBlocked(tasks.byAgent.get(agent.id) ?? [], false)) return "blocked";
  return "idle";
}

/** "18m", "2h", "3d": how long ago, short. */
export function shortAgo(value: string | Date, now: Date) {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 20". */
export function shortDate(value: string | Date) {
  const date = new Date(value);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export type AgentDetail = {
  /** One line on what it's doing or why it's stopped. */
  text: string;
  /** Where the line leads: the run, the task, or the Inbox. Relative to the company. */
  href?: string;
  /** The task it's working on or waiting for, for the inspector's "Working now". */
  task?: Pick<CompactIssue, "id" | "identifier" | "title">;
  runId?: string;
};

export function taskRef(task: Pick<CompactIssue, "id" | "identifier">) {
  return task.identifier ?? task.id.slice(0, 8);
}

/** The line under an agent's status in the roster and the inspector. */
export function agentDetail(
  agent: Pick<Agent, "id" | "urlKey" | "lastHeartbeatAt" | "pausedAt" | "pauseReason" | "errorReason">,
  state: OrgState,
  live: ReadonlyMap<string, LiveRun>,
  tasks: TaskIndex,
  now: Date,
): AgentDetail {
  if (state === "running") {
    const run = live.get(agent.id);
    const task = run?.issueId ? tasks.byId.get(run.issueId) : undefined;
    const since = run?.startedAt ?? run?.createdAt;
    const parts = [task ? taskRef(task) : "Running", since ? shortAgo(since, now) : null].filter(Boolean);
    return {
      text: parts.join(" · "),
      href: run ? `/agents/${agent.urlKey}/runs/${run.id}` : undefined,
      task: task ? { id: task.id, identifier: task.identifier, title: task.title } : undefined,
      runId: run?.id,
    };
  }
  if (state === "blocked") {
    const task = (tasks.byAgent.get(agent.id) ?? [])[0]!;
    return { text: `${taskRef(task)} is blocked`, href: `/issues/${taskRef(task)}`, task: { id: task.id, identifier: task.identifier, title: task.title } };
  }
  if (state === "paused") {
    const reason = agent.pauseReason === "budget" ? "Hit its budget" : agent.pauseReason === "system" || agent.pauseReason === "company_archived" ? "Paused by Paperclip" : "Paused";
    return { text: agent.pausedAt ? `${reason} · ${shortDate(agent.pausedAt)}` : reason };
  }
  if (state === "pending") return { text: "Hire waiting on approval · Review in Inbox", href: "/inbox" };
  if (state === "error") return { text: agent.errorReason?.trim() || "Its last run failed" };
  const open = tasks.byAgent.get(agent.id)?.length ?? 0;
  const ago = agent.lastHeartbeatAt ? shortAgo(agent.lastHeartbeatAt, now) : null;
  const last = ago === null ? "No runs yet" : ago === "now" ? "Last run just now" : `Last run ${ago} ago`;
  return { text: open > 0 ? `${last} · ${open} open` : last };
}

/** The agent's title, or its role in words ("General", "Ceo" → "CEO" stays as the role reads). */
export function roleTitle(agent: Pick<Agent, "title" | "role">) {
  const role = String(agent.role ?? "");
  return agent.title?.trim() || (role.length <= 3 ? role.toUpperCase() : role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
}

/**
 * The Harness and model column: what runs the agent as its agent page names it ("Claude Code ·
 * Paperclip Runner", "Codex · Legacy runner", "Process"), and its default model.
 */
export function harnessAndModel(agent: Pick<Agent, "adapterType" | "adapterConfig">) {
  const external = ["process", "http"].includes(agent.adapterType);
  return { harness: runtimeIdentity(agent).label, model: external ? "Managed externally" : (agentDefaultModel(agent) ?? "Harness default") };
}

// ---------------------------------------------------------------------------------------------
// The reporting tree

export type OrgTreeNode<A> = { agent: A; reports: OrgTreeNode<A>[] };

type TreeAgent = Pick<Agent, "id" | "name" | "status" | "reportsTo">;

/** Agents the chart and roster leave out: retired ones. Pending hires show in the roster only. */
const OFF_CHART = new Set(["terminated", "pending_approval"]);

/**
 * The org chart's tree: the server's `/org` tree, matched to the agents list. Agents that aren't
 * drawn (pending hires, built-ins, agents the list doesn't have) are skipped and their reports move up
 * to their place. Agents the server tree misses, such as two that report to each other, are added
 * under their manager when it's drawn, or at the top. Without the server tree, it's built from each
 * agent's `reportsTo`. Siblings are sorted by name.
 */
export function buildOrgTree<A extends TreeAgent>(
  nodes: readonly OrgNode[] | undefined,
  agents: readonly A[],
  builtIn: ReadonlySet<string> = new Set(),
): OrgTreeNode<A>[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const drawn = (id: string) => {
    const agent = byId.get(id);
    return agent && !OFF_CHART.has(agent.status) && !builtIn.has(id) ? agent : undefined;
  };
  const placed = new Map<string, OrgTreeNode<A>>();

  const walk = (list: readonly OrgNode[]): OrgTreeNode<A>[] =>
    list.flatMap((node) => {
      const reports = walk(node.reports ?? []);
      const agent = placed.has(node.id) ? undefined : drawn(node.id);
      if (!agent) return reports;
      const treeNode = { agent, reports };
      placed.set(agent.id, treeNode);
      return [treeNode];
    });
  const roots = walk(nodes ?? []);

  // Whatever the server tree didn't place, in an order where managers come before their reports.
  const missing = agents.filter((agent) => drawn(agent.id) && !placed.has(agent.id));
  let pending = missing;
  while (pending.length > 0) {
    const next: A[] = [];
    for (const agent of pending) {
      const manager = agent.reportsTo ? drawn(agent.reportsTo) : undefined;
      const managerNode = manager ? placed.get(manager.id) : undefined;
      if (manager && !managerNode && pending.some((other) => other.id === manager.id)) {
        next.push(agent);
        continue;
      }
      const treeNode = { agent, reports: [] };
      placed.set(agent.id, treeNode);
      (managerNode ? managerNode.reports : roots).push(treeNode);
    }
    // A loop of agents that report to each other: put the first at the top and carry on.
    if (next.length === pending.length) {
      const [first, ...rest] = next;
      const treeNode = { agent: first!, reports: [] };
      placed.set(first!.id, treeNode);
      roots.push(treeNode);
      pending = rest;
    } else pending = next;
  }

  const sort = (list: OrgTreeNode<A>[]) => {
    list.sort((a, b) => a.agent.name.localeCompare(b.agent.name, undefined, { sensitivity: "base" }));
    for (const node of list) sort(node.reports);
    return list;
  };
  return sort(roots);
}

export function treeSize(nodes: readonly OrgTreeNode<unknown>[]): number {
  return nodes.reduce((sum, node) => sum + 1 + treeSize(node.reports), 0);
}

/** The agents who report to `agentId`, by name. */
export function directReports<A extends TreeAgent>(agentId: string, agents: readonly A[]) {
  return agents.filter((agent) => agent.reportsTo === agentId && !OFF_CHART.has(agent.status)).map((agent) => agent.name);
}

/**
 * Who the selected agents can report to: any other agent on the chart that isn't one of them or
 * reports to one of them, at any depth, since that would make a loop.
 */
export function managerChoices<A extends TreeAgent>(selected: ReadonlySet<string>, agents: readonly A[]) {
  const below = new Set<string>(selected);
  let grew = true;
  while (grew) {
    grew = false;
    for (const agent of agents) {
      if (!below.has(agent.id) && agent.reportsTo && below.has(agent.reportsTo)) {
        below.add(agent.id);
        grew = true;
      }
    }
  }
  return agents
    .filter((agent) => !below.has(agent.id) && !OFF_CHART.has(agent.status))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// ---------------------------------------------------------------------------------------------
// The roster's filters and sort (board 20)

export type OrgFilter = "all" | "running" | "attention" | "paused" | "idle" | "builtin";

export const ORG_FILTERS: readonly { value: OrgFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Working" },
  { value: "attention", label: "Needs attention" },
  { value: "paused", label: "Paused" },
  { value: "idle", label: "Idle" },
  { value: "builtin", label: "Built-in" },
];

export function isOrgFilter(value: unknown): value is OrgFilter {
  return ORG_FILTERS.some((filter) => filter.value === value);
}

/** The old UI's roster tabs (`/agents/all`, `/agents/paused`…), which redirect to the roster. */
export const LEGACY_AGENT_TABS = ["all", "active", "paused", "error", "builtin"];

/** The old UI's `/agents/:tab` filters, mapped onto these. "Active" included idle agents. */
export function legacyFilter(tab: string): OrgFilter {
  return ({ all: "all", active: "all", paused: "paused", error: "attention", builtin: "builtin" } as Record<string, OrgFilter>)[tab] ?? "all";
}

export function matchesFilter(state: OrgState, isBuiltIn: boolean, filter: OrgFilter) {
  if (filter === "all") return true;
  if (filter === "builtin") return isBuiltIn;
  if (filter === "running") return state === "running";
  if (filter === "attention") return state === "blocked" || state === "error" || state === "pending";
  if (filter === "paused") return state === "paused";
  return state === "idle" && !isBuiltIn;
}

export function filterCounts(rows: readonly { state: OrgState; builtIn: boolean }[]) {
  return Object.fromEntries(
    ORG_FILTERS.map(({ value }) => [value, rows.filter((row) => matchesFilter(row.state, row.builtIn, value)).length]),
  ) as Record<OrgFilter, number>;
}

/** Every word of the query in the agent's name, role or title. */
export function matchesSearch(agent: Pick<Agent, "name" | "role" | "title">, query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [agent.name, agent.role, agent.title].filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

export type OrgSort = "status" | "name" | "spend";

export const ORG_SORTS: readonly { value: OrgSort; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "name", label: "Name" },
  { value: "spend", label: "Spend" },
];

/** Status order: what needs a look first, then working, then the rest. */
const STATE_ORDER: Record<OrgState, number> = { pending: 0, error: 1, blocked: 2, running: 3, paused: 4, idle: 5 };

export function sortRows<R extends { state: OrgState; name: string; spendCents: number }>(rows: readonly R[], sort: OrgSort) {
  const byName = (a: R, b: R) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return [...rows].sort((a, b) => {
    if (sort === "status") return STATE_ORDER[a.state] - STATE_ORDER[b.state] || byName(a, b);
    if (sort === "spend") return b.spendCents - a.spendCents || byName(a, b);
    return byName(a, b);
  });
}

// ---------------------------------------------------------------------------------------------
// Runs and spend

export type RunCounts = { total: number; succeeded: number; failed: number };

const FAILED = new Set(["failed", "timed_out", "interrupted", "error"]);

/** Runs per agent created since `since`, from the recent runs list. */
export function runCountsByAgent(runs: readonly Pick<RunSummary, "agentId" | "status" | "createdAt">[] | undefined, since: Date) {
  const map = new Map<string, RunCounts>();
  for (const run of runs ?? []) {
    if (new Date(run.createdAt).getTime() < since.getTime()) continue;
    const counts = map.get(run.agentId) ?? { total: 0, succeeded: 0, failed: 0 };
    counts.total += 1;
    if (run.status === "succeeded") counts.succeeded += 1;
    else if (FAILED.has(run.status)) counts.failed += 1;
    map.set(run.agentId, counts);
  }
  return map;
}

/** "95% ok" over finished runs, or null when none finished. */
export function successRate(counts: RunCounts | undefined) {
  const finished = (counts?.succeeded ?? 0) + (counts?.failed ?? 0);
  return finished > 0 ? Math.round(((counts?.succeeded ?? 0) / finished) * 100) : null;
}

/** The start of the window `days` long that ends now. */
export function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * This month's spend, in cents. The agent's counter is for the UTC month in `spendMonthUtc`, which
 * the server sends but the shared type leaves out; a counter from an earlier month counts as 0.
 */
export function monthSpendCents(agent: Pick<Agent, "spentMonthlyCents"> & { spendMonthUtc?: string | null }, now: Date) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  if (agent.spendMonthUtc && !String(agent.spendMonthUtc).startsWith(month)) return 0;
  return agent.spentMonthlyCents ?? 0;
}

/** A spend meter's fill, 0–100, and whether it's near the limit. */
export function spendMeter(spentCents: number, budgetCents: number) {
  if (budgetCents <= 0) return { percent: 0, warn: false };
  const percent = Math.min(100, Math.round((spentCents / budgetCents) * 100));
  return { percent, warn: percent >= 80 };
}

export type RunDayBar = { date: string; label: string; succeeded: number; recovered: number; failed: number; other: number; total: number; tip: string };

/** The dashboard's 14 days of runs as bars, labelled every third day and on the last. */
export function runDayBars(days: readonly DashboardRunActivityDay[] | undefined): RunDayBar[] {
  const list = days ?? [];
  return list.map((day, index) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    const name = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
    const parts = [`${day.total} ${day.total === 1 ? "run" : "runs"}`, `${day.succeeded} succeeded`];
    if (day.recovered) parts.push(`${day.recovered} recovered`);
    if (day.failed) parts.push(`${day.failed} failed`);
    return {
      date: day.date,
      label: (index % 3 === 0 && index <= list.length - 3) || index === list.length - 1 ? name : "",
      succeeded: day.succeeded,
      recovered: day.recovered,
      failed: day.failed,
      other: day.other,
      total: day.total,
      tip: `${name}: ${parts.join(", ")}`,
    };
  });
}

export function runTotals(days: readonly DashboardRunActivityDay[] | undefined) {
  const totals = { total: 0, succeeded: 0, recovered: 0, failed: 0 };
  for (const day of days ?? []) {
    totals.total += day.total;
    totals.succeeded += day.succeeded;
    totals.recovered += day.recovered;
    totals.failed += day.failed;
  }
  return { ...totals, rate: totals.total > 0 ? Math.round((totals.succeeded / totals.total) * 100) : null };
}

/** A round axis top for the bar chart: the busiest day, rounded up to an even number. */
export function chartMax(bars: readonly RunDayBar[]) {
  const max = Math.max(0, ...bars.map((bar) => bar.total));
  return max <= 2 ? 2 : Math.ceil(max / 2) * 2;
}

/** A project's tasks for the dashboard's Projects card: done of all (cancelled left out), and open. */
export function projectProgress(tasks: readonly Pick<CompactIssue, "projectId" | "status">[] | undefined, projectId: string) {
  let done = 0;
  let total = 0;
  for (const task of tasks ?? []) {
    if (task.projectId !== projectId || task.status === "cancelled") continue;
    total += 1;
    if (task.status === "done") done += 1;
  }
  return { done, total, open: total - done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** The agents with the most spend this month, and what the rest add up to. */
export function topSpenders<R extends { spendCents: number; agent: { name: string } }>(rows: readonly R[], limit = 5) {
  const spending = [...rows].filter((row) => row.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents || a.agent.name.localeCompare(b.agent.name));
  const top = spending.slice(0, limit);
  const rest = spending.slice(limit);
  return {
    top,
    max: top[0]?.spendCents ?? 0,
    rest: { names: rest.map((row) => row.agent.name), cents: rest.reduce((sum, row) => sum + row.spendCents, 0) },
  };
}

// ---------------------------------------------------------------------------------------------
// Recent activity

/** Events the dashboard leaves out: reads and inbox housekeeping are noise at company level. */
const QUIET = new Set([
  "issue.read_marked",
  "issue.read_unmarked",
  "issue.inbox_archived",
  "issue.inbox_unarchived",
  "issue.feedback_vote_saved",
  "issue.checked_out",
  "issue.released",
]);

const VERBS: Record<string, string> = {
  "issue.created": "created",
  "issue.updated": "updated",
  "issue.comment_added": "commented on",
  "issue.commented": "commented on",
  "issue.deleted": "deleted",
  "issue.attachment_added": "attached a file to",
  "issue.document_created": "created a document for",
  "issue.document_updated": "updated a document on",
  "issue.interaction_created": "asked a question on",
  "issue.interaction_answered": "answered a question on",
  "agent.created": "hired",
  "agent.hire_created": "asked to hire",
  "agent.updated": "updated",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.terminated": "retired",
  "agent.approved": "approved the hire of",
  "agent.budget_updated": "set the budget for",
  "approval.created": "asked for approval on",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "approval.revision_requested": "asked for changes to",
  "project.created": "created the project",
  "project.updated": "updated the project",
  "routine.created": "created the recurring task",
  "routine.run_triggered": "ran the recurring task",
  "company.updated": "updated the organization",
  "heartbeat.invoked": "started a run for",
};

export type ActivityTone = "run" | "green" | "amber" | "gray";

export type ActivityLine = {
  id: string;
  who: string;
  verb: string;
  target: string;
  /** Relative to the company. */
  href?: string;
  tone: ActivityTone;
  at: string;
};

export type ActivityNames = {
  agent: (id: string) => Pick<Agent, "name" | "urlKey"> | undefined;
  person: (id: string) => string;
  youId: string | null;
  /** The agent, when a task is one of your chats (a hidden task, decision 8), which opens as the chat. */
  chatAgent?: (issueId: string) => string | undefined;
};

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function statusVerb(details: Record<string, unknown> | null) {
  const change = (details?.changes as Record<string, { to?: unknown }> | undefined)?.status;
  const to = str(change?.to);
  if (!to) return null;
  return to === "done" ? "finished" : to === "blocked" ? "marked blocked" : to === "in_review" ? "sent for review" : to === "cancelled" ? "cancelled" : to === "in_progress" ? "started" : `moved to ${to.replace(/_/g, " ")}`;
}

/** One activity event in words, or null for the ones the dashboard leaves out. */
export function activityLine(event: ActivityEvent, names: ActivityNames): ActivityLine | null {
  if (QUIET.has(event.action) || event.action.startsWith("provider_trace.")) return null;
  const details = event.details;
  const actorAgent = event.actorType === "agent" ? names.agent(event.actorId) : undefined;
  const who =
    event.actorType === "agent"
      ? (actorAgent?.name ?? "An agent")
      : event.actorType === "user"
        ? event.actorId === names.youId
          ? "You"
          : names.person(event.actorId)
        : "Paperclip";

  let target = "";
  let href: string | undefined;
  const chatWith = event.entityType === "issue" ? names.chatAgent?.(event.entityId) : undefined;
  if (chatWith) {
    const agent = names.agent(chatWith);
    target = agent ? `your chat with ${agent.name}` : "your chat";
    href = `/agents/${agent?.urlKey ?? chatWith}`;
  } else if (event.entityType === "issue") {
    const identifier = str(details?.identifier);
    target = identifier ?? str(details?.issueTitle) ?? "a task";
    href = `/issues/${identifier ?? event.entityId}`;
  } else if (event.entityType === "agent") {
    const agent = names.agent(event.entityId);
    target = agent?.name ?? str(details?.name) ?? "an agent";
    if (agent) href = `/agents/${agent.urlKey}`;
  } else {
    target = str(details?.title) ?? str(details?.name) ?? str(details?.identifier) ?? "";
  }

  const verb = (event.action === "issue.updated" ? statusVerb(details) : null) ?? VERBS[event.action] ?? event.action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ");
  const tone: ActivityTone = /paused|blocked|rejected|terminated|retired/.test(verb)
    ? "gray"
    : /hire|approval|asked/.test(verb)
      ? "amber"
      : /finished|approved|sign|hired|resumed/.test(verb)
        ? "green"
        : /started|run/.test(verb)
          ? "run"
          : "gray";
  return { id: event.id, who, verb, target, href, tone, at: String(event.createdAt) };
}
