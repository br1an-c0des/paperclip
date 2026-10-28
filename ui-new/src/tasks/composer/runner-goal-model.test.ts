import type { RunnerGoalCapability, RunnerGoalProjection, RunnerGoalSnapshot } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { formatDuration, formatTokens, goalActions, goalFromComposer, liveGoalUpdate, parseGoalCommand, progressParts, unfinishedGoal } from "./runner-goal-model";

const capability = (overrides: Partial<RunnerGoalCapability> = {}): RunnerGoalCapability => ({
  availability: "available",
  verified: false,
  actions: ["set", "pause", "resume", "clear"],
  autonomousUpdates: true,
  persistentAcrossResume: true,
  maxObjectiveChars: 4000,
  tokenBudgetControl: true,
  usageReporting: true,
  ...overrides,
});

const snapshot = (overrides: Partial<RunnerGoalSnapshot> = {}): RunnerGoalSnapshot => ({
  objective: "Ship the release",
  status: "active",
  tokenBudget: null,
  tokensUsed: 12_345,
  elapsedSeconds: 3_725,
  iterations: 3,
  lastReason: null,
  createdAt: null,
  updatedAt: null,
  completedAt: null,
  workingNow: false,
  ...overrides,
});

const projection = (overrides: Partial<RunnerGoalProjection> = {}): RunnerGoalProjection => ({
  issueId: "t1",
  agentId: "a1",
  adapterType: "paperclip_runner",
  sessionId: null,
  capability: capability(),
  goal: snapshot(),
  workingNow: false,
  activeRunId: null,
  pendingAction: null,
  revision: 4,
  observedAt: null,
  ...overrides,
});

describe("parseGoalCommand", () => {
  it("reads an objective, a bare /goal and the subcommands", () => {
    expect(parseGoalCommand("/goal Ship the release")).toEqual({ matched: true, command: { action: "create", objective: "Ship the release" } });
    expect(parseGoalCommand("  /goal  ")).toEqual({ matched: true, command: { action: "focus" } });
    expect(parseGoalCommand("/goal pause")).toEqual({ matched: true, command: { action: "pause" } });
    expect(parseGoalCommand("/goal clear now")).toEqual({ matched: true, error: "/goal clear doesn't take anything after it." });
  });

  it("leaves other messages alone", () => {
    expect(parseGoalCommand("Ship /goal later")).toEqual({ matched: false });
    expect(parseGoalCommand("/goals are fun")).toEqual({ matched: false });
  });
});

describe("goalFromComposer", () => {
  it("is an ordinary message without the pill or /goal", () => {
    expect(goalFromComposer({ body: "Hello", goalMode: false, attachmentCount: 0 })).toBeNull();
  });

  it("turns the text into an objective with the Goal pill on", () => {
    expect(goalFromComposer({ body: " Keep the tests green ", goalMode: true, attachmentCount: 0 })).toEqual({ ok: true, command: { action: "create", objective: "Keep the tests green" } });
  });

  it("asks for an objective and refuses files", () => {
    expect(goalFromComposer({ body: "  ", goalMode: true, attachmentCount: 0 })).toMatchObject({ ok: false });
    expect(goalFromComposer({ body: "/goal Ship", goalMode: false, attachmentCount: 1 })).toMatchObject({ ok: false, problem: expect.stringContaining("files") });
    expect(goalFromComposer({ body: "x".repeat(4001), goalMode: true, attachmentCount: 0 })).toMatchObject({ ok: false, problem: expect.stringContaining("4,000") });
  });
});

describe("goalActions", () => {
  it("offers what the runner can do for the goal's state", () => {
    expect(goalActions(projection())).toEqual({ edit: true, pause: true, resume: false, clear: true });
    expect(goalActions(projection({ goal: snapshot({ status: "paused" }) }))).toEqual({ edit: true, pause: false, resume: true, clear: true });
  });

  it("offers nothing when the runner can't, or there's no goal", () => {
    expect(goalActions(projection({ capability: capability({ actions: ["set", "clear"] }), goal: snapshot({ status: "paused" }) }))).toEqual({ edit: true, pause: false, resume: false, clear: true });
    expect(goalActions(projection({ capability: capability({ availability: "unsupported" }) }))).toEqual({ edit: false, pause: false, resume: false, clear: false });
    expect(goalActions(projection({ goal: null }))).toEqual({ edit: false, pause: false, resume: false, clear: false });
  });

  it("treats only an unfinished goal as one to replace", () => {
    expect(unfinishedGoal(projection())).toBe(true);
    expect(unfinishedGoal(projection({ goal: snapshot({ status: "complete" }) }))).toBe(false);
  });
});

describe("liveGoalUpdate", () => {
  const scope = { taskId: "t1", agentId: "a1" };
  it("takes a newer goal for this task and agent", () => {
    expect(liveGoalUpdate(projection(), projection({ revision: 5 }), scope)).toBe("take");
    expect(liveGoalUpdate(undefined, projection(), scope)).toBe("take");
  });
  it("refetches after skipped revisions and ignores others", () => {
    expect(liveGoalUpdate(projection(), projection({ revision: 7 }), scope)).toBe("refetch");
    expect(liveGoalUpdate(projection(), projection({ revision: 3 }), scope)).toBe("ignore");
    expect(liveGoalUpdate(projection(), projection({ issueId: "t2", revision: 5 }), scope)).toBe("ignore");
    expect(liveGoalUpdate(projection(), projection({ agentId: "a2", revision: 5 }), scope)).toBe("ignore");
  });
});

describe("progress", () => {
  it("formats time, tokens and turns", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(3_725)).toBe("1h 2m");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(progressParts(snapshot({ tokenBudget: 50_000 }), capability())).toEqual(["1h 2m", "12k of 50k tokens", "3 turns"]);
    expect(progressParts(snapshot({ iterations: 0 }), capability({ usageReporting: false }))).toEqual(["1h 2m"]);
  });
});
