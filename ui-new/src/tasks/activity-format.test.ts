import type { ActivityEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { activityLine, executionWaitText } from "./activity-format";

const names = { agent: () => undefined, person: (id: string) => `User ${id}`, youId: () => "u1" };

const event = (details: Record<string, unknown>) =>
  ({ action: "issue.execution_waiting", details, actorType: "system", actorId: "execution-admission", agentId: "a1" }) as unknown as ActivityEvent;

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
