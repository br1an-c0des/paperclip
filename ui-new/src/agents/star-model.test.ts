import type { ResourceMemberships } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { applyAgentMembership, emptyMemberships, isAgentStarred, starredAgents } from "./star-model";

const now = new Date("2026-10-28T12:00:00Z");

function memberships(over: Partial<ResourceMemberships> = {}): ResourceMemberships {
  return { ...emptyMemberships(), ...over };
}

describe("starring agents", () => {
  it("puts a new star first and joins the agent", () => {
    const next = applyAgentMembership(memberships({ starredAgentIds: ["a1"], agentMemberships: { a2: "left" } }), "a2", { starred: true }, now);
    expect(next.starredAgentIds).toEqual(["a2", "a1"]);
    expect(next.agentMemberships.a2).toBe("joined");
    expect(next.agentStarredAt?.a2).toEqual(now);
    expect(isAgentStarred(next, "a2")).toBe(true);
  });

  it("unstarring keeps the agent joined", () => {
    const next = applyAgentMembership(memberships({ starredAgentIds: ["a1", "a2"], agentStarredAt: { a1: now } }), "a1", { starred: false }, now);
    expect(next.starredAgentIds).toEqual(["a2"]);
    expect(next.agentMemberships.a1).toBe("joined");
    expect(next.agentStarredAt).toEqual({});
  });

  it("leaving clears the star", () => {
    const next = applyAgentMembership(memberships({ starredAgentIds: ["a1"] }), "a1", { state: "left" }, now);
    expect(next.starredAgentIds).toEqual([]);
    expect(next.agentMemberships.a1).toBe("left");
  });

  it("works before the memberships have loaded", () => {
    expect(applyAgentMembership(undefined, "a1", { starred: true }, now).starredAgentIds).toEqual(["a1"]);
    expect(isAgentStarred(undefined, "a1")).toBe(false);
  });
});

describe("the nav's Starred group", () => {
  it("lists starred agents in star order, skipping missing and retired ones", () => {
    const agents = [
      { id: "a1", status: "idle" },
      { id: "a2", status: "terminated" },
      { id: "a3", status: "running" },
    ];
    expect(starredAgents(memberships({ starredAgentIds: ["a3", "gone", "a2", "a1"] }), agents).map((agent) => agent.id)).toEqual(["a3", "a1"]);
    expect(starredAgents(undefined, agents)).toEqual([]);
  });
});
