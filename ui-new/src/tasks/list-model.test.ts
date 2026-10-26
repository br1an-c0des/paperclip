import type { CompactIssue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { buildTaskGroups, groupDefaults, moveUpdate, startsCollapsed, updatedLabel, type GroupNames } from "./list-model";

function task(id: string, status: string, extra: Partial<CompactIssue> = {}) {
  return { id, identifier: id.toUpperCase(), title: id, status, parentId: null, blockedBy: [], ...extra } as unknown as CompactIssue;
}

describe("buildTaskGroups", () => {
  it("groups by status in the board's order and skips empty groups", () => {
    const groups = buildTaskGroups([task("a", "done"), task("b", "todo"), task("c", "in_progress"), task("d", "todo")], new Set());
    expect(groups.map((group) => group.key)).toEqual(["in_progress", "todo", "done"]);
    expect(groups.map((group) => startsCollapsed(group))).toEqual([false, false, true]);
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

const names: GroupNames = {
  agent: (id) => ({ ada: "Ada", ben: "Ben" })[id],
  person: (id) => (id === "pat" ? "Pat" : id),
  youId: () => "me",
  label: (id) => ({ bug: { name: "bug", color: "#f00" }, ui: { name: "design", color: null } })[id],
  task: (id) => (id === "p1" ? { identifier: "TES-1", title: "Launch", status: "in_progress" } : undefined),
};

describe("buildTaskGroups, other groupings", () => {
  it("groups by assignee: you, then agents by name, then people, then Unassigned", () => {
    const groups = buildTaskGroups(
      [
        task("a", "todo", { assigneeAgentId: "ben" }),
        task("b", "todo", { assigneeUserId: "pat" }),
        task("c", "todo"),
        task("d", "todo", { assigneeAgentId: "ada" }),
        task("e", "todo", { assigneeUserId: "me" }),
      ],
      new Set(),
      { groupBy: "assignee", names },
    );
    expect(groups.map((group) => group.label)).toEqual(["You", "Ada", "Ben", "Pat", "Unassigned"]);
    expect(groups[0]!.mark).toEqual({ kind: "user", userId: "me", you: true });
    expect(groups.some((group) => startsCollapsed(group))).toBe(false);
  });

  it("groups by priority from critical down", () => {
    const groups = buildTaskGroups(
      [task("a", "todo", { priority: "low" }), task("b", "todo", { priority: "critical" }), task("c", "todo", { priority: "medium" })],
      new Set(),
      { groupBy: "priority", names },
    );
    expect(groups.map((group) => group.label)).toEqual(["Critical", "Medium", "Low"]);
  });

  it("puts a task in each of its labels' groups, and unlabelled tasks last", () => {
    const groups = buildTaskGroups(
      [task("a", "todo", { labelIds: ["bug", "ui"] }), task("b", "todo", { labelIds: [] }), task("c", "todo", { labelIds: ["bug"] })],
      new Set(),
      { groupBy: "label", names },
    );
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.task.id)])).toEqual([
      ["bug", ["a", "c"]],
      ["design", ["a"]],
      ["No label", ["b"]],
    ]);
  });

  it("groups by parent without folding subtasks, and names parents from the whole list", () => {
    const groups = buildTaskGroups(
      [task("p1", "in_progress"), task("k1", "todo", { parentId: "p1" }), task("k2", "done", { parentId: "gone" })],
      new Set(),
      { groupBy: "parent", names },
    );
    expect(groups.map((group) => group.label)).toEqual(["TES-1 · Launch", "A task outside this list", "No parent task"]);
    expect(groups[0]!.rows[0]).toMatchObject({ subtasks: 0 });
  });

  it("puts everything in one group with no grouping", () => {
    const groups = buildTaskGroups([task("a", "todo"), task("b", "done")], new Set(), { groupBy: "none", names });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: "All tasks", value: null });
  });
});

describe("moveUpdate and groupDefaults", () => {
  const a = task("a", "todo", { priority: "low", assigneeAgentId: "ada", assigneeUserId: null, labelIds: ["bug", "x"] });

  it("changes only what differs", () => {
    expect(moveUpdate(a, undefined, { field: "status", status: "todo" })).toBeNull();
    expect(moveUpdate(a, undefined, { field: "status", status: "done" })).toEqual({ status: "done" });
    expect(moveUpdate(a, undefined, { field: "assignee", agentId: "ada", userId: null })).toBeNull();
    expect(moveUpdate(a, undefined, { field: "assignee", agentId: null, userId: "me" })).toEqual({
      assigneeAgentId: null,
      assigneeUserId: "me",
    });
    expect(moveUpdate(a, undefined, null)).toBeNull();
  });

  it("swaps one label for another between label groups", () => {
    expect(moveUpdate(a, { field: "label", labelId: "bug" }, { field: "label", labelId: "ui" })).toEqual({ labelIds: ["x", "ui"] });
    expect(moveUpdate(a, undefined, { field: "label", labelId: null })).toEqual({ labelIds: [] });
    expect(moveUpdate(a, undefined, { field: "label", labelId: "x" })).toBeNull();
  });

  it("never makes a task its own parent", () => {
    expect(moveUpdate(a, undefined, { field: "parent", parentId: "a" })).toBeNull();
    expect(moveUpdate(a, undefined, { field: "parent", parentId: "p1" })).toEqual({ parentId: "p1" });
  });

  it("gives new tasks the group's value", () => {
    expect(groupDefaults({ field: "status", status: "in_review" })).toEqual({ status: "in_review" });
    expect(groupDefaults({ field: "assignee", agentId: null, userId: null })).toEqual({});
    expect(groupDefaults({ field: "label", labelId: "bug" })).toEqual({ labelIds: ["bug"] });
    expect(groupDefaults(null)).toEqual({});
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
