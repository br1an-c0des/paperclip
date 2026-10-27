import type { ExecutionProjection } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { runNextAction } from "./TaskRuns";

const execution = (nextAction: string | null) => ({ nextAction }) as ExecutionProjection;

describe("runNextAction", () => {
  it("reads the execution projection's next action first", () => {
    expect(runNextAction({ execution: execution("Answer the question"), nextAction: "Old advice" })).toBe("Answer the question");
  });

  it("keeps a projection's silence rather than the run's older advice", () => {
    expect(runNextAction({ execution: execution(null), nextAction: "Old advice" })).toBeNull();
  });

  it("falls back to the run's own next action without a projection", () => {
    expect(runNextAction({ execution: null, nextAction: "Retry later" })).toBe("Retry later");
    expect(runNextAction({})).toBeNull();
  });
});
