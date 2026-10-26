import type { CompactIssue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { applyUpdate } from "./task-updates";
import {
  applyFilters,
  DEFAULT_VIEW_STATE,
  EMPTY_FILTERS,
  filterCount,
  parseViewState,
  readViewState,
  toggled,
  viewStateKey,
  writeViewState,
} from "./view-state";

function task(id: string, extra: Partial<CompactIssue> = {}) {
  return {
    id,
    identifier: id.toUpperCase(),
    title: id,
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    labelIds: [],
    ...extra,
  } as unknown as CompactIssue;
}

describe("parseViewState", () => {
  it("falls back to the default for missing or broken state", () => {
    expect(parseViewState(null)).toEqual(DEFAULT_VIEW_STATE);
    expect(parseViewState("{not json")).toEqual(DEFAULT_VIEW_STATE);
    expect(parseViewState(JSON.stringify({ groupBy: "colour", filters: { statuses: ["todo", 3] } }))).toEqual({
      ...DEFAULT_VIEW_STATE,
      filters: { ...EMPTY_FILTERS, statuses: ["todo"] },
    });
  });

  it("keeps a saved grouping and folded groups", () => {
    const saved = { groupBy: "assignee", filters: EMPTY_FILTERS, collapsed: { "assignee:none": true, bad: "yes" } };
    expect(parseViewState(JSON.stringify(saved))).toEqual({
      layout: "list",
      groupBy: "assignee",
      filters: EMPTY_FILTERS,
      collapsed: { "assignee:none": true },
    });
  });
});

describe("the layout switch", () => {
  it("starts as a list and keeps a saved board", () => {
    expect(DEFAULT_VIEW_STATE.layout).toBe("list");
    expect(parseViewState(JSON.stringify({ layout: "board", groupBy: "priority" }))).toMatchObject({ layout: "board", groupBy: "priority" });
  });

  it("falls back to the list for an unknown layout", () => {
    expect(parseViewState(JSON.stringify({ layout: "calendar" })).layout).toBe("list");
  });

  it("saves the layout with the rest of the view, per list", () => {
    const key = viewStateKey("company", "project");
    writeViewState(key, { ...DEFAULT_VIEW_STATE, layout: "board", collapsed: { "board:status:done": false } });
    expect(readViewState(key)).toMatchObject({ layout: "board", collapsed: { "board:status:done": false } });
    expect(readViewState(viewStateKey("company")).layout).toBe("list");
    localStorage.removeItem(key);
  });
});

describe("applyFilters", () => {
  const tasks = [
    task("a", { status: "todo", assigneeAgentId: "ada", labelIds: ["bug"], title: "Fix the login page" }),
    task("b", { status: "done", assigneeUserId: "me", priority: "high", description: "Login copy" }),
    task("c", { status: "blocked", identifier: "TES-12" }),
  ];
  const ids = (list: CompactIssue[]) => list.map((each) => each.id);

  it("matches any value within a filter and every filter across them", () => {
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, statuses: ["todo", "blocked"] }))).toEqual(["a", "c"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, statuses: ["todo", "blocked"], assignees: ["none"] }))).toEqual(["c"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, assignees: ["agent:ada", "user:me"] }))).toEqual(["a", "b"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, labels: ["none"] }))).toEqual(["b", "c"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, priorities: ["high"] }))).toEqual(["b"]);
  });

  it("searches identifiers, titles and descriptions, word by word", () => {
    expect(ids(applyFilters(tasks, EMPTY_FILTERS, "login"))).toEqual(["a", "b"]);
    expect(ids(applyFilters(tasks, EMPTY_FILTERS, "login fix"))).toEqual(["a"]);
    expect(ids(applyFilters(tasks, EMPTY_FILTERS, "tes-12"))).toEqual(["c"]);
  });

  it("counts and toggles filter values", () => {
    expect(filterCount({ ...EMPTY_FILTERS, statuses: ["todo"], labels: ["bug", "none"] })).toBe(3);
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("applyUpdate", () => {
  it("turns label ids into the labels the list shows", () => {
    const labels = [{ id: "bug", name: "bug", color: "#f00" }] as NonNullable<CompactIssue["labels"]>;
    const next = applyUpdate(task("a", { labels: [] }), { labelIds: ["bug", "missing"], status: "done" }, labels);
    expect(next).toMatchObject({ status: "done", labelIds: ["bug", "missing"], labels: [{ id: "bug", name: "bug" }] });
  });
});
