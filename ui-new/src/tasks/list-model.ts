import type { CompactIssue, IssueStatus } from "@paperclipai/shared";
import { STATUS_ORDER } from "@/ui/status-meta";

/*
 * The task list's view model (board 1): tasks grouped by status in the board's order, with each
 * row's subtask count, live state and note. Subtasks whose parent is in the same list are counted on
 * the parent's row instead of getting their own; a subtask whose parent isn't loaded (another
 * project, say) stands on its own.
 */

export type RowNote = { tone: "red" | "green" | "cyan"; label: string };

export type TaskRow = {
  task: CompactIssue;
  subtasks: number;
  subtasksDone: number;
  live: boolean;
  note: RowNote | null;
};

export type TaskGroup = { status: IssueStatus; rows: TaskRow[] };

/** Groups that start collapsed, as on board 1. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<IssueStatus> = new Set(["backlog", "done", "cancelled"]);

function rowNote(task: CompactIssue): RowNote | null {
  const blockers = task.blockedBy ?? [];
  if (task.status === "blocked" && blockers.length > 0) {
    const first = blockers[0]!;
    const label = blockers.length === 1 ? `Blocked by ${first.identifier ?? first.title}` : `Blocked by ${blockers.length} tasks`;
    return { tone: "red", label };
  }
  return null;
}

export function buildTaskGroups(tasks: readonly CompactIssue[], liveIssueIds: ReadonlySet<string>): TaskGroup[] {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, CompactIssue[]>();
  for (const task of tasks) {
    if (!task.parentId || !ids.has(task.parentId)) continue;
    const list = children.get(task.parentId) ?? [];
    list.push(task);
    children.set(task.parentId, list);
  }
  const byStatus = new Map<IssueStatus, TaskRow[]>();
  for (const task of tasks) {
    if (task.parentId && ids.has(task.parentId)) continue;
    const kids = children.get(task.id) ?? [];
    const row: TaskRow = {
      task,
      subtasks: kids.length,
      subtasksDone: kids.filter((kid) => kid.status === "done").length,
      live: liveIssueIds.has(task.id),
      note: rowNote(task),
    };
    const status = task.status as IssueStatus;
    const rows = byStatus.get(status) ?? [];
    rows.push(row);
    byStatus.set(status, rows);
  }
  return STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => ({ status, rows: byStatus.get(status)! }));
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
