import type { Agent, Issue, PauseReason, Project, TaskInterruptionPresentation } from "@paperclipai/shared";
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
 * - A task stopped because its agent may not read the project explains that and links to the
 *   agent's project access; once access is added, it offers Retry.
 * - Interruptions waiting on someone (an approval, a reconnect, an assignee, a model, a budget) say
 *   what's needed. "Resume" ones become the paused notice for whatever is paused.
 * - A paused task or subtree offers Resume where the pause was made (its root task); elsewhere it
 *   links to the root.
 * - A paused assignee offers Resume agent, except after a budget stop or a company archive, which
 *   clear themselves. A setup draft (`pauseReason: "setup"`) isn't paused by anyone: the notice says
 *   it's still being set up, and links to Finish setup unless its computer is still being prepared.
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
      /** Why an accepted Retry still waits (`retryWait`), in the server's words. */
      retryWait: string | null;
      /** The saved-work step the scheduled retry waits for (`recoveryStep`), as words. */
      recoveryStep: string | null;
    }
  | {
      kind: "provider-failure";
      failure: ProviderFailure;
      state: "failed" | "retry_scheduled" | "waiting_for_user";
      canRetry: boolean;
      nextRetryAt: string | null;
      recoveryStep: string | null;
    }
  /** Paperclip is recovering the previous attempt's saved work before the task goes on. */
  | { kind: "recovering"; step: string }
  | { kind: "waiting"; action: Exclude<NonNullable<TaskInterruptionPresentation["userAction"]>, "project_access" | "resume"> }
  | { kind: "tree-paused"; scope: "leaf" | "subtree"; isRoot: boolean; rootIssueId: string }
  | { kind: "agent-paused"; agentId: string; agentName: string; reason: PauseReason | null; canResume: boolean }
  /** The assignee is a setup draft, not paused by anyone: `preparing` while its computer gets ready. */
  | { kind: "agent-setup"; agentId: string; agentName: string; preparing: boolean }
  | { kind: "project-paused"; projectName: string | null }
  | { kind: "paused" };

/** The saved-work recovery steps (`recoveryStep`, since the 2026-11-05 sync), as the old UI words them. */
export const RECOVERY_STEP_TEXT: Record<NonNullable<TaskInterruptionPresentation["recoveryStep"]>, string> = {
  checking_previous_run: "Checking that the previous attempt stopped",
  saving_previous_files: "Saving files from the previous attempt",
  finishing_recovery: "Finishing recovery of saved work",
};

/**
 * A native export hold (`workspaceRepairRequired` on a retained-export cause): the files must be
 * recovered first, so Recover saved files (TaskRecovery.tsx) takes the place of Retry.
 */
export const RETAINED_EXPORT_CAUSES = new Set(["native_workspace_sync_out_retry_exhausted", "native_workspace_sync_out_unrecoverable"]);

export function retainedExportHold(task: Pick<Issue, "executionBlocker">) {
  const blocker = task.executionBlocker;
  return !!blocker?.workspaceRepairRequired && RETAINED_EXPORT_CAUSES.has(blocker.cause);
}

export type NoticeInput = {
  task: Pick<Issue, "status" | "hiddenAt" | "interruption"> & Partial<Pick<Issue, "executionBlocker">>;
  assignee?: Pick<Agent, "id" | "name" | "status" | "pauseReason"> & Partial<Pick<Agent, "lifecycleState">> | null;
  project?: Pick<Project, "name" | "pausedAt"> | null;
  tree?: TreeControlState | null;
  /** Whether the task has subtasks, which makes a pause a subtree pause. */
  hasSubtasks: boolean;
};

const TERMINAL = new Set(["done", "cancelled"]);

export function taskNotices(input: NoticeInput): TaskNotice[] {
  const notices: TaskNotice[] = [];
  const { task } = input;
  const interruption = task.interruption ?? null;
  if (task.hiddenAt) notices.push({ kind: "hidden" });
  const failure = providerFailureOf(interruption?.providerFailure);
  // The saved-work step names what a system wait is for, while it's working or scheduled (#19260).
  const step =
    interruption?.responsibility === "system" && interruption.recoveryStep && (interruption.state === "working" || interruption.state === "retry_scheduled")
      ? (RECOVERY_STEP_TEXT[interruption.recoveryStep] ?? null)
      : null;
  // Under a native export hold the files are recovered first; Retry would only be refused (#18848).
  const canRetry = !!interruption?.canRetry && !retainedExportHold(task);
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
    notices.push({ kind: "provider-failure", failure, state: interruption.state, canRetry, nextRetryAt: interruption.nextRetryAt, recoveryStep: step });
  } else if (step && interruption?.state === "working") {
    notices.push({ kind: "recovering", step });
  } else if (interruption?.responsibility === "system" && (interruption.state === "failed" || interruption.state === "retry_scheduled")) {
    notices.push({
      kind: "interrupted",
      state: interruption.state,
      canRetry,
      nextRetryAt: interruption.nextRetryAt,
      workspaceFailure: interruption.workspaceFailure?.message || null,
      retryWait,
      recoveryStep: step,
    });
  } else if (interruption?.state === "waiting_for_user" && interruption.userAction && interruption.userAction !== "resume" && interruption.userAction !== "project_access") {
    notices.push({ kind: "waiting", action: interruption.userAction });
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

/** What each kind of wait needs, in a sentence. */
export const WAITING_TEXT: Record<Extract<TaskNotice, { kind: "waiting" }>["action"], string> = {
  approval: "Waiting for an approval before the agent can go on.",
  reconnect: "The agent's AI connection needs signing in again before it can go on.",
  assign_agent: "Nobody is working on this. Assign an agent to carry on.",
  choose_model: "The provider turned down the agent's model. Choose another model to carry on.",
  budget: "Stopped by a budget limit. It carries on when the budget resets or is raised.",
};

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
