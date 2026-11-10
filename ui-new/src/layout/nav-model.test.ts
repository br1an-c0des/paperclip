import { describe, expect, it } from "vitest";
import { clampNavWidth, inStoredOrder, isProjectPage, moveId, NAV_WIDTH_DEFAULT, NAV_WIDTH_MAX, NAV_WIDTH_MIN, parseNavWidth, openTaskRef, parseRecent, recordRecent, refreshRecent, showStatusLink, visibleProjects, type RecentTask } from "./nav-model";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("inStoredOrder", () => {
  it("puts placed items first, then the rest as they came", () => {
    expect(inStoredOrder(items, ["c", "x"]).map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(inStoredOrder(items, undefined).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("moveId", () => {
  it("swaps with the neighbour and stops at the ends", () => {
    expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a"], "z", 1)).toEqual(["a"]);
  });
});

describe("visibleProjects", () => {
  it("drops projects you left", () => {
    expect(visibleProjects(items, { projectMemberships: { b: "left", c: "joined" } }).map((item) => item.id)).toEqual(["a", "c"]);
    expect(visibleProjects(items, undefined)).toHaveLength(3);
  });
});

describe("isProjectPage", () => {
  const project = { id: "p1", urlKey: "trading-bench" };
  it("is true on every page of the project, by key or id", () => {
    for (const path of ["/TES/projects/trading-bench", "/TES/projects/trading-bench/issues", "/tes/projects/Trading-Bench/board", "/TES/projects/trading-bench/settings/x", "/TES/projects/p1/issues"]) {
      expect(isProjectPage(path, "TES", project), path).toBe(true);
    }
  });

  it("is false elsewhere", () => {
    for (const path of ["/TES/projects", "/TES/projects/", "/TES/projects/trading-bench-2/issues", "/TES/issues", "/NOR/projects/trading-bench"]) {
      expect(isProjectPage(path, "TES", project), path).toBe(false);
    }
  });
});

const task = (id: string, at = 0): RecentTask => ({ id, identifier: `T-${id}`, title: id, status: "todo", at });

describe("recent tasks", () => {
  it("records a task once, newest first, five at most", () => {
    let list: RecentTask[] = [];
    for (const id of ["1", "2", "3", "4", "5", "6"]) list = recordRecent(list, task(id), Number(id));
    expect(list.map((entry) => entry.id)).toEqual(["6", "5", "4", "3", "2"]);
    list = recordRecent(list, task("4"), 7);
    expect(list.map((entry) => entry.id)).toEqual(["4", "6", "5", "3", "2"]);
  });

  it("refreshes titles and statuses and drops tasks the server no longer returns", () => {
    const list = [task("1"), task("2")];
    expect(refreshRecent(list, undefined)).toEqual(list);
    const next = refreshRecent(list, [{ id: "2", identifier: "T-2", title: "Renamed", status: "done" }]);
    expect(next).toEqual([{ ...task("2"), title: "Renamed", status: "done", displayStatus: null }]);
  });

  it("keeps what the server says a task shows, such as Monitoring, and lets go of it when it stops", () => {
    const list = [task("1")];
    const monitored = refreshRecent(list, [{ id: "1", identifier: "T-1", title: "One", status: "in_progress", displayStatus: "monitoring" }]);
    expect(monitored[0]).toMatchObject({ status: "in_progress", displayStatus: "monitoring" });
    expect(refreshRecent(monitored, [{ id: "1", identifier: "T-1", title: "One", status: "in_progress" }])[0]!.displayStatus).toBeNull();
  });

  it("parses what was stored, ignoring junk", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{")).toEqual([]);
    expect(parseRecent(JSON.stringify([task("1"), { id: 2 }]))).toEqual([task("1")]);
  });
});

describe("openTaskRef", () => {
  it("reads the task page or the panel", () => {
    expect(openTaskRef("/TES/issues/TES-6", "", "TES")).toBe("TES-6");
    expect(openTaskRef("/tes/issues/TES-6/runs", "", "TES")).toBe("TES-6");
    expect(openTaskRef("/TES/issues", "?task=TES-2", "TES")).toBe("TES-2");
    expect(openTaskRef("/TES/projects/web/issues", "?task=TES-3&section=activity", "TES")).toBe("TES-3");
  });

  it("is null for lists and other pages", () => {
    expect(openTaskRef("/TES/issues", "", "TES")).toBeNull();
    expect(openTaskRef("/TES/issues/active", "", "TES")).toBeNull();
    expect(openTaskRef("/TES/dashboard", "", "TES")).toBeNull();
  });
});

describe("showStatusLink", () => {
  it("shows Status only while the instance has status cards on", () => {
    expect(showStatusLink({ enableStatusCards: true })).toBe(true);
    expect(showStatusLink({ enableStatusCards: false })).toBe(false);
    expect(showStatusLink(undefined)).toBe(false);
  });
});

describe("the nav's width", () => {
  it("keeps whole pixels between the narrowest and widest", () => {
    expect(clampNavWidth(300.4)).toBe(300);
    expect(clampNavWidth(50)).toBe(NAV_WIDTH_MIN);
    expect(clampNavWidth(2000)).toBe(NAV_WIDTH_MAX);
    expect(clampNavWidth(Number.NaN)).toBe(NAV_WIDTH_DEFAULT);
  });

  it("reads a saved width, or the default", () => {
    expect(parseNavWidth(320)).toBe(320);
    expect(parseNavWidth(999)).toBe(NAV_WIDTH_MAX);
    expect(parseNavWidth("320")).toBe(NAV_WIDTH_DEFAULT);
    expect(parseNavWidth(null)).toBe(NAV_WIDTH_DEFAULT);
  });
});
