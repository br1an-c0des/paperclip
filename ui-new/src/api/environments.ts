import type { Environment, EnvironmentDeleteBlastRadius, EnvironmentProbeResult } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's execution environments (ui/src/api/environments.ts): where a project's task
 * checkouts and an agent's runs happen. Company settings → Environments lists them, probes them,
 * archives or restores them, and deletes one once nothing depends on it.
 */
export const environmentsApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<Environment[]>(`/companies/${encodeURIComponent(companyId)}/environments`, { signal }),
  /** Probes an environment; on a sandbox this records the platform qualification the Paperclip Runner needs. */
  probe: (environmentId: string, companyId: string) =>
    api.post<EnvironmentProbeResult>(`/environments/${encodeURIComponent(environmentId)}/probe?companyId=${encodeURIComponent(companyId)}`, {}),
  /** Name, description and status. The company is the secret context the server needs for writes. */
  update: (environmentId: string, companyId: string, body: { name?: string; description?: string | null; status?: "active" | "archived" }) =>
    api.patch<Environment>(`/environments/${encodeURIComponent(environmentId)}?companyId=${encodeURIComponent(companyId)}`, body),
  /** What a delete would touch, and whether it's allowed. */
  deleteBlastRadius: (environmentId: string, signal?: AbortSignal) =>
    api.get<EnvironmentDeleteBlastRadius>(`/environments/${encodeURIComponent(environmentId)}/delete-blast-radius`, { signal }),
  remove: (environmentId: string) => api.delete<Environment>(`/environments/${encodeURIComponent(environmentId)}`),
};
