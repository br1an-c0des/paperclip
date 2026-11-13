import type { ResourceMemberships } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { applyAgentMembership, emptyMemberships, inPinOrder, isAgentStarred, parsePinOrder, pinOrderKey, starredAgents } from "./star-model";

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

describe("your order of starred agents (U144, upstream #20830)", () => {
  it("keeps your order, with agents starred since then first in star order", () => {
    expect(inPinOrder(["a1", "a2", "a3"], [])).toEqual(["a1", "a2", "a3"]);
    expect(inPinOrder(["a1", "a2", "a3"], ["a3", "a1", "a2"])).toEqual(["a3", "a1", "a2"]);
    // a4 was starred after you arranged them; a9 was unstarred.
    expect(inPinOrder(["a4", "a1", "a2", "a3"], ["a3", "a9", "a1", "a2"])).toEqual(["a4", "a3", "a1", "a2"]);
    expect(inPinOrder([], ["a1"])).toEqual([]);
  });

  it("reads a saved order back safely", () => {
    expect(parsePinOrder('["a2","a1","a2",3,null]')).toEqual(["a2", "a1"]);
    expect(parsePinOrder("not json")).toEqual([]);
    expect(parsePinOrder('{"a":1}')).toEqual([]);
    expect(parsePinOrder(null)).toEqual([]);
  });

  it("keeps each person's order apart, per company", () => {
    expect(pinOrderKey("user 1", "c1")).toBe("paperclip.ui-new.agent-pin-order.v1:user%201:c1");
    expect(pinOrderKey("user 1", "c1")).not.toBe(pinOrderKey("user 1", "c2"));
  });
});
