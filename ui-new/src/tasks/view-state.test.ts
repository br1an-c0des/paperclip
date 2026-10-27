import type { CompactIssue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { applyUpdate } from "./task-updates";
import {
  applyFilters,
  creatorKey,
  DEFAULT_SORT,
  DEFAULT_VIEW_STATE,
  EMPTY_FILTERS,
  filterCount,
  isAgentCreated,
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
      ...DEFAULT_VIEW_STATE,
      groupBy: "assignee",
      collapsed: { "assignee:none": true },
    });
  });

  it("fills in the filters, sort and display options an older saved state lacks", () => {
    const saved = { groupBy: "status", filters: { statuses: ["todo"], assignees: [], labels: [], priorities: [] } };
    const state = parseViewState(JSON.stringify(saved));
    expect(state.filters).toEqual({ ...EMPTY_FILTERS, statuses: ["todo"] });
    expect(state.sort).toEqual(DEFAULT_SORT);
    expect(state.board).toEqual({ subtasks: false, closed: true });
    expect(state.savedViewId).toBeNull();
  });

  it("keeps the new filters, a sort, the board's options and the picked view", () => {
    const saved = {
      groupBy: "workspace",
      filters: { ...EMPTY_FILTERS, creators: ["agent:a"], projects: ["p1", 3], workspaces: ["none"], liveOnly: true, hideAgentCreated: "yes" },
      sort: { field: "priority", dir: "asc" },
      board: { subtasks: true, closed: false },
      savedViewId: "v1",
    };
    expect(parseViewState(JSON.stringify(saved))).toMatchObject({
      groupBy: "workspace",
      filters: { creators: ["agent:a"], projects: ["p1"], workspaces: ["none"], liveOnly: true, hideAgentCreated: false },
      sort: { field: "priority", dir: "asc" },
      board: { subtasks: true, closed: false },
      savedViewId: "v1",
    });
  });

  it("drops a sort it doesn't know", () => {
    expect(parseViewState(JSON.stringify({ sort: { field: "random", dir: "asc" } })).sort).toEqual(DEFAULT_SORT);
    expect(parseViewState(JSON.stringify({ sort: { field: "title", dir: "sideways" } })).sort).toEqual({ field: "title", dir: "desc" });
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
    expect(filterCount({ ...EMPTY_FILTERS, creators: ["user:me"], projects: ["p"], workspaces: ["w"], liveOnly: true, hideAgentCreated: true })).toBe(5);
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("applyFilters, creator, project, workspace and the switches", () => {
  const tasks = [
    task("mine", { createdByUserId: "me", originKind: "manual", projectId: "p1", projectWorkspaceId: "w1" }),
    task("bot", { createdByAgentId: "ada", projectId: "p1" }),
    task("routine", { createdByUserId: "me", originKind: "routine_execution", projectId: null }),
    task("system", { createdByUserId: null, createdByAgentId: null, projectId: "p2" }),
  ];
  const ids = (list: CompactIssue[]) => list.map((each) => each.id);

  it("keys creators as assignees are keyed", () => {
    expect(tasks.map(creatorKey)).toEqual(["user:me", "agent:ada", "user:me", "none"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, creators: ["agent:ada", "none"] }))).toEqual(["bot", "system"]);
  });

  it("filters by project, with none for tasks outside any", () => {
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, projects: ["p1"] }))).toEqual(["mine", "bot"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, projects: ["none", "p2"] }))).toEqual(["routine", "system"]);
  });

  it("filters by the workspace the context resolves, with none for the default", () => {
    const workspaceOf = (each: CompactIssue) => each.projectWorkspaceId ?? null;
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, workspaces: ["w1"] }, "", { workspaceOf }))).toEqual(["mine"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, workspaces: ["none"] }, "", { workspaceOf }))).toEqual(["bot", "routine", "system"]);
  });

  it("keeps only running tasks when live only is on", () => {
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, liveOnly: true }, "", { liveIssueIds: new Set(["bot"]) }))).toEqual(["bot"]);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, liveOnly: true }))).toEqual([]);
  });

  it("hides what agents, routines and the system created, as shared's isAgentCreatedIssue decides", () => {
    expect(tasks.map(isAgentCreated)).toEqual([false, true, true, true]);
    expect(isAgentCreated({ createdByUserId: "me", createdByAgentId: null, originKind: "onboarding_first_task" } as CompactIssue)).toBe(false);
    expect(ids(applyFilters(tasks, { ...EMPTY_FILTERS, hideAgentCreated: true }))).toEqual(["mine"]);
  });
});

describe("applyUpdate", () => {
  it("turns label ids into the labels the list shows", () => {
    const labels = [{ id: "bug", name: "bug", color: "#f00" }] as NonNullable<CompactIssue["labels"]>;
    const next = applyUpdate(task("a", { labels: [] }), { labelIds: ["bug", "missing"], status: "done" }, labels);
    expect(next).toMatchObject({ status: "done", labelIds: ["bug", "missing"], labels: [{ id: "bug", name: "bug" }] });
  });
});
