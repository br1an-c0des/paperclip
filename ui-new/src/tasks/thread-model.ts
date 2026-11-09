import type { ActivityEvent, CompactIssue, Issue, IssueComment, IssueThreadInteraction } from "@paperclipai/shared";
import type { RunForIssue } from "@/api/issues";
import type { Request } from "@/requests/request-model";
import { activityLine, type ActivityLine, type ActivityNames } from "./activity-format";
import { runWait } from "./run-waits";
import type { Compaction } from "./thread-compactions";

/*
 * The Activity section's timeline (board 3): comments, activity events and finished runs merged in
 * time order, oldest first like a chat. Runs of events between comments become one compact list.
 * Comments are paged from the newest; while older pages are left to load, events and runs from
 * before the oldest loaded comment are held back too, so the timeline has no gaps. The same change
 * made several times in a row by the same actor shows once, with a count. Requests (agent
 * questions, suggested tasks, approvals) sit in time order like comments; settled ones from before
 * the oldest loaded comment wait with it, open ones always show. Comments still waiting in the
 * queue are left out, since the queue shows them.
 *
 * Tasks an agent made while working on this one (its subtasks, and follow-ups made from it) show as
 * a card at the time they were made, as the old feed has since the 2026-11-01 sync (upstream
 * #18320), with their title and status as they are now. Tasks a request card already shows (an
 * accepted suggestion's) aren't shown twice. A task an agent asked for under this one that the
 * server put beside it instead (agents' trees stop at parent → child since the 2026-11-07 sync,
 * upstream #19312) is a follow-up: `createdFromIssueId` finds it through its recorded
 * `originIssueId`, and it's a subtask of this task's parent, not of this one.
 *
 * Where a finished run's agent compacted its context, a divider marks the time (U58,
 * thread-compactions.ts). A run Compact now queued does nothing else, so its divider stands in for
 * its line.
 */

export type ThreadFilter = "all" | "comments" | "changes";

/**
 * `count` is how many identical lines in a row this one stands for; `at` is the latest's time. A
 * run's line carries its `runId`, to open it in the run modal.
 */
export type ThreadLine = ActivityLine & {
  key: string;
  at: Date;
  tone?: "red" | "green";
  count?: number;
  runId?: string;
  /** On the task's "created this task" line: the task whose work made it (`Issue.createdFrom`). */
  createdFrom?: CreatedFrom;
};

/** The task another was created from, as the task's detail gives it (`IssueCreationSource.issue`). */
export type CreatedFrom = { id: string; identifier: string | null; title: string };

/**
 * A task an agent made from this one; `subtask` when it's this task's child, otherwise a follow-up.
 * `via` is the subtask whose work asked for it, when that wasn't this task's (#19312: a subtask's
 * agent asking for a subtask of its own gets a sibling instead).
 */
export type CreatedTask = Pick<CompactIssue, "id" | "identifier" | "title" | "status" | "displayStatus" | "projectId"> & {
  subtask: boolean;
  via?: { id: string; identifier: string | null };
};

export type ThreadItem =
  | { kind: "lines"; key: string; lines: ThreadLine[] }
  | { kind: "task"; key: string; at: Date; task: CreatedTask }
  | { kind: "comment"; key: string; at: Date; comment: IssueComment }
  | { kind: "request"; key: string; at: Date; request: Request }
  | { kind: "compaction"; key: string; at: Date; compaction: Compaction };

/** Runs still going show as the live card instead. */
const ACTIVE_RUN = new Set(["queued", "running", "scheduled_retry"]);

/** `heartbeat.invoked` duplicates the run's own line. */
const SKIPPED_EVENTS = new Set(["heartbeat.invoked"]);

function runText(run: RunForIssue): { text: string; tone?: "red" | "green" } {
  const took = duration(run.startedAt, run.finishedAt);
  const suffix = took ? ` · ${took}` : "";
  switch (run.status) {
    case "succeeded":
      return { text: `finished a run${suffix}`, tone: "green" };
    case "failed":
      return { text: `run failed${suffix}${run.error ? `: ${run.error}` : ""}`, tone: "red" };
    case "timed_out":
      return { text: `run timed out${suffix}`, tone: "red" };
    case "cancelled":
      // Held for the provider's usage limit, not stopped: it starts again at the reset (#19246).
      if (run.errorCode === "provider_limit_wait") {
        const until = runWait(run)?.until;
        return { text: `run is waiting for its usage limit to reset${until ? `, until ${stampLabel(until)}` : ""}` };
      }
      return { text: `run was stopped${suffix}` };
    default:
      return { text: `run ${run.status.replace(/_/g, " ")}${suffix}` };
  }
}

/** "45s", "18m 12s", "2h 5m"; empty without both ends. */
export function duration(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  if (!start || !end) return "";
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type MadeTask = Pick<
  CompactIssue,
  "id" | "companyId" | "identifier" | "title" | "status" | "displayStatus" | "projectId" | "parentId" | "createdByAgentId" | "createdAt"
> &
  // The list's rows carry it too, though `CompactIssue` doesn't name it.
  Partial<Pick<Issue, "originIssueId">>;

/** The tasks an accepted suggestion made, which its request card lists. */
export function suggestedTaskIds(interactions: readonly IssueThreadInteraction[]): Set<string> {
  const ids = new Set<string>();
  for (const interaction of interactions) {
    if (interaction.kind !== "suggest_tasks" || interaction.status !== "accepted") continue;
    for (const task of interaction.result?.createdTasks ?? []) ids.add(task.issueId);
  }
  return ids;
}

/**
 * The tasks to show as made in this task's thread, from its subtasks and the tasks made from it
 * (the server checks the reader may see each): only those an agent made, in this company, each once,
 * leaving out the task itself and any in `shown`. A subtask another subtask's work asked for names
 * it (`via`), from its recorded origin.
 */
export function createdTasks(
  tasks: readonly MadeTask[],
  context: { taskId: string; companyId: string; shown?: ReadonlySet<string> },
): { at: Date; task: CreatedTask }[] {
  const seen = new Set(context.shown ?? []);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.flatMap((task) => {
    if (!task.createdByAgentId || task.id === context.taskId || task.companyId !== context.companyId || seen.has(task.id)) return [];
    seen.add(task.id);
    const { id, identifier, title, status, displayStatus, projectId } = task;
    const subtask = task.parentId === context.taskId;
    const origin = subtask && task.originIssueId && task.originIssueId !== context.taskId ? byId.get(task.originIssueId) : undefined;
    const via = origin ? { id: origin.id, identifier: origin.identifier } : undefined;
    return [{ at: new Date(task.createdAt), task: { id, identifier, title, status, displayStatus, projectId, subtask, ...(via ? { via } : {}) } }];
  });
}

export function buildThread(input: {
  comments: readonly IssueComment[];
  events: readonly ActivityEvent[];
  runs: readonly RunForIssue[];
  requests?: readonly Request[];
  /** Tasks agents made from this one (`createdTasks`). */
  tasks?: readonly { at: Date; task: CreatedTask }[];
  /** Comments to leave out, such as those still queued for the agent's next turn. */
  hiddenCommentIds?: ReadonlySet<string>;
  /** Context compactions in finished runs (thread-compactions.ts). */
  compactions?: readonly Compaction[];
  /** Runs Compact now queued; with a divider to show, their own line is left out. */
  compactionRunIds?: ReadonlySet<string>;
  /** The task this one was created from, named on its "created this task" line. */
  createdFrom?: CreatedFrom | null;
  names: ActivityNames & { agent: (id: string) => string | undefined };
  /** True while older comment pages are left to load. */
  moreComments?: boolean;
  filter?: ThreadFilter;
  search?: string;
}): ThreadItem[] {
  const filter = input.filter ?? "all";
  const words = (input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((word) => text.toLowerCase().includes(word));
  const oldest = input.moreComments && input.comments.length > 0
    ? Math.min(...input.comments.map((comment) => new Date(comment.createdAt).getTime()))
    : -Infinity;

  type Entry = { at: Date; line?: ThreadLine; comment?: IssueComment; request?: Request; task?: CreatedTask; compaction?: Compaction };
  const entries: Entry[] = [];
  if (filter !== "changes") {
    for (const comment of input.comments) {
      if (input.hiddenCommentIds?.has(comment.id)) continue;
      if (words.length > 0 && !matches(comment.body)) continue;
      entries.push({ at: new Date(comment.createdAt), comment });
    }
    for (const request of input.requests ?? []) {
      if (request.state === "settled" && request.createdAt.getTime() < oldest) continue;
      if (words.length > 0 && !matches(`${request.title} ${request.asker.name}`)) continue;
      entries.push({ at: request.createdAt, request });
    }
  }
  if (filter !== "comments") {
    for (const event of input.events) {
      if (SKIPPED_EVENTS.has(event.action)) continue;
      const at = new Date(event.createdAt);
      if (at.getTime() < oldest) continue;
      const line = activityLine(event, input.names);
      const from = event.action === "issue.created" ? (input.createdFrom ?? undefined) : undefined;
      if (!line || (words.length > 0 && !matches(`${line.actor} ${line.text} ${from ? `${from.identifier ?? ""} ${from.title}` : ""}`))) continue;
      entries.push({ at, line: { ...line, key: `event:${event.id}`, at, ...(from ? { createdFrom: from } : {}) } });
    }
    for (const made of input.tasks ?? []) {
      if (made.at.getTime() < oldest) continue;
      if (words.length > 0 && !matches(`${made.task.identifier ?? ""} ${made.task.title}`)) continue;
      entries.push({ at: made.at, task: made.task });
    }
    const divided = new Set<string>();
    for (const compaction of input.compactions ?? []) {
      if (compaction.at.getTime() < oldest) continue;
      divided.add(compaction.runId);
      if (words.length > 0 && !matches("context compacted")) continue;
      entries.push({ at: compaction.at, compaction });
    }
    for (const run of input.runs) {
      if (ACTIVE_RUN.has(run.status)) continue;
      if (run.status === "succeeded" && divided.has(run.runId) && input.compactionRunIds?.has(run.runId)) continue;
      const at = new Date(run.finishedAt ?? run.startedAt ?? run.createdAt);
      if (at.getTime() < oldest) continue;
      const line: ThreadLine = { actor: input.names.agent(run.agentId) ?? "An agent", ...runText(run), key: `run:${run.runId}`, at, runId: run.runId };
      if (words.length > 0 && !matches(`${line.actor} ${line.text}`)) continue;
      entries.push({ at, line });
    }
  }
  entries.sort((a, b) => a.at.getTime() - b.at.getTime());

  const items: ThreadItem[] = [];
  for (const entry of entries) {
    if (entry.request) {
      items.push({ kind: "request", key: entry.request.key, at: entry.at, request: entry.request });
      continue;
    }
    if (entry.task) {
      items.push({ kind: "task", key: `task:${entry.task.id}`, at: entry.at, task: entry.task });
      continue;
    }
    if (entry.compaction) {
      items.push({ kind: "compaction", key: entry.compaction.key, at: entry.at, compaction: entry.compaction });
      continue;
    }
    if (entry.comment) {
      items.push({ kind: "comment", key: `comment:${entry.comment.id}`, at: entry.at, comment: entry.comment });
      continue;
    }
    const line = entry.line!;
    const last = items[items.length - 1];
    if (last?.kind !== "lines") {
      items.push({ kind: "lines", key: `lines:${line.key}`, lines: [line] });
      continue;
    }
    const previous = last.lines[last.lines.length - 1]!;
    // Each run keeps its own line, so each can open in the run modal.
    if (!line.status && !previous.status && !line.runId && !previous.runId && !line.createdFrom && previous.actor === line.actor && previous.text === line.text && previous.tone === line.tone) {
      last.lines[last.lines.length - 1] = { ...previous, at: line.at, count: (previous.count ?? 1) + 1 };
    } else {
      last.lines.push(line);
    }
  }
  return items;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today, 10:31 am", "Yesterday, 9:02 pm", "Oct 12, 9:14 am", or with the year when it's another. */
export function stampLabel(value: Date | string, now: Date = new Date()) {
  const date = new Date(value);
  const hours = date.getHours();
  const time = `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `Today, ${time}`;
  if (date.getTime() >= startOfToday - 24 * 60 * 60 * 1000) return `Yesterday, ${time}`;
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day}, ${date.getFullYear()}, ${time}`;
}
