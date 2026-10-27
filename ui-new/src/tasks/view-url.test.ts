import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_STATE } from "./view-state";
import { parseListUrl, withUrlFilters } from "./view-url";

describe("parseListUrl", () => {
  it("reads the search term", () => {
    expect(parseListUrl("?q=login+page&task=TES-3")).toMatchObject({ search: "login page", filters: {}, participantAgentId: null });
    expect(parseListUrl("").search).toBe("");
  });

  it("reads the old list's assignee pre-filter, an agent id by default", () => {
    expect(parseListUrl("?assignee=agent-1").filters).toEqual({ assignees: ["agent:agent-1"] });
    expect(parseListUrl("?assignee=user:pat&assignee=__unassigned").filters).toEqual({ assignees: ["user:pat", "none"] });
    expect(parseListUrl("?assignee=me", "me-id").filters).toEqual({ assignees: ["user:me-id"] });
    // "Me" means nothing until we know who you are.
    expect(parseListUrl("?assignee=__me", null).filters).toEqual({});
  });

  it("reads repeated workspaces, the participant and the old status views", () => {
    const url = parseListUrl("?workspace=w1&workspace=w2&participantAgentId=ada&view=active");
    expect(url.filters).toEqual({ workspaces: ["w1", "w2"], statuses: ["todo", "in_progress", "in_review", "blocked"] });
    expect(url.participantAgentId).toBe("ada");
    expect(parseListUrl("?view=done").filters.statuses).toEqual(["done", "cancelled"]);
    expect(parseListUrl("?view=all").filters.statuses).toEqual([]);
    // The inbox's views aren't the list's.
    expect(parseListUrl("?view=mine").filters).toEqual({});
  });

  it("takes URLSearchParams too", () => {
    expect(parseListUrl(new URLSearchParams({ q: "x", assignee: "a" }))).toMatchObject({ search: "x", filters: { assignees: ["agent:a"] } });
  });
});

describe("withUrlFilters", () => {
  it("replaces only the fields the URL sets", () => {
    const state = { ...DEFAULT_VIEW_STATE, filters: { ...DEFAULT_VIEW_STATE.filters, assignees: ["none"], labels: ["bug"] } };
    const next = withUrlFilters(state, { assignees: ["agent:a"] });
    expect(next.filters).toMatchObject({ assignees: ["agent:a"], labels: ["bug"] });
    expect(withUrlFilters(state, {})).toBe(state);
  });
});
