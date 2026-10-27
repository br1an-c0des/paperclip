import type {
  Agent,
  AttentionItem,
  CompactIssue,
  IssueStatus,
  ProjectBudgetSummary,
  ProjectCodebase,
  ProjectWorkspace,
  WorkspaceOverviewItem,
} from "@paperclipai/shared";
import type { LiveRun } from "@/api/heartbeats";
import { isAlert, placement } from "@/inbox/inbox-model";
import { itemTask } from "@/inbox/use-inbox";
import type { Request, RequestKind } from "@/requests/request-model";
import { PRIORITY_META } from "@/ui/status-meta";

/*
 * The project dashboard's derived blocks (board 8), kept apart from the page so they can be tested:
 *
 * - Budget: this month's spend (UTC, as budget windows count it) against the project's budget, a
 *   meter and the month's pace. A lifetime budget compares all-time spend instead.
 * - Agents at work: every agent with a live run on one of the project's tasks or open work assigned
 *   in it, with what it's on now.
 * - Waiting on you: which of the project's tasks the Inbox's feed says need you, so only their
 *   requests are loaded, and the open requests that come back, filtered by kind.
 * - Stuck work: open tasks that wait on someone without a request to answer, such as a blocked task,
 *   a failed run, a stalled review, work nobody is assigned to, or work that stopped moving.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type ProjectTask = Pick<
  CompactIssue,
  "id" | "identifier" | "title" | "status" | "priority" | "assigneeAgentId" | "assigneeUserId" | "updatedAt" | "blockedBy" | "interruption" | "reviewAttention"
> & { lastActivityAt?: Date | string | null };

const OPEN: ReadonlySet<IssueStatus> = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);
/** Open, and not parked in the backlog: work someone is expected to move. */
const ACTIVE: ReadonlySet<IssueStatus> = new Set(["todo", "in_progress", "in_review", "blocked"]);

const isOpen = (task: Pick<ProjectTask, "status">) => OPEN.has(task.status);
const lastMoved = (task: ProjectTask) => new Date(task.lastActivityAt ?? task.updatedAt).getTime();

// ---------------------------------------------------------------------------------------------
// Money

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$142.18"; `whole` rounds to "$142" for estimates. */
export function formatCents(cents: number, whole = false) {
  return (whole ? wholeDollars : dollars).format(cents / 100);
}

/** The UTC calendar month `now` falls in, as budget windows count it. */
export function monthWindow(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: start.toISOString(), start, end, name: MONTHS[now.getUTCMonth()]! };
}

export type BudgetView = {
  /** "October", or "All time" for a lifetime budget. */
  period: string;
  spentCents: number;
  limitCents: number | null;
  /** Spend as a share of the limit, 0–100 for the meter; null without a limit. */
  percent: number | null;
  tone: "ok" | "warn" | "over";
  /** "of $300 monthly limit", "No budget set". */
  limitLabel: string;
  /** "On pace for about $220 by Oct 31." Monthly only, once a day of the month has passed. */
  pace: string | null;
};

/** Warn from 80% of the limit, as budget policies do by default. */
const WARN_PERCENT = 80;

export function budgetView(input: {
  budget: ProjectBudgetSummary | null | undefined;
  /** This month's spend in cents, from `costs/by-project`; null while loading. */
  monthCents: number | null;
  allTimeCents: number | null;
  now: Date;
}): BudgetView {
  const lifetime = input.budget?.windowKind === "lifetime";
  const month = monthWindow(input.now);
  const spentCents = (lifetime ? input.allTimeCents : input.monthCents) ?? 0;
  const limitCents = input.budget && input.budget.amountCents > 0 ? input.budget.amountCents : null;
  const ratio = limitCents ? (spentCents / limitCents) * 100 : null;
  const tone = ratio === null ? "ok" : ratio >= 100 ? "over" : ratio >= WARN_PERCENT ? "warn" : "ok";

  let pace: string | null = null;
  if (!lifetime && spentCents > 0) {
    const elapsed = input.now.getTime() - month.start.getTime();
    const length = month.end.getTime() - month.start.getTime();
    if (elapsed >= DAY) {
      const projected = Math.round((spentCents * length) / elapsed);
      const last = new Date(month.end.getTime() - DAY);
      pace = `On pace for about ${formatCents(projected, true)} by ${month.name.slice(0, 3)} ${last.getUTCDate()}.`;
    }
  }

  return {
    period: lifetime ? "All time" : month.name,
    spentCents,
    limitCents,
    percent: ratio === null ? null : Math.min(100, Math.round(ratio)),
    tone,
    limitLabel: limitCents ? `of ${formatCents(limitCents, true)} ${lifetime ? "lifetime" : "monthly"} limit` : "No budget set",
    pace,
  };
}

/** A project's row in `costs/by-project`, in cents; 0 when it has no spend in the range. */
export function projectSpend(rows: readonly { projectId: string | null; costCents: number }[] | undefined, projectId: string) {
  if (!rows) return null;
  return rows.find((row) => row.projectId === projectId)?.costCents ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Code

export type CodeView = {
  /** Repositories, the primary first: "owner/name" and the branch work starts from. */
  repos: { name: string; branch: string | null; primary: boolean }[];
  /** A local folder on the server, when the project points at one instead of a repository. */
  folder: string | null;
  /** Task checkouts still open, and the tasks using them. */
  checkouts: { count: number; tasks: string[] };
  /** Dev servers running in those checkouts. */
  services: { name: string; url: string | null }[];
};

/** "owner/name" from a GitHub-style URL; the URL itself when it doesn't look like one. */
export function repoName(url: string) {
  const match = /([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1] ?? url;
}

const CLOSED_CHECKOUTS: ReadonlySet<string> = new Set(["archived", "cleanup_failed"]);

export function codeView(
  project: { workspaces: readonly Pick<ProjectWorkspace, "sourceType" | "repoUrl" | "repoRef" | "defaultRef" | "cwd" | "isPrimary">[]; codebase: ProjectCodebase },
  overview: readonly Pick<WorkspaceOverviewItem, "executionWorkspaceStatus" | "linkedIssues" | "primaryService">[] | undefined,
): CodeView {
  const withRepo = project.workspaces.filter((workspace) => workspace.repoUrl);
  const repos = [...withRepo]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((workspace) => ({ name: repoName(workspace.repoUrl!), branch: workspace.repoRef ?? workspace.defaultRef ?? null, primary: workspace.isPrimary }));
  if (repos.length === 0 && project.codebase.repoUrl) {
    repos.push({
      name: project.codebase.repoName ?? repoName(project.codebase.repoUrl),
      branch: project.codebase.repoRef ?? project.codebase.defaultRef,
      primary: true,
    });
  }
  const folder = repos.length === 0 && project.codebase.origin === "local_folder" ? project.codebase.localFolder : null;
  const open = (overview ?? []).filter((item) => !CLOSED_CHECKOUTS.has(item.executionWorkspaceStatus));
  return {
    repos,
    folder,
    checkouts: {
      count: open.length,
      tasks: [...new Set(open.flatMap((item) => item.linkedIssues.map((issue) => issue.identifier ?? issue.title)))],
    },
    services: open.flatMap((item) =>
      item.primaryService?.status === "running" ? [{ name: item.primaryService.serviceName, url: item.primaryService.url }] : [],
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Agents at work

export type CrewState = "running" | "queued" | "blocked" | "error" | "paused" | "idle";

export type CrewMember = {
  agentId: string;
  state: CrewState;
  /** What it's on: its running task, else a blocked one, else its latest open one. */
  task: ProjectTask | null;
  /** The live run to watch, when it has one. */
  runId: string | null;
  /** Open tasks assigned to it in this project. */
  openCount: number;
};

const CREW_ORDER: Record<CrewState, number> = { running: 0, queued: 1, blocked: 2, error: 3, paused: 4, idle: 5 };

export function crew(input: {
  tasks: readonly ProjectTask[];
  liveRuns: readonly LiveRun[] | undefined;
  agents: readonly Pick<Agent, "id" | "name" | "status">[] | undefined;
}): CrewMember[] {
  const taskById = new Map(input.tasks.map((task) => [task.id, task] as const));
  const agentById = new Map((input.agents ?? []).map((agent) => [agent.id, agent] as const));
  const runs = (input.liveRuns ?? []).filter((run) => run.issueId && taskById.has(run.issueId));
  const ids = new Set([...runs.map((run) => run.agentId), ...input.tasks.filter(isOpen).flatMap((task) => (task.assigneeAgentId ? [task.assigneeAgentId] : []))]);

  const members: CrewMember[] = [];
  for (const agentId of ids) {
    const agent = agentById.get(agentId);
    if (agent?.status === "terminated") continue;
    const assigned = input.tasks
      .filter((task) => task.assigneeAgentId === agentId && isOpen(task))
      .sort((a, b) => lastMoved(b) - lastMoved(a));
    const run = runs.find((candidate) => candidate.status === "running" && candidate.agentId === agentId) ?? runs.find((candidate) => candidate.agentId === agentId);
    const blocked = assigned.find((task) => task.status === "blocked");
    let state: CrewState = "idle";
    if (run) state = run.status === "running" ? "running" : "queued";
    else if (blocked) state = "blocked";
    else if (agent?.status === "error") state = "error";
    else if (agent?.status === "paused") state = "paused";
    const task = run ? (taskById.get(run.issueId!) ?? null) : (blocked ?? assigned.find((candidate) => candidate.status === "in_progress") ?? assigned[0] ?? null);
    members.push({ agentId, state, task, runId: run?.id ?? null, openCount: assigned.length });
  }
  const name = (id: string) => agentById.get(id)?.name ?? "";
  return members.sort((a, b) => CREW_ORDER[a.state] - CREW_ORDER[b.state] || name(a.agentId).localeCompare(name(b.agentId)));
}

/** "2 running · 1 blocked · 1 idle". Queued counts as running. */
export function crewSummary(members: readonly CrewMember[]) {
  const counts = new Map<string, number>();
  for (const member of members) {
    const key = member.state === "queued" ? "running" : member.state;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = ["running", "blocked", "error", "paused", "idle"] as const;
  const words: Record<(typeof order)[number], string> = { running: "running", blocked: "blocked", error: "in error", paused: "paused", idle: "idle" };
  return order.flatMap((key) => (counts.get(key) ? [`${counts.get(key)} ${words[key]}`] : [])).join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Waiting on you

/** Attention feed sources that are requests: answered with a request card. */
const REQUEST_SOURCES = new Set(["issue_thread_interaction", "approval", "decision"]);

export type WaitingTargets = {
  /** Tasks with a request waiting on you; their interactions and approvals are loaded. */
  requestTaskIds: string[];
  /** Tasks in review waiting on your sign-off, drawn as sign-off request cards; stalled when nobody can review. */
  signoffs: { taskId: string; whyNow: string; since: string; stalled: boolean }[];
};

/**
 * What the Inbox's feed says waits on you in this project. It reads the same feed as the Inbox
 * (`useInbox`, dismissed items included) and keeps what the Inbox's Needs you tab keeps: items you
 * haven't cleared or snoozed, and not alerts (`placement`, `isAlert`). An item belongs to the
 * project when it names the project or one of its tasks. The feed leaves an approval's tasks out,
 * so `approvalTasks` (from `/approvals/:id/issues`, as the Inbox reads them) fills them in.
 */
export function waitingTargets(
  items: readonly AttentionItem[] | undefined,
  projectId: string,
  taskIds: ReadonlySet<string>,
  approvalTasks: ReadonlyMap<string, readonly string[]> = new Map(),
): WaitingTargets {
  const requests = new Set<string>();
  const signoffs = new Map<string, WaitingTargets["signoffs"][number]>();
  for (const item of items ?? []) {
    if (placement(item) !== "active" || isAlert(item) || item.archivedAt) continue;
    const related = itemTask(item)?.id ?? null;
    const issueIds = related ? [related] : item.sourceKind === "approval" ? [...(approvalTasks.get(item.subject.id) ?? [])] : [];
    for (const issueId of issueIds) {
      if (item.project?.id !== projectId && !taskIds.has(issueId)) continue;
      if (REQUEST_SOURCES.has(item.sourceKind)) requests.add(issueId);
      else if (item.sourceKind === "review" && !signoffs.has(issueId))
        signoffs.set(issueId, { taskId: issueId, whyNow: item.whyNow, since: item.activityAt, stalled: item.subject.metadata?.reviewAttentionState === "stalled" });
    }
  }
  return { requestTaskIds: [...requests], signoffs: [...signoffs.values()] };
}

/** Approvals in the feed, whose linked tasks are read apart. */
export function feedApprovalIds(items: readonly AttentionItem[] | undefined) {
  return [...new Set((items ?? []).flatMap((item) => (item.sourceKind === "approval" && !item.relatedIssue && placement(item) === "active" ? [item.subject.id] : [])))];
}

export type RequestFilter = "all" | RequestKind;

export type WaitingRequest = { taskId: string; request: Request };

/** The requests still waiting (open or set aside), newest first. */
export function openRequests(perTask: readonly { taskId: string; requests: readonly Request[] }[]): WaitingRequest[] {
  return perTask
    .flatMap((entry) => entry.requests.filter((request) => request.state !== "settled").map((request) => ({ taskId: entry.taskId, request })))
    .sort((a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime());
}

const FILTER_ORDER: RequestKind[] = ["question", "proposal", "approval", "signoff"];
const FILTER_LABEL: Record<RequestKind, string> = { question: "Questions", proposal: "Proposals", approval: "Approvals", signoff: "Sign-offs" };

/** All, then each kind that has something waiting, with counts. Sign-offs count the review rows too. */
export function requestFilters(requests: readonly WaitingRequest[], signoffCount: number) {
  const count = (kind: RequestKind) => requests.filter((entry) => entry.request.kind === kind).length + (kind === "signoff" ? signoffCount : 0);
  return [
    { value: "all" as RequestFilter, label: "All", count: requests.length + signoffCount },
    ...FILTER_ORDER.filter((kind) => count(kind) > 0).map((kind) => ({ value: kind as RequestFilter, label: FILTER_LABEL[kind], count: count(kind) })),
  ];
}

// ---------------------------------------------------------------------------------------------
// Stuck work

export type StuckReason = "interrupted" | "blocked" | "review" | "stale" | "unassigned";

export type StuckItem = {
  task: ProjectTask;
  reason: StuckReason;
  /** "Blocked by TES-4 · Test Agent is waiting", "Medium priority · no assignee for 10 days". */
  detail: string;
  /** Unassigned work offers Assign; everything else opens the task. */
  action: "open" | "assign";
};

/** In progress with nothing running and no activity for this long counts as stalled. */
export const STALE_DAYS = 3;
/** Ready work with no assignee for this long counts as stuck. */
export const UNASSIGNED_DAYS = 1;

const REASON_ORDER: Record<StuckReason, number> = { interrupted: 0, blocked: 1, review: 2, stale: 3, unassigned: 4 };

const WAITING_FOR: Record<string, string> = {
  approval: "Needs an approval to continue",
  reconnect: "Needs a connection reconnected",
  assign_agent: "Needs an agent assigned",
  choose_model: "Needs a model chosen",
  resume: "Paused until someone resumes it",
  budget: "Stopped by the budget",
  project_access: "Its agent can't read this project",
};

function days(ms: number) {
  const count = Math.max(1, Math.floor(ms / DAY));
  return `${count} day${count === 1 ? "" : "s"}`;
}

function since(ms: number) {
  if (ms < HOUR) return "under an hour";
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return days(ms);
}

export function stuckWork(input: {
  tasks: readonly ProjectTask[];
  /** Tasks with a live run; they're moving. */
  liveTaskIds: ReadonlySet<string>;
  /** Tasks already in Waiting on you. */
  exclude: ReadonlySet<string>;
  agentName: (id: string) => string | undefined;
  now: Date;
}): StuckItem[] {
  const items: StuckItem[] = [];
  for (const task of input.tasks) {
    if (!ACTIVE.has(task.status) || input.exclude.has(task.id)) continue;
    const age = input.now.getTime() - lastMoved(task);
    const assignee = task.assigneeAgentId ? input.agentName(task.assigneeAgentId) : undefined;
    const interruption = task.interruption;
    if (interruption && interruption.state === "failed") {
      items.push({ task, reason: "interrupted", detail: interruption.canRetry ? "Its last run failed · it can be retried" : "Its last run failed", action: "open" });
    } else if (interruption && interruption.state === "waiting_for_user" && interruption.userAction) {
      items.push({ task, reason: "interrupted", detail: WAITING_FOR[interruption.userAction] ?? "Waiting for someone to act", action: "open" });
    } else if (task.status === "blocked") {
      const blockers = (task.blockedBy ?? []).filter((blocker) => blocker.status !== "done" && blocker.status !== "cancelled");
      const by = blockers.length > 0 ? `Blocked by ${blockers.map((blocker) => blocker.identifier ?? blocker.title).join(", ")}` : "Blocked, with no blocking task set";
      const who = assignee ? ` · ${assignee} is waiting` : "";
      items.push({ task, reason: "blocked", detail: `${by} for ${since(age)}${who}`, action: "open" });
    } else if (task.status === "in_review" && task.reviewAttention?.state === "stalled") {
      items.push({ task, reason: "review", detail: task.reviewAttention.reason ?? `In review with no one acting on it for ${since(age)}`, action: "open" });
    } else if (!input.liveTaskIds.has(task.id) && !task.assigneeAgentId && !task.assigneeUserId && (task.status === "todo" || task.status === "in_progress")) {
      if (age >= UNASSIGNED_DAYS * DAY) {
        items.push({ task, reason: "unassigned", detail: `${PRIORITY_META[task.priority].label} priority · no assignee for ${days(age)}`, action: "assign" });
      }
    } else if (!input.liveTaskIds.has(task.id) && task.status === "in_progress" && age >= STALE_DAYS * DAY) {
      items.push({ task, reason: "stale", detail: `No activity for ${days(age)}${assignee ? ` · assigned to ${assignee}` : ""}`, action: "open" });
    }
  }
  return items.sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || lastMoved(a.task) - lastMoved(b.task));
}
