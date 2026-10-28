import type { RunnerGoalCapability, RunnerGoalPendingAction, RunnerGoalProjection, RunnerGoalSnapshot, RunnerGoalStatus } from "@paperclipai/shared";

/*
 * The runner goal's model (`tasks/runner-goal`): "Goal: keep pursuing" in the composer sets an
 * objective the agent's session keeps working toward across turns, and a card above the composer
 * shows its progress. The rules follow ui/src/components/task-chat/RunnerGoalWidget.tsx and
 * TaskChatComposer.tsx:
 *
 * - Only runners whose capability is "available" offer it (Paperclip Runner with Codex, or with
 *   Claude or Codex over ACP); others say why not. Support is verified when the session starts.
 * - `/goal <objective>` typed in the composer works as well as the Goal pill; `/goal pause`,
 *   `resume`, `clear` and `edit` act on the current goal.
 * - Setting a new objective while one is unfinished asks before replacing it.
 * - A goal can't carry files, and the objective is at most 4,000 characters.
 */

export const MAX_OBJECTIVE = 4_000;

export type GoalCommand =
  | { action: "focus" }
  | { action: "create"; objective: string }
  | { action: "edit" }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "clear" };

export type ParsedGoalCommand = { matched: false } | { matched: true; command: GoalCommand } | { matched: true; error: string };

/** Reads `/goal …` at the start of a message. Anything else is an ordinary message. */
export function parseGoalCommand(text: string): ParsedGoalCommand {
  const trimmed = text.replaceAll(" ", " ").trim();
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return { matched: false };
  const rest = (match[1] ?? "").trim();
  if (!rest) return { matched: true, command: { action: "focus" } };
  const [word, ...extra] = rest.split(/\s+/);
  if (word === "edit" || word === "pause" || word === "resume" || word === "clear") {
    if (extra.length > 0) return { matched: true, error: `/goal ${word} doesn't take anything after it.` };
    return { matched: true, command: { action: word } };
  }
  return { matched: true, command: { action: "create", objective: rest } };
}

/**
 * What the composer sends as a goal: the objective from the Goal pill, or a `/goal` command typed in
 * the message. `null` when it's an ordinary message.
 */
export function goalFromComposer(input: { body: string; goalMode: boolean; attachmentCount: number }): { ok: true; command: GoalCommand } | { ok: false; problem: string } | null {
  const parsed = parseGoalCommand(input.body);
  if (!input.goalMode && !parsed.matched) return null;
  if (parsed.matched && "error" in parsed) return { ok: false, problem: parsed.error };
  const command: GoalCommand = parsed.matched ? parsed.command : { action: "create", objective: input.body.trim() };
  if (command.action === "create" || (input.goalMode && command.action === "focus")) {
    const objective = command.action === "create" ? command.objective : "";
    if (!objective) return { ok: false, problem: "Write the goal first: what should the agent keep working toward?" };
    if (objective.length > MAX_OBJECTIVE) return { ok: false, problem: `A goal can be at most ${MAX_OBJECTIVE.toLocaleString()} characters.` };
  }
  if (input.attachmentCount > 0) return { ok: false, problem: "A goal can't carry files. Remove them, or send them as a message first." };
  return { ok: true, command };
}

export function goalAvailable(capability: RunnerGoalCapability | null | undefined) {
  return capability?.availability === "available";
}

export const PENDING_LABELS: Record<RunnerGoalPendingAction, string> = {
  starting: "Starting",
  editing: "Saving",
  replacing: "Replacing",
  pausing: "Pausing after this turn",
  resuming: "Resuming",
  clearing: "Clearing",
  continuing: "Continuing in a new run",
};

export const STATUS_LABELS: Record<RunnerGoalStatus, { label: string; tone: "run" | "amber" | "red" | "green" | "neutral" }> = {
  active: { label: "Pursuing", tone: "run" },
  paused: { label: "Paused", tone: "neutral" },
  blocked: { label: "Blocked", tone: "red" },
  limited: { label: "Limited", tone: "amber" },
  usage_limited: { label: "Usage limit", tone: "amber" },
  budget_limited: { label: "Token budget reached", tone: "amber" },
  complete: { label: "Complete", tone: "green" },
};

const RESUMABLE: ReadonlySet<RunnerGoalStatus> = new Set(["paused", "blocked", "limited", "usage_limited"]);

/** The buttons the goal card offers, by what the runner can do and where the goal stands. */
export function goalActions(projection: RunnerGoalProjection | null | undefined) {
  const goal = projection?.goal ?? null;
  const capability = projection?.capability;
  const can = (action: "set" | "pause" | "resume" | "clear") => goalAvailable(capability) && !!capability?.actions.includes(action);
  return {
    edit: !!goal && can("set"),
    pause: goal?.status === "active" && can("pause"),
    resume: !!goal && RESUMABLE.has(goal.status) && can("resume"),
    clear: !!goal && can("clear"),
  };
}

/** Whether there's an unfinished goal, which a new objective would replace. */
export function unfinishedGoal(projection: RunnerGoalProjection | null | undefined) {
  return !!projection?.goal && projection.goal.status !== "complete";
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatTokens(tokens: number) {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}

/** The goal's progress in a line: time, tokens (when the runner reports them), turns, last reason. */
export function progressParts(goal: RunnerGoalSnapshot, capability: RunnerGoalCapability | null | undefined) {
  const parts = [formatDuration(goal.elapsedSeconds)];
  if (capability?.usageReporting) parts.push(`${formatTokens(goal.tokensUsed)}${goal.tokenBudget ? ` of ${formatTokens(goal.tokenBudget)}` : ""} tokens`);
  if (goal.iterations > 0) parts.push(`${goal.iterations} turn${goal.iterations === 1 ? "" : "s"}`);
  return parts;
}

/**
 * What to do with a goal pushed by the live events (`agent.session.goal.changed`): take it when it's
 * this task's goal and not older than what's shown; refetch when revisions were skipped.
 */
export function liveGoalUpdate(
  current: RunnerGoalProjection | undefined,
  next: RunnerGoalProjection,
  scope: { taskId: string; agentId: string | null },
): "take" | "refetch" | "ignore" {
  if (next.issueId !== scope.taskId) return "ignore";
  if (scope.agentId && next.agentId !== scope.agentId) return "ignore";
  if (current && next.revision > current.revision + 1) return "refetch";
  if (!current || next.revision >= current.revision) return "take";
  return "ignore";
}

export function newRequestId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `goal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
