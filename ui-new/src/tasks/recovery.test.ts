import type { TaskInterruptionPresentation } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { retryCountdown, taskNotices, type NoticeInput } from "./recovery";

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
      { kind: "interrupted", state: "failed", canRetry: true, nextRetryAt: null },
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
