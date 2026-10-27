import { describe, expect, it } from "vitest";
import { parseQuery, stripFilters, tokenize, type ParserContext } from "./query-parser";

const context: ParserContext = {
  youId: "me",
  agents: [{ id: "a1", name: "Quant Researcher", urlKey: "quant-researcher" }],
  projects: [{ id: "p1", name: "Test Project", urlKey: "test-project" }],
  labels: [{ id: "l1", name: "bug" }],
};

describe("tokenize", () => {
  it("keeps quoted phrases and quoted values whole", () => {
    expect(tokenize(' flaky  "login page" assignee:"Quant Researcher" x')).toEqual(["flaky", '"login page"', 'assignee:"Quant Researcher"', "x"]);
  });
});

describe("parseQuery", () => {
  it("takes typed filters out of the text", () => {
    expect(parseQuery("login status:blocked priority:high updated:>7d", context)).toEqual({
      text: "login",
      filters: { status: ["blocked"], priority: ["high"], updated: "7d" },
      dimensions: ["status", "priority", "updated"],
    });
  });

  it("resolves people, projects and labels by name or key", () => {
    expect(parseQuery('assignee:"Quant Researcher" project:test-project label:Bug', context).filters).toEqual({
      assignee: "agent:a1",
      projectId: "p1",
      labelId: "l1",
    });
    expect(parseQuery("assignee:me", context).filters.assignee).toBe("user:me");
    expect(parseQuery("assignee:none", context).filters.assignee).toBe("none");
  });

  it("joins statuses and reads is:open and is:closed", () => {
    expect(parseQuery("status:todo status:in-progress", context).filters.status).toEqual(["todo", "in_progress"]);
    expect(parseQuery("is:closed", context).filters.status).toEqual(["done", "cancelled"]);
  });

  it("searches for tokens that don't resolve", () => {
    expect(parseQuery("assignee:nobody status:someday constructor:x http://x", context)).toEqual({
      text: "assignee:nobody status:someday constructor:x http://x",
      filters: {},
      dimensions: [],
    });
    // "me" means nothing until we know who you are.
    expect(parseQuery("assignee:me", { ...context, youId: null }).text).toBe("assignee:me");
  });
});

describe("stripFilters", () => {
  it("takes out every filter token, or one dimension's", () => {
    const query = "login status:blocked assignee:me fix";
    expect(stripFilters(query, context)).toBe("login fix");
    expect(stripFilters(query, context, "status")).toBe("login assignee:me fix");
  });
});
