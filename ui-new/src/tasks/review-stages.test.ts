import type { IssueExecutionPolicy, IssueExecutionState } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  boardMonitor,
  buildPolicy,
  executionStatus,
  nextRunnableStage,
  readPolicy,
  reviewSentence,
  stageKeys,
  toDateTimeLocal,
  toggleKey,
  withMonitor,
} from "./review-stages";

const names: Record<string, string> = { "agent:sam": "Sam", "agent:alex": "Alex", "user:lee": "Lee", "user:me": "You" };
const nameOf = (key: string) => names[key] ?? key;

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

const policy: IssueExecutionPolicy = {
  mode: "normal",
  commentRequired: true,
  stages: [
    { id: "stage-r", type: "review", approvalsNeeded: 1, participants: [{ id: "p-sam", type: "agent", agentId: "sam", userId: null }] },
    { id: "stage-a", type: "approval", approvalsNeeded: 1, participants: [{ id: "p-alex", type: "agent", agentId: "alex", userId: null }] },
  ],
};

function state(extra: Partial<IssueExecutionState>): IssueExecutionState {
  return {
    status: "pending",
    currentStageId: "stage-r",
    currentStageIndex: 0,
    currentStageType: "review",
    currentParticipant: { type: "agent", agentId: "sam", userId: null },
    returnAssignee: null,
    reviewRequest: null,
    completedStageIds: [],
    lastDecisionId: null,
    lastDecisionOutcome: null,
    ...extra,
  };
}

describe("reviewSentence", () => {
  it("says who reviews and who approves, in order", () => {
    expect(reviewSentence(policy, nameOf)).toBe("When it's done, Sam reviews, then Alex approves");
  });

  it("speaks to you, and names any one of several", () => {
    const mine = buildPolicy(null, ["user:me"], ["agent:sam", "agent:alex", "user:lee"], ids());
    expect(reviewSentence(mine, nameOf)).toBe("When it's done, you review, then Sam, Alex or Lee approves");
  });

  it("is null without stages", () => {
    expect(reviewSentence(null, nameOf)).toBeNull();
    expect(reviewSentence({ ...policy, stages: [] }, nameOf)).toBeNull();
  });
});

describe("buildPolicy", () => {
  it("keeps the ids of stages and participants that stay", () => {
    const next = buildPolicy(policy, ["agent:sam", "user:lee"], ["agent:alex"], ids());
    expect(next?.stages[0]).toEqual({
      id: "stage-r",
      type: "review",
      approvalsNeeded: 1,
      participants: [
        { id: "p-sam", type: "agent", agentId: "sam", userId: null },
        { id: "id-1", type: "user", agentId: null, userId: "lee" },
      ],
    });
    expect(next?.stages[1]?.id).toBe("stage-a");
  });

  it("drops an emptied stage, and clears a policy with nothing left", () => {
    expect(buildPolicy(policy, [], ["agent:alex"], ids())?.stages.map((stage) => stage.type)).toEqual(["approval"]);
    expect(buildPolicy(policy, [], [], ids())).toBeNull();
  });

  it("keeps the rest of the policy, such as a monitor, even with no stages", () => {
    const monitor = { nextCheckAt: "2026-10-27T10:00:00.000Z", notes: null, scheduledBy: "board" as const };
    const next = buildPolicy({ ...policy, mode: "auto", monitor }, [], [], ids());
    expect(next).toEqual({ mode: "auto", commentRequired: true, stages: [], monitor });
  });

  it("starts a new policy in normal mode, and ignores duplicates", () => {
    expect(buildPolicy(null, ["agent:sam", "agent:sam"], [], ids())).toEqual({
      mode: "normal",
      commentRequired: true,
      stages: [{ id: "id-2", type: "review", approvalsNeeded: 1, participants: [{ id: "id-1", type: "agent", agentId: "sam", userId: null }] }],
    });
  });

  it("refuses to overwrite a policy it can't read", () => {
    expect(readPolicy({ stages: "nope" })).toEqual({ ok: false });
    expect(() => buildPolicy({ stages: [{ type: "review" }] }, [], [], ids())).toThrow();
    expect(stageKeys({ stages: "nope" }, "review")).toEqual([]);
  });
});

describe("executionStatus", () => {
  it("names the stage under way and who has it", () => {
    expect(executionStatus(state({}), nameOf)).toBe("Review pending with Sam");
    expect(executionStatus(state({ currentStageType: "approval", currentParticipant: { type: "user", userId: "me" } }), nameOf)).toBe(
      "Approval pending with you",
    );
    expect(executionStatus(state({ status: "changes_requested" }), nameOf)).toBe("Sam asked for changes in review");
  });

  it("is null when no stage is under way", () => {
    expect(executionStatus(null, nameOf)).toBeNull();
    expect(executionStatus(state({ status: "completed", currentStageType: null }), nameOf)).toBeNull();
  });
});

describe("nextRunnableStage", () => {
  it("offers the first stage before any has started, and the one that asked for changes", () => {
    expect(nextRunnableStage(policy, null)).toBe("review");
    expect(nextRunnableStage(buildPolicy(null, [], ["agent:alex"], ids()), null)).toBe("approval");
    expect(nextRunnableStage(policy, state({ status: "changes_requested", currentStageType: "approval" }))).toBe("approval");
  });

  it("offers nothing while a stage is pending, or without stages", () => {
    expect(nextRunnableStage(policy, state({}))).toBeNull();
    expect(nextRunnableStage(null, null)).toBeNull();
  });
});

describe("monitor", () => {
  const monitor = { nextCheckAt: "2026-10-27T10:00:00.000Z", notes: "Check the deploy", scheduledBy: "board" as const };

  it("adds a monitor beside the stages, keeping their ids", () => {
    const next = withMonitor(policy, monitor, ids());
    expect(next?.monitor).toEqual(monitor);
    expect(next?.stages.map((stage) => stage.id)).toEqual(["stage-r", "stage-a"]);
  });

  it("starts a policy for a monitor alone, and clears it when the monitor goes", () => {
    expect(withMonitor(null, monitor, ids())).toEqual({ mode: "normal", commentRequired: true, stages: [], monitor });
    expect(withMonitor({ mode: "normal", commentRequired: true, stages: [], monitor }, null, ids())).toBeNull();
    expect(withMonitor({ ...policy, monitor }, null, ids())).not.toHaveProperty("monitor");
  });

  it("builds a board monitor from the form", () => {
    expect(boardMonitor({ at: "", notes: "", service: "" })).toBeNull();
    const built = boardMonitor({ at: "2026-10-27T10:00", notes: " Re-check ", service: " Vercel " });
    expect(built).toMatchObject({ notes: "Re-check", scheduledBy: "board", kind: "external_service", serviceName: "Vercel", externalRef: null });
    expect(boardMonitor({ at: "2026-10-27T10:00", notes: "", service: "" })).toMatchObject({ kind: null, serviceName: null, notes: null });
  });

  it("formats a date for a datetime-local field", () => {
    expect(toDateTimeLocal(new Date(2026, 9, 27, 9, 5))).toBe("2026-10-27T09:05");
    expect(toDateTimeLocal(null)).toBe("");
  });
});

describe("toggleKey", () => {
  it("ticks and unticks", () => {
    expect(toggleKey(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleKey(["a", "b"], "a")).toEqual(["b"]);
  });
});
