import type { Environment } from "@paperclipai/shared";
import { api } from "./client";

/* The company's execution environments (ui/src/api/environments.ts), for where a project's task checkouts run. */
export const environmentsApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<Environment[]>(`/companies/${encodeURIComponent(companyId)}/environments`, { signal }),
};
