import type { CompanySecret, UserSecretDefinition } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's secrets and per-person secret definitions, for the environment variables a project
 * sets (ui/src/api/secrets.ts). Values are never read back: a variable points to a secret by id, or
 * to a person's own secret by key. Creating one stores its value on the server.
 */
export const secretsApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<CompanySecret[]>(`/companies/${encodeURIComponent(companyId)}/secrets`, { signal }),
  create: (companyId: string, data: { name: string; value: string }) =>
    api.post<CompanySecret>(`/companies/${encodeURIComponent(companyId)}/secrets`, data),
  userDefinitions: (companyId: string, signal?: AbortSignal) =>
    api.get<UserSecretDefinition[]>(`/companies/${encodeURIComponent(companyId)}/user-secret-definitions`, { signal }),
};
