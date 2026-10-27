import { describe, expect, it } from "vitest";
import { companySummary, dockHiddenAfterScroll, dockPlace, tapTasks, tasksScope, toggleCompanies } from "./dock-model";

describe("dockPlace", () => {
  it("gives each page under the company to its dock place", () => {
    expect(dockPlace("/TST/inbox", "TST")).toBe("inbox");
    expect(dockPlace("/TST/inbox/updates", "TST")).toBe("inbox");
    expect(dockPlace("/TST/issues", "TST")).toBe("tasks");
    expect(dockPlace("/TST/issues/TST-41", "TST")).toBe("tasks");
    expect(dockPlace("/TST/projects/trading/board", "TST")).toBe("tasks");
    expect(dockPlace("/TST/agents", "TST")).toBe("agents");
    expect(dockPlace("/TST/agents/ceo/chat", "TST")).toBe("agents");
  });

  it("leaves pages outside the three places with none", () => {
    expect(dockPlace("/TST/dashboard", "TST")).toBeNull();
    expect(dockPlace("/TST/company/settings", "TST")).toBeNull();
    expect(dockPlace("/TST", "TST")).toBeNull();
    expect(dockPlace("/TSTX/issues", "TST")).toBeNull();
  });

  it("matches the prefix without case and ignores a trailing slash", () => {
    expect(dockPlace("/tst/issues/", "TST")).toBe("tasks");
  });
});

describe("tasksScope", () => {
  it("knows the company list and project lists, but not a single task", () => {
    expect(tasksScope("/TST/issues", "TST")).toEqual({ kind: "all" });
    expect(tasksScope("/TST/projects/trading%20bench/board", "TST")).toEqual({ kind: "project", key: "trading bench" });
    expect(tasksScope("/TST/issues/TST-41", "TST")).toBeNull();
    expect(tasksScope("/TST/inbox", "TST")).toBeNull();
  });
});

describe("tapTasks", () => {
  it("goes to Tasks from another place, closing any sheet", () => {
    expect(tapTasks("inbox", "closed")).toEqual({ navigate: true, sheet: "closed" });
    expect(tapTasks(null, "closed")).toEqual({ navigate: true, sheet: "closed" });
  });

  it("opens the switcher in Tasks, and closes it from any view", () => {
    expect(tapTasks("tasks", "closed")).toEqual({ navigate: false, sheet: "projects" });
    expect(tapTasks("tasks", "projects")).toEqual({ navigate: false, sheet: "closed" });
    expect(tapTasks("tasks", "companies")).toEqual({ navigate: false, sheet: "closed" });
    expect(tapTasks("tasks", "you")).toEqual({ navigate: false, sheet: "closed" });
  });

  it("swaps projects and companies with the company dropdown", () => {
    expect(toggleCompanies("projects")).toBe("companies");
    expect(toggleCompanies("companies")).toBe("projects");
    expect(toggleCompanies("you")).toBe("companies");
  });
});

describe("dockHiddenAfterScroll", () => {
  it("hides scrolling down and shows scrolling up", () => {
    expect(dockHiddenAfterScroll(200, 260, false)).toBe(true);
    expect(dockHiddenAfterScroll(260, 200, true)).toBe(false);
  });

  it("ignores small movements", () => {
    expect(dockHiddenAfterScroll(200, 205, false)).toBe(false);
    expect(dockHiddenAfterScroll(205, 200, true)).toBe(true);
  });

  it("always shows near the top", () => {
    expect(dockHiddenAfterScroll(0, 40, false)).toBe(false);
    expect(dockHiddenAfterScroll(300, 20, true)).toBe(false);
  });
});

describe("companySummary", () => {
  it("joins what's known", () => {
    expect(companySummary({ projects: 3, agents: 1, needsYou: 8 })).toBe("3 projects · 1 agent · 8 need you");
    expect(companySummary({ agents: 2, tasks: 1 })).toBe("2 agents · 1 task");
    expect(companySummary({ needsYou: 0 })).toBe("all quiet");
    expect(companySummary({ needsYou: 1 })).toBe("1 needs you");
    expect(companySummary({})).toBe("");
  });
});
