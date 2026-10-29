import type {
  AgentEnvConfig,
  Environment,
  EnvironmentCapabilities,
  EnvironmentDeleteBlastRadius,
  EnvironmentDriver,
  EnvironmentProbeResult,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's execution environments (ui/src/api/environments.ts): where a project's task
 * checkouts and an agent's runs happen. Company settings → Environments lists them, creates and
 * edits them (SSH hosts and sandbox providers), probes them saved or as a draft, archives or
 * restores them, and deletes one once nothing depends on it.
 *
 * Custom sandbox images, their setup sessions and the terminal are on hold (decision 39, D7).
 */

/** One secret an environment's settings point at; it may belong to another organization. */
export type EnvironmentSecretRef = {
  configPath: string;
  secretId: string;
  name: string;
  status: string;
  companyId: string;
  companyName: string | null;
};

/** What creating an environment or probing a draft sends. */
export type EnvironmentInput = {
  name: string;
  description?: string | null;
  driver: EnvironmentDriver;
  config?: Record<string, unknown>;
  envVars?: AgentEnvConfig;
};

/** An edit; a Paperclip-managed environment takes only `envVars`. */
export type EnvironmentPatch = Partial<EnvironmentInput> & { status?: "active" | "archived" };

const forCompany = (companyId: string) => `companyId=${encodeURIComponent(companyId)}`;

export const environmentsApi = {
  list: (companyId: string, signal?: AbortSignal) =>
    api.get<Environment[]>(`/companies/${encodeURIComponent(companyId)}/environments`, { signal }),
  /** The drivers and sandbox providers this instance offers, with each provider's settings schema. */
  capabilities: (companyId: string, signal?: AbortSignal) =>
    api.get<EnvironmentCapabilities>(`/companies/${encodeURIComponent(companyId)}/environments/capabilities`, { signal }),
  /** Names the secrets an environment's settings point at, so one from another organization isn't shown as missing. */
  secretRefs: (environmentId: string, signal?: AbortSignal) =>
    api.get<{ refs: EnvironmentSecretRef[] }>(`/environments/${encodeURIComponent(environmentId)}/secret-refs`, { signal }),
  create: (companyId: string, body: EnvironmentInput) => api.post<Environment>(`/companies/${encodeURIComponent(companyId)}/environments`, body),
  /** Probes an environment; on a sandbox this records the platform qualification the Paperclip Runner needs. */
  probe: (environmentId: string, companyId: string) =>
    api.post<EnvironmentProbeResult>(`/environments/${encodeURIComponent(environmentId)}/probe?${forCompany(companyId)}`, {}),
  /** Probes settings before they're saved. */
  probeConfig: (companyId: string, body: EnvironmentInput) =>
    api.post<EnvironmentProbeResult>(`/companies/${encodeURIComponent(companyId)}/environments/probe-config`, body),
  /** The company is the secret context the server needs for writes. */
  update: (environmentId: string, companyId: string, body: EnvironmentPatch) =>
    api.patch<Environment>(`/environments/${encodeURIComponent(environmentId)}?${forCompany(companyId)}`, body),
  /** What a delete would touch, and whether it's allowed. */
  deleteBlastRadius: (environmentId: string, signal?: AbortSignal) =>
    api.get<EnvironmentDeleteBlastRadius>(`/environments/${encodeURIComponent(environmentId)}/delete-blast-radius`, { signal }),
  remove: (environmentId: string) => api.delete<Environment>(`/environments/${encodeURIComponent(environmentId)}`),
};
