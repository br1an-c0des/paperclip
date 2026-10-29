import { describe, expect, it } from "vitest";
import { companySummary, desktopArea, detailParent, dockHiddenAfterScroll, dockPlace, isDetailPage, isOrgPage, tapTasks, tasksScope, toggleCompanies } from "./dock-model";

describe("isOrgPage", () => {
  it("covers the dashboard, the roster and the org tabs", () => {
    expect(isOrgPage("/TST/dashboard", "TST")).toBe(true);
    expect(isOrgPage("/TST/agents", "TST")).toBe(true);
    expect(isOrgPage("/TST/agents/", "TST")).toBe(true);
    expect(isOrgPage("/TST/agents/paused", "TST")).toBe(true);
    expect(isOrgPage("/TST/workload", "TST")).toBe(true);
    expect(isOrgPage("/TST/activity/runs", "TST")).toBe(true);
    expect(isOrgPage("/tst/org", "TST")).toBe(true);
  });

  it("leaves an agent's own page, settings and other places out", () => {
    expect(isOrgPage("/TST/agents/ceo", "TST")).toBe(false);
    expect(isOrgPage("/TST/agents/ceo/settings", "TST")).toBe(false);
    expect(isOrgPage("/TST/company/settings", "TST")).toBe(false);
    expect(isOrgPage("/TST/issues", "TST")).toBe(false);
    expect(isOrgPage("/TST/dashboards", "TST")).toBe(false);
    expect(isOrgPage("/OTHER/dashboard", "TST")).toBe(false);
  });
});

describe("dockPlace", () => {
  it("gives each page under the company to its dock place", () => {
    expect(dockPlace("/TST/inbox", "TST")).toBe("inbox");
    expect(dockPlace("/TST/inbox/updates", "TST")).toBe("inbox");
    expect(dockPlace("/TST/issues", "TST")).toBe("tasks");
    expect(dockPlace("/TST/issues/TST-41", "TST")).toBe("tasks");
    expect(dockPlace("/TST/projects/trading/board", "TST")).toBe("tasks");
    expect(dockPlace("/TST/projects/trading/issues", "TST")).toBe("tasks");
    expect(dockPlace("/TST/projects/trading/issues/TST-41", "TST")).toBe("tasks");
    expect(dockPlace("/TST/agents", "TST")).toBe("agents");
    expect(dockPlace("/TST/agents/ceo/chat", "TST")).toBe("agents");
  });

  it("leaves pages outside the three places with none", () => {
    expect(dockPlace("/TST/dashboard", "TST")).toBeNull();
    expect(dockPlace("/TST/company/settings", "TST")).toBeNull();
    expect(dockPlace("/TST", "TST")).toBeNull();
    expect(dockPlace("/TSTX/issues", "TST")).toBeNull();
  });

  it("doesn't count a project's dashboard, Docs or settings as Tasks", () => {
    expect(dockPlace("/TST/projects/trading", "TST")).toBeNull();
    expect(dockPlace("/TST/projects/trading/overview", "TST")).toBeNull();
    expect(dockPlace("/TST/projects/trading/docs", "TST")).toBeNull();
    expect(dockPlace("/TST/projects/trading/settings", "TST")).toBeNull();
    expect(dockPlace("/TST/projects/trading/boards", "TST")).toBeNull();
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
    expect(tasksScope("/TST/projects/trading/issues", "TST")).toEqual({ kind: "project", key: "trading" });
    expect(tasksScope("/TST/inbox", "TST")).toBeNull();
  });

  it("leaves a project's dashboard and Docs out, so Tasks never goes back to them", () => {
    expect(tasksScope("/TST/projects/trading", "TST")).toBeNull();
    expect(tasksScope("/TST/projects/trading/docs", "TST")).toBeNull();
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

describe("isDetailPage", () => {
  it("covers a task, an agent and an approval", () => {
    expect(isDetailPage("/TST/issues/TST-1", "TST")).toBe(true);
    expect(isDetailPage("/TST/agents/nova", "TST")).toBe(true);
    expect(isDetailPage("/TST/agents/nova/runs", "TST")).toBe(true);
    expect(isDetailPage("/TST/approvals/0b6f0c56-6f0a-4a4e-9d6c-1f6d2b6c7a10", "TST")).toBe(true);
  });

  it("leaves lists and the roster out", () => {
    expect(isDetailPage("/TST/issues", "TST")).toBe(false);
    expect(isDetailPage("/TST/issues/active", "TST")).toBe(false);
    expect(isDetailPage("/TST/agents", "TST")).toBe(false);
    expect(isDetailPage("/TST/agents/paused", "TST")).toBe(false);
    expect(isDetailPage("/TST/agents/new", "TST")).toBe(false);
    expect(isDetailPage("/TST/approvals/all", "TST")).toBe(false);
    expect(isDetailPage("/TST/dashboard", "TST")).toBe(false);
  });

  it("knows where Back goes without history", () => {
    expect(detailParent("/TST/issues/TST-1", "TST")).toBe("/TST/issues");
    expect(detailParent("/TST/agents/nova", "TST")).toBe("/TST/agents");
    expect(detailParent("/TST/approvals/x", "TST")).toBe("/TST/inbox");
  });
});

describe("desktopArea", () => {
  it("names the screens outside the phone's scope", () => {
    expect(desktopArea("/TST/company/settings", "TST")).toBe("Settings");
    expect(desktopArea("/TST/company/settings/instance/account", "TST")).toBe("App settings");
    expect(desktopArea("/TST/projects/web/settings/budget", "TST")).toBe("Project settings");
    expect(desktopArea("/TST/apps/advanced", "TST")).toBe("Apps");
    expect(desktopArea("/TST/skills", "TST")).toBe("Skills");
    expect(desktopArea("/TST/activity/runs", "TST")).toBe("Activity");
  });

  it("is null for the phone's own screens", () => {
    expect(desktopArea("/TST/issues", "TST")).toBeNull();
    expect(desktopArea("/TST/agents/nova", "TST")).toBeNull();
    expect(desktopArea("/TST/projects/web", "TST")).toBeNull();
    expect(desktopArea("/TST/inbox", "TST")).toBeNull();
  });
});
