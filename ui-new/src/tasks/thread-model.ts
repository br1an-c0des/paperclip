import type { ActivityEvent, IssueComment } from "@paperclipai/shared";
import type { RunForIssue } from "@/api/issues";
import type { Request } from "@/requests/request-model";
import { activityLine, type ActivityLine, type ActivityNames } from "./activity-format";

/*
 * The Activity section's timeline (board 3): comments, activity events and finished runs merged in
 * time order, oldest first like a chat. Runs of events between comments become one compact list.
 * Comments are paged from the newest; while older pages are left to load, events and runs from
 * before the oldest loaded comment are held back too, so the timeline has no gaps. The same change
 * made several times in a row by the same actor shows once, with a count. Requests (agent
 * questions, suggested tasks, approvals) sit in time order like comments; settled ones from before
 * the oldest loaded comment wait with it, open ones always show. Comments still waiting in the
 * queue are left out, since the queue shows them.
 */

export type ThreadFilter = "all" | "comments" | "changes";

/**
 * `count` is how many identical lines in a row this one stands for; `at` is the latest's time. A
 * run's line carries its `runId`, to open it in the run modal.
 */
export type ThreadLine = ActivityLine & { key: string; at: Date; tone?: "red" | "green"; count?: number; runId?: string };

export type ThreadItem =
  | { kind: "lines"; key: string; lines: ThreadLine[] }
  | { kind: "comment"; key: string; at: Date; comment: IssueComment }
  | { kind: "request"; key: string; at: Date; request: Request };

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

export function buildThread(input: {
  comments: readonly IssueComment[];
  events: readonly ActivityEvent[];
  runs: readonly RunForIssue[];
  requests?: readonly Request[];
  /** Comments to leave out, such as those still queued for the agent's next turn. */
  hiddenCommentIds?: ReadonlySet<string>;
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

  type Entry = { at: Date; line?: ThreadLine; comment?: IssueComment; request?: Request };
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
      if (!line || (words.length > 0 && !matches(`${line.actor} ${line.text}`))) continue;
      entries.push({ at, line: { ...line, key: `event:${event.id}`, at } });
    }
    for (const run of input.runs) {
      if (ACTIVE_RUN.has(run.status)) continue;
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
    if (!line.status && !previous.status && !line.runId && !previous.runId && previous.actor === line.actor && previous.text === line.text && previous.tone === line.tone) {
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
