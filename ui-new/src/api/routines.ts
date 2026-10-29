import type {
  ActivityEvent,
  FolderListResult,
  Routine,
  RoutineDetail,
  RoutineListItem,
  RoutineRevision,
  RoutineRun,
  RoutineRunSummary,
  RoutineTrigger,
  RoutineTriggerSecretMaterial,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Routines, which the redesign shows as recurring tasks (M4, boards N4–N7 and R1–R4). The requests
 * follow ui/src/api/routines.ts, plus the routine folders (ui/src/api/folders.ts, kind "routine").
 * The company's secrets come from api/secrets.ts.
 *
 * A routine is the template; each time one of its triggers fires the server makes a run, and the
 * run usually makes a task (an occurrence) with `originKind: "routine_execution"` and
 * `originId: <routine id>`.
 */

export type RoutineTriggerResponse = {
  trigger: RoutineTrigger;
  /** The webhook's URL and secret, returned once, when the trigger is created. */
  secretMaterial: RoutineTriggerSecretMaterial | null;
};

export type RotateRoutineTriggerResponse = {
  trigger: RoutineTrigger;
  secretMaterial: RoutineTriggerSecretMaterial;
};

export type RestoreRoutineRevisionResponse = {
  routine: Routine;
  revision: RoutineRevision;
  restoredFromRevisionId: string;
  restoredFromRevisionNumber: number;
  /** Webhook triggers a restore brings back get fresh secrets, shown once. */
  secretMaterials: (RoutineTriggerSecretMaterial & { triggerId: string })[];
};

export const routinesApi = {
  list: (companyId: string, filters: { projectId?: string } = {}, signal?: AbortSignal) => {
    const query = filters.projectId ? `?projectId=${encodeURIComponent(filters.projectId)}` : "";
    return api.get<RoutineListItem[]>(`/companies/${companyId}/routines${query}`, { signal });
  },
  create: (companyId: string, data: Record<string, unknown>) => api.post<Routine>(`/companies/${companyId}/routines`, data),
  get: (id: string, signal?: AbortSignal) => api.get<RoutineDetail>(`/routines/${id}`, { signal }),
  update: (id: string, data: Record<string, unknown>) => api.patch<Routine>(`/routines/${id}`, data),
  revisions: (id: string, signal?: AbortSignal) => api.get<RoutineRevision[]>(`/routines/${id}/revisions`, { signal }),
  restoreRevision: (id: string, revisionId: string, changeSummary?: string) =>
    api.post<RestoreRoutineRevisionResponse>(`/routines/${id}/revisions/${revisionId}/restore`, changeSummary ? { changeSummary } : {}),
  runs: (id: string, limit = 50, signal?: AbortSignal) => api.get<RoutineRunSummary[]>(`/routines/${id}/runs?limit=${limit}`, { signal }),
  run: (id: string, data: Record<string, unknown> = {}) => api.post<RoutineRun>(`/routines/${id}/run`, data),
  /**
   * The recurring task's activity, as the old routine page gathers it: the routine's own entries,
   * each trigger's and each run's (`GET /companies/:id/activity?entityType=&entityId=`, one request
   * each, since the log has no filter for "this routine and everything under it"), merged newest
   * first by the caller.
   */
  activity: (companyId: string, routineId: string, related: { triggerIds: string[]; runIds: string[] }, signal?: AbortSignal) => {
    const list = (entityType: string, entityId: string) =>
      api.get<ActivityEvent[]>(`/companies/${companyId}/activity?${new URLSearchParams({ entityType, entityId })}`, { signal });
    return Promise.all([
      list("routine", routineId),
      ...related.triggerIds.map((id) => list("routine_trigger", id)),
      ...related.runIds.map((id) => list("routine_run", id)),
    ]);
  },
  createTrigger: (id: string, data: Record<string, unknown>) => api.post<RoutineTriggerResponse>(`/routines/${id}/triggers`, data),
  updateTrigger: (triggerId: string, data: Record<string, unknown>) => api.patch<RoutineTrigger>(`/routine-triggers/${triggerId}`, data),
  deleteTrigger: (triggerId: string) => api.delete<void>(`/routine-triggers/${triggerId}`),
  rotateTriggerSecret: (triggerId: string) => api.post<RotateRoutineTriggerResponse>(`/routine-triggers/${triggerId}/rotate-secret`, {}),

  folders: (companyId: string, signal?: AbortSignal) =>
    api.get<FolderListResult>(`/companies/${companyId}/folders?kind=routine`, { signal }),
  createFolder: (companyId: string, name: string) =>
    api.post<{ id: string; name: string }>(`/companies/${companyId}/folders`, { kind: "routine", name }),
  renameFolder: (companyId: string, folderId: string, name: string) =>
    api.patch<{ id: string; name: string }>(`/companies/${companyId}/folders/${folderId}`, { name }),
  /** Deleting a folder moves its recurring tasks to Unfiled. */
  deleteFolder: (companyId: string, folderId: string) => api.delete<unknown>(`/companies/${companyId}/folders/${folderId}`),
  moveToFolder: (companyId: string, routineId: string, folderId: string | null) =>
    api.post<unknown>(`/companies/${companyId}/folders/items/move`, { kind: "routine", itemId: routineId, folderId }),
};
