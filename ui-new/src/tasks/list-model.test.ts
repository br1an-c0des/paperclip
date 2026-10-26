import type { CompactIssue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { buildTaskGroups, updatedLabel } from "./list-model";

function task(id: string, status: string, extra: Partial<CompactIssue> = {}) {
  return { id, identifier: id.toUpperCase(), title: id, status, parentId: null, blockedBy: [], ...extra } as unknown as CompactIssue;
}

describe("buildTaskGroups", () => {
  it("groups by status in the board's order and skips empty groups", () => {
    const groups = buildTaskGroups([task("a", "done"), task("b", "todo"), task("c", "in_progress"), task("d", "todo")], new Set());
    expect(groups.map((group) => group.status)).toEqual(["in_progress", "todo", "done"]);
    expect(groups[1]!.rows.map((row) => row.task.id)).toEqual(["b", "d"]);
  });

  it("counts loaded subtasks on their parent and keeps orphans as rows", () => {
    const groups = buildTaskGroups(
      [
        task("parent", "in_progress"),
        task("kid1", "done", { parentId: "parent" }),
        task("kid2", "todo", { parentId: "parent" }),
        task("orphan", "todo", { parentId: "elsewhere" }),
      ],
      new Set(["parent"]),
    );
    const parent = groups[0]!.rows[0]!;
    expect(parent).toMatchObject({ subtasks: 2, subtasksDone: 1, live: true });
    expect(groups.flatMap((group) => group.rows.map((row) => row.task.id))).toEqual(["parent", "orphan"]);
  });

  it("notes what a blocked task waits on", () => {
    const blocker = { id: "x", identifier: "TES-9", title: "Analytics" };
    const [group] = buildTaskGroups([task("a", "blocked", { blockedBy: [blocker] as CompactIssue["blockedBy"] })], new Set());
    expect(group!.rows[0]!.note).toEqual({ tone: "red", label: "Blocked by TES-9" });
  });
});

describe("updatedLabel", () => {
  const now = new Date(2026, 9, 26, 15, 0);
  it("reads like board 1's Updated column", () => {
    expect(updatedLabel(new Date(2026, 9, 26, 14, 58), now)).toBe("2m ago");
    expect(updatedLabel(new Date(2026, 9, 26, 9, 30), now)).toBe("5h ago");
    expect(updatedLabel(new Date(2026, 9, 25, 9, 0), now)).toBe("Yesterday");
    expect(updatedLabel(new Date(2026, 9, 11, 9, 0), now)).toBe("Oct 11");
    expect(updatedLabel(new Date(2025, 9, 11, 9, 0), now)).toBe("Oct 11, 2025");
  });
});
