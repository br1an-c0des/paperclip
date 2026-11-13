import type {
  Agent,
  Issue,
  IssueBlockerStalledWakeContext,
  IssueLockedStub,
  IssueRelationIssueSummary,
  PauseReason,
  Project,
  TaskInterruptionPresentation,
} from "@paperclipai/shared";
import type { TreeControlState } from "@/api/task-actions";
import { providerFailureOf, type ProviderFailure } from "@/ui/provider-failure";

/*
 * The health notices at the top of an open task (`tasks/recovery`), and which fix each offers. The
 * server sums an interruption up as the task's `interruption` (TaskInterruptionPresentation, built
 * in server/src/services/task-interruption-presentation.ts); the old UI shows it in
 * ui/src/components/ExecutionBlockerNotice.tsx and TaskProjectAccessNotice.tsx. The paused notices
 * follow ui/src/components/TaskTreeControls.tsx (TaskPauseNotice) and IssueAssigneePausedNotice in
 * ui/src/components/IssueChatThread.tsx.
 *
 * - An attempt that failed offers Retry when the server says it can be retried; a scheduled retry
 *   counts down and offers Retry to go now. When the task's folders couldn't be prepared
 *   (`workspaceFailure`, since the 2026-11-03 sync) it says so, with the server's reason.
 * - A provider's refusal (`providerFailure`, since the same sync) takes the place of the plain
 *   interruption, or of the wait it caused (a sign-in, a model), as in the old UI's
 *   ExecutionBlockerNotice: who refused and why, with Retry when the server allows one.
 * - Since the 2026-11-05 sync: while Paperclip recovers the previous attempt's saved work it names
 *   the step (`recoveryStep`: checking the run stopped, saving its files, finishing), alone or before
 *   the retry countdown. An accepted Retry that still waits says why (`retryWait`), over the
 *   provider's refusal. Under a native export hold Retry gives way to Recover saved files.
 * - Since the 2026-11-07 sync: Retry gives way only while the recovery card offers a way on itself
 *   (#19840): Recover saved files on a verified source, or the confirmation that the previous
 *   server stopped. A hold whose source can't be verified keeps Retry, which renews the recovery,
 *   so it never dead-ends. A native run the coordinator resumes by itself (#19503: scheduled, with
 *   no Retry and no recovery step) reads "Resuming" with its time, not as a competing Retry; the
 *   same rule (`pendingResume`) words it under a provider's refusal and on the list rows' pill.
 * - Since the 2026-11-09 sync (#20109): a saved Retry that waits only on unfinished blockers reads
 *   as waiting (`state: "working"`, `retryWait.reason: "dependency_blocked"`, no Retry), and the
 *   notice lists those blockers from the task's `blockedBy`, each with what to do, as the old UI's
 *   ExecutionBlockerNotice does. Other waits of a task that hasn't started (a budget hold) show
 *   their message the same way.
 * - Also since then (#20098), the children and blockers stopped on a recovery action that needs
 *   the board (`stalledDependencies`) get their own notice (`stalledDependencyRows`, drawn in
 *   TaskNotices.tsx), each with its own Retry.
 * - A task stopped because its agent may not read the project explains that and links to the
 *   agent's project access; once access is added, it offers Retry.
 * - Interruptions waiting on someone (an approval, a reconnect, an assignee, a model, a budget) say
 *   what's needed. "Resume" ones become the paused notice for whatever is paused.
 * - A paused task or subtree offers Resume where the pause was made (its root task); elsewhere it
 *   links to the root.
 * - A paused assignee offers Resume agent, except after a budget stop or a company archive, which
 *   clear themselves. A setup draft (`pauseReason: "setup"`) isn't paused by anyone: the notice says
 *   it's still being set up, and links to Finish setup unless its computer is still being prepared.
 *
 * Since the 2026-11-10 sync:
 * - A Retry parked because the previous native run never recorded its process (#20310) waits for an
 *   owner or admin to confirm it stopped (`confirm_run_stopped`): the notice carries the form
 *   (`confirm-run-stopped`, TaskRecovery.tsx's ConfirmServerStopped), and the Retry starts once
 *   they confirm.
 * - A workspace setup command that exited non-zero is named (`setupFailure`, #20478), with its
 *   command and output, and a link to the project's workspace settings.
 * - A rejected model is named (`rejectedModel`, #20488) in the choose-model wait.
 * - A budget-held Retry (#20338) says whether an attempt ran, and links to Costs.
 * - An agent parked while its setup is checked again (no `pauseReason`, lifecycle `preparing`,
 *   `verifying` or `resuming`, #20361) isn't called paused and gets no Resume agent, which can't
 *   finish verification: the notice points to the task's connection card instead.
 *
 * Since the 2026-11-13 sync:
 * - A continuation Paperclip recorded that has waited 15 minutes to start (#21373, #21385) reads as
 *   waiting for the agent's other work, with Move it forward now (`move-forward`; retry.tsx sends
 *   `retryAction: "move_forward"`). The task is working, not failed.
 * - A rejected model (`choose_model`) offers Try again on the failed run (#21244), which the server
 *   allows once the model is fixed and refuses while it's still selected
 *   (`native_provider_model_still_unavailable`; runs/model-retry.ts words that refusal).
 */

export type TaskNotice =
  | { kind: "hidden" }
  | { kind: "project-access"; agentId: string; projectId: string | null; ready: boolean; canRetry: boolean }
  | {
      kind: "interrupted";
      state: "failed" | "retry_scheduled";
      canRetry: boolean;
      nextRetryAt: string | null;
      workspaceFailure: string | null;
      /** A workspace setup command that exited non-zero (`setupFailure`, #20478). */
      setupFailure: SetupFailure | null;
      /** Why an accepted Retry still waits (`retryWait`), in the server's words. */
      retryWait: string | null;
      /** The saved-work step the scheduled retry waits for (`recoveryStep`), as words. */
      recoveryStep: string | null;
      /**
       * Scheduled with no Retry and no saved-work step: the native coordinator resumes the same run
       * by itself at `nextRetryAt` (#19503), or an accepted Retry is being prepared.
       */
      resuming: boolean;
    }
  | {
      kind: "provider-failure";
      failure: ProviderFailure;
      state: "failed" | "retry_scheduled" | "waiting_for_user";
      canRetry: boolean;
      nextRetryAt: string | null;
      recoveryStep: string | null;
      /** A pending native resume (`pendingResume`): its countdown reads "Resuming", not "Trying again". */
      resuming: boolean;
      /** The model the provider rejected, on a choose-model wait (#20488). */
      rejectedModel: string | null;
      /** A budget hold keeps the refusal on screen (#20338): the line that says so, with Costs. */
      budgetWait: boolean;
      /** The failed run Try again retries, on a rejected model (#21244); null for none. */
      modelRetry: ModelRetry | null;
    }
  /** A recorded continuation waiting behind the agent's other work, with Move it forward now (#21373). */
  | { kind: "move-forward"; canRetry: boolean }
  /** Paperclip is recovering the previous attempt's saved work before the task goes on. */
  | { kind: "recovering"; step: string }
  /**
   * A saved Retry, or a task that hasn't started, waiting on something that clears by itself or
   * elsewhere (`retryWait` on a working task): the server's message, and for a dependency wait
   * the unfinished blockers it waits on.
   */
  | { kind: "retry-waiting"; reason: string; message: string; blockers: RetryBlocker[] }
  | {
      kind: "waiting";
      action: Exclude<NonNullable<TaskInterruptionPresentation["userAction"]>, "project_access" | "resume">;
      /** The model the provider rejected (`rejectedModel`, #20488), on a choose-model wait. */
      rejectedModel: string | null;
      /** Whether an attempt ran before the wait, which a budget hold words differently (#20338). */
      attempted: boolean;
      /** The failed run Try again retries, on a rejected model (#21244); null for none. */
      modelRetry: ModelRetry | null;
    }
  /**
   * A Retry parked because the previous run never recorded its process (#20310): an owner or admin
   * confirms it stopped (`POST /issues/:id/recovery-actions/confirm-run-stopped`), and the Retry starts.
   */
  | { kind: "confirm-run-stopped"; runId: string; message: string }
  | { kind: "tree-paused"; scope: "leaf" | "subtree"; isRoot: boolean; rootIssueId: string }
  | { kind: "agent-paused"; agentId: string; agentName: string; reason: PauseReason | null; canResume: boolean }
  /** The assignee is a setup draft, not paused by anyone: `preparing` while its computer gets ready. */
  | { kind: "agent-setup"; agentId: string; agentName: string; preparing: boolean }
  /**
   * The assignee is parked while its setup is checked again (#20361): no operator pause, so no
   * Resume agent. A missing AI account is fixed in the task's connection card.
   */
  | { kind: "agent-checking"; agentId: string; agentName: string; error: string | null }
  | { kind: "project-paused"; projectName: string | null }
  | { kind: "paused" };

/** The saved-work recovery steps (`recoveryStep`, since the 2026-11-05 sync), as the old UI words them. */
export const RECOVERY_STEP_TEXT: Record<NonNullable<TaskInterruptionPresentation["recoveryStep"]>, string> = {
  checking_previous_run: "Checking that the previous attempt stopped",
  saving_previous_files: "Saving files from the previous attempt",
  finishing_recovery: "Finishing recovery of saved work",
};

/** A failed workspace setup command (`setupFailure`, #20478), bounded and redacted by the server. */
export type SetupFailure = NonNullable<TaskInterruptionPresentation["setupFailure"]>;

/** What each setup step is, for the command's disclosure. */
export const SETUP_STEP_TEXT: Record<SetupFailure["step"], string> = {
  workspace_provision: "Workspace setup command",
  workspace_seed: "Workspace seed command",
  workspace_runtime_provision: "Runtime setup command",
};

/** The server's message without a trailing full stop, so the sentence around it reads once. */
const sentence = (message: string) => message.trim().replace(/[.\s]+$/, "");

/**
 * The interrupted notice's text for a failed setup command, in the old UI's words: "Couldn't set
 * up the task workspace. <message>. Fix the command in the project's workspace settings, then
 * retry.", or while a retry is scheduled, "<message>. Trying again in 40s…".
 */
export function setupFailureText(failure: Pick<SetupFailure, "message">, countdown: string | null = null) {
  if (countdown) return `${sentence(failure.message)}. ${countdown}…`;
  return `Couldn't set up the task workspace. ${sentence(failure.message)}. Fix the command in the project's workspace settings, then retry.`;
}

/**
 * A native export hold (`workspaceRepairRequired` on a retained-export cause): the files must be
 * recovered first, so Recover saved files (TaskRecovery.tsx) takes the place of Retry.
 */
export const RETAINED_EXPORT_CAUSES = new Set(["native_workspace_sync_out_retry_exhausted", "native_workspace_sync_out_unrecoverable"]);

export function retainedExportHold(task: Pick<Issue, "executionBlocker">) {
  const blocker = task.executionBlocker;
  return !!blocker?.workspaceRepairRequired && RETAINED_EXPORT_CAUSES.has(blocker.cause);
}

type InterruptionFacts = Pick<TaskInterruptionPresentation, "responsibility" | "state" | "canRetry" | "nextRetryAt"> &
  Partial<Pick<TaskInterruptionPresentation, "recoveryStep">>;

/** The saved-work step a system wait is for, as words, while it's working or scheduled (#19260). */
export function recoveryStepOf(interruption: InterruptionFacts | null | undefined): string | null {
  return interruption?.responsibility === "system" && interruption.recoveryStep && (interruption.state === "working" || interruption.state === "retry_scheduled")
    ? (RECOVERY_STEP_TEXT[interruption.recoveryStep] ?? null)
    : null;
}

/**
 * A pending native resume (#19503): scheduled, with no Retry and no saved-work step, so the native
 * coordinator resumes the same run by itself at `nextRetryAt`. It reads "Resuming", never as a
 * retry to press, wherever the task's interruption shows: the task's notice, under a provider's
 * refusal, and the list rows' pill. API gap: an accepted Retry still being prepared looks the same.
 */
export function pendingResume(interruption: InterruptionFacts | null | undefined): boolean {
  return !!interruption && interruption.state === "retry_scheduled" && !interruption.canRetry && !recoveryStepOf(interruption) && !!interruption.nextRetryAt;
}

/**
 * A blocker a saved Retry waits on: its link and what to do about it. A private one the viewer may
 * not read (`locked`) shows only its identifier, as the old UI's LockedIssueChip does.
 */
export type RetryBlocker = { id: string; identifier: string | null; title: string | null; locked: boolean; action: string | null };

/** What to do about a blocker, by its status (the old UI's ExecutionBlockerNotice `blockerAction`). */
export const BLOCKER_ACTION: Record<string, string> = {
  blocked: "Blocked: open it to Retry",
  cancelled: "Cancelled: remove or replace it",
  done: "Saving its files",
};

type Blocker = IssueRelationIssueSummary | IssueLockedStub;
const isLocked = (blocker: Blocker): blocker is IssueLockedStub => (blocker as { locked?: unknown }).locked === true;

/**
 * The blockers a `dependency_blocked` Retry waits on: the unfinished ones (a locked one counts), or,
 * when every readable one is done (a finished task still saving its files), all of them. Nothing
 * for any other wait.
 */
export function retryWaitBlockers(retryWait: { reason: string } | null | undefined, blockedBy: readonly Blocker[] | null | undefined): RetryBlocker[] {
  if (retryWait?.reason !== "dependency_blocked") return [];
  const all = blockedBy ?? [];
  const unfinished = all.filter((blocker) => isLocked(blocker) || blocker.status !== "done");
  return (unfinished.length ? unfinished : all).map((blocker) =>
    isLocked(blocker)
      ? { id: blocker.id, identifier: blocker.identifier, title: null, locked: true, action: null }
      : {
          id: blocker.id,
          identifier: blocker.identifier,
          title: blocker.title,
          locked: false,
          action: BLOCKER_ACTION[blocker.status] ?? words(blocker.status),
        },
  );
}

/** "Retry is waiting on TES-12", "on 2 tasks", or for a wait that isn't a dependency, "Waiting to start". */
export function retryWaitTitle(notice: { reason: string; blockers: readonly RetryBlocker[] }) {
  if (notice.reason !== "dependency_blocked") return "Waiting to start";
  if (notice.blockers.length === 1) return `Retry is waiting on ${notice.blockers[0].identifier ?? "a task"}`;
  return notice.blockers.length > 1 ? `Retry is waiting on ${notice.blockers.length} tasks` : "Retry is waiting on its dependencies";
}

const words = (value: string) => value.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());

/** A failed run to try again, and the agent that ran it (`POST /agents/:id/wakeup` with `failedRunId`). */
export type ModelRetry = { runId: string; agentId: string };

/**
 * The run Try again retries on a rejected model (#21244; the old UI's "Model unavailable" marker):
 * the run the interruption observed, by the task's assignee, which the server requires. Null when
 * the task's own Retry is offered, or without a run or an assignee.
 */
export function modelRetryOf(
  interruption: Pick<TaskInterruptionPresentation, "userAction" | "observedRunId" | "canRetry"> | null | undefined,
  assigneeAgentId: string | null | undefined,
): ModelRetry | null {
  if (interruption?.userAction !== "choose_model" || interruption.canRetry) return null;
  return interruption.observedRunId && assigneeAgentId ? { runId: interruption.observedRunId, agentId: assigneeAgentId } : null;
}

export type NoticeInput = {
  task: Pick<Issue, "status" | "hiddenAt" | "interruption"> & Partial<Pick<Issue, "executionBlocker" | "blockedBy" | "assigneeAgentId">>;
  assignee?: Pick<Agent, "id" | "name" | "status" | "pauseReason"> & Partial<Pick<Agent, "lifecycleState" | "lifecycleError">> | null;
  project?: Pick<Project, "name" | "pausedAt"> | null;
  tree?: TreeControlState | null;
  /** Whether the task has subtasks, which makes a pause a subtree pause. */
  hasSubtasks: boolean;
  /**
   * Whether the recovery card offers its own way on (TaskRecovery.tsx): Recover saved files on a
   * verified source, or the previous-server confirmation. Retry gives way under a native export
   * hold only then (#19840). Unknown counts as yes, as in the old UI, until the card says.
   */
  recoveryOwnsRetry?: boolean;
};

const TERMINAL = new Set(["done", "cancelled"]);

/** Lifecycle states in which a parked agent is having its setup checked, not paused by anyone (#20361). */
export const SETUP_CHECK_STATES = new Set(["preparing", "verifying", "resuming"]);

/**
 * An agent parked while its setup is checked again (#20361): stored paused, with no pause reason,
 * in a setup-check lifecycle state. The task notice and the agent's header say it's finishing its
 * setup rather than paused, and offer no Resume, which can't finish verification.
 */
export function checkingSetup(agent: (Pick<Agent, "status" | "pauseReason"> & Partial<Pick<Agent, "lifecycleState">>) | null | undefined) {
  return agent?.status === "paused" && !agent.pauseReason && SETUP_CHECK_STATES.has(agent.lifecycleState ?? "");
}

const assigneeBudgetPaused = (agent: NoticeInput["assignee"], status: string) =>
  agent?.status === "paused" && agent.pauseReason === "budget" && !TERMINAL.has(status);

/** The model a choose-model wait names (#20488), or null. */
const rejectedModelOf = (interruption: TaskInterruptionPresentation) =>
  (interruption.userAction === "choose_model" && interruption.rejectedModel?.trim()) || null;

export function taskNotices(input: NoticeInput): TaskNotice[] {
  const notices: TaskNotice[] = [];
  const { task } = input;
  const interruption = task.interruption ?? null;
  if (task.hiddenAt) notices.push({ kind: "hidden" });
  const failure = providerFailureOf(interruption?.providerFailure);
  const step = recoveryStepOf(interruption);
  const resuming = pendingResume(interruption);
  // Under a native export hold the files are recovered first (#18848), while the card offers that;
  // otherwise Retry renews the recovery, so it stays (#19840).
  const canRetry = !!interruption?.canRetry && !(retainedExportHold(task) && input.recoveryOwnsRetry !== false);
  const retryWait = interruption?.retryWait?.message || null;

  if (interruption?.projectAccess) {
    const access = interruption.projectAccess;
    notices.push({
      kind: "project-access",
      agentId: access.agentId,
      projectId: access.projectId,
      ready: access.ready,
      canRetry: access.ready && canRetry,
    });
  } else if (
    failure &&
    interruption &&
    !retryWait &&
    (interruption.state === "failed" || interruption.state === "retry_scheduled" || interruption.state === "waiting_for_user")
  ) {
    notices.push({
      kind: "provider-failure",
      failure,
      state: interruption.state,
      canRetry,
      nextRetryAt: interruption.nextRetryAt,
      recoveryStep: step,
      resuming,
      rejectedModel: rejectedModelOf(interruption),
      budgetWait: interruption.state === "waiting_for_user" && interruption.userAction === "budget",
      modelRetry: interruption.state === "waiting_for_user" ? modelRetryOf(interruption, task.assigneeAgentId) : null,
    });
  } else if (step && interruption?.state === "working") {
    notices.push({ kind: "recovering", step });
  } else if (interruption?.state === "working" && interruption.retryAction === "move_forward" && interruption.canRetry) {
    // Ahead of a Retry wait, as in the old UI's ExecutionBlockerNotice (#21373).
    notices.push({ kind: "move-forward", canRetry });
  } else if (retryWait && interruption?.state === "working") {
    const reason = interruption.retryWait!.reason;
    notices.push({ kind: "retry-waiting", reason, message: retryWait, blockers: retryWaitBlockers(interruption.retryWait, task.blockedBy) });
  } else if (interruption?.responsibility === "system" && (interruption.state === "failed" || interruption.state === "retry_scheduled")) {
    notices.push({
      kind: "interrupted",
      state: interruption.state,
      canRetry,
      nextRetryAt: interruption.nextRetryAt,
      workspaceFailure: interruption.workspaceFailure?.message || null,
      setupFailure: interruption.setupFailure?.message ? interruption.setupFailure : null,
      retryWait,
      recoveryStep: step,
      resuming,
    });
  } else if (interruption?.state === "waiting_for_user" && interruption.userAction === "confirm_run_stopped" && interruption.observedRunId) {
    notices.push({
      kind: "confirm-run-stopped",
      runId: interruption.observedRunId,
      message: interruption.retryWait?.message || "Paperclip can't confirm that the previous run stopped. Your message is saved.",
    });
  } else if (
    interruption?.state === "waiting_for_user" &&
    interruption.userAction &&
    interruption.userAction !== "resume" &&
    interruption.userAction !== "project_access" &&
    // A budget stop of the assignee itself is told by its paused notice, below (#20143 keeps such
    // tasks in their status, so this is now the usual way a budget pause shows).
    !(interruption.userAction === "budget" && assigneeBudgetPaused(input.assignee, task.status))
  ) {
    notices.push({
      kind: "waiting",
      action: interruption.userAction,
      rejectedModel: rejectedModelOf(interruption),
      attempted: !!interruption.observedRunId || interruption.sourceRunIds.length > 0,
      modelRetry: modelRetryOf(interruption, task.assigneeAgentId),
    });
  }

  let pauseShown = false;
  const hold = input.tree?.activePauseHold;
  if (hold) {
    pauseShown = true;
    notices.push({ kind: "tree-paused", scope: input.hasSubtasks ? "subtree" : "leaf", isRoot: hold.isRoot, rootIssueId: hold.rootIssueId });
  }
  const agent = input.assignee;
  if (agent?.status === "paused" && !TERMINAL.has(task.status)) {
    pauseShown = true;
    if (agent.pauseReason === "setup") {
      // A new agent is stored paused until its setup finishes; nobody paused it (#19322). Only the
      // computer's preparation goes on by itself; a verifying or parked draft waits for its wizard.
      const preparing = agent.lifecycleState === "preparing" || agent.lifecycleState === "pausing";
      notices.push({ kind: "agent-setup", agentId: agent.id, agentName: agent.name, preparing });
    } else if (checkingSetup(agent)) {
      // Parked while its setup is checked again (#20361): Resume changes operator holds and can't
      // finish verification, so point to the task's connection card, as the old UI does.
      notices.push({ kind: "agent-checking", agentId: agent.id, agentName: agent.name, error: agent.lifecycleError?.trim() || null });
    } else {
      // Budget pauses clear when the budget allows, archive pauses when the company is restored.
      const canResume = agent.pauseReason !== "budget" && agent.pauseReason !== "company_archived";
      notices.push({ kind: "agent-paused", agentId: agent.id, agentName: agent.name, reason: agent.pauseReason, canResume });
    }
  }
  if (interruption?.userAction === "resume" && !pauseShown) {
    notices.push(input.project?.pausedAt ? { kind: "project-paused", projectName: input.project.name } : { kind: "paused" });
  }
  return notices;
}

/** "Trying again in 40s" or "in 3m", counted from now. */
export function retryCountdown(nextRetryAt: string | null, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Date.parse(nextRetryAt ?? "") - now) / 1000));
  if (!Number.isFinite(seconds)) return "Trying again soon";
  return `Trying again in ${seconds > 60 ? `${Math.ceil(seconds / 60)}m` : `${seconds}s`}`;
}

/** "Resuming in 28s" or "in 3m", counted from now. */
export function resumeCountdown(nextRetryAt: string | null, now = Date.now()) {
  return retryCountdown(nextRetryAt, now).replace(/^Trying again/, "Resuming");
}

/**
 * The line under a provider's refusal while the task goes on by itself: the saved-work step and its
 * countdown; "Resuming in 28s by itself." for a pending native resume; else "Trying again in 40s by
 * itself."
 */
export function scheduledLine(notice: { nextRetryAt: string | null; recoveryStep: string | null; resuming: boolean }, now = Date.now()) {
  if (notice.recoveryStep) return `${notice.recoveryStep}. ${retryCountdown(notice.nextRetryAt, now)}…`;
  return `${notice.resuming ? resumeCountdown(notice.nextRetryAt, now) : retryCountdown(notice.nextRetryAt, now)} by itself.`;
}

/** "15:26", the time of day a resume is due. */
export function timeOfDay(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** What each kind of wait needs, in a sentence. */
export const WAITING_TEXT: Record<Extract<TaskNotice, { kind: "waiting" }>["action"], string> = {
  approval: "Waiting for an approval before the agent can go on.",
  reconnect: "The agent's AI connection needs signing in again before it can go on.",
  assign_agent: "Nobody is working on this. Assign an agent to carry on.",
  choose_model: "The provider turned down the agent's model. Choose another model to carry on.",
  budget: "Stopped by a budget limit. It carries on when the budget resets or is raised.",
  confirm_owner_stop: "Paperclip can't tell whether the previous server stopped. An owner or admin needs to confirm it stopped before the agent can go on.",
  confirm_run_stopped: "Paperclip can't confirm that the previous run stopped. An owner or admin needs to confirm it stopped before your Retry starts.",
};

/** The choose-model sentence naming the rejected model, in the old UI's words (#20488). */
export function rejectedModelText(model: string) {
  return `The provider rejected the model "${model}". Choose a supported model or clear the task's model override, then retry.`;
}

/** The line a budget hold adds: it waits for the budget, which is raised in Costs (#20338). */
export const BUDGET_WAIT_LINE = "It's waiting for the budget to allow new work. Raise the budget in Costs.";

/**
 * A budget-held task in the old UI's words (#20338): one that already ran says its attempt didn't
 * finish and the message is saved; one refused before its first run says it hasn't started.
 */
export function budgetWaitText(attempted: boolean) {
  return attempted ? `Couldn't finish this attempt. Your message is saved. ${BUDGET_WAIT_LINE}` : `This task hasn't started. ${BUDGET_WAIT_LINE}`;
}

/** The waiting notice's sentence: the rejected model or the budget hold when known, else the kind's. */
export function waitingText(notice: Pick<Extract<TaskNotice, { kind: "waiting" }>, "action" | "rejectedModel" | "attempted">) {
  if (notice.action === "choose_model" && notice.rejectedModel) return rejectedModelText(notice.rejectedModel);
  if (notice.action === "budget") return budgetWaitText(notice.attempted);
  return WAITING_TEXT[notice.action];
}

/** Why an agent was paused, after the old UI's IssueAssigneePausedNotice. */
export function pauseDetail(reason: PauseReason | null) {
  switch (reason) {
    case "budget":
      return "It was paused by a budget hard stop, and resumes when the budget allows.";
    case "import":
      return "It arrived paused from an organization import; imported agents stay parked until you resume them.";
    case "system":
      return "It was paused by the system.";
    case "company_archived":
      return "It was paused because its company is archived.";
    case "manual":
      return "It was paused by hand.";
    default:
      return "";
  }
}

/*
 * Stalled dependencies (since the 2026-11-09 sync, upstream #20098; the old UI's
 * StalledDependencyNotice.tsx): the task's children and blockers that stopped on a recovery action
 * that needs the board (`Issue.stalledDependencies`). The waiting task's agent is woken once per
 * stall (`issue_blocker_stalled`); the notice lets the board act on each from here.
 */

export type StalledDependencyRow = {
  entry: IssueBlockerStalledWakeContext;
  /** "Subtask" for a child, "Blocker" for a task this one waits on. */
  relation: string;
  /** What the link opens: the identifier, else the id. */
  ref: string;
};

/**
 * The rows still worth showing. The saved list refreshes only with the waiting task, so a row drops
 * once its child's own state (read separately) has moved on from the status the stall recorded: its
 * Retry started it, or it was unblocked. A child not read yet stays.
 */
export function stalledDependencyRows(
  entries: readonly IssueBlockerStalledWakeContext[] | null | undefined,
  childStatus: (issueId: string) => string | undefined,
): StalledDependencyRow[] {
  return (entries ?? [])
    .filter((entry) => {
      const status = childStatus(entry.stalledIssueId);
      return status === undefined || status === entry.stalledIssueStatus;
    })
    .map((entry) => ({
      entry,
      relation: entry.relation === "child" ? "Subtask" : "Blocker",
      ref: entry.stalledIssueIdentifier ?? entry.stalledIssueId,
    }));
}

/** "A dependency needs the board", or "2 dependencies need the board". */
export function stalledDependencyTitle(count: number) {
  return count === 1 ? "A dependency needs the board" : `${count} dependencies need the board`;
}
