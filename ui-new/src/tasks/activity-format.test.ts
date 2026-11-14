import type { ActivityEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { activityLine, executionWaitText } from "./activity-format";

const names = { agent: () => undefined, person: (id: string) => `User ${id}`, youId: () => "u1" };

const event = (details: Record<string, unknown>) =>
  ({ action: "issue.execution_waiting", details, actorType: "system", actorId: "execution-admission", agentId: "a1" }) as unknown as ActivityEvent;

describe("stop confirmations", () => {
  const confirmed = (action: string) =>
    activityLine({ action, details: { runId: "r1", alreadyStopped: false }, actorType: "user", actorId: "u1", agentId: null } as unknown as ActivityEvent, names);

  it("reads a confirmed run stop in the old UI's words, not the raw action (#20310)", () => {
    expect(confirmed("issue.run_stop_confirmed")).toMatchObject({ actor: "You", text: "confirmed the previous run stopped" });
    expect(confirmed("issue.workspace_owner_stop_confirmed")?.text).toBe("confirmed the previous server stopped");
  });
});

describe("issue.execution_waiting (#20338)", () => {
  it("reads as Paperclip holding the Retry, with the reason in words, not the raw action", () => {
    expect(activityLine(event({ requestId: "w1", reason: "budget.blocked" }), names)).toEqual({
      actor: "Paperclip",
      text: "held the Retry until the budget allows new work",
    });
    expect(activityLine(event({ reason: "dependency_blocked" }), names)?.text).toBe("held the Retry until its blockers finish");
  });

  it("falls back to a general line for a reason it doesn't know", () => {
    expect(executionWaitText("something_new")).toBe("held the Retry until it can start");
    expect(executionWaitText(undefined)).toBe("held the Retry until it can start");
  });
});

describe("actor names (U161, #21406)", () => {
  const updated = (extra: Record<string, unknown>) =>
    ({ action: "issue.updated", details: { priority: "high" }, actorType: "user", actorId: "local-board", agentId: null, ...extra }) as unknown as ActivityEvent;

  it("prefers the server's name for the actor, and still says You", () => {
    expect(activityLine(updated({ actorName: "Board" }), names)?.actor).toBe("Board");
    expect(activityLine(updated({ actorId: "u7", actorName: "Maya R." }), names)?.actor).toBe("Maya R.");
    expect(activityLine(updated({ actorType: "agent", actorId: "a9", agentId: "a9", actorName: "Codex" }), names)?.actor).toBe("Codex");
    expect(activityLine(updated({ actorType: "plugin", actorId: "p1", actorName: "Linear sync" }), names)?.actor).toBe("Linear sync");
    expect(activityLine(updated({ actorId: "u1", actorName: "Brian" }), names)?.actor).toBe("You");
  });

  it("falls back to its own lookup on a server without names", () => {
    expect(activityLine(updated({ actorId: "u7" }), names)?.actor).toBe("User u7");
    expect(activityLine(updated({ actorType: "plugin", actorId: "p1", actorName: "  " }), names)?.actor).toBe("A plugin");
  });

  it("says plainly that a Stop while the run waited put the task back (#21407)", () => {
    const details = { status: "todo", previousStatus: "in_progress", reason: "stopped_while_waiting", _previous: { status: "in_progress" } };
    expect(activityLine(updated({ actorName: "Board", details }), names)).toEqual({
      actor: "Board",
      text: "stopped the run before it started, so nobody is working on it now",
      status: { from: "in_progress", to: "todo" },
    });
  });
});
