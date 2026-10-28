import type { CompanySecret, CompanySecretProviderConfig, SecretProposalView, SecretProvider, SecretProviderDescriptor, UserSecretCoverageSummary } from "@paperclipai/shared";

/*
 * Secrets (board 24): the organization's secrets, where their values are stored, the per-person
 * secrets each member sets, and the secrets agents ask for while working.
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
