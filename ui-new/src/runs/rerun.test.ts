import { describe, expect, it } from "vitest";
import { runPath } from "@/api/runs";
import { canResumeRun, canRetryRun, resumePayload, retryOutcome, runTaskPayload } from "./run-model";

const run = (status: string, errorCode: string | null = null, execution: { phase: string; successorRunId: string | null } | null = null) => ({
  id: "run-1",
  status,
  errorCode,
  execution,
  contextSnapshot: { issueId: "issue-1", taskKey: "TRA-41", wakeCommentId: "comment-9", other: 3, taskId: "" },
});

describe("Retry and Resume", () => {
  it("offers Resume for a lost process, and Retry for other failures", () => {
    expect(canResumeRun(run("failed", "process_lost"))).toBe(true);
    expect(canRetryRun(run("failed", "process_lost"))).toBe(false);
    expect(canRetryRun(run("failed", "adapter_failed"))).toBe(true);
    expect(canRetryRun(run("timed_out"))).toBe(true);
  });

  it("offers neither for runs that succeeded, are going, or recovery has taken over", () => {
    for (const status of ["succeeded", "running", "queued", "cancelled"]) {
      expect(canRetryRun(run(status))).toBe(false);
      expect(canResumeRun(run(status))).toBe(false);
    }
    expect(canRetryRun(run("failed", null, { phase: "recovery_needed", successorRunId: null }))).toBe(false);
    expect(canRetryRun(run("failed", null, { phase: "failed", successorRunId: "run-2" }))).toBe(false);
  });

  it("wakes the agent on the run's task, and Resume names the lost run and the comment that woke it", () => {
    expect(runTaskPayload(run("failed"))).toEqual({ issueId: "issue-1", taskKey: "TRA-41" });
    expect(resumePayload(run("failed", "process_lost"))).toEqual({
      resumeFromRunId: "run-1",
      issueId: "issue-1",
      taskKey: "TRA-41",
      commentId: "comment-9",
    });
  });
});

describe("retryOutcome", () => {
  it("opens the new run", () => {
    expect(retryOutcome({ id: "run-2", status: "queued" })).toEqual({ runId: "run-2", issueId: null });
  });

  it("says when a repeated click found a retry that already stopped", () => {
    expect(retryOutcome({ id: "run-2", status: "failed" })).toHaveProperty("error");
  });

  it("accepts a retry the task starts later, and reports one that couldn't start", () => {
    expect(retryOutcome({ actionId: "a1", issueId: "issue-1", runId: null, status: "deferred" })).toEqual({ runId: null, issueId: "issue-1" });
    expect(retryOutcome({ actionId: "a1", issueId: "issue-1", runId: null, status: "cancelled" })).toHaveProperty("error");
  });

  it("passes on why a skipped retry didn't start", () => {
    expect(retryOutcome({ status: "skipped", message: "The agent is paused." })).toEqual({ error: "The agent is paused." });
    expect(retryOutcome({ status: "skipped", message: null })).toEqual({ error: "Retry was skipped." });
  });
});

describe("runPath", () => {
  it("is the old UI's run route", () => {
    expect(runPath("TRA", "quant-researcher", "run-1")).toBe("/TRA/agents/quant-researcher/runs/run-1");
  });
});
