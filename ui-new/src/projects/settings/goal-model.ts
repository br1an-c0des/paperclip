import type { Goal, Project } from "@paperclipai/shared";
import { goalEdit, newGoalPayload, projectGoalIds, type GoalDraft, type ProjectGoal } from "./settings-model";

/*
 * The goal editor's hierarchy and reach, after the old goal page (ui/src/pages/GoalDetail.tsx and
 * components/GoalProperties.tsx): a goal's parent, its sub-goals, the projects it serves, and when it
 * was made and last changed. There's no goal tree page (decision 14), so these sit in the editor of
 * a project's goal.
 *
 * The server doesn't check a parent (`PATCH /goals/:id` takes any id, its own or a sub-goal's
 * included), so the menu offers only goals that can't make a loop.
 */

type Patch = Record<string, unknown>;

/** The editor's draft: the project settings' goal draft plus the parent goal. */
export type GoalEditorDraft = GoalDraft & { parentId: string | null };

export function withParent(draft: GoalDraft, parentId: string | null | undefined): GoalEditorDraft {
  return { ...draft, parentId: parentId ?? null };
}

/** `POST /companies/:id/goals`, with the parent when one is picked. */
export function newGoalEditorPayload(draft: GoalEditorDraft): Patch {
  const payload = newGoalPayload(draft);
  if (draft.parentId) payload.parentId = draft.parentId;
  return payload;
}

/** What changed, as `PATCH /goals/:id` takes it, the parent included. */
export function goalEditorEdit(goal: ProjectGoal, draft: GoalEditorDraft): Patch | null {
  const patch: Patch = { ...(goalEdit(goal, draft) ?? {}) };
  if ((draft.parentId ?? null) !== (goal.parentId ?? null)) patch.parentId = draft.parentId;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The goal's sub-goals, and theirs, as ids (the goal itself left out). Stops at a loop already stored. */
export function descendantIds(goalId: string, goals: readonly Pick<Goal, "id" | "parentId">[] | undefined): Set<string> {
  const children = new Map<string, string[]>();
  for (const goal of goals ?? []) {
    if (!goal.parentId) continue;
    children.set(goal.parentId, [...(children.get(goal.parentId) ?? []), goal.id]);
  }
  const found = new Set<string>();
  const queue = [...(children.get(goalId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === goalId || found.has(id)) continue;
    found.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return found;
}

/**
 * Goals that may be the goal's parent: not itself or one of its sub-goals (that would make a loop),
 * not archived unless it's the current parent. A new goal (`goalId` null) may take any open goal.
 */
export function parentCandidates(goalId: string | null, currentParentId: string | null, goals: readonly Goal[] | undefined): Goal[] {
  const below = goalId ? descendantIds(goalId, goals) : new Set<string>();
  return (goals ?? [])
    .filter((goal) => goal.id !== goalId && !below.has(goal.id) && (goal.status !== "cancelled" || goal.id === currentParentId))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.title.localeCompare(b.title));
}

const LEVEL_ORDER = ["company", "team", "agent", "task"];
function levelRank(level: string) {
  const rank = LEVEL_ORDER.indexOf(level);
  return rank === -1 ? LEVEL_ORDER.length : rank;
}

/** The goal's direct sub-goals, open ones first. */
export function subGoals(goalId: string, goals: readonly Goal[] | undefined): Goal[] {
  return (goals ?? [])
    .filter((goal) => goal.parentId === goalId && goal.id !== goalId)
    .sort((a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || a.title.localeCompare(b.title));
}

/** The projects that list the goal among theirs, this one first. */
export function servedProjects<T extends Pick<Project, "id" | "goalIds" | "goals" | "goalId" | "name">>(
  goalId: string,
  projects: readonly T[] | undefined,
  currentProjectId?: string,
): T[] {
  return (projects ?? [])
    .filter((project) => projectGoalIds(project).includes(goalId))
    .sort((a, b) => Number(b.id === currentProjectId) - Number(a.id === currentProjectId) || a.name.localeCompare(b.name));
}

/** The parent chain above a goal, nearest first, stopping at a loop or a goal that isn't listed. */
export function goalAncestors(goalId: string, goals: readonly Goal[] | undefined): Goal[] {
  const byId = new Map((goals ?? []).map((goal) => [goal.id, goal] as const));
  const chain: Goal[] = [];
  const seen = new Set([goalId]);
  let parentId = byId.get(goalId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.push(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

/** "Oct 18", or "Oct 18, 2025" in another year. */
export function goalDate(value: string | Date | null | undefined, now = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
