import type { CompactIssue, IssueComment, IssueStatus } from "@paperclipai/shared";
import type { Request } from "@/requests/request-model";
import { dayLabel } from "@/runs/run-model";

/*
 * The chat's thread (board 12), oldest first, as pure functions over what the API returns.
 *
 * - Messages are the chat task's comments. A run of messages from the same author close together
 *   shares one header (avatar, name, time), as chat apps group them.
 * - A day separator ("Today", "Yesterday", "Oct 12") goes before each day's first entry.
 * - `/new` from a person isn't drawn as a message: it's the dashed "New session started" line, since
 *   the agent no longer remembers what's above it.
 * - Tasks handed off from the chat are cards. A card goes under the agent's message from the run
 *   that created it (comment `createdByRunId` = task `originRunId`), else on its own at the time
 *   the task was created.
 * - Reports (tasks a recurring task made for the agent) are cards at the time they finished, or
 *   were created while still open. Only those inside the loaded history show, so paging back
 *   doesn't bunch old reports at the top.
 * - The agent's requests (questions, proposals, approvals) sit in time order like messages.
 * - A reply run that ended without posting a message (it failed, was stopped, or had nothing to
 *   say) leaves a short line where the reply would have been, with its transcript a click away.
 * - Comments still waiting in the queue are left out: the queue shows them under the thread.
 */

/** Messages from one author this close together share a header. */
export const GROUP_GAP_MS = 5 * 60_000;

export type ChatTask = Pick<CompactIssue, "id" | "identifier" | "title" | "status" | "projectId" | "assigneeAgentId" | "originRunId"> & {
  createdAt: string | Date;
  completedAt?: string | Date | null;
  updatedAt?: string | Date;
};

/** One of the chat's runs, as `GET /issues/:id/runs` lists them. */
export type ChatRun = { runId: string; status: string; agentId: string; createdAt: string; startedAt: string | null; finishedAt: string | null; error?: string | null };

export type ChatAuthor = { kind: "you" | "agent" | "person" | "system"; id: string | null };

export type ChatEntry =
  | { kind: "day"; key: string; label: string }
  | { kind: "session"; key: string; at: Date }
  | {
      kind: "message";
      key: string;
      at: Date;
      comment: IssueComment;
      author: ChatAuthor;
      /** First of a group: draws the avatar, name and time. */
      head: boolean;
      /** Tasks this message's run handed off. */
      tasks: ChatTask[];
    }
  | { kind: "handoff"; key: string; at: Date; task: ChatTask }
  | { kind: "report"; key: string; at: Date; task: ChatTask }
  | { kind: "request"; key: string; at: Date; request: Request }
  | { kind: "run"; key: string; at: Date; run: ChatRun };

const time = (value: string | Date) => new Date(value).getTime();

const ACTIVE = new Set(["queued", "running", "scheduled_retry"]);

export function isSessionReset(comment: Pick<IssueComment, "body" | "authorUserId">) {
  return !!comment.authorUserId && comment.body.trim() === "/new";
}

/** The run a comment came from, stored or worked out by the server. */
export function commentRunId(comment: Pick<IssueComment, "createdByRunId" | "derivedCreatedByRunId">) {
  return comment.createdByRunId ?? comment.derivedCreatedByRunId ?? null;
}

export function commentAuthor(comment: IssueComment, youId: string | null): ChatAuthor {
  const agentId = comment.authorAgentId ?? comment.derivedAuthorAgentId ?? null;
  if (agentId) return { kind: "agent", id: agentId };
  if (comment.authorUserId) return { kind: comment.authorUserId === youId ? "you" : "person", id: comment.authorUserId };
  return { kind: "system", id: null };
}

function sameAuthor(a: ChatAuthor, b: ChatAuthor) {
  return a.kind === b.kind && a.id === b.id;
}

/** When a report belongs in the thread: when it finished, or when it was made while it's open. */
export function reportAt(task: ChatTask) {
  return new Date(task.status === "done" && task.completedAt ? task.completedAt : task.createdAt);
}

export function buildChat(input: {
  comments: readonly IssueComment[];
  handoffs?: readonly ChatTask[];
  reports?: readonly ChatTask[];
  requests?: readonly Request[];
  /** The chat's runs; finished ones that posted nothing get a line. */
  runs?: readonly ChatRun[];
  /** Runs still drawn as a live reply. */
  liveRunIds?: ReadonlySet<string>;
  hiddenCommentIds?: ReadonlySet<string>;
  youId: string | null;
  /** True while older messages are left to load: entries from before the oldest loaded wait. */
  moreHistory?: boolean;
  /** Narrows to messages containing every word. Separators, cards and requests drop out. */
  search?: string;
  now?: Date;
}): ChatEntry[] {
  const now = input.now ?? new Date();
  const words = (input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const comments = [...input.comments]
    .filter((comment) => !input.hiddenCommentIds?.has(comment.id))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
  const oldest = input.moreHistory && comments.length > 0 ? time(comments[0]!.createdAt) : -Infinity;

  // Hand-offs go under the message from the run that made them, when it's loaded.
  const messageRuns = new Map<string, string>();
  for (const comment of comments) {
    const runId = commentRunId(comment);
    if (runId && commentAuthor(comment, input.youId).kind === "agent" && !messageRuns.has(runId)) messageRuns.set(runId, comment.id);
  }
  const attached = new Map<string, ChatTask[]>();
  const loose: ChatTask[] = [];
  for (const task of input.handoffs ?? []) {
    const commentId = task.originRunId ? messageRuns.get(task.originRunId) : undefined;
    if (commentId) attached.set(commentId, [...(attached.get(commentId) ?? []), task]);
    else loose.push(task);
  }

  type Raw =
    | { at: Date; order: number; comment: IssueComment }
    | { at: Date; order: number; handoff: ChatTask }
    | { at: Date; order: number; report: ChatTask }
    | { at: Date; order: number; request: Request }
    | { at: Date; order: number; run: ChatRun };
  const raw: Raw[] = [];
  for (const comment of comments) {
    if (words.length > 0 && (isSessionReset(comment) || !words.every((word) => comment.body.toLowerCase().includes(word)))) continue;
    raw.push({ at: new Date(comment.createdAt), order: 0, comment });
  }
  if (words.length === 0) {
    for (const task of loose) {
      const at = new Date(task.createdAt);
      if (at.getTime() >= oldest) raw.push({ at, order: 1, handoff: task });
    }
    for (const task of input.reports ?? []) {
      const at = reportAt(task);
      if (at.getTime() >= oldest) raw.push({ at, order: 1, report: task });
    }
    for (const request of input.requests ?? []) {
      if (request.state === "settled" && request.createdAt.getTime() < oldest) continue;
      raw.push({ at: request.createdAt, order: 2, request });
    }
    const posted = new Set(comments.map(commentRunId).filter((id): id is string => !!id));
    for (const run of input.runs ?? []) {
      if (ACTIVE.has(run.status) || posted.has(run.runId) || input.liveRunIds?.has(run.runId)) continue;
      const at = new Date(run.finishedAt ?? run.startedAt ?? run.createdAt);
      if (at.getTime() >= oldest) raw.push({ at, order: 3, run });
    }
  }
  raw.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);

  const entries: ChatEntry[] = [];
  let day: string | null = null;
  let previous: { author: ChatAuthor; at: number } | null = null;
  for (const item of raw) {
    const label = dayLabel(item.at, now);
    if (label !== day && words.length === 0) {
      entries.push({ kind: "day", key: `day:${label}:${item.at.toDateString()}`, label });
      day = label;
      previous = null;
    }
    if ("comment" in item) {
      const comment = item.comment;
      if (isSessionReset(comment)) {
        entries.push({ kind: "session", key: `session:${comment.id}`, at: item.at });
        previous = null;
        continue;
      }
      const author = commentAuthor(comment, input.youId);
      const head = !previous || !sameAuthor(previous.author, author) || item.at.getTime() - previous.at > GROUP_GAP_MS;
      entries.push({ kind: "message", key: `comment:${comment.id}`, at: item.at, comment, author, head, tasks: attached.get(comment.id) ?? [] });
      previous = { author, at: item.at.getTime() };
      continue;
    }
    previous = null;
    if ("handoff" in item) entries.push({ kind: "handoff", key: `handoff:${item.handoff.id}`, at: item.at, task: item.handoff });
    else if ("report" in item) entries.push({ kind: "report", key: `report:${item.report.id}`, at: item.at, task: item.report });
    else if ("run" in item) entries.push({ kind: "run", key: `run:${item.run.runId}`, at: item.at, run: item.run });
    else entries.push({ kind: "request", key: item.request.key, at: item.at, request: item.request });
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Live replies

/** A reply run the chat has seen: going now, or just finished. */
export type ReplyTurn = { runId: string; status: string; finishedAt: string | Date | null };

/** How long a finished reply keeps showing while its message is on its way. */
export const REPLY_HANDOVER_MS = 20_000;

/**
 * Which reply runs still show as a live reply: those going now, and those that finished less than
 * `REPLY_HANDOVER_MS` ago and whose message hasn't loaded yet. Once the agent's message from that
 * run is in the thread, it takes the live reply's place, so the reply never shows twice or blinks
 * out before its message arrives. A run that ended without posting anything drops out after the wait.
 */
export function shownReplies(turns: readonly ReplyTurn[], comments: readonly Pick<IssueComment, "createdByRunId" | "derivedCreatedByRunId">[], now: Date): ReplyTurn[] {
  const posted = new Set(comments.map(commentRunId).filter((id): id is string => !!id));
  return turns.filter((turn) => {
    if (ACTIVE.has(turn.status)) return true;
    if (posted.has(turn.runId)) return false;
    const ended = turn.finishedAt ? time(turn.finishedAt) : now.getTime();
    return now.getTime() - ended < REPLY_HANDOVER_MS;
  });
}

// ---------------------------------------------------------------------------------------------
// Labels

export const OPEN_TASK_STATUSES: ReadonlySet<IssueStatus> = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);

/** "IN PROGRESS", as board 12's task card writes the status. */
export function statusTag(status: IssueStatus) {
  return status.replace(/_/g, " ").toUpperCase();
}

/** What a reply run that posted nothing came to: "didn't reply", "was stopped", "failed: …". */
export function quietRunText(run: Pick<ChatRun, "status" | "error">) {
  switch (run.status) {
    case "failed":
      return run.error ? `couldn't reply: ${run.error}` : "couldn't reply";
    case "timed_out":
      return "ran out of time before replying";
    case "cancelled":
      return "was stopped before replying";
    default:
      return "finished without replying";
  }
}

/** "4:12 pm". */
export function messageTime(value: string | Date) {
  const date = new Date(value);
  const hours = date.getHours();
  return `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 19", or "Oct 19, 2025" in another year: for "New session started Oct 19". */
export function shortDate(value: string | Date, now: Date = new Date()) {
  const date = new Date(value);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** Where the chat lives: the agent's own address. */
export function chatPath(prefix: string, agentKey: string) {
  return `/${prefix}/agents/${agentKey}`;
}
