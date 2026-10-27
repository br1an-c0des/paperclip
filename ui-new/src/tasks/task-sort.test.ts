import type { CompactIssue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { buildTaskGroups } from "./list-model";
import { defaultDir, dirLabels, sortTasks, workflowSort } from "./task-sort";

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    identifier: id.toUpperCase(),
    title: id,
    status: "todo",
    priority: "medium",
    parentId: null,
    blockedBy: [],
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...extra,
  } as unknown as CompactIssue;
}

const ids = (list: readonly CompactIssue[]) => list.map((each) => each.id);

describe("sortTasks", () => {
  const tasks = [
    task("b", { title: "Beta 10", priority: "low", status: "done", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" }),
    task("a", { title: "alpha", priority: "critical", status: "in_review", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" }),
    task("c", {
      title: "Beta 9",
      priority: "high",
      status: "backlog",
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      lastActivityAt: "2026-10-09T00:00:00Z",
    }),
  ];

  it("sorts by update time, using the last activity the Updated column shows", () => {
    expect(ids(sortTasks(tasks, { field: "updated", dir: "desc" }))).toEqual(["c", "b", "a"]);
    expect(ids(sortTasks(tasks, { field: "updated", dir: "asc" }))).toEqual(["a", "b", "c"]);
  });

  it("sorts by creation time", () => {
    expect(ids(sortTasks(tasks, { field: "created", dir: "desc" }))).toEqual(["b", "c", "a"]);
  });

  it("sorts priority from Critical down and status in the order work moves", () => {
    expect(ids(sortTasks(tasks, { field: "priority", dir: "asc" }))).toEqual(["a", "c", "b"]);
    expect(ids(sortTasks(tasks, { field: "status", dir: "asc" }))).toEqual(["c", "a", "b"]);
    expect(ids(sortTasks(tasks, { field: "status", dir: "desc" }))).toEqual(["b", "a", "c"]);
  });

  it("sorts titles without regard to case, and numbers by value", () => {
    expect(ids(sortTasks(tasks, { field: "title", dir: "asc" }))).toEqual(["a", "c", "b"]);
  });

  it("keeps the incoming order for ties and doesn't change the input", () => {
    const same = [task("x"), task("y"), task("z")];
    expect(ids(sortTasks(same, { field: "priority", dir: "desc" }))).toEqual(["x", "y", "z"]);
    sortTasks(tasks, { field: "title", dir: "asc" });
    expect(ids(tasks)).toEqual(["b", "a", "c"]);
  });

  it("orders rows within each group, and subtasks under their parent", () => {
    const list = [
      task("p", { title: "Parent", status: "todo" }),
      task("k2", { title: "Kid 2", parentId: "p" }),
      task("k1", { title: "Kid 1", parentId: "p" }),
      task("z", { title: "Zed", status: "todo" }),
      task("d", { title: "Done", status: "done" }),
    ];
    const groups = buildTaskGroups(sortTasks(list, { field: "title", dir: "desc" }), new Set());
    expect(groups.map((group) => group.rows.map((row) => row.task.id))).toEqual([["z", "p"], ["d"]]);
    expect(groups[0]!.rows[1]!.children.map((row) => row.task.id)).toEqual(["k2", "k1"]);
  });

  it("names its directions to fit the field, and starts times newest first", () => {
    expect(defaultDir("updated")).toBe("desc");
    expect(defaultDir("priority")).toBe("asc");
    expect(dirLabels("created").desc).toBe("Newest first");
    expect(dirLabels("priority").asc).toBe("Highest first");
  });
});

describe("workflowSort", () => {
  const blockedBy = (...blockers: string[]) => ({ blockedBy: blockers.map((id) => ({ id })) });

  it("puts each blocker straight before the task it holds up, otherwise oldest first", () => {
    const list = [
      task("third", { createdAt: "2026-10-01T00:00:00Z", ...blockedBy("second") }),
      task("loose", { createdAt: "2026-10-02T00:00:00Z" }),
      task("second", { createdAt: "2026-10-03T00:00:00Z", ...blockedBy("first") }),
      task("first", { createdAt: "2026-10-04T00:00:00Z" }),
    ];
    expect(ids(workflowSort(list))).toEqual(["loose", "first", "second", "third"]);
    expect(ids(sortTasks(list, { field: "workflow", dir: "desc" }))).toEqual(["third", "second", "first", "loose"]);
  });

  it("ignores blockers outside the list and falls back to oldest first on a cycle", () => {
    const outside = [task("a", { createdAt: "2026-10-02T00:00:00Z", ...blockedBy("elsewhere") }), task("b", { createdAt: "2026-10-01T00:00:00Z" })];
    expect(ids(workflowSort(outside))).toEqual(["b", "a"]);
    const cycle = [
      task("x", { createdAt: "2026-10-02T00:00:00Z", ...blockedBy("y") }),
      task("y", { createdAt: "2026-10-01T00:00:00Z", ...blockedBy("x") }),
    ];
    expect(ids(workflowSort(cycle))).toEqual(["y", "x"]);
  });
});
