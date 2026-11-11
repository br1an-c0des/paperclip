import { describe, expect, it } from "vitest";
import type { CrewMember, ProjectTask } from "./dashboard-model";
import { docsNumbers, headerAgents, headerSearch, phoneView } from "./phone-header-model";

function member(agentId: string, state: CrewMember["state"], identifier?: string): CrewMember {
  return {
    agentId,
    state,
    task: identifier ? ({ id: `t-${identifier}`, identifier, title: identifier } as ProjectTask) : null,
    runId: null,
    openCount: 1,
  };
}

const agents = [
  { id: "a1", name: "Quant Researcher", urlKey: "quant-researcher" },
  { id: "a2", name: "ML Engineer", urlKey: "ml-engineer" },
  { id: "a3", name: "Frontend Engineer", urlKey: null },
];

describe("headerAgents", () => {
  it("names each agent with what it's doing and keeps the crew's order", () => {
    const { shown, more } = headerAgents(
      [member("a1", "running", "TRA-41"), member("a2", "blocked", "TRA-45"), member("a3", "paused")],
      agents,
    );
    expect(more).toBe(0);
    expect(shown.map((agent) => agent.title)).toEqual([
      "Quant Researcher · Running TRA-41",
      "ML Engineer · Blocked on TRA-45",
      "Frontend Engineer · Paused",
    ]);
    expect(shown.map((agent) => agent.label)).toEqual(["Quant Researcher, running", "ML Engineer, blocked", "Frontend Engineer, paused"]);
    expect(shown.map((agent) => agent.bar)).toEqual(["var(--g-ion)", "var(--g-flare)", "var(--g-ember)"]);
  });

  it("links by the agent's URL key, else its id", () => {
    const { shown } = headerAgents([member("a1", "idle"), member("a3", "idle"), member("gone", "idle")], agents);
    expect(shown.map((agent) => agent.key)).toEqual(["quant-researcher", "a3", "gone"]);
    expect(shown.map((agent) => agent.bar)).toEqual([null, null, null]);
    expect(shown[2]!.name).toBe("Agent");
  });

  it("draws the first four and counts the rest", () => {
    const members = ["a", "b", "c", "d", "e", "f"].map((id) => member(id, "idle", "TRA-1"));
    const { shown, more } = headerAgents(members, [], 4);
    expect(shown).toHaveLength(4);
    expect(more).toBe(2);
    expect(shown[0]!.title).toBe("Agent · On TRA-1");
  });
});

describe("docsNumbers", () => {
  it("waits for the groups, then sums their items", () => {
    expect(docsNumbers(undefined)).toBeNull();
    expect(docsNumbers([])).toEqual({ items: 0, tasks: 0 });
    expect(docsNumbers([{ count: 3 }, { count: 0 }, { count: 2 }])).toEqual({ items: 5, tasks: 2 });
  });
});

describe("headerSearch", () => {
  it("narrows the Search page to the project, and to documents on Docs", () => {
    expect(headerSearch("overview", "TES", "p1")).toEqual({ href: "/TES/search?projectId=p1", label: "Search this project" });
    expect(headerSearch("docs", "TES", "p1")).toEqual({ href: "/TES/search?scope=documents&projectId=p1", label: "Search docs and files" });
  });

  it("leaves the list to its toolbar's search", () => {
    expect(headerSearch("list", "TES", "p1")).toBeNull();
  });
});

describe("phoneView", () => {
  it("maps project tabs onto the phone's three views", () => {
    expect(phoneView("")).toBe("overview");
    expect(phoneView("overview")).toBe("overview");
    expect(phoneView("issues")).toBe("list");
    expect(phoneView("issues/TES-4")).toBe("list");
    expect(phoneView("issues/")).toBe("list");
    expect(phoneView("docs")).toBe("docs");
    expect(phoneView("board")).toBe("other");
    expect(phoneView("settings/budget")).toBe("other");
  });
});
