import { describe, expect, it } from "vitest";
import {
  addView,
  deleteView,
  localSavedViews,
  parseSavedViews,
  renameView,
  sameSettings,
  savedViewsScope,
  updateView,
  type ViewSettings,
} from "./saved-views";
import { DEFAULT_SORT, EMPTY_FILTERS } from "./view-state";

const settings: ViewSettings = {
  groupBy: "assignee",
  filters: { ...EMPTY_FILTERS, statuses: ["blocked"], liveOnly: true },
  sort: { field: "priority", dir: "asc" },
  search: "  login ",
};

describe("saved views", () => {
  it("adds a view with the current settings, its search trimmed", () => {
    const views = addView([], "Blocked", settings, "v1");
    expect(views).toEqual([{ id: "v1", name: "Blocked", ...settings, search: "login" }]);
  });

  it("numbers a name that's taken, and names a blank one", () => {
    let views = addView([], "Blocked", settings, "v1");
    views = addView(views, "blocked", settings, "v2");
    views = addView(views, "  ", settings, "v3");
    expect(views.map((view) => view.name)).toEqual(["Blocked", "blocked 2", "Untitled view"]);
  });

  it("renames, updates and deletes by id", () => {
    let views = addView(addView([], "One", settings, "v1"), "Two", settings, "v2");
    views = renameView(views, "v1", "Two");
    expect(views.map((view) => view.name)).toEqual(["Two 2", "Two"]);
    expect(renameView(views, "v1", "   ")[0]!.name).toBe("Two 2");
    views = updateView(views, "v2", { ...settings, groupBy: "status", search: "" });
    expect(views[1]).toMatchObject({ id: "v2", name: "Two", groupBy: "status", search: "" });
    expect(deleteView(views, "v1").map((view) => view.id)).toEqual(["v2"]);
  });

  it("matches settings whatever order the filters were ticked in", () => {
    const view = addView([], "View", { ...settings, filters: { ...settings.filters, statuses: ["todo", "blocked"] } }, "v1")[0]!;
    expect(sameSettings(view, { ...settings, filters: { ...settings.filters, statuses: ["blocked", "todo"] } })).toBe(true);
    expect(sameSettings(view, { ...settings, filters: { ...settings.filters, statuses: ["todo"] } })).toBe(false);
    expect(sameSettings(view, { ...settings, filters: { ...settings.filters, statuses: ["todo", "blocked"], liveOnly: false } })).toBe(false);
    expect(sameSettings(view, { ...settings, filters: { ...settings.filters, statuses: ["todo", "blocked"] }, sort: DEFAULT_SORT })).toBe(false);
  });

  it("reads back what it stored, per list, and drops malformed entries", () => {
    const scope = savedViewsScope("company", "project");
    localSavedViews.write(scope, addView([], "Mine", settings, "v1"));
    expect(localSavedViews.read(scope)).toMatchObject([{ id: "v1", name: "Mine", groupBy: "assignee", filters: { statuses: ["blocked"] } }]);
    expect(localSavedViews.read(savedViewsScope("company"))).toEqual([]);
    localStorage.removeItem(`ui-new:tasks:saved-views:${scope}`);

    const raw = JSON.stringify([{ id: "a", name: "Ok", groupBy: "nonsense" }, { id: 2, name: "Bad" }, { id: "b", name: " " }, null]);
    expect(parseSavedViews(raw)).toEqual([{ id: "a", name: "Ok", groupBy: "status", filters: EMPTY_FILTERS, sort: DEFAULT_SORT, search: "" }]);
    expect(parseSavedViews("not json")).toEqual([]);
    expect(parseSavedViews(null)).toEqual([]);
  });
});
