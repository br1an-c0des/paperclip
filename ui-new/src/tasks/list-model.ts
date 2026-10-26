import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from "@/ui/status-meta";
import type { GroupBy } from "./view-state";

/*
 * The task list's view model (board 1): tasks in groups, by status in the board's order unless the
 * viewer picks another grouping, with each row's subtask count, live state and note. Subtasks whose
 * parent is in the same list are counted on the parent's row instead of getting their own; a subtask
 * whose parent isn't loaded (another project, say) stands on its own. Grouped by parent task, every
 * task gets its own row instead.
 *
 * Each group also says what its tasks have in common (`value`), which is what a task dropped into
 * the group, or added from it, is given.
 */

export type RowNote = { tone: "red" | "green" | "cyan"; label: string };

export type TaskRow = {
  task: CompactIssue;
  subtasks: number;
  subtasksDone: number;
  live: boolean;
  note: RowNote | null;
};

/** The group heading's mark. */
export type GroupMark =
  | { kind: "status"; status: IssueStatus }
  | { kind: "priority"; priority: IssuePriority }
  | { kind: "agent"; agentId: string }
  | { kind: "user"; userId: string; you: boolean }
  | { kind: "unassigned" }
  | { kind: "label"; color: string | null }
  | { kind: "task"; status: IssueStatus | null }
  | { kind: "none" };

/** What the group's tasks have in common. Null for an ungrouped list. */
export type GroupValue =
  | { field: "status"; status: IssueStatus }
  | { field: "priority"; priority: IssuePriority }
  | { field: "assignee"; agentId: string | null; userId: string | null }
  | { field: "label"; labelId: string | null }
  | { field: "parent"; parentId: string | null }
  | null;

export type TaskGroup = { key: string; label: string; mark: GroupMark; value: GroupValue; rows: TaskRow[] };

/** Names for group headings, from the company's agents, people, labels and tasks. */
export type GroupNames = {
  agent: (id: string) => string | undefined;
  person: (id: string) => string;
  youId: () => string | null;
  label: (id: string) => { name: string; color: string | null } | undefined;
  /** A task by id, for parent groups; looked up in the whole list, not just the filtered rows. */
  task: (id: string) => Pick<CompactIssue, "identifier" | "title" | "status"> | undefined;
};

/** Status groups that start collapsed, as on board 1. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<IssueStatus> = new Set(["backlog", "done", "cancelled"]);

export const PRIORITY_ORDER: IssuePriority[] = ["critical", "high", "medium", "low"];

/** The order of statuses in pickers: the order work moves through them. */
export const STATUS_PICK_ORDER: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];

export function startsCollapsed(group: Pick<TaskGroup, "mark">) {
  return group.mark.kind === "status" && COLLAPSED_BY_DEFAULT.has(group.mark.status);
}

function rowNote(task: CompactIssue): RowNote | null {
  const blockers = task.blockedBy ?? [];
  if (task.status === "blocked" && blockers.length > 0) {
    const first = blockers[0]!;
    const label = blockers.length === 1 ? `Blocked by ${first.identifier ?? first.title}` : `Blocked by ${blockers.length} tasks`;
    return { tone: "red", label };
  }
  return null;
}

function labelIdsOf(task: CompactIssue) {
  return task.labelIds ?? task.labels?.map((label) => label.id) ?? [];
}

type Slot = Omit<TaskGroup, "rows"> & { rank: number[] };

function slot(key: string, label: string, mark: GroupMark, value: GroupValue, ...rank: number[]): Slot {
  return { key, label, mark, value, rank };
}

/** The groups a task belongs to: one, except by label, where it's in each of its labels' groups. */
function slotsFor(task: CompactIssue, groupBy: GroupBy, names: GroupNames | undefined, order: Map<string, number>): Slot[] {
  switch (groupBy) {
    case "status": {
      const status = task.status as IssueStatus;
      const label = STATUS_META[status]?.label ?? status;
      return [slot(status, label, { kind: "status", status }, { field: "status", status }, STATUS_ORDER.indexOf(status))];
    }
    case "priority": {
      const priority = task.priority as IssuePriority;
      const label = PRIORITY_META[priority]?.label ?? priority;
      return [slot(priority, label, { kind: "priority", priority }, { field: "priority", priority }, PRIORITY_ORDER.indexOf(priority))];
    }
    // You first, then agents, then other people, then Unassigned; by name within each.
    case "assignee": {
      if (task.assigneeAgentId) {
        const id = task.assigneeAgentId;
        const value: GroupValue = { field: "assignee", agentId: id, userId: null };
        return [slot(`agent:${id}`, names?.agent(id) ?? "Unknown agent", { kind: "agent", agentId: id }, value, 1)];
      }
      if (task.assigneeUserId) {
        const id = task.assigneeUserId;
        const you = id === names?.youId();
        const value: GroupValue = { field: "assignee", agentId: null, userId: id };
        return [slot(`user:${id}`, you ? "You" : (names?.person(id) ?? id), { kind: "user", userId: id, you }, value, you ? 0 : 2)];
      }
      return [slot("none", "Unassigned", { kind: "unassigned" }, { field: "assignee", agentId: null, userId: null }, 3)];
    }
    case "label": {
      const ids = labelIdsOf(task);
      if (ids.length === 0) return [slot("none", "No label", { kind: "label", color: null }, { field: "label", labelId: null }, 1)];
      return ids.map((id) => {
        const found = task.labels?.find((label) => label.id === id) ?? names?.label(id);
        return slot(id, found?.name ?? "Unknown label", { kind: "label", color: found?.color ?? null }, { field: "label", labelId: id }, 0);
      });
    }
    case "parent": {
      const id = task.parentId;
      if (!id) return [slot("none", "No parent task", { kind: "none" }, { field: "parent", parentId: null }, 1, 0)];
      const parent = names?.task(id);
      const label = parent ? `${parent.identifier ? `${parent.identifier} · ` : ""}${parent.title}` : "A task outside this list";
      const mark: GroupMark = { kind: "task", status: (parent?.status as IssueStatus | undefined) ?? null };
      return [slot(id, label, mark, { field: "parent", parentId: id }, 0, order.get(id) ?? 0)];
    }
    case "none":
      return [slot("all", "All tasks", { kind: "none" }, null, 0)];
  }
}

function compareRank(a: Slot, b: Slot) {
  for (let index = 0; index < Math.max(a.rank.length, b.rank.length); index++) {
    const diff = (a.rank[index] ?? 0) - (b.rank[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.label.localeCompare(b.label);
}

export function buildTaskGroups(
  tasks: readonly CompactIssue[],
  liveIssueIds: ReadonlySet<string>,
  options: { groupBy?: GroupBy; names?: GroupNames } = {},
): TaskGroup[] {
  const groupBy = options.groupBy ?? "status";
  const nest = groupBy !== "parent";
  const ids = new Set(tasks.map((task) => task.id));
  // Parent groups come in the order their first subtask appears in the list.
  const order = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (task.parentId && !order.has(task.parentId)) order.set(task.parentId, index);
  });
  const children = new Map<string, CompactIssue[]>();
  if (nest) {
    for (const task of tasks) {
      if (!task.parentId || !ids.has(task.parentId)) continue;
      const list = children.get(task.parentId) ?? [];
      list.push(task);
      children.set(task.parentId, list);
    }
  }
  const slots = new Map<string, Slot>();
  const rows = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    if (nest && task.parentId && ids.has(task.parentId)) continue;
    const kids = children.get(task.id) ?? [];
    const row: TaskRow = {
      task,
      subtasks: kids.length,
      subtasksDone: kids.filter((kid) => kid.status === "done").length,
      live: liveIssueIds.has(task.id),
      note: rowNote(task),
    };
    for (const slot of slotsFor(task, groupBy, options.names, order)) {
      if (!slots.has(slot.key)) slots.set(slot.key, slot);
      const list = rows.get(slot.key) ?? [];
      list.push(row);
      rows.set(slot.key, list);
    }
  }
  return [...slots.values()].sort(compareRank).map(({ rank: _rank, ...group }) => ({ ...group, rows: rows.get(group.key)! }));
}

/**
 * The change that moves a task from one group into another, or null when it's already there. A task
 * dragged between label groups swaps the one label for the other and keeps the rest.
 */
export function moveUpdate(task: CompactIssue, from: GroupValue | undefined, to: GroupValue): Record<string, unknown> | null {
  if (!to) return null;
  switch (to.field) {
    case "status":
      return task.status === to.status ? null : { status: to.status };
    case "priority":
      return task.priority === to.priority ? null : { priority: to.priority };
    case "assignee":
      if ((task.assigneeAgentId ?? null) === to.agentId && (task.assigneeUserId ?? null) === to.userId) return null;
      return { assigneeAgentId: to.agentId, assigneeUserId: to.userId };
    case "label": {
      const ids = labelIdsOf(task);
      if (to.labelId === null) return ids.length === 0 ? null : { labelIds: [] };
      if (ids.includes(to.labelId)) return null;
      const kept = from?.field === "label" && from.labelId ? ids.filter((id) => id !== from.labelId) : ids;
      return { labelIds: [...kept, to.labelId] };
    }
    case "parent":
      if ((task.parentId ?? null) === to.parentId || to.parentId === task.id) return null;
      return { parentId: to.parentId };
  }
}

/** What a task added from a group starts with. */
export function groupDefaults(value: GroupValue): Record<string, unknown> {
  if (!value) return {};
  switch (value.field) {
    case "status":
      return { status: value.status };
    case "priority":
      return { priority: value.priority };
    case "assignee":
      return value.agentId ? { assigneeAgentId: value.agentId } : value.userId ? { assigneeUserId: value.userId } : {};
    case "label":
      return value.labelId ? { labelIds: [value.labelId] } : {};
    case "parent":
      return value.parentId ? { parentId: value.parentId } : {};
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2m ago", "5h ago", "Yesterday", "Oct 11", or "Oct 11, 2025" in another year (board 1's Updated column). */
export function updatedLabel(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (date.getTime() >= startOfToday - 24 * HOUR) return "Yesterday";
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}
