import type { CompactIssue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { boardCollapseKey, boardColumns, boardStartsCollapsed, columnTone, moveCursor, neighbourColumn } from "./board-model";
import { buildTaskGroups, groupDefaults, moveUpdate } from "./list-model";
import { EMPTY_FILTERS } from "./view-state";

function task(id: string, status: string, extra: Partial<CompactIssue> = {}) {
  return {
    id,
    identifier: id.toUpperCase(),
    title: id,
    status,
    priority: "medium",
    parentId: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    labelIds: [],
    blockedBy: [],
    ...extra,
  } as unknown as CompactIssue;
}

describe("boardColumns", () => {
  it("shows every status in the order work moves, with empty columns to drop into", () => {
    const groups = buildTaskGroups([task("a", "done"), task("b", "todo"), task("c", "in_progress")], new Set());
    const columns = boardColumns(groups, "status", EMPTY_FILTERS);
    expect(columns.map((column) => column.key)).toEqual(["backlog", "todo", "in_progress", "in_review", "blocked", "done"]);
    expect(columns.map((column) => column.rows.length)).toEqual([0, 1, 1, 0, 0, 1]);
    expect(columns[3]).toMatchObject({ label: "In review", value: { field: "status", status: "in_review" }, mark: { kind: "status" } });
  });

  it("adds Cancelled only when it has tasks, at the end", () => {
    const groups = buildTaskGroups([task("a", "cancelled"), task("b", "todo")], new Set());
    expect(boardColumns(groups, "status").map((column) => column.key).at(-1)).toBe("cancelled");
    expect(boardColumns(buildTaskGroups([task("b", "todo")], new Set()), "status").map((column) => column.key)).not.toContain("cancelled");
  });

  it("narrows fixed columns to the filtered values, keeping any that still have tasks", () => {
    const groups = buildTaskGroups([task("a", "todo")], new Set());
    const filters = { ...EMPTY_FILTERS, statuses: ["todo" as const, "in_review" as const] };
    expect(boardColumns(groups, "status", filters).map((column) => column.key)).toEqual(["todo", "in_review"]);
  });

  it("shows every priority from Critical to Low", () => {
    const groups = buildTaskGroups([task("a", "todo", { priority: "low" })], new Set(), { groupBy: "priority" });
    const columns = boardColumns(groups, "priority");
    expect(columns.map((column) => column.key)).toEqual(["critical", "high", "medium", "low"]);
    expect(columns.map((column) => column.rows.length)).toEqual([0, 0, 0, 1]);
  });

  it("uses the tasks' own groups for other groupings", () => {
    const groups = buildTaskGroups(
      [task("a", "todo", { assigneeAgentId: "agent-1" }), task("b", "todo")],
      new Set(),
      { groupBy: "assignee", names: { agent: () => "Ada", person: (id) => id, youId: () => null, label: () => undefined, task: () => undefined } },
    );
    expect(boardColumns(groups, "assignee").map((column) => column.key)).toEqual(["agent:agent-1", "none"]);
    expect(boardColumns(groups, "none")).toEqual(groups);
  });
});

describe("dropping a card into a column", () => {
  it("resolves to the column's field change", () => {
    const moving = task("a", "todo", { priority: "low", labelIds: ["red", "blue"] });
    const byStatus = boardColumns(buildTaskGroups([moving], new Set()), "status");
    const review = byStatus.find((column) => column.key === "in_review")!;
    expect(moveUpdate(moving, byStatus.find((column) => column.key === "todo")!.value, review.value)).toEqual({ status: "in_review" });
    expect(moveUpdate(moving, review.value, byStatus.find((column) => column.key === "todo")!.value)).toBeNull();

    const byPriority = boardColumns(buildTaskGroups([moving], new Set(), { groupBy: "priority" }), "priority");
    expect(moveUpdate(moving, byPriority[3]!.value, byPriority[0]!.value)).toEqual({ priority: "critical" });

    expect(moveUpdate(moving, { field: "label", labelId: "red" }, { field: "label", labelId: "green" })).toEqual({ labelIds: ["blue", "green"] });
    expect(groupDefaults(review.value)).toEqual({ status: "in_review" });
  });
});

describe("folds and tones", () => {
  it("starts Done and Cancelled folded, and keys folds apart from the list's", () => {
    const columns = boardColumns([], "status");
    expect(columns.filter(boardStartsCollapsed).map((column) => column.key)).toEqual(["done"]);
    expect(boardCollapseKey("status", { key: "done" })).toBe("board:status:done");
  });

  it("tints status columns with their status and others with the well", () => {
    const [backlog, todo] = boardColumns([], "status");
    expect(columnTone(todo!)).toEqual({ tint: "var(--amber-bg)", ink: "var(--amber-fg)" });
    expect(columnTone(backlog!).tint).toBe("var(--well)");
  });
});

describe("moveCursor", () => {
  const grid = [["a", "b", "c"], [], ["d"], ["e", "f"]];

  it("starts at the first card", () => {
    expect(moveCursor(grid, null, "down")).toEqual({ col: 0, row: 0 });
    expect(moveCursor([[], []], null, "down")).toBeNull();
  });

  it("moves within a column and stops at its ends", () => {
    expect(moveCursor(grid, { col: 0, row: 1 }, "down")).toEqual({ col: 0, row: 2 });
    expect(moveCursor(grid, { col: 0, row: 2 }, "down")).toEqual({ col: 0, row: 2 });
    expect(moveCursor(grid, { col: 0, row: 0 }, "up")).toEqual({ col: 0, row: 0 });
  });

  it("skips empty or folded columns and keeps the height where it can", () => {
    expect(moveCursor(grid, { col: 0, row: 2 }, "right")).toEqual({ col: 2, row: 0 });
    expect(moveCursor(grid, { col: 2, row: 0 }, "right")).toEqual({ col: 3, row: 0 });
    expect(moveCursor(grid, { col: 3, row: 1 }, "left")).toEqual({ col: 2, row: 0 });
    expect(moveCursor(grid, { col: 3, row: 1 }, "right")).toEqual({ col: 3, row: 1 });
  });
});

describe("neighbourColumn", () => {
  it("finds the next column that takes drops", () => {
    const columns = [{ value: { field: "status", status: "todo" } }, { value: null }, { value: { field: "status", status: "done" } }] as const;
    expect(neighbourColumn(columns, 0, 1)).toBe(2);
    expect(neighbourColumn(columns, 2, -1)).toBe(0);
    expect(neighbourColumn(columns, 0, -1)).toBeNull();
  });

  it("skips workspace columns, which don't take drops", () => {
    const columns = [
      { value: { field: "workspace", workspaceId: "w1", defaults: {} } },
      { value: { field: "workspace", workspaceId: null, defaults: {} } },
    ] as const;
    expect(neighbourColumn(columns, 0, 1)).toBeNull();
  });
});

describe("the Closed switch", () => {
  it("takes the Done and Cancelled columns off the board", () => {
    const groups = buildTaskGroups([task("a", "todo"), task("b", "cancelled")], new Set());
    expect(boardColumns(groups, "status", EMPTY_FILTERS, true).map((column) => column.key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
      "done",
      "cancelled",
    ]);
    expect(boardColumns(groups, "status", EMPTY_FILTERS, false).map((column) => column.key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
    ]);
  });
});
