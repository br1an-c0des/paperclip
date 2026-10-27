import { describe, expect, it } from "vitest";
import {
  clearDimension,
  EMPTY_FILTERS,
  filterChips,
  filterCount,
  filterRequest,
  isFilterOn,
  loosenOptions,
  mergeFilters,
  toggleFilter,
  updatedLabel,
  type FilterNames,
  type SearchFilters,
} from "./filters";

const names: FilterNames = {
  agent: (id) => ({ ada: "Ada" })[id],
  person: (id) => ({ pat: "Pat" })[id],
  project: (id) => ({ p1: "Website" })[id],
  label: (id) => ({ l1: "bug" })[id],
  youId: "me",
};

const filters = (patch: Partial<SearchFilters>): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });

describe("toggleFilter", () => {
  it("adds and removes statuses and priorities", () => {
    const one = toggleFilter(EMPTY_FILTERS, "status", "todo");
    const two = toggleFilter(one, "status", "blocked");
    expect(two.status).toEqual(["todo", "blocked"]);
    expect(toggleFilter(two, "status", "todo").status).toEqual(["blocked"]);
    expect(toggleFilter(EMPTY_FILTERS, "priority", "high").priority).toEqual(["high"]);
  });

  it("makes the API's single filters single picks", () => {
    const ada = toggleFilter(EMPTY_FILTERS, "assignee", "agent:ada");
    expect(toggleFilter(ada, "assignee", "agent:bob").assignee).toBe("agent:bob");
    expect(toggleFilter(ada, "assignee", "agent:ada").assignee).toBeNull();
    expect(toggleFilter(EMPTY_FILTERS, "updated", "7d").updated).toBe("7d");
    expect(isFilterOn(ada, "assignee", "agent:ada")).toBe(true);
  });
});

describe("mergeFilters", () => {
  it("joins lists and lets typed single picks win", () => {
    const merged = mergeFilters(filters({ status: ["todo"], projectId: "p1" }), { status: ["blocked", "todo"], projectId: "p2", updated: "7d" });
    expect(merged).toEqual(filters({ status: ["todo", "blocked"], projectId: "p2", updated: "7d" }));
  });
});

describe("filterRequest", () => {
  it("splits the assignee into the API's two fields", () => {
    expect(filterRequest(filters({ assignee: "none" }))).toEqual({ assigneeAgentId: null });
    expect(filterRequest(filters({ assignee: "agent:ada" }))).toEqual({ assigneeAgentId: "ada" });
    expect(filterRequest(filters({ assignee: "user:pat" }))).toEqual({ assigneeUserId: "pat" });
    expect(filterRequest(EMPTY_FILTERS)).toEqual({});
  });

  it("passes the rest through", () => {
    expect(filterRequest(filters({ status: ["todo"], labelId: "l1", updated: "30d" }))).toEqual({
      status: ["todo"],
      labelId: "l1",
      updatedWithin: "30d",
    });
  });
});

describe("filterChips", () => {
  it("draws one chip per dimension, with names", () => {
    const chips = filterChips(filters({ status: ["in_progress", "in_review"], assignee: "user:me", projectId: "p1", updated: "7d" }), names);
    expect(chips.map((chip) => [chip.label, chip.value])).toEqual([
      ["Status", "In progress, In review"],
      ["Assignee", "You"],
      ["Project", "Website"],
      ["Updated", "Last 7 days"],
    ]);
    expect(filterCount(filters({ status: ["todo", "done"], labelId: "l1" }))).toBe(2);
  });

  it("names agents, people, unassigned and unknown ids", () => {
    const label = (assignee: string) => filterChips(filters({ assignee }), names)[0]!.value;
    expect(label("agent:ada")).toBe("Ada");
    expect(label("user:pat")).toBe("Pat");
    expect(label("none")).toBe("Unassigned");
    expect(label("agent:gone")).toBe("Unknown agent");
  });
});

describe("clearDimension", () => {
  it("drops one dimension only", () => {
    expect(clearDimension(filters({ status: ["todo"], assignee: "none" }), "status")).toEqual(filters({ assignee: "none" }));
  });
});

describe("updatedLabel", () => {
  it("names the windows, typed ones too", () => {
    expect(updatedLabel("24h")).toBe("Last 24 hours");
    expect(updatedLabel("2w")).toBe("Last 2 weeks");
    expect(updatedLabel("1m")).toBe("Last 1 month");
  });
});

describe("loosenOptions", () => {
  const set = filters({ status: ["done"], assignee: "agent:ada" });

  it("offers each filter to drop, most results first, then clearing them all", () => {
    const options = loosenOptions(
      {
        unfilteredTotal: 7,
        loosenSuggestions: [
          { filter: "status", values: ["done"], resultCount: 1, additionalCount: 1 },
          { filter: "assigneeAgentId", values: ["ada"], resultCount: 3, additionalCount: 3 },
        ],
      },
      set,
      names,
    );
    expect(options).toEqual([
      { dimension: "assignee", label: "Remove Assignee: Ada", count: 3 },
      { dimension: "status", label: "Remove Status: Done", count: 1 },
      { dimension: null, label: "Clear every filter", count: 7 },
    ]);
  });

  it("leaves out drops that find nothing, and a clear-all that repeats the only drop", () => {
    const options = loosenOptions(
      { unfilteredTotal: 4, loosenSuggestions: [{ filter: "updatedWithin", values: ["24h"], resultCount: 4, additionalCount: 4 }] },
      filters({ updated: "24h" }),
      names,
    );
    expect(options).toEqual([{ dimension: "updated", label: "Remove Updated: Last 24 hours", count: 4 }]);
    const none = loosenOptions({ unfilteredTotal: 5, loosenSuggestions: [{ filter: "status", values: ["done"], resultCount: 0, additionalCount: 0 }] }, set, names);
    expect(none).toEqual([{ dimension: null, label: "Clear every filter", count: 5 }]);
  });

  it("offers nothing when the query finds nothing even unfiltered", () => {
    expect(loosenOptions({ unfilteredTotal: 0, loosenSuggestions: [] }, set, names)).toEqual([]);
  });
});
