import type { CompactIssue } from "@paperclipai/shared";
import type { SortField, TaskSort } from "./view-state";

/*
 * Sorting a task list, with the fields the old list offers (ui/src/components/IssuesList.tsx,
 * `sortIssues`). Tasks are sorted before they're grouped, so rows keep this order inside each group
 * and column, and subtasks inside their parent. Ties keep the server's order (most recently updated
 * first), as the sort is stable.
 *
 * Status sorts in the order work moves (Backlog to Cancelled) and priority from Critical down,
 * ascending. "Updated" uses the time the Updated column shows: the last activity, else the last
 * change.
 */

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "title", label: "Title" },
  { value: "workflow", label: "Workflow" },
];

/** The direction a field starts in when picked: newest first for times, top to bottom otherwise. */
export function defaultDir(field: SortField): TaskSort["dir"] {
  return field === "updated" || field === "created" ? "desc" : "asc";
}

/** Names for the two directions of a field, for the sort menu. */
export function dirLabels(field: SortField): { asc: string; desc: string } {
  switch (field) {
    case "updated":
    case "created":
      return { asc: "Oldest first", desc: "Newest first" };
    case "priority":
      return { asc: "Highest first", desc: "Lowest first" };
    case "title":
      return { asc: "A to Z", desc: "Z to A" };
    case "status":
    case "workflow":
      return { asc: "In order", desc: "Reversed" };
  }
}

const STATUS_RANK = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
const PRIORITY_RANK = ["critical", "high", "medium", "low"];

function time(value: Date | string | null | undefined) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function rank(order: readonly string[], value: string) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function compare(field: Exclude<SortField, "workflow">, a: CompactIssue, b: CompactIssue) {
  switch (field) {
    case "updated":
      return time(a.lastActivityAt ?? a.updatedAt) - time(b.lastActivityAt ?? b.updatedAt);
    case "created":
      return time(a.createdAt) - time(b.createdAt);
    case "priority":
      return rank(PRIORITY_RANK, a.priority) - rank(PRIORITY_RANK, b.priority);
    case "status":
      return rank(STATUS_RANK, a.status) - rank(STATUS_RANK, b.status);
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  }
}

export function sortTasks(tasks: readonly CompactIssue[], sort: TaskSort): CompactIssue[] {
  if (sort.field === "workflow") {
    const ordered = workflowSort(tasks);
    return sort.dir === "desc" ? ordered.reverse() : ordered;
  }
  const field = sort.field;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => dir * compare(field, a, b));
}

/**
 * The old list's workflow order (ui/src/lib/workflow-sort.ts): a task comes after the tasks it's
 * blocked by, so a chain of blockers reads top to bottom, each blocker straight before the task it
 * holds up where the chain allows. Otherwise tasks come oldest first. Blockers outside the list
 * don't count, and a cycle (which the server refuses) falls back to oldest first.
 */
export function workflowSort<T extends Pick<CompactIssue, "id" | "createdAt" | "blockedBy">>(tasks: readonly T[]): T[] {
  if (tasks.length <= 1) return [...tasks];
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const older = (a: T, b: T) => time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const next = new Map<string, string[]>(tasks.map((task) => [task.id, []]));
  const waiting = new Map<string, number>(tasks.map((task) => [task.id, 0]));
  for (const task of tasks) {
    const seen = new Set<string>();
    for (const blocker of task.blockedBy ?? []) {
      if (!byId.has(blocker.id) || blocker.id === task.id || seen.has(blocker.id)) continue;
      seen.add(blocker.id);
      next.get(blocker.id)!.push(task.id);
      waiting.set(task.id, waiting.get(task.id)! + 1);
    }
  }
  for (const ids of next.values()) ids.sort((a, b) => older(byId.get(a)!, byId.get(b)!));

  const ready = tasks.filter((task) => waiting.get(task.id) === 0).sort(older);
  const done = new Set<string>();
  const out: T[] = [];
  const insertReady = (task: T) => {
    let at = ready.findIndex((each) => older(each, task) > 0);
    if (at === -1) at = ready.length;
    ready.splice(at, 0, task);
  };
  /** Marks a task done and returns what it frees: the one task to follow it straight on, if any. */
  const emit = (task: T): T | undefined => {
    done.add(task.id);
    out.push(task);
    const freed: T[] = [];
    for (const id of next.get(task.id) ?? []) {
      if (done.has(id)) continue;
      const left = waiting.get(id)! - 1;
      waiting.set(id, left);
      if (left === 0) freed.push(byId.get(id)!);
    }
    // A single successor that only this task held up continues the chain; branches go back to
    // the ready queue.
    if (freed.length === 1 && (next.get(task.id)?.length ?? 0) === 1) return freed[0];
    for (const each of freed) insertReady(each);
    return undefined;
  };

  while (ready.length > 0) {
    let current: T | undefined = ready.shift();
    while (current && !done.has(current.id)) current = emit(current);
  }
  // Something was left in a cycle: give up on chains and go oldest first, as the old list does.
  return out.length < tasks.length ? [...tasks].sort(older) : out;
}
