import type { IssueBlockerStalledWakeContext, TaskInterruptionPresentation } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  budgetWaitText,
  modelRetryOf,
  pauseDetail,
  rejectedModelText,
  setupFailureText,
  waitingText,
  WAITING_TEXT,
  resumeCountdown,
  retryCountdown,
  retryWaitBlockers,
  retryWaitTitle,
  scheduledLine,
  stalledDependencyRows,
  stalledDependencyTitle,
  taskNotices,
  type NoticeInput,
} from "./recovery";

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
      { kind: "interrupted", state: "failed", canRetry: true, nextRetryAt: null, workspaceFailure: null, setupFailure: null, retryWait: null, recoveryStep: null, resuming: false },
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

  it("shows a waiting continuation with Move it forward now, ahead of a Retry wait, and no failure (#21373)", () => {
    const waiting = interruption({ state: "working", retryAction: "move_forward", canRetry: true });
    expect(taskNotices(input({ task: { interruption: waiting } }))).toEqual([{ kind: "move-forward", canRetry: true }]);
    const held = interruption({ state: "working", retryAction: "move_forward", canRetry: true, retryWait: { reason: "budget.blocked", message: "Waiting for the budget." } });
    expect(kinds(input({ task: { interruption: held } }))).toEqual(["move-forward"]);
    // Once a person asked (or before 15 minutes), the server drops the offer: nothing to show.
    expect(kinds(input({ task: { interruption: interruption({ state: "working", retryAction: "move_forward", canRetry: false }) } }))).toEqual([]);
    // A saved-work step still reads first.
    const recovering = interruption({ state: "working", retryAction: "move_forward", canRetry: true, recoveryStep: "saving_previous_files" });
    expect(kinds(input({ task: { interruption: recovering } }))).toEqual(["recovering"]);
  });

  it("offers Try again on the failed run of a rejected model, by the task's assignee (#21244)", () => {
    const rejected = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "choose_model", canRetry: false, rejectedModel: "bad/model" });
    expect(taskNotices(input({ task: { interruption: rejected, assigneeAgentId: "agent-1" } }))).toEqual([
      { kind: "waiting", action: "choose_model", rejectedModel: "bad/model", attempted: true, modelRetry: { runId: "run-1", agentId: "agent-1" } },
    ]);
    expect(modelRetryOf(rejected, null)).toBeNull();
    expect(modelRetryOf({ ...rejected, observedRunId: null }, "agent-1")).toBeNull();
    // The task's own Retry, when the server offers one, is the way on instead.
    expect(modelRetryOf({ ...rejected, canRetry: true }, "agent-1")).toBeNull();
    expect(modelRetryOf({ ...rejected, userAction: "reconnect" }, "agent-1")).toBeNull();
  });

  it("says what a wait needs", () => {
    const waiting = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "choose_model", canRetry: false });
    expect(taskNotices(input({ task: { interruption: waiting } }))).toEqual([{ kind: "waiting", action: "choose_model", rejectedModel: null, attempted: true, modelRetry: null }]);
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

  it("tells a pause's stop once, with the task in its own status (#20143, #20281)", () => {
    // New todo work for a manually paused agent waits: the task stays todo, with Resume agent.
    const resume = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "resume", canRetry: false });
    const manual = { id: "a1", name: "Sam", status: "paused" as const, pauseReason: "manual" as const };
    expect(taskNotices(input({ task: { status: "todo", interruption: resume }, assignee: manual }))).toEqual([
      { kind: "agent-paused", agentId: "a1", agentName: "Sam", reason: "manual", canResume: true },
    ]);
    // A budget stop keeps the task in progress; the paused notice says it, not a second budget line.
    const budget = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "budget", canRetry: false });
    expect(kinds(input({ task: { interruption: budget }, assignee: { ...manual, pauseReason: "budget" } }))).toEqual(["agent-paused"]);
    // A budget hold elsewhere (the company's or project's) still says what's needed.
    expect(kinds(input({ task: { interruption: budget }, assignee: { ...manual, status: "active" as never, pauseReason: null } }))).toEqual(["waiting"]);
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
      {
        kind: "provider-failure",
        failure: providerFailure,
        state: "failed",
        canRetry: true,
        nextRetryAt: null,
        recoveryStep: null,
        resuming: false,
        rejectedModel: null,
        budgetWait: false,
        modelRetry: null,
      },
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
        setupFailure: null,
        retryWait: "Retry is waiting for the budget to allow it.",
        recoveryStep: null,
        resuming: false,
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
    // Retry stays when the card offers no way on itself: a source that didn't verify (#19840).
    expect(taskNotices(input({ task: { interruption: interruption({}), executionBlocker }, recoveryOwnsRetry: false }))[0]).toMatchObject({ canRetry: true });
    expect(taskNotices(input({ task: { interruption: interruption({}), executionBlocker }, recoveryOwnsRetry: true }))[0]).toMatchObject({ canRetry: false });
  });
});

describe("a pending native resume (#19503)", () => {
  it("reads as resuming with its time, not a competing Retry", () => {
    const resume = interruption({ state: "retry_scheduled", nextRetryAt: "2026-11-06T15:26:18.687Z", canRetry: false });
    expect(taskNotices(input({ task: { interruption: resume } }))[0]).toMatchObject({ kind: "interrupted", state: "retry_scheduled", canRetry: false, resuming: true });
    // An ordinary scheduled retry keeps Retry now, and a saved-work step names itself instead.
    expect(taskNotices(input({ task: { interruption: { ...resume, canRetry: true } } }))[0]).toMatchObject({ resuming: false, canRetry: true });
    expect(taskNotices(input({ task: { interruption: { ...resume, recoveryStep: "checking_previous_run" } } }))[0]).toMatchObject({ resuming: false });
    expect(resumeCountdown("2026-11-06T15:26:18.687Z", Date.parse("2026-11-06T15:25:50.000Z"))).toBe("Resuming in 29s");
    expect(resumeCountdown("2026-11-06T15:30:18.687Z", Date.parse("2026-11-06T15:25:50.000Z"))).toBe("Resuming in 5m");
  });

  it("reads as resuming under a provider's refusal too, by the same rule", () => {
    const providerFailure = { schema: "paperclip.provider-failure.v1", provider: "anthropic", phase: "turn", category: "overloaded", message: "Overloaded", retryability: "transient" } as const;
    const resume = interruption({ state: "retry_scheduled", nextRetryAt: "2026-11-06T15:26:18.687Z", canRetry: false, providerFailure });
    const [notice] = taskNotices(input({ task: { interruption: resume } }));
    expect(notice).toMatchObject({ kind: "provider-failure", canRetry: false, resuming: true });
    const now = Date.parse("2026-11-06T15:25:50.000Z");
    expect(scheduledLine(notice as Extract<typeof notice, { kind: "provider-failure" }>, now)).toBe("Resuming in 29s by itself.");
    expect(scheduledLine({ nextRetryAt: "2026-11-06T15:26:18.687Z", recoveryStep: null, resuming: false }, now)).toBe("Trying again in 29s by itself.");
    expect(scheduledLine({ nextRetryAt: "2026-11-06T15:26:18.687Z", recoveryStep: "Saving files from the previous attempt", resuming: false }, now)).toBe(
      "Saving files from the previous attempt. Trying again in 29s…",
    );
    expect(taskNotices(input({ task: { interruption: { ...resume, canRetry: true } } }))[0]).toMatchObject({ kind: "provider-failure", resuming: false });
  });

  it("asks an owner or admin to confirm the previous server stopped", () => {
    const waiting = interruption({ responsibility: "user", state: "waiting_for_user", userAction: "confirm_owner_stop", canRetry: false });
    expect(taskNotices(input({ task: { interruption: waiting } }))).toEqual([
      { kind: "waiting", action: "confirm_owner_stop", rejectedModel: null, attempted: true, modelRetry: null },
    ]);
  });
});

describe("since the 2026-11-10 sync", () => {
  const user = (extra: Partial<TaskInterruptionPresentation>) =>
    interruption({ responsibility: "user", state: "waiting_for_user", canRetry: false, ...extra });

  it("asks an owner or admin to confirm a run that never recorded its process stopped (#20310)", () => {
    const parked = user({
      userAction: "confirm_run_stopped",
      observedRunId: "run-9",
      retryWait: { reason: "process_identity_missing", message: "Paperclip can't verify the previous run stopped." },
    });
    expect(taskNotices(input({ task: { interruption: parked } }))).toEqual([
      { kind: "confirm-run-stopped", runId: "run-9", message: "Paperclip can't verify the previous run stopped." },
    ]);
    // The old UI's words when the server gives none.
    expect(taskNotices(input({ task: { interruption: user({ userAction: "confirm_run_stopped", observedRunId: "run-9" }) } }))[0]).toMatchObject({
      message: "Paperclip can't confirm that the previous run stopped. Your message is saved.",
    });
    // Without a run to confirm there's nothing to send: the plain wait.
    expect(kinds(input({ task: { interruption: user({ userAction: "confirm_run_stopped", observedRunId: null }) } }))).toEqual(["waiting"]);
  });

  it("names a failed workspace setup command (#20478)", () => {
    const setupFailure = {
      step: "workspace_provision",
      command: "pnpm install",
      exitCode: 1,
      output: "ERR_PNPM_NO_LOCKFILE",
      message: 'The project\'s workspace provision command "pnpm install" failed with exit code 1: ERR_PNPM_NO_LOCKFILE',
    } as const;
    const [notice] = taskNotices(input({ task: { interruption: interruption({ setupFailure }) } }));
    expect(notice).toMatchObject({ kind: "interrupted", setupFailure });
    expect(setupFailureText(setupFailure)).toBe(
      'Couldn\'t set up the task workspace. The project\'s workspace provision command "pnpm install" failed with exit code 1: ERR_PNPM_NO_LOCKFILE. Fix the command in the project\'s workspace settings, then retry.',
    );
    expect(setupFailureText({ message: "It failed." }, "Trying again in 40s")).toBe("It failed. Trying again in 40s…");
  });

  it("names the model the provider rejected (#20488)", () => {
    const rejected = user({ userAction: "choose_model", rejectedModel: "gpt-9" });
    const [notice] = taskNotices(input({ task: { interruption: rejected } }));
    expect(notice).toMatchObject({ kind: "waiting", rejectedModel: "gpt-9" });
    expect(waitingText(notice as never)).toBe('The provider rejected the model "gpt-9". Choose a supported model or clear the task\'s model override, then retry.');
    expect(waitingText({ action: "choose_model", rejectedModel: null, attempted: true })).toBe(WAITING_TEXT.choose_model);
    expect(rejectedModelText("gpt-9")).toContain('"gpt-9"');
  });

  it("words a budget hold by whether an attempt ran, and keeps it under a provider's refusal (#20338)", () => {
    expect(waitingText({ action: "budget", rejectedModel: null, attempted: true })).toBe(
      "Couldn't finish this attempt. Your message is saved. It's waiting for the budget to allow new work. Raise the budget in Costs.",
    );
    const fresh = user({ userAction: "budget", observedRunId: null, sourceRunIds: [] });
    expect(taskNotices(input({ task: { interruption: fresh } }))).toEqual([{ kind: "waiting", action: "budget", rejectedModel: null, attempted: false, modelRetry: null }]);
    expect(budgetWaitText(false)).toBe("This task hasn't started. It's waiting for the budget to allow new work. Raise the budget in Costs.");
    const providerFailure = {
      schema: "paperclip.provider-failure.v1",
      provider: "openai",
      phase: "turn",
      category: "rate_limit",
      message: "Too many requests",
      retryability: "transient",
    } as const;
    expect(taskNotices(input({ task: { interruption: user({ userAction: "budget", providerFailure }) } }))[0]).toMatchObject({
      kind: "provider-failure",
      budgetWait: true,
    });
  });

  it("points a parked setup check to the connection card, not Resume agent (#20361)", () => {
    for (const lifecycleState of ["preparing", "verifying", "resuming"] as const) {
      const assignee = { id: "a1", name: "Rae", status: "paused" as const, pauseReason: null, lifecycleState, lifecycleError: "Connect an account" };
      expect(taskNotices(input({ task: { status: "todo" }, assignee }))).toEqual([
        { kind: "agent-checking", agentId: "a1", agentName: "Rae", error: "Connect an account" },
      ]);
    }
    // An operator pause still offers Resume agent.
    const manual = { id: "a1", name: "Rae", status: "paused" as const, pauseReason: "manual" as const, lifecycleState: "verifying" as const };
    expect(taskNotices(input({ task: { status: "todo" }, assignee: manual }))[0]).toMatchObject({ kind: "agent-paused", canResume: true });
  });
});

const blocker = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id, identifier: id.toUpperCase(), title: `Task ${id}`, status, priority: "medium", assigneeAgentId: null, assigneeUserId: null, ...extra }) as never;

describe("a saved Retry waiting on its blockers (#20109)", () => {
  const message = "Retry is waiting on a blocked task this one depends on. Retry or unblock it; this task continues when it is done. Your Retry is saved.";
  const waiting = interruption({ state: "working", canRetry: false, retryWait: { reason: "dependency_blocked", message } });

  it("names the unfinished blockers, each with what to do, and offers no Retry of its own", () => {
    const blockedBy = [blocker("tes-1", "blocked"), blocker("tes-2", "cancelled"), blocker("tes-3", "done"), blocker("tes-4", "in_progress")];
    expect(taskNotices(input({ task: { interruption: waiting, blockedBy } }))).toEqual([
      {
        kind: "retry-waiting",
        reason: "dependency_blocked",
        message,
        blockers: [
          { id: "tes-1", identifier: "TES-1", title: "Task tes-1", locked: false, action: "Blocked: open it to Retry" },
          { id: "tes-2", identifier: "TES-2", title: "Task tes-2", locked: false, action: "Cancelled: remove or replace it" },
          { id: "tes-4", identifier: "TES-4", title: "Task tes-4", locked: false, action: "In progress" },
        ],
      },
    ]);
  });

  it("shows the finished ones still saving their files when nothing else is left", () => {
    const [notice] = taskNotices(input({ task: { interruption: waiting, blockedBy: [blocker("tes-3", "done")] } }));
    expect(notice).toMatchObject({ kind: "retry-waiting", blockers: [{ identifier: "TES-3", action: "Saving its files" }] });
  });

  it("shows a private blocker by its identifier only", () => {
    const blockedBy = [{ id: "p1", identifier: "TES-9", locked: true }, blocker("tes-3", "done")] as never;
    expect(retryWaitBlockers({ reason: "dependency_blocked" }, blockedBy)).toEqual([{ id: "p1", identifier: "TES-9", title: null, locked: true, action: null }]);
  });

  it("lists no blockers for another kind of wait, and calls a task that hasn't started waiting to start", () => {
    const budget = interruption({ state: "working", canRetry: false, retryWait: { reason: "budget.blocked", message: "Waiting for the budget to allow new work." } });
    const [notice] = taskNotices(input({ task: { interruption: budget, blockedBy: [blocker("tes-1", "blocked")] } }));
    expect(notice).toEqual({ kind: "retry-waiting", reason: "budget.blocked", message: "Waiting for the budget to allow new work.", blockers: [] });
    expect(retryWaitTitle(notice as never)).toBe("Waiting to start");
  });

  it("titles the wait by what it waits on", () => {
    const one = retryWaitBlockers({ reason: "dependency_blocked" }, [blocker("tes-1", "blocked")]);
    expect(retryWaitTitle({ reason: "dependency_blocked", blockers: one })).toBe("Retry is waiting on TES-1");
    const two = retryWaitBlockers({ reason: "dependency_blocked" }, [blocker("tes-1", "blocked"), blocker("tes-2", "todo")]);
    expect(retryWaitTitle({ reason: "dependency_blocked", blockers: two })).toBe("Retry is waiting on 2 tasks");
    expect(retryWaitTitle({ reason: "dependency_blocked", blockers: [] })).toBe("Retry is waiting on its dependencies");
  });

  it("leaves a failed Retry wait to the interrupted notice", () => {
    const failed = interruption({ state: "failed", retryWait: { reason: "remote_cleanup", message: "Retry is waiting for the previous environment to stop." } });
    expect(taskNotices(input({ task: { interruption: failed } }))[0]).toMatchObject({ kind: "interrupted", retryWait: "Retry is waiting for the previous environment to stop." });
  });
});

describe("stalled dependencies (#20098)", () => {
  const entry = (id: string, relation: "child" | "blocker", status = "blocked"): IssueBlockerStalledWakeContext => ({
    stalledIssueId: id,
    stalledIssueIdentifier: id === "anon" ? null : id.toUpperCase(),
    stalledIssueTitle: `Task ${id}`,
    stalledIssueStatus: status,
    relation,
    recoveryAction: { id: `ra-${id}`, kind: "stranded_assigned_issue", cause: "retry_exhausted", status: "escalated", ownerType: "board", nextAction: "Retry it or choose its next step." },
  });

  it("lists each one with its relation and link", () => {
    expect(stalledDependencyRows([entry("tes-5", "child"), entry("anon", "blocker")], () => undefined)).toEqual([
      { entry: entry("tes-5", "child"), relation: "Subtask", ref: "TES-5" },
      { entry: entry("anon", "blocker"), relation: "Blocker", ref: "anon" },
    ]);
  });

  it("drops a row once its task's own status has moved on", () => {
    const statuses: Record<string, string> = { "tes-5": "blocked", "tes-6": "in_progress" };
    const rows = stalledDependencyRows([entry("tes-5", "child"), entry("tes-6", "child")], (id) => statuses[id]);
    expect(rows.map((row) => row.ref)).toEqual(["TES-5"]);
    expect(stalledDependencyRows(null, () => undefined)).toEqual([]);
  });

  it("says how many need the board", () => {
    expect(stalledDependencyTitle(1)).toBe("A dependency needs the board");
    expect(stalledDependencyTitle(3)).toBe("3 dependencies need the board");
  });
});
