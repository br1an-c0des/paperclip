import { describe, expect, it } from "vitest";
import { searchQueryString } from "@/api/search";
import { EMPTY_FILTERS } from "./filters";
import { DEFAULT_SEARCH_STATE, readSearchState, searchPath, searchQuery } from "./search-url";

const PROJECT = "81846458-8c0e-4435-85b0-b41a5c2a55a1";

describe("readSearchState", () => {
  it("reads the defaults from an empty URL", () => {
    expect(readSearchState("")).toEqual(DEFAULT_SEARCH_STATE);
  });

  it("reads the old UI's parameters", () => {
    const state = readSearchState(`?q=login&scope=issues&status=todo&status=blocked&priority=high&assigneeAgentId=ada&projectId=${PROJECT}&updatedWithin=7d&sort=updated`);
    expect(state).toEqual({
      q: "login",
      scope: "issues",
      sort: "updated",
      filters: { status: ["todo", "blocked"], priority: ["high"], assignee: "agent:ada", projectId: PROJECT, labelId: null, updated: "7d" },
    });
  });

  it("takes comma lists, unassigned and people", () => {
    expect(readSearchState("?status=todo,done").filters.status).toEqual(["todo", "done"]);
    expect(readSearchState("?assigneeAgentId=null").filters.assignee).toBe("none");
    expect(readSearchState("?assigneeUserId=local-board").filters.assignee).toBe("user:local-board");
  });

  it("drops values it doesn't know", () => {
    const state = readSearchState("?scope=everything&sort=random&status=nope&priority=urgent&projectId=abc&updatedWithin=forever");
    expect(state.scope).toBe("all");
    expect(state.sort).toBe("relevance");
    expect(state.filters).toEqual(EMPTY_FILTERS);
  });
});

describe("searchQuery and searchPath", () => {
  it("leaves the defaults out", () => {
    expect(searchQuery(DEFAULT_SEARCH_STATE)).toBe("");
    expect(searchPath("TES")).toBe("/TES/search");
    expect(searchPath("TES", { q: "flaky login" })).toBe("/TES/search?q=flaky+login");
  });

  it("round-trips a full state", () => {
    const state = readSearchState(`?q=x&scope=comments&status=todo&status=done&assigneeAgentId=null&projectId=${PROJECT}&updatedWithin=24h&sort=priority`);
    expect(readSearchState(searchQuery(state))).toEqual(state);
  });

  it("writes people as assigneeUserId", () => {
    expect(searchQuery({ filters: { ...EMPTY_FILTERS, assignee: "user:u1" } })).toBe("assigneeUserId=u1");
  });
});

describe("searchQueryString", () => {
  it("writes the request the API takes", () => {
    expect(searchQueryString({ q: "login", scope: "all", limit: 50, assigneeAgentId: null, status: ["todo", "blocked"] })).toBe(
      "q=login&limit=50&status=todo&status=blocked&assigneeAgentId=null",
    );
    expect(searchQueryString({ q: "", scope: "issues", offset: 25, sort: "updated", updatedWithin: "7d" })).toBe(
      "q=&scope=issues&offset=25&updatedWithin=7d&sort=updated",
    );
  });
});
