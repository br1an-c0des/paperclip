import type { RunnerGoalActionAccepted, RunnerGoalActionRequest, RunnerGoalProjection } from "@paperclipai/shared";
import { api } from "./client";

/*
 * A task's runner goal ("Goal: keep pursuing"), as ui/src/api/issues.ts uses it: the goal an agent's
 * session keeps working toward across turns, and the actions on it (create, edit, replace, pause,
 * resume, clear). Only some runners support goals; the projection's `capability` says whether this
 * agent's does and why not.
 *
 * `agentId` asks about the goal for a given agent, such as the one the composer is about to
 * reassign the task to; without it the server answers for the task's assignee.
 */
export const runnerGoalApi = {
  get: (taskId: string, agentId?: string | null, signal?: AbortSignal) =>
    api.get<RunnerGoalProjection>(`/issues/${encodeURIComponent(taskId)}/runner-goal${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`, { signal }),
  /** Answers 202 with the new projection; 409 with `{ error, current }` when the revision moved on. */
  act: (taskId: string, request: RunnerGoalActionRequest) =>
    api.post<RunnerGoalActionAccepted>(`/issues/${encodeURIComponent(taskId)}/runner-goal/actions`, request),
};
