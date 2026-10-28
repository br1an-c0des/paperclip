import type { Environment, EnvironmentProbeResult } from "@paperclipai/shared";
import { api } from "./client";

/* The company's execution environments (ui/src/api/environments.ts), for where a project's task checkouts run. */
export const environmentsApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<Environment[]>(`/companies/${encodeURIComponent(companyId)}/environments`, { signal }),
  /** Probes an environment; on a sandbox this records the platform qualification the Paperclip Runner needs. */
  probe: (environmentId: string, companyId: string) =>
    api.post<EnvironmentProbeResult>(`/environments/${encodeURIComponent(environmentId)}/probe?companyId=${encodeURIComponent(companyId)}`, {}),
};
