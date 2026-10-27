import type { IssuePriority, IssueStatus } from "@paperclipai/shared";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { PRIORITY_ORDER, takesDrops, type TaskGroup } from "./list-model";
import type { GroupBy, TaskFilters } from "./view-state";

/*
 * The board view's model (board 4): the list's groups (list-model.ts) as columns, under the same
 * grouping and filters. Grouped by status or priority the board shows every value as a column, so a
 * card can be dragged into a status nothing has yet; an active filter on that field narrows the
 * columns to the values it lets through. Other groupings show the groups the tasks make.
 *
 * Columns run in the order work moves (Backlog to Done, Critical to Low). Done and Cancelled start
 * collapsed, as on board 4; the board keeps its own folds, apart from the list's. Board 4's "Closed"
 * switch takes them, and closed tasks, off the board altogether.
 */

/** Status columns in the order work moves through them. Cancelled shows only when it has tasks. */
export const BOARD_STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"];

/** Board 4's tones: each status column is tinted with its status's background. */
const STATUS_TONE: Partial<Record<IssueStatus, "amber" | "run" | "violet" | "red" | "green">> = {
  todo: "amber",
  in_progress: "run",
  in_review: "violet",
  blocked: "red",
  done: "green",
};

export function emptyStatusGroup(status: IssueStatus): TaskGroup {
  return { key: status, label: STATUS_META[status].label, mark: { kind: "status", status }, value: { field: "status", status }, rows: [] };
}

export function emptyPriorityGroup(priority: IssuePriority): TaskGroup {
  return {
    key: priority,
    label: PRIORITY_META[priority].label,
    mark: { kind: "priority", priority },
    value: { field: "priority", priority },
    rows: [],
  };
}

/** Every value in `order` the filter lets through, as a column, with the tasks' groups filled in. */
function fixedColumns<T extends string>(
  groups: readonly TaskGroup[],
  order: readonly T[],
  filter: readonly T[],
  empty: (value: T) => TaskGroup,
): TaskGroup[] {
  const byKey = new Map(groups.map((group) => [group.key, group] as const));
  const shown = order.filter((value) => filter.length === 0 || filter.includes(value) || byKey.has(value));
  const columns = shown.map((value) => byKey.get(value) ?? empty(value));
  // Anything the order doesn't know (cancelled, or a status added upstream) goes at the end.
  const known = new Set<string>(order);
  return [...columns, ...groups.filter((group) => !known.has(group.key))];
}

/** Done and Cancelled: the statuses board 4's "Closed" switch takes off the board. */
export const CLOSED_STATUSES: ReadonlySet<string> = new Set<IssueStatus>(["done", "cancelled"]);

/**
 * The board's columns for the list's groups. With `closed` off the board leaves out the Done and
 * Cancelled columns; the caller leaves closed tasks out of the groups.
 */
export function boardColumns(groups: readonly TaskGroup[], groupBy: GroupBy, filters?: TaskFilters, closed = true): TaskGroup[] {
  switch (groupBy) {
    case "status":
      return closed
        ? fixedColumns(groups, BOARD_STATUSES, filters?.statuses ?? [], emptyStatusGroup)
        : fixedColumns(
            groups.filter((group) => !CLOSED_STATUSES.has(group.key)),
            BOARD_STATUSES.filter((status) => !CLOSED_STATUSES.has(status)),
            filters?.statuses ?? [],
            emptyStatusGroup,
          );
    case "priority":
      return fixedColumns(groups, PRIORITY_ORDER, filters?.priorities ?? [], emptyPriorityGroup);
    default:
      return [...groups];
  }
}

export function boardCollapseKey(groupBy: GroupBy, group: Pick<TaskGroup, "key">) {
  return `board:${groupBy}:${group.key}`;
}

/** Done and Cancelled start collapsed on the board; Backlog stays open, unlike on the list. */
export function boardStartsCollapsed(group: Pick<TaskGroup, "mark">) {
  return group.mark.kind === "status" && (group.mark.status === "done" || group.mark.status === "cancelled");
}

/** A column's colors: its tint, and the color of its name when collapsed. */
export function columnTone(group: Pick<TaskGroup, "mark">): { tint: string; ink: string } {
  const tone = group.mark.kind === "status" ? STATUS_TONE[group.mark.status] : undefined;
  return tone ? { tint: `var(--${tone}-bg)`, ink: `var(--${tone}-fg)` } : { tint: "var(--well)", ink: "var(--text)" };
}

/** Cards shown per column before "Show more", as the old board pages its columns. */
export const COLUMN_PAGE = 50;

export type Cursor = { col: number; row: number };
export type CursorMove = "up" | "down" | "left" | "right";

/**
 * Where the keyboard cursor goes on the board. `grid` is the cards shown, by column; a collapsed
 * column is an empty one. Up and down stay in the column; left and right go to the nearest column
 * with cards, at the same height or the last card if the column is shorter. With no cursor yet, any
 * move starts at the first card.
 */
export function moveCursor(grid: readonly (readonly string[])[], at: Cursor | null, move: CursorMove): Cursor | null {
  const first = grid.findIndex((column) => column.length > 0);
  if (first === -1) return null;
  if (!at || !grid[at.col]?.length) return { col: first, row: 0 };
  const column = grid[at.col]!;
  const row = Math.min(at.row, column.length - 1);
  if (move === "up") return { col: at.col, row: Math.max(row - 1, 0) };
  if (move === "down") return { col: at.col, row: Math.min(row + 1, column.length - 1) };
  const step = move === "right" ? 1 : -1;
  for (let col = at.col + step; col >= 0 && col < grid.length; col += step) {
    const cards = grid[col]!;
    if (cards.length > 0) return { col, row: Math.min(row, cards.length - 1) };
  }
  return { col: at.col, row };
}

/** The column a card moved with Shift+←/→ goes to: the next one that takes drops, or null. */
export function neighbourColumn(columns: readonly Pick<TaskGroup, "value">[], from: number, step: 1 | -1): number | null {
  for (let col = from + step; col >= 0 && col < columns.length; col += step) {
    if (takesDrops(columns[col]!.value)) return col;
  }
  return null;
}

/** The subtasks a card lists when "Show subtasks on cards" is on: the first few, and how many more. */
export const CARD_SUBTASKS = 5;
