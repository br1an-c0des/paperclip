import type { Agent, Issue, PauseReason, Project, TaskInterruptionPresentation } from "@paperclipai/shared";
import type { TreeControlState } from "@/api/task-actions";

/*
 * The health notices at the top of an open task (`tasks/recovery`), and which fix each offers. The
 * server sums an interruption up as the task's `interruption` (TaskInterruptionPresentation, built
 * in server/src/services/task-interruption-presentation.ts); the old UI shows it in
 * ui/src/components/ExecutionBlockerNotice.tsx and TaskProjectAccessNotice.tsx. The paused notices
 * follow ui/src/components/TaskTreeControls.tsx (TaskPauseNotice) and IssueAssigneePausedNotice in
 * ui/src/components/IssueChatThread.tsx.
 *
 * - An attempt that failed offers Retry when the server says it can be retried; a scheduled retry
 *   counts down and offers Retry to go now.
 * - A task stopped because its agent may not read the project explains that and links to the
 *   agent's project access; once access is added, it offers Retry.
 * - Interruptions waiting on someone (an approval, a reconnect, an assignee, a model, a budget) say
 *   what's needed. "Resume" ones become the paused notice for whatever is paused.
 * - A paused task or subtree offers Resume where the pause was made (its root task); elsewhere it
 *   links to the root.
 * - A paused assignee offers Resume agent, except after a budget stop, which clears itself.
 */

export type TaskNotice =
  | { kind: "hidden" }
  | { kind: "project-access"; agentId: string; projectId: string | null; ready: boolean; canRetry: boolean }
  | { kind: "interrupted"; state: "failed" | "retry_scheduled"; canRetry: boolean; nextRetryAt: string | null }
  | { kind: "waiting"; action: Exclude<NonNullable<TaskInterruptionPresentation["userAction"]>, "project_access" | "resume"> }
  | { kind: "tree-paused"; scope: "leaf" | "subtree"; isRoot: boolean; rootIssueId: string }
  | { kind: "agent-paused"; agentId: string; agentName: string; reason: PauseReason | null; canResume: boolean }
  | { kind: "project-paused"; projectName: string | null }
  | { kind: "paused" };

export type NoticeInput = {
  task: Pick<Issue, "status" | "hiddenAt" | "interruption">;
  assignee?: Pick<Agent, "id" | "name" | "status" | "pauseReason"> | null;
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

  if (interruption?.projectAccess) {
    const access = interruption.projectAccess;
    notices.push({
      kind: "project-access",
      agentId: access.agentId,
      projectId: access.projectId,
      ready: access.ready,
      canRetry: access.ready && interruption.canRetry,
    });
  } else if (interruption?.responsibility === "system" && (interruption.state === "failed" || interruption.state === "retry_scheduled")) {
    notices.push({ kind: "interrupted", state: interruption.state, canRetry: interruption.canRetry, nextRetryAt: interruption.nextRetryAt });
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
    notices.push({ kind: "agent-paused", agentId: agent.id, agentName: agent.name, reason: agent.pauseReason, canResume: agent.pauseReason !== "budget" });
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
    default:
      return "It was paused by hand.";
  }
}
