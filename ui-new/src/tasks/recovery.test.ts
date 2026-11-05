import type { TaskInterruptionPresentation } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { pauseDetail, retryCountdown, taskNotices, type NoticeInput } from "./recovery";

function interruption(extra: Partial<TaskInterruptionPresentation>): TaskInterruptionPresentation {
  return {
    intentId: null,
    responsibility: "system",
    state: "failed",
    nextRetryAt: null,
    canRetry: true,
    userAction: null,
    sourceRunIds: ["run-1"],
    observedRunId: "run-1",
    ...extra,
  };
}

function input(extra: Partial<Omit<NoticeInput, "task">> & { task?: Partial<NoticeInput["task"]> } = {}): NoticeInput {
  return {
    hasSubtasks: false,
    ...extra,
    task: { status: "in_progress", hiddenAt: null, interruption: null, ...extra.task },
  };
}

const kinds = (value: NoticeInput) => taskNotices(value).map((notice) => notice.kind);

describe("taskNotices", () => {
  it("shows nothing for a healthy task", () => {
    expect(taskNotices(input())).toEqual([]);
    expect(kinds(input({ task: { interruption: interruption({ state: "working" }) } }))).toEqual([]);
  });

  it("offers Retry on a failed attempt when the server allows it", () => {
    expect(taskNotices(input({ task: { interruption: interruption({}) } }))).toEqual([
      { kind: "interrupted", state: "failed", canRetry: true, nextRetryAt: null, workspaceFailure: null, retryWait: null, recoveryStep: null },
    ]);
    const scheduled = interruption({ state: "retry_scheduled", nextRetryAt: "2026-10-26T10:00:40.000Z" });
    expect(taskNotices(input({ task: { interruption: scheduled } }))[0]).toMatchObject({ kind: "interrupted", state: "retry_scheduled" });
  });

  it("explains a project access denial, and offers Retry only once access is added", () => {
    const denied = interruption({
      responsibility: "user",
      state: "waiting_for_user",
      userAction: "project_access",
      projectAccess: { agentId: "a1", projectId: "p1", ready: false },
    });
    expect(taskNotices(input({ task: { interruption: denied } }))).toEqual([
      { kind: "project-access", agentId: "a1", projectId: "p1", ready: false, canRetry: false },
    ]);
    const ready = interruption({ projectAccess: { agentId: "a1", projectId: "p1", ready: true } });
    expect(taskNotices(input({ task: { interruption: ready } }))[0]).toMatchObject({ kind: "project-access", ready: true, canRetry: true });
  });

  it("says what a wait needs", () => {
    const waiting = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "choose_model", canRetry: false });
    expect(taskNotices(input({ task: { interruption: waiting } }))).toEqual([{ kind: "waiting", action: "choose_model" }]);
  });

  it("offers Resume where a tree pause was made", () => {
    const tree = { activePauseHold: { holdId: "h1", rootIssueId: "t1", issueId: "t1", isRoot: true, mode: "pause" as const, reason: null, releasePolicy: null } };
    expect(taskNotices(input({ tree, hasSubtasks: true }))).toEqual([{ kind: "tree-paused", scope: "subtree", isRoot: true, rootIssueId: "t1" }]);
    const inherited = { activePauseHold: { ...tree.activePauseHold, issueId: "t2", isRoot: false } };
    expect(taskNotices(input({ tree: inherited }))[0]).toMatchObject({ scope: "leaf", isRoot: false });
  });

  it("offers Resume agent for a paused assignee, but not after a budget stop or once the task is done", () => {
    const agent = { id: "a1", name: "Sam", status: "paused" as const, pauseReason: "manual" as const };
    expect(taskNotices(input({ assignee: agent }))[0]).toMatchObject({ kind: "agent-paused", canResume: true });
    expect(taskNotices(input({ assignee: { ...agent, pauseReason: "budget" } }))[0]).toMatchObject({ canResume: false });
    expect(taskNotices(input({ assignee: agent, task: { status: "done" } }))).toEqual([]);
  });

  it("names a paused project when that's what holds the task, and nothing twice", () => {
    const resume = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "resume", canRetry: false });
    expect(taskNotices(input({ task: { interruption: resume }, project: { name: "Web", pausedAt: new Date() } }))).toEqual([
      { kind: "project-paused", projectName: "Web" },
    ]);
    expect(kinds(input({ task: { interruption: resume } }))).toEqual(["paused"]);
    const agent = { id: "a1", name: "Sam", status: "paused" as const, pauseReason: null };
    expect(kinds(input({ task: { interruption: resume }, assignee: agent }))).toEqual(["agent-paused"]);
  });

  it("doesn't call a setup draft paused, and links to Finish setup once its computer is ready (#19322)", () => {
    const draft = { id: "a1", name: "Sam", status: "paused" as const, pauseReason: "setup" as const, lifecycleState: "preparing" as const };
    expect(taskNotices(input({ assignee: draft }))).toEqual([{ kind: "agent-setup", agentId: "a1", agentName: "Sam", preparing: true }]);
    expect(taskNotices(input({ assignee: { ...draft, lifecycleState: "paused" } }))[0]).toMatchObject({ kind: "agent-setup", preparing: false });
    expect(taskNotices(input({ assignee: { ...draft, lifecycleState: "verifying" } }))[0]).toMatchObject({ kind: "agent-setup", preparing: false });
    // It stands in for the generic paused notice too.
    const resume = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "resume", canRetry: false });
    expect(kinds(input({ task: { interruption: resume }, assignee: draft }))).toEqual(["agent-setup"]);
  });

  it("offers no Resume for a company archive pause, and only says 'by hand' for a manual one", () => {
    const agent = { id: "a1", name: "Sam", status: "paused" as const, pauseReason: "company_archived" as const };
    expect(taskNotices(input({ assignee: agent }))[0]).toMatchObject({ kind: "agent-paused", canResume: false });
    expect(pauseDetail("company_archived")).toBe("It was paused because its company is archived.");
    expect(pauseDetail("manual")).toBe("It was paused by hand.");
    expect(pauseDetail(null)).toBe("");
  });

  it("marks a hidden task", () => {
    expect(kinds(input({ task: { hiddenAt: new Date() } }))).toEqual(["hidden"]);
  });
});

describe("retryCountdown", () => {
  it("counts seconds, then minutes", () => {
    const now = Date.parse("2026-10-26T10:00:00.000Z");
    expect(retryCountdown("2026-10-26T10:00:40.000Z", now)).toBe("Trying again in 40s");
    expect(retryCountdown("2026-10-26T10:02:30.000Z", now)).toBe("Trying again in 3m");
    expect(retryCountdown(null, now)).toBe("Trying again soon");
  });
});

describe("provider and workspace failures", () => {
  const providerFailure = {
    schema: "paperclip.provider-failure.v1",
    provider: "openai",
    phase: "startup",
    category: "authentication",
    message: "Invalid API key",
    httpStatus: 401,
    retryability: "requires_action",
  } as const;

  it("shows a provider's refusal in place of the plain interruption, or of the wait it caused", () => {
    expect(taskNotices(input({ task: { interruption: interruption({ providerFailure }) } }))).toEqual([
      { kind: "provider-failure", failure: providerFailure, state: "failed", canRetry: true, nextRetryAt: null, recoveryStep: null },
    ]);
    const waiting = interruption({ providerFailure, responsibility: "user", state: "waiting_for_user", userAction: "reconnect", canRetry: false });
    expect(kinds(input({ task: { interruption: waiting } }))).toEqual(["provider-failure"]);
    expect(kinds(input({ task: { interruption: interruption({ providerFailure, state: "working" }) } }))).toEqual([]);
  });

  it("ignores a provider failure that isn't in the server's shape", () => {
    const broken = { ...providerFailure, schema: "something-else" } as never;
    expect(kinds(input({ task: { interruption: interruption({ providerFailure: broken }) } }))).toEqual(["interrupted"]);
  });

  it("carries the reason the task's folders couldn't be prepared", () => {
    const notices = taskNotices(input({ task: { interruption: interruption({ workspaceFailure: { message: "No space left" } }) } }));
    expect(notices[0]).toMatchObject({ kind: "interrupted", workspaceFailure: "No space left" });
  });

  it("keeps the project access notice first", () => {
    const access = interruption({ providerFailure, projectAccess: { agentId: "a1", projectId: "p1", ready: false } });
    expect(kinds(input({ task: { interruption: access } }))).toEqual(["project-access"]);
  });

  it("shows a persisted Retry wait over the provider's refusal (#18845)", () => {
    const waited = interruption({ providerFailure, retryWait: { reason: "budget", message: "Retry is waiting for the budget to allow it." }, canRetry: false });
    expect(taskNotices(input({ task: { interruption: waited } }))).toEqual([
      {
        kind: "interrupted",
        state: "failed",
        canRetry: false,
        nextRetryAt: null,
        workspaceFailure: null,
        retryWait: "Retry is waiting for the budget to allow it.",
        recoveryStep: null,
      },
    ]);
  });
});

describe("saved-work recovery", () => {
  it("names the step while it works, and before a scheduled retry (#19260)", () => {
    const working = interruption({ state: "working", recoveryStep: "saving_previous_files" });
    expect(taskNotices(input({ task: { interruption: working } }))).toEqual([{ kind: "recovering", step: "Saving files from the previous attempt" }]);
    const scheduled = interruption({ state: "retry_scheduled", nextRetryAt: "2026-10-26T10:00:40.000Z", recoveryStep: "checking_previous_run", canRetry: false });
    expect(taskNotices(input({ task: { interruption: scheduled } }))[0]).toMatchObject({
      kind: "interrupted",
      state: "retry_scheduled",
      canRetry: false,
      recoveryStep: "Checking that the previous attempt stopped",
    });
    // A step on a failed attempt isn't shown: the failure is what to read.
    expect(taskNotices(input({ task: { interruption: interruption({ recoveryStep: "finishing_recovery" }) } }))[0]).toMatchObject({ recoveryStep: null });
  });

  it("drops Retry under a native export hold, where Recover saved files takes its place (#18848)", () => {
    const executionBlocker = {
      recoveryActionId: "ra1",
      runId: "run-1",
      agentId: "a1",
      cause: "native_workspace_sync_out_retry_exhausted",
      nextAction: "Recover the files",
      workspaceRepairRequired: true,
    };
    expect(taskNotices(input({ task: { interruption: interruption({}), executionBlocker } }))[0]).toMatchObject({ kind: "interrupted", canRetry: false });
    expect(taskNotices(input({ task: { interruption: interruption({}), executionBlocker: { ...executionBlocker, cause: "other" } } }))[0]).toMatchObject({
      canRetry: true,
    });
  });
});
