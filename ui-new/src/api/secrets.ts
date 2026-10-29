import type {
  ApproveSecretProposalInput,
  CompanySecret,
  CompanySecretProviderConfig,
  CompanySecretUsageBinding,
  RejectSecretProposalInput,
  RemoteSecretImportPreviewResult,
  RemoteSecretImportResult,
  SecretAccessEvent,
  SecretProposalView,
  SecretProvider,
  SecretProviderConfigDiscoveryPreviewResult,
  SecretProviderConfigHealthResponse,
  SecretProviderConfigStatus,
  SecretProviderDescriptor,
  SecretStatus,
  UserSecretCoverageSummary,
  UserSecretDefinition,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's secrets (ui/src/api/secrets.ts). Values are never read back: a variable points to
 * a secret by id, or to a person's own secret by key. Creating or rotating one stores its value on
 * the server.
 *
 * Projects and agents use the list, the create and the per-person definitions. Company settings →
 * Secrets (board 24) adds the rest: editing, rotating, disabling and deleting a secret, where it's
 * used and who read it, the providers and their vaults (set up, edited, checked, turned off,
 * removed, discovered from AWS), importing a vault's existing secrets as references, per-person
 * definitions and your own values, and the secrets agents propose.
 */

/** One "My secrets" row: a company definition paired with your own value, if you set one. */
export type MyUserSecretEntry = { definition: UserSecretDefinition; secret: CompanySecret | null };

export type UpdateSecretInput = { name?: string; key?: string; status?: SecretStatus; description?: string | null };

/** A vault (provider config): where a provider stores this company's values, and how they're named. */
export type ProviderConfigInput = {
  provider: SecretProvider;
  displayName: string;
  status?: SecretProviderConfigStatus;
  isDefault?: boolean;
  config?: Record<string, unknown>;
};

export type ProviderDiscoveryInput = { provider: SecretProvider; config?: Record<string, unknown>; query?: string | null; nextToken?: string | null; pageSize?: number };

/** One existing provider secret to import as a reference, with the name and key it gets here. */
export type RemoteImportSelection = {
  externalRef: string;
  name?: string | null;
  key?: string | null;
  description?: string | null;
  providerVersionRef?: string | null;
  providerMetadata?: Record<string, unknown> | null;
};

/** Not exported from `@paperclipai/shared` (decision 10): ui/src/api/secrets.ts declares it. */
export type SecretProviderHealthResponse = {
  providers: Array<{
    provider: SecretProvider;
    status: "ok" | "warn" | "error";
    message: string;
    warnings?: string[];
    backupGuidance?: string[];
    details?: Record<string, unknown>;
  }>;
};

const company = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`;
const secret = (secretId: string) => `/secrets/${encodeURIComponent(secretId)}`;

export const secretsApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<CompanySecret[]>(`${company(companyId)}/secrets`, { signal }),
  /** Stores a new secret. Without a provider config it goes to the company's default store. */
  create: (companyId: string, data: { name: string; value: string; description?: string | null; providerConfigId?: string | null }) =>
    api.post<CompanySecret>(`${company(companyId)}/secrets`, data),
  update: (secretId: string, data: UpdateSecretInput) => api.patch<CompanySecret>(secret(secretId), data),
  /** Stores a new value as the secret's next version. */
  rotate: (secretId: string, value: string) => api.post<CompanySecret>(`${secret(secretId)}/rotate`, { value }),
  remove: (secretId: string) => api.delete<{ ok: true }>(secret(secretId)),
  usage: (secretId: string, signal?: AbortSignal) =>
    api.get<{ secretId: string; bindings: CompanySecretUsageBinding[] }>(`${secret(secretId)}/usage`, { signal }),

  providers: (companyId: string, signal?: AbortSignal) =>
    api.get<SecretProviderDescriptor[]>(`${company(companyId)}/secret-providers`, { signal }),
  providerConfigs: (companyId: string, signal?: AbortSignal) =>
    api.get<CompanySecretProviderConfig[]>(`${company(companyId)}/secret-provider-configs`, { signal }),
  checkProviderConfig: (configId: string) =>
    api.post<SecretProviderConfigHealthResponse>(`/secret-provider-configs/${encodeURIComponent(configId)}/health`, {}),
  setDefaultProviderConfig: (configId: string) =>
    api.post<CompanySecretProviderConfig>(`/secret-provider-configs/${encodeURIComponent(configId)}/default`, {}),
  /** The deployment's own provider settings and their health (AWS's prefix and deployment id among the details). */
  providerHealth: (companyId: string, signal?: AbortSignal) =>
    api.get<SecretProviderHealthResponse>(`${company(companyId)}/secret-providers/health`, { signal }),
  createProviderConfig: (companyId: string, data: ProviderConfigInput) =>
    api.post<CompanySecretProviderConfig>(`${company(companyId)}/secret-provider-configs`, data),
  /** Edits a vault; `{ status: "disabled" }` turns it off. */
  updateProviderConfig: (configId: string, data: Partial<ProviderConfigInput>) =>
    api.patch<CompanySecretProviderConfig>(`/secret-provider-configs/${encodeURIComponent(configId)}`, data),
  removeProviderConfig: (configId: string) => api.delete<CompanySecretProviderConfig>(`/secret-provider-configs/${encodeURIComponent(configId)}`),
  /** Reads AWS Secrets Manager metadata (never values) to suggest a vault's routing settings. */
  discoverProviderConfig: (companyId: string, data: ProviderDiscoveryInput) =>
    api.post<SecretProviderConfigDiscoveryPreviewResult>(`${company(companyId)}/secret-provider-configs/discovery/preview`, data),
  /** Lists a vault's existing secrets that could be imported as references, page by page. */
  remoteImportPreview: (companyId: string, data: { providerConfigId: string; query?: string | null; nextToken?: string | null; pageSize?: number }) =>
    api.post<RemoteSecretImportPreviewResult>(`${company(companyId)}/secrets/remote-import/preview`, data),
  remoteImport: (companyId: string, data: { providerConfigId: string; secrets: RemoteImportSelection[] }) =>
    api.post<RemoteSecretImportResult>(`${company(companyId)}/secrets/remote-import`, data),
  /** Each time a run, agent or plugin read the secret's value (redacted). */
  accessEvents: (secretId: string, signal?: AbortSignal) => api.get<SecretAccessEvent[]>(`${secret(secretId)}/access-events`, { signal }),

  userDefinitions: (companyId: string, signal?: AbortSignal) =>
    api.get<UserSecretDefinition[]>(`${company(companyId)}/user-secret-definitions`, { signal }),
  createUserDefinition: (companyId: string, data: { key: string; name: string; description?: string | null }) =>
    api.post<UserSecretDefinition>(`${company(companyId)}/user-secret-definitions`, data),
  removeUserDefinition: (companyId: string, definitionId: string) =>
    api.delete<{ ok: true }>(`${company(companyId)}/user-secret-definitions/${encodeURIComponent(definitionId)}`),
  userDefinitionCoverage: (companyId: string, definitionId: string, signal?: AbortSignal) =>
    api.get<UserSecretCoverageSummary>(`${company(companyId)}/user-secret-definitions/${encodeURIComponent(definitionId)}/coverage`, { signal }),

  mySecrets: (companyId: string, signal?: AbortSignal) => api.get<MyUserSecretEntry[]>(`${company(companyId)}/me/user-secrets`, { signal }),
  setMySecret: (companyId: string, definitionId: string, value: string) =>
    api.post<CompanySecret>(`${company(companyId)}/me/user-secrets`, { definitionId, value }),
  rotateMySecret: (companyId: string, secretId: string, value: string) =>
    api.post<CompanySecret>(`${company(companyId)}/me/user-secrets/${encodeURIComponent(secretId)}/rotate`, { value }),
  removeMySecret: (companyId: string, secretId: string) =>
    api.delete<{ ok: true }>(`${company(companyId)}/me/user-secrets/${encodeURIComponent(secretId)}`),

  proposals: (companyId: string, signal?: AbortSignal) =>
    api.get<SecretProposalView[]>(`${company(companyId)}/secret-proposals?status=pending`, { signal }),
  approveProposal: (companyId: string, proposalId: string, data: ApproveSecretProposalInput = {}) =>
    api.post<SecretProposalView>(`${company(companyId)}/secret-proposals/${encodeURIComponent(proposalId)}/approve`, data),
  rejectProposal: (companyId: string, proposalId: string, data: RejectSecretProposalInput) =>
    api.post<SecretProposalView>(`${company(companyId)}/secret-proposals/${encodeURIComponent(proposalId)}/reject`, data),
};
