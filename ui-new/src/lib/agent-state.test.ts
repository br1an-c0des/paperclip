import { describe, expect, it } from "vitest";
import type { LiveRun } from "@/api/heartbeats";
import { agentState, isAgentBlocked, runningAgentIds, sortAgentsForNav } from "./agent-state";

describe("agent state", () => {
  it("counts only running runs", () => {
    const runs = [
      { agentId: "a", status: "running" },
      { agentId: "b", status: "queued" },
    ] as LiveRun[];
    expect([...runningAgentIds(runs)]).toEqual(["a"]);
  });

  it("says running for a live run, otherwise the status in words", () => {
    const running = new Set(["a"]);
    expect(agentState({ id: "a", status: "idle" }, running).key).toBe("running");
    expect(agentState({ id: "b", status: "paused" }, running).label).toBe("paused");
    expect(agentState({ id: "b", status: "pending_approval" }, running).label).toBe("needs approval");
    expect(agentState({ id: "b", status: "active" }, running).key).toBe("idle");
  });

  it("calls an agent blocked only when every open task it has is blocked and it isn't running", () => {
    const blocked = { status: "blocked" };
    expect(isAgentBlocked([blocked], false)).toBe(true);
    expect(isAgentBlocked([blocked, { status: "done" }, { status: "cancelled" }], false)).toBe(true);
    expect(isAgentBlocked([blocked, { status: "todo" }], false)).toBe(false);
    expect(isAgentBlocked([blocked], true)).toBe(false);
    expect(isAgentBlocked([], false)).toBe(false);
    expect(isAgentBlocked([{ status: "done" }], false)).toBe(false);
  });

  it("puts running agents first, then sorts by name", () => {
    const agents = [
      { id: "1", name: "zed", status: "idle" },
      { id: "2", name: "Amy", status: "idle" },
      { id: "3", name: "Bo", status: "idle" },
    ] as const;
    expect(sortAgentsForNav([...agents], new Set(["3"])).map((agent) => agent.name)).toEqual(["Bo", "Amy", "zed"]);
  });
});
