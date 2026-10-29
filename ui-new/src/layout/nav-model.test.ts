import { describe, expect, it } from "vitest";
import { inStoredOrder, moveId, openTaskRef, parseRecent, recordRecent, refreshRecent, showStatusLink, visibleProjects, type RecentTask } from "./nav-model";

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
    expect(next).toEqual([{ ...task("2"), title: "Renamed", status: "done" }]);
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
