import type { UpdateWorkspacePreference, WorkspacePreference } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Your own workspace preferences (ui/src/api/workspacePreferences.ts): read across companies, saved
 * through a company you belong to (it only gives the change its audit context). ui-new saves only
 * the browser's time zone here (U143, lib/time-zone.ts); the other preference, the coordinator
 * workspace, belongs to a layout ui-new doesn't port (U36).
 */
export const workspacePreferencesApi = {
  get: (signal?: AbortSignal) => api.get<WorkspacePreference>("/workspace-preferences/me", { signal }),
  update: (companyId: string, data: UpdateWorkspacePreference) =>
    api.put<WorkspacePreference>(`/companies/${encodeURIComponent(companyId)}/workspace-preferences/me`, data),
};
