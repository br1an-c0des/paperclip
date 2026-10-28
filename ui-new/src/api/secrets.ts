import type {
  ApproveSecretProposalInput,
  CompanySecret,
  CompanySecretProviderConfig,
  CompanySecretUsageBinding,
  RejectSecretProposalInput,
  SecretProposalView,
  SecretProviderConfigHealthResponse,
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
 * used, the providers and their configurations, per-person definitions and your own values, and
 * the secrets agents propose.
 */

/** One "My secrets" row: a company definition paired with your own value, if you set one. */
export type MyUserSecretEntry = { definition: UserSecretDefinition; secret: CompanySecret | null };

export type UpdateSecretInput = { name?: string; key?: string; status?: SecretStatus; description?: string | null };

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
