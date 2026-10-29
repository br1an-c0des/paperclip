import type {
  CompanySecret,
  CompanySecretProviderConfig,
  RemoteSecretImportCandidate,
  RemoteSecretImportResult,
  SecretAccessEvent,
  SecretProposalView,
  SecretProvider,
  SecretProviderConfigDiscoveryCandidate,
  SecretProviderConfigStatus,
  SecretProviderDescriptor,
  UserSecretCoverageSummary,
} from "@paperclipai/shared";

/*
 * Secrets (board 24): the organization's secrets, where their values are stored, the per-person
 * secrets each member sets, and the secrets agents ask for while working. The vaults (provider
 * configs), importing a vault's existing secrets and a secret's access log are the old Secrets
 * page's, ported in M7.
 */

/** The organization's own secrets: company-scoped and not deleted, by name. */
export function organizationSecrets(secrets: readonly CompanySecret[] | undefined) {
  return (secrets ?? []).filter((secret) => secret.scope === "company" && secret.status !== "deleted").sort((a, b) => a.name.localeCompare(b.name));
}

const PROVIDER_NAMES: Record<SecretProvider, string> = {
  local_encrypted: "Paperclip vault",
  aws_secrets_manager: "AWS Secrets Manager",
  gcp_secret_manager: "GCP Secret Manager",
  vault: "HashiCorp Vault",
};

/** Where a secret's value lives: its provider config's name, else the provider's. */
export function storedIn(secret: Pick<CompanySecret, "provider" | "providerConfigId">, configs: readonly CompanySecretProviderConfig[] | undefined) {
  const config = secret.providerConfigId ? configs?.find((entry) => entry.id === secret.providerConfigId) : undefined;
  return config?.displayName ?? PROVIDER_NAMES[secret.provider] ?? secret.provider;
}

export function providerName(provider: SecretProvider) {
  return PROVIDER_NAMES[provider] ?? provider;
}

/** "Not used", "1 use", "6 uses". */
export function usesLabel(count: number | undefined) {
  if (!count) return "Not used";
  return count === 1 ? "1 use" : `${count} uses`;
}

/** "No secrets", "1 secret", "4 secrets". */
export function secretsLabel(count: number | undefined) {
  if (!count) return "No secrets";
  return count === 1 ? "1 secret" : `${count} secrets`;
}

/** How many secrets each provider holds, for the Providers card. */
export function secretCounts(secrets: readonly CompanySecret[]) {
  const counts = new Map<SecretProvider, number>();
  for (const secret of secrets) counts.set(secret.provider, (counts.get(secret.provider) ?? 0) + 1);
  return counts;
}

/** The providers worth listing: configured ones, plus any that already hold secrets. */
export function listedProviders(descriptors: readonly SecretProviderDescriptor[] | undefined, counts: Map<SecretProvider, number>) {
  return (descriptors ?? []).filter((descriptor) => descriptor.configured || (counts.get(descriptor.id) ?? 0) > 0);
}

/** "Quant Researcher asked for COINGLASS_API_KEY", or a binding of an existing secret. */
export function proposalTitle(proposal: SecretProposalView): { who: string; what: string; name: string } {
  if (proposal.kind === "secret") {
    return { who: proposal.proposedBy.name, what: "asked for a new secret,", name: proposal.proposedName ?? proposal.proposedKey ?? "a secret" };
  }
  const secret = proposal.secretName ?? proposal.secretProposalName ?? "a secret";
  return { who: proposal.proposedBy.name, what: `wants ${proposal.target?.name ?? "an agent"} to use`, name: secret };
}

/** The proposal's reason, task and when. */
export function proposalMeta(proposal: SecretProposalView, now = new Date()) {
  const parts: string[] = [];
  if (proposal.justification) parts.push(proposal.justification);
  if (proposal.originIssue) parts.push(`on ${proposal.originIssue.key}`);
  if (proposal.kind === "binding" && proposal.configPath) parts.push(`as ${proposal.configPath}`);
  const created = new Date(proposal.createdAt);
  if (!Number.isNaN(created.getTime())) {
    const sameDay = created.toDateString() === now.toDateString();
    parts.push(sameDay ? `today at ${created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()}` : created.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }
  return parts.join(" · ");
}

/** "2 of 3 people have set it". */
export function coverageLabel(coverage: UserSecretCoverageSummary | undefined) {
  if (!coverage) return "";
  const total = coverage.configuredCount + coverage.missingCount + coverage.inactiveCount;
  if (total === 0) return "Nobody needs it yet";
  return `${coverage.configuredCount} of ${total} ${total === 1 ? "person has" : "people have"} set it`;
}

/** Secret keys: letters, digits, dots, dashes and underscores, as the server accepts them. */
export function keyProblem(key: string): string | null {
  const value = key.trim();
  if (!value) return "Enter a key, such as GITHUB_TOKEN.";
  if (value.length > 120) return "Keep the key under 120 characters.";
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) return "Use letters, digits, dots, dashes and underscores only.";
  return null;
}

/** A key from a typed name: "Personal GitHub token" → "PERSONAL_GITHUB_TOKEN". */
export function keyFromName(name: string) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------------------------
// Vaults (provider configs), from the old Secrets page's Provider vaults tab

/** The providers in the order the old page lists them. GCP and HashiCorp Vault save settings only. */
export const VAULT_PROVIDERS: readonly SecretProvider[] = ["local_encrypted", "aws_secrets_manager", "gcp_secret_manager", "vault"];

/** Providers whose vaults are draft settings only: Paperclip can't store or read values there yet. */
export function vaultComingSoon(provider: SecretProvider) {
  return provider === "gcp_secret_manager" || provider === "vault";
}

export type VaultField = { key: string; label: string; placeholder: string; required?: boolean };

/** Each provider's routing settings (the old page's ProviderVaultFields). */
export const VAULT_FIELDS: Record<SecretProvider, readonly VaultField[]> = {
  local_encrypted: [],
  aws_secrets_manager: [
    { key: "region", label: "AWS region", placeholder: "us-east-1", required: true },
    { key: "namespace", label: "Namespace", placeholder: "production" },
    { key: "secretNamePrefix", label: "Secret name prefix", placeholder: "paperclip" },
    { key: "kmsKeyId", label: "KMS key ID", placeholder: "alias/paperclip-secrets" },
    { key: "ownerTag", label: "Owner tag", placeholder: "platform" },
    { key: "environmentTag", label: "Environment tag", placeholder: "prod" },
  ],
  gcp_secret_manager: [
    { key: "projectId", label: "Project ID", placeholder: "paperclip-prod" },
    { key: "location", label: "Location", placeholder: "global" },
    { key: "namespace", label: "Namespace", placeholder: "production" },
    { key: "secretNamePrefix", label: "Secret name prefix", placeholder: "paperclip" },
  ],
  vault: [
    { key: "address", label: "Address", placeholder: "https://vault.example.com" },
    { key: "namespace", label: "Namespace", placeholder: "admin" },
    { key: "mountPath", label: "Mount path", placeholder: "secret" },
    { key: "secretPathPrefix", label: "Secret path prefix", placeholder: "paperclip/prod" },
  ],
};

export type VaultForm = {
  provider: SecretProvider;
  displayName: string;
  isDefault: boolean;
  /** Paperclip vault only: backups need both the database and the key file. */
  backupReminderAcknowledged: boolean;
  fields: Record<string, string>;
};

export function emptyVaultForm(provider: SecretProvider): VaultForm {
  return { provider, displayName: "", isDefault: false, backupReminderAcknowledged: false, fields: {} };
}

export function vaultForm(config: CompanySecretProviderConfig): VaultForm {
  const values = (config.config ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const field of VAULT_FIELDS[config.provider] ?? []) {
    if (typeof values[field.key] === "string") fields[field.key] = values[field.key] as string;
  }
  return { provider: config.provider, displayName: config.displayName, isDefault: config.isDefault, backupReminderAcknowledged: values.backupReminderAcknowledged === true, fields };
}

/** The `config` a vault saves: blank optional fields become null, as the old page sends them. */
export function vaultConfig(form: VaultForm): Record<string, unknown> {
  if (form.provider === "local_encrypted") return { backupReminderAcknowledged: form.backupReminderAcknowledged };
  const config: Record<string, unknown> = {};
  for (const field of VAULT_FIELDS[form.provider] ?? []) {
    const value = (form.fields[field.key] ?? "").trim();
    config[field.key] = field.required ? value : value || null;
  }
  return config;
}

export function vaultProblem(form: VaultForm): string | null {
  if (!form.displayName.trim()) return "Give the vault a name.";
  for (const field of VAULT_FIELDS[form.provider] ?? []) {
    if (field.required && !(form.fields[field.key] ?? "").trim()) return `Enter the ${field.label}.`;
  }
  if (form.provider === "local_encrypted" && !form.backupReminderAcknowledged) return "Confirm you know how to back it up.";
  return null;
}

/** New vaults of providers that can't store values yet are saved as drafts. */
export function vaultStatus(provider: SecretProvider): SecretProviderConfigStatus {
  return vaultComingSoon(provider) ? "coming_soon" : "ready";
}

/** Why a vault can't take new secrets or imports, or null. */
export function vaultBlockReason(config: Pick<CompanySecretProviderConfig, "status" | "healthStatus" | "healthMessage">): string | null {
  if (config.status === "disabled") return "It's turned off.";
  if (config.status === "coming_soon") return "It's saved as draft settings only.";
  if (config.healthStatus === "error") return config.healthMessage ?? "Its last health check failed.";
  return null;
}

/** AWS discovery searches by the most specific routing field typed so far. */
export function discoveryQuery(form: VaultForm): string | null {
  return ["secretNamePrefix", "namespace", "environmentTag", "ownerTag"].map((key) => (form.fields[key] ?? "").trim()).find(Boolean) ?? null;
}

/** Fills the routing fields from a discovered AWS candidate, keeping a name already typed. */
export function applyCandidate(form: VaultForm, candidate: SecretProviderConfigDiscoveryCandidate): VaultForm {
  if (candidate.provider !== "aws_secrets_manager") return form;
  const config = candidate.config as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const field of VAULT_FIELDS.aws_secrets_manager) fields[field.key] = typeof config[field.key] === "string" ? (config[field.key] as string) : "";
  return { ...form, displayName: form.displayName.trim() ? form.displayName : candidate.displayName, fields };
}

/** Vaults existing secrets can be imported from: AWS ones that are on. */
export function importableVaults(configs: readonly CompanySecretProviderConfig[] | undefined) {
  return (configs ?? []).filter((config) => config.provider === "aws_secrets_manager" && (config.status === "ready" || config.status === "warning"));
}

// ---------------------------------------------------------------------------------------------
// Importing a vault's existing secrets as references

export type ImportDraft = { candidate: RemoteSecretImportCandidate; name: string; key: string };

const IMPORT_KEY = /^[a-z0-9_.-]+$/;

/** A secret key from a remote name, as the old import dialog makes one. */
export function importKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function importDraft(candidate: RemoteSecretImportCandidate): ImportDraft {
  return { candidate, name: candidate.name, key: candidate.key || importKey(candidate.remoteName) };
}

/** Why a selected row can't be imported: a bad name or key, or one a secret or another row already has. */
export function importDraftProblem(draft: ImportDraft, existing: readonly Pick<CompanySecret, "name" | "key">[], drafts: readonly ImportDraft[]): string | null {
  const name = draft.name.trim().toLowerCase();
  const key = draft.key.trim().toLowerCase();
  if (!name) return "Give it a name.";
  if (draft.name.length > 160) return "Keep the name under 160 characters.";
  if (!key) return "Give it a key.";
  if (!IMPORT_KEY.test(draft.key)) return "Keys use lowercase letters, digits, dots, dashes and underscores.";
  if (draft.key.length > 120) return "Keep the key under 120 characters.";
  for (const secret of existing) {
    if (secret.name.trim().toLowerCase() === name) return "A secret already has this name.";
    if (secret.key.trim().toLowerCase() === key) return "A secret already has this key.";
  }
  for (const other of drafts) {
    if (other.candidate.externalRef === draft.candidate.externalRef) continue;
    if (other.name.trim().toLowerCase() === name) return "Another selected secret has this name.";
    if (other.key.trim().toLowerCase() === key) return "Another selected secret has this key.";
  }
  return null;
}

/** "3 imported · 1 skipped · 0 failed". */
export function importResultLine(result: Pick<RemoteSecretImportResult, "importedCount" | "skippedCount" | "errorCount">) {
  return `${result.importedCount} imported · ${result.skippedCount} skipped · ${result.errorCount} failed`;
}

// ---------------------------------------------------------------------------------------------
// Access events

const CONSUMER_LABELS: Record<string, string> = { agent_api: "Agent API", plugin_worker: "Plugin worker", tool_connection: "Tool connection" };

/** "Agent", "Agent API", "Plugin worker"… (ui/src/lib/secret-delivery.ts). */
export function consumerLabel(consumerType: SecretAccessEvent["consumerType"]) {
  return CONSUMER_LABELS[consumerType] ?? consumerType.charAt(0).toUpperCase() + consumerType.slice(1).replace(/_/g, " ");
}
