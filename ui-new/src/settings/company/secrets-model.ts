import type {
  Agent,
  CompanySecret,
  CompanySecretProviderConfig,
  RemoteSecretImportCandidate,
  RemoteSecretImportResult,
  SecretAccessEvent,
  SecretAccessOutcome,
  SecretProposalStatus,
  SecretProposalView,
  SecretProvider,
  SecretProviderConfigDiscoveryCandidate,
  SecretProviderConfigStatus,
  SecretProviderDescriptor,
  SecretStatus,
  UserSecretCoverageSummary,
  UserSecretDefinition,
} from "@paperclipai/shared";
import type { SecretProviderHealthResponse } from "@/api/secrets";

/*
 * Secrets (board 24, redesigned after upstream #21225, build plan U135): one list of the secrets
 * the team added, each provided by the organization (one shared value) or by each user (everyone
 * adds their own), with the agents that use it. Credentials Paperclip saved itself (connections,
 * chat channels, model sign-ins, routine webhooks, the trace exporter) are kept apart under
 * "Managed by Paperclip", grouped by where they came from. The vaults (provider configs), importing
 * a vault's existing secrets, the requests agents make and a person's own values sit beside it.
 */

// ---------------------------------------------------------------------------------------------
// The list: organization secrets and the secrets each user provides, as one set of rows

/** The organization's own secrets: company-scoped and not deleted, by name. */
export function organizationSecrets(secrets: readonly CompanySecret[] | undefined) {
  return (secrets ?? []).filter((secret) => secret.scope === "company" && secret.status !== "deleted").sort((a, b) => a.name.localeCompare(b.name));
}

/** One row of the list: an organization secret, or a secret each user provides (a definition). */
export type SecretRow =
  | { id: string; kind: "company"; name: string; key: string; status: SecretStatus; secret: CompanySecret }
  | { id: string; kind: "user"; name: string; key: string; status: SecretStatus; definition: UserSecretDefinition };

export function secretRows(secrets: readonly CompanySecret[] | undefined, definitions: readonly UserSecretDefinition[] | undefined): SecretRow[] {
  return [
    ...organizationSecrets(secrets).map((secret): SecretRow => ({ id: `company:${secret.id}`, kind: "company", name: secret.name, key: secret.key, status: secret.status, secret })),
    ...(definitions ?? [])
      .filter((definition) => definition.status !== "deleted")
      .map((definition): SecretRow => ({ id: `user:${definition.id}`, kind: "user", name: definition.name, key: definition.key, status: definition.status, definition })),
  ].sort((a, b) => collator.compare(a.name, b.name));
}

export type ProvidedBy = "all" | "company" | "user";
/** "current" is everything still in play: active and disabled, not archived. */
export type StatusFilter = "current" | "disabled" | "archived";
export type SecretFilters = { search: string; providedBy: ProvidedBy; provider: SecretProvider | "all"; status: StatusFilter };

export const NO_FILTERS: SecretFilters = { search: "", providedBy: "all", provider: "all", status: "current" };

function rowMatches(row: SecretRow, needle: string) {
  const fields =
    row.kind === "company"
      ? [row.secret.name, row.secret.key, row.secret.description, row.secret.externalRef]
      : [row.definition.name, row.definition.key, row.definition.description, row.definition.usageGuidance];
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/** The rows the search and filters keep. Archived rows show only when asked for. */
export function filterRows(rows: readonly SecretRow[], filters: SecretFilters): SecretRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.providedBy !== "all" && row.kind !== filters.providedBy) return false;
    if (filters.status === "current" ? row.status !== "active" && row.status !== "disabled" : row.status !== filters.status) return false;
    if (filters.provider !== "all" && row.kind === "company" && row.secret.provider !== filters.provider) return false;
    return !needle || rowMatches(row, needle);
  });
}

/** The filters set apart from the defaults, as removable chips. */
export function filterChips(filters: SecretFilters, providerLabel: (provider: SecretProvider) => string): { key: keyof SecretFilters; label: string }[] {
  const chips: { key: keyof SecretFilters; label: string }[] = [];
  if (filters.providedBy !== "all") chips.push({ key: "providedBy", label: filters.providedBy === "user" ? "Each user" : "Organization" });
  if (filters.provider !== "all") chips.push({ key: "provider", label: filters.provider === "local_encrypted" ? "Paperclip" : providerLabel(filters.provider) });
  if (filters.status !== "current") chips.push({ key: "status", label: filters.status === "archived" ? "Archived" : "Disabled" });
  return chips;
}

export function statusLabel(status: SecretStatus) {
  return status === "active" ? "Active" : status === "disabled" ? "Disabled" : status === "archived" ? "Archived" : "Deleted";
}

// ---------------------------------------------------------------------------------------------
// Managed by Paperclip: secrets Paperclip saved itself (upstream's secret-origin.ts)

/*
 * Secrets don't record where they came from, so the origin is read from the naming conventions of
 * the server modules that save them: connection credentials (`tool_app.*`, `tool_oauth.*`,
 * `slack_manager.*`), chat channels (`chat.<platform>.*`), model sign-ins (`ai_<uuid>`), routine
 * webhooks (`routine-<uuid>-<hex>`) and the trace exporter (`agent-observability.*`). It only groups
 * the list; it never hides or blocks anything.
 */

export type SecretOrigin = "team" | "connections" | "chat" | "models" | "routines" | "observability";
export type ManagedOrigin = Exclude<SecretOrigin, "team">;

export const ORIGIN_GROUPS: readonly { id: ManagedOrigin; label: string; detail: string }[] = [
  { id: "models", label: "Model sign-ins", detail: "Accounts and keys for the models your agents run on" },
  { id: "connections", label: "Connections", detail: "Tokens for the apps you connected" },
  { id: "chat", label: "Chat channels", detail: "Credentials for chat apps your agents answer in" },
  { id: "routines", label: "Routine webhooks", detail: "Signing secrets for routine triggers" },
  { id: "observability", label: "Agent observability", detail: "Headers for your trace exporter" },
];

const UUID = "[0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}";
const MODEL_KEY = new RegExp(`^ai[-_]${UUID}$`, "i");
const ROUTINE_NAME = new RegExp(`^routine-${UUID}-[0-9a-f]+$`, "i");

export function classifyOrigin(input: { key: string; name: string }): SecretOrigin {
  const key = input.key.toLowerCase();
  const name = input.name.toLowerCase();
  if (key.startsWith("tool_app.") || key.startsWith("tool_oauth.") || key.startsWith("slack_manager.")) return "connections";
  if (MODEL_KEY.test(key) || MODEL_KEY.test(name)) return "models";
  if (name.startsWith("chat.") || key.startsWith("chat_") || key.startsWith("chat.")) return "chat";
  if (ROUTINE_NAME.test(name)) return "routines";
  if (name.startsWith("agent-observability.") || key.startsWith("agent_observability_headers_")) return "observability";
  return "team";
}

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

const PLATFORM_NAMES: Record<string, string> = { github: "GitHub" };

function platformName(value: string) {
  return PLATFORM_NAMES[value.toLowerCase()] ?? (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
}

/** A readable name for a secret Paperclip saved: their stored names carry record ids. */
export function managedLabel(input: { key: string; name: string }, origin: SecretOrigin): string {
  const name = input.name.trim();
  if (origin === "chat") {
    const [, platform, , field] = name.split(".");
    if (platform && field) return `${platformName(platform)} ${words(field)}`;
  }
  if (origin === "routines") return "Routine webhook secret";
  if (origin === "observability") return "Trace exporter headers";
  if (origin === "models" && MODEL_KEY.test(name)) return "Model provider key";
  if (origin === "connections") return name.replace(/\s+[0-9a-f]{8}$/i, "");
  return name;
}

export type ManagedGroup = { group: (typeof ORIGIN_GROUPS)[number]; rows: SecretRow[] };

/** The team's rows, and the rest grouped by origin in ORIGIN_GROUPS' order. */
export function splitByOrigin(rows: readonly SecretRow[]): { team: SecretRow[]; managed: ManagedGroup[]; managedCount: number } {
  const team: SecretRow[] = [];
  const byOrigin = new Map<SecretOrigin, SecretRow[]>();
  for (const row of rows) {
    const origin = classifyOrigin(row);
    if (origin === "team") team.push(row);
    else byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), row]);
  }
  const managed = ORIGIN_GROUPS.flatMap((group) => {
    const found = byOrigin.get(group.id);
    return found ? [{ group, rows: found }] : [];
  });
  return { team, managed, managedCount: rows.length - team.length };
}

// ---------------------------------------------------------------------------------------------
// Which agents use a secret (upstream's agent-secret-access.ts)

/*
 * An agent uses a secret through a binding in its adapter config: an environment variable
 * (`env.<KEY>`, `{ type: "secret_ref", secretId }`, or `{ type: "user_secret_ref", key }` for a
 * secret each user provides) or an API alias (`access.<ALIAS>`, company secrets only), which the
 * run fetches on demand. One pass over the agents list answers "who uses it?" for every row.
 */

export const ACCESS_PREFIX = "access.";

/** A valid environment variable name or API alias (the server's `ENV_KEY_RE`). */
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type AccessReference = { kind: "company"; secret: Pick<CompanySecret, "id" | "name"> } | { kind: "user"; definition: Pick<UserSecretDefinition, "id" | "key" | "name"> };

type Binding = Record<string, unknown>;

function isBinding(value: unknown): value is Binding {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingMatches(binding: Binding, reference: AccessReference) {
  return reference.kind === "company"
    ? binding.type === "secret_ref" && binding.secretId === reference.secret.id
    : binding.type === "user_secret_ref" && binding.key === reference.definition.key;
}

/** The env keys in an agent's `env` that resolve to this secret. */
export function envKeysFor(env: unknown, reference: AccessReference): string[] {
  if (!isBinding(env)) return [];
  return Object.entries(env)
    .filter(([, binding]) => isBinding(binding) && bindingMatches(binding, reference))
    .map(([key]) => key)
    .sort();
}

/** The `access.<ALIAS>` keys in an agent's adapter config that resolve to this secret. */
export function apiAliasesFor(adapterConfig: unknown, reference: AccessReference): string[] {
  if (reference.kind !== "company" || !isBinding(adapterConfig)) return [];
  return Object.entries(adapterConfig)
    .filter(([key, binding]) => key.startsWith(ACCESS_PREFIX) && isBinding(binding) && bindingMatches(binding, reference))
    .map(([key]) => key.slice(ACCESS_PREFIX.length))
    .sort();
}

export type AgentUsage = { bySecretId: Map<string, Agent[]>; byUserKey: Map<string, Agent[]> };

function pushAgent(map: Map<string, Agent[]>, key: string, agent: Agent) {
  const list = map.get(key);
  if (!list) map.set(key, [agent]);
  else if (list[list.length - 1] !== agent) list.push(agent);
}

/** Which agents hold which secret, from the agents' own configs. Retired agents don't count. */
export function agentUsage(agents: readonly Agent[] | undefined): AgentUsage {
  const usage: AgentUsage = { bySecretId: new Map(), byUserKey: new Map() };
  for (const agent of agents ?? []) {
    if (agent.status === "terminated") continue;
    const config = agent.adapterConfig as unknown;
    if (!isBinding(config)) continue;
    const bindings = [
      ...(isBinding(config.env) ? Object.values(config.env) : []),
      ...Object.entries(config)
        .filter(([key]) => key.startsWith(ACCESS_PREFIX))
        .map(([, binding]) => binding),
    ];
    for (const binding of bindings) {
      if (!isBinding(binding)) continue;
      if (binding.type === "secret_ref" && typeof binding.secretId === "string") pushAgent(usage.bySecretId, binding.secretId, agent);
      else if (binding.type === "user_secret_ref" && typeof binding.key === "string") pushAgent(usage.byUserKey, binding.key, agent);
    }
  }
  return usage;
}

export function rowAgents(row: SecretRow, usage: AgentUsage): Agent[] {
  return (row.kind === "company" ? usage.bySecretId.get(row.secret.id) : usage.byUserKey.get(row.definition.key)) ?? [];
}

/** The Used by cell's words: an agent's name, "3 agents", the other places it's set, or "Not used yet". */
export function usedByLabel(agents: readonly Pick<Agent, "name">[], otherUses = 0) {
  if (agents.length === 1) return agents[0]!.name;
  if (agents.length > 1) return `${agents.length} agents`;
  if (otherUses > 0) return `Set in ${otherUses} ${otherUses === 1 ? "place" : "places"}`;
  return "Not used yet";
}

/** Each agent that uses the secret, with the names it reads it under. */
export function agentsWithAccess(agents: readonly Agent[] | undefined, reference: AccessReference) {
  return (agents ?? [])
    .filter((agent) => agent.status !== "terminated")
    .map((agent) => {
      const config = (agent.adapterConfig ?? null) as Record<string, unknown> | null;
      return { agent, envKeys: envKeysFor(config?.env, reference), apiAliases: apiAliasesFor(config, reference) };
    })
    .filter((entry) => entry.envKeys.length > 0 || entry.apiAliases.length > 0);
}

/** An environment variable name from a secret's name: "github token" → "GITHUB_TOKEN". */
export function envKeyFromName(name: string) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** The last part of a slashed name: what a secret is called inside its folder. */
export function leafName(name: string) {
  return segments(name).at(-1) ?? name;
}

/** The name an agent reads a secret under: a user secret's key, or the company secret's leaf name. */
export function defaultEnvKey(reference: AccessReference) {
  return reference.kind === "user" ? reference.definition.key : envKeyFromName(leafName(reference.secret.name));
}

/** An agent's adapter config with the secret added as `env[envKey]`; throws when the name is taken. */
export function grantConfig(adapterConfig: unknown, agentName: string, envKey: string, reference: AccessReference): Record<string, unknown> {
  const config = { ...(isBinding(adapterConfig) ? adapterConfig : {}) };
  const env = { ...(isBinding(config.env) ? config.env : {}) };
  if (env[envKey] !== undefined) throw new Error(`${agentName} already has an environment variable named ${envKey}.`);
  env[envKey] = reference.kind === "company" ? { type: "secret_ref", secretId: reference.secret.id } : { type: "user_secret_ref", key: reference.definition.key };
  return { ...config, env };
}

/** An agent's adapter config without any env var or API alias that points at the secret, or null when none does. */
export function revokeConfig(adapterConfig: unknown, reference: AccessReference): Record<string, unknown> | null {
  const config = { ...(isBinding(adapterConfig) ? adapterConfig : {}) };
  const env = { ...(isBinding(config.env) ? config.env : {}) };
  const keys = envKeysFor(env, reference);
  const aliases = apiAliasesFor(config, reference);
  if (keys.length === 0 && aliases.length === 0) return null;
  for (const key of keys) delete env[key];
  for (const alias of aliases) delete config[`${ACCESS_PREFIX}${alias}`];
  return { ...config, env };
}

// ---------------------------------------------------------------------------------------------
// New secret

/** Splits a pasted `NAME=value` (or `export NAME="value"`) into its two halves; null otherwise. */
export function parseEnvAssignment(text: string): { name: string; value: string } | null {
  const lines = text.trim().split("\n");
  if (lines.length !== 1) return null;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(lines[0]!.trim());
  if (!match) return null;
  const value = match[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  return value ? { name: match[1]!, value } : null;
}

/** A stable key from a typed name, as the server makes one: "GitHub token" → "github-token". */
export function secretKeyFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
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

export type CreateMode = "managed" | "external";

/**
 * One place a new secret can go: a provider's built-in storage (Paperclip's own, or a provider set
 * up for the whole deployment), or one of the organization's vaults. `managed` and `external` say
 * whether it takes a value, or a reference to a secret that already lives there.
 */
export type CreateStore = {
  value: string;
  provider: SecretProvider;
  providerConfigId: string;
  label: string;
  managed: boolean;
  external: boolean;
  blockReason: string | null;
};

export function storeValue(provider: SecretProvider, providerConfigId: string) {
  return `${provider}:${providerConfigId}`;
}

/** The organization's usable vault for a provider: its default when that works, else the first that does. */
export function selectableVault(configs: readonly CompanySecretProviderConfig[] | undefined, provider: SecretProvider) {
  const own = (configs ?? []).filter((config) => config.provider === provider);
  return own.find((config) => config.isDefault && !vaultBlockReason(config)) ?? own.find((config) => !vaultBlockReason(config)) ?? null;
}

/** Why a provider's built-in storage can't take a new secret: not set up here, or failing its check. */
export function providerBlockReason(descriptor: SecretProviderDescriptor, health: SecretProviderHealthResponse | null | undefined): string | null {
  const entry = health?.providers.find((item) => item.provider === descriptor.id);
  if (descriptor.configured === false) {
    const base = `${descriptor.id === "local_encrypted" ? "Paperclip's storage" : descriptor.label} isn't set up on this Paperclip server.`;
    return entry?.message ? `${base} ${entry.message}` : base;
  }
  if (entry?.status === "error") return `${descriptor.label} failed its check: ${entry.message}`;
  return null;
}

/**
 * Every place a new secret can be stored, as one list: Paperclip's own storage, a deployment-wide
 * provider's, and each vault that's on. A provider's built-in storage isn't offered once the
 * organization has a usable vault for it: new secrets for that provider go to the vault. "Stored
 * in" shows only when this has more than one entry.
 */
export function createStores(
  descriptors: readonly SecretProviderDescriptor[] | undefined,
  configs: readonly CompanySecretProviderConfig[] | undefined,
  health?: SecretProviderHealthResponse | null,
): CreateStore[] {
  const stores: CreateStore[] = [];
  const localDefault = selectableVault(configs, "local_encrypted")?.id ?? "";
  const ordered = [...(descriptors ?? [])].sort((a, b) => VAULT_PROVIDERS.indexOf(a.id) - VAULT_PROVIDERS.indexOf(b.id));
  for (const descriptor of ordered) {
    const managed = descriptor.supportsManagedValues !== false && !descriptor.requiresExternalRef;
    const external = descriptor.supportsExternalReferences === true;
    if (!managed && !external) continue;
    const blockReason = providerBlockReason(descriptor, health);
    if (!selectableVault(configs, descriptor.id) && (descriptor.id === "local_encrypted" || !blockReason)) {
      stores.push({
        value: storeValue(descriptor.id, ""),
        provider: descriptor.id,
        providerConfigId: "",
        label: descriptor.id === "local_encrypted" ? `Paperclip${localDefault ? "" : " (default)"}` : `${descriptor.label} (this deployment's settings)`,
        managed,
        external,
        blockReason,
      });
    }
    for (const config of configs ?? []) {
      if (config.provider !== descriptor.id || config.status === "disabled" || config.status === "coming_soon") continue;
      stores.push({
        value: storeValue(descriptor.id, config.id),
        provider: descriptor.id,
        providerConfigId: config.id,
        label: `${config.displayName} · ${providerKind(descriptor.id, descriptors)}${config.id === localDefault ? " (default)" : ""}`,
        managed,
        external,
        blockReason: vaultBlockReason(config),
      });
    }
  }
  return stores;
}

/** Where a new secret starts: Paperclip's default vault, or its own storage. */
export function defaultStore(stores: readonly CreateStore[], configs: readonly CompanySecretProviderConfig[] | undefined) {
  const localId = selectableVault(configs, "local_encrypted")?.id ?? "";
  return stores.find((store) => store.value === storeValue("local_encrypted", localId)) ?? stores.find((store) => store.managed && !store.blockReason) ?? stores[0] ?? null;
}

/** Where a value written to AWS lands: `<prefix>/<deploymentId>/<companyId>/<key>`, or null elsewhere. */
export function awsPathPreview(store: Pick<CreateStore, "provider" | "providerConfigId"> | null | undefined, health: SecretProviderHealthResponse | null | undefined, companyId: string, keySource: string) {
  if (store?.provider !== "aws_secrets_manager" || store.providerConfigId) return null;
  const details = health?.providers.find((entry) => entry.provider === "aws_secrets_manager")?.details;
  const text = (key: string) => (typeof details?.[key] === "string" && (details[key] as string).trim() ? (details[key] as string).trim() : null);
  return `${text("prefix") ?? "paperclip"}/${text("deploymentId") ?? "{deploymentId}"}/${companyId}/${secretKeyFromName(keySource) || "{secretKey}"}`;
}

export type CreateForm = {
  providedBy: "company" | "user";
  mode: CreateMode;
  /** The full name, folder prefix included. */
  name: string;
  /** A folder the new secret goes in, shown as a chip before the name ("github/"), or "". */
  prefix: string;
  value: string;
  externalRef: string;
  key: string;
  agentIds: readonly string[];
};

/** What the New secret dialog still needs, field by field. Create stays enabled and says these. */
export function createProblems(form: CreateForm, store: CreateStore | null, editing: boolean) {
  const leaf = form.name.slice(form.prefix.length);
  const envKey = form.providedBy === "user" ? form.key.trim() : envKeyFromName(leafName(form.name));
  const problems = {
    name: !leaf.trim() || leaf.trim().endsWith("/") ? "Give the secret a name." : null,
    value:
      form.providedBy !== "company" || editing
        ? null
        : form.mode === "managed"
          ? form.value
            ? null
            : "Paste the value to store."
          : form.externalRef.trim()
            ? null
            : "Paste the secret's ARN or path.",
    key: form.providedBy === "user" && !editing ? (form.key.trim() ? keyProblem(form.key) : "Add the environment variable name agents will read.") : null,
    access:
      form.agentIds.length > 0 && !ENV_KEY.test(envKey)
        ? "Agents can only read names made of letters, digits and underscores that don't start with a digit. Rename the secret, or give access later."
        : null,
    store: form.providedBy === "company" && !editing ? (store ? store.blockReason : "There's nowhere to store it.") : null,
  };
  return { ...problems, envKey, blocked: Object.values(problems).some(Boolean) };
}

// ---------------------------------------------------------------------------------------------
// The secret's storage, details and activity

const PROVIDER_NAMES: Record<SecretProvider, string> = {
  local_encrypted: "Paperclip",
  aws_secrets_manager: "AWS Secrets Manager",
  gcp_secret_manager: "GCP Secret Manager",
  vault: "HashiCorp Vault",
};

export function providerName(provider: SecretProvider) {
  return PROVIDER_NAMES[provider] ?? provider;
}

/** A provider as the list names it: "Paperclip-encrypted" for Paperclip's own, else the server's label. */
export function providerKind(provider: SecretProvider, descriptors?: readonly SecretProviderDescriptor[]) {
  if (provider === "local_encrypted") return "Paperclip-encrypted";
  return descriptors?.find((entry) => entry.id === provider)?.label ?? providerName(provider);
}

/** Where a secret's value lives: "Paperclip", or "<vault> · <provider>". */
export function storedIn(secret: Pick<CompanySecret, "provider" | "providerConfigId">, configs: readonly CompanySecretProviderConfig[] | undefined, descriptors?: readonly SecretProviderDescriptor[]) {
  const config = secret.providerConfigId ? configs?.find((entry) => entry.id === secret.providerConfigId) : undefined;
  if (config) return `${config.displayName} · ${providerKind(secret.provider, descriptors)}`;
  return secret.provider === "local_encrypted" ? "Paperclip" : providerKind(secret.provider, descriptors);
}

/** The row's second line, only when the value lives outside Paperclip's own storage or is linked. */
export function vaultLine(secret: Pick<CompanySecret, "provider" | "providerConfigId" | "managedMode">, configs: readonly CompanySecretProviderConfig[] | undefined, descriptors?: readonly SecretProviderDescriptor[]) {
  const config = secret.providerConfigId ? (configs?.find((entry) => entry.id === secret.providerConfigId) ?? null) : null;
  const linked = secret.managedMode === "external_reference";
  if (!config && !linked && secret.provider === "local_encrypted") return null;
  return { linked, text: `${linked ? "Linked from" : "Stored in"} ${storedIn(secret, configs, descriptors)}`, unavailable: !!(config && vaultBlockReason(config)) };
}

/** "Never", "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function whenLabel(value: string | Date | null | undefined, now = new Date()) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** "Not used", "1 use", "6 uses". */
export function usesLabel(count: number | undefined) {
  if (!count) return "Not used";
  return count === 1 ? "1 use" : `${count} uses`;
}

/** "No secrets", "1 secret", "4 secrets". */
export function secretsLabel(count: number | undefined) {
  if (!count) return "0 secrets";
  return count === 1 ? "1 secret" : `${count} secrets`;
}

const CONSUMER_LABELS: Record<string, string> = { agent_api: "Agent API", plugin_worker: "Plugin worker", tool_connection: "Tool connection" };

/** "Agent", "Agent API", "Plugin worker"… (ui/src/lib/secret-delivery.ts). */
export function consumerLabel(consumerType: SecretAccessEvent["consumerType"]) {
  return CONSUMER_LABELS[consumerType] ?? consumerType.charAt(0).toUpperCase() + consumerType.slice(1).replace(/_/g, " ");
}

const OUTCOME_TEXT: Record<SecretAccessOutcome, string> = {
  success: "used it",
  failure: "couldn't read it",
  missing: "asked for it, but no value was set",
  inactive: "asked for it while it was turned off",
  not_allowed: "was refused: no access",
  optional_omitted: "ran without it",
  provider_error: "couldn't read it: the vault didn't answer",
};

/** "Quant Researcher used it": who read the secret, by agent name where known, and how it went. */
export function activityLine(event: Pick<SecretAccessEvent, "consumerId" | "consumerType" | "actorId" | "outcome">, agentNames: ReadonlyMap<string, string>) {
  const who = agentNames.get(event.consumerId) ?? (event.actorId ? agentNames.get(event.actorId) : undefined) ?? consumerLabel(event.consumerType);
  return `${who} ${OUTCOME_TEXT[event.outcome] ?? event.outcome}`;
}

export function activityFailed(outcome: SecretAccessOutcome) {
  return outcome !== "success" && outcome !== "optional_omitted";
}

/** How a binding outside agents gets the secret: "Env var GITHUB_TOKEN", "API access GH", "Config path". */
export function bindingLine(binding: { configPath: string; required: boolean }) {
  const path = binding.configPath;
  const text = path.startsWith(ACCESS_PREFIX) ? `API access ${path.slice(ACCESS_PREFIX.length)}` : path.startsWith("env.") ? `Env var ${path.slice(4)}` : `Config ${path}`;
  return binding.required ? text : `${text} · optional`;
}

// ---------------------------------------------------------------------------------------------
// Each user's secrets

/** "2 of 3 people have set it". */
export function coverageLabel(coverage: UserSecretCoverageSummary | undefined) {
  if (!coverage) return "";
  const total = coverage.configuredCount + coverage.missingCount + coverage.inactiveCount;
  if (total === 0) return "Nobody needs it yet";
  return `${coverage.configuredCount} of ${total} ${total === 1 ? "person has" : "people have"} set it`;
}

/** The Provided by cell's count: "2 of 3 added". */
export function coverageShort(coverage: UserSecretCoverageSummary | undefined) {
  if (!coverage) return "";
  return `${coverage.configuredCount} of ${coverage.configuredCount + coverage.missingCount + coverage.inactiveCount} added`;
}

/** The secrets still waiting on you first; the rest keep the server's order. */
export function sortMine<T extends { definition: Pick<UserSecretDefinition, "status">; secret: unknown }>(entries: readonly T[]) {
  const needs = (entry: T) => entry.definition.status === "active" && !entry.secret;
  return [...entries].sort((a, b) => Number(needs(b)) - Number(needs(a)));
}

export function missingMine(entries: readonly { definition: Pick<UserSecretDefinition, "status">; secret: unknown }[]) {
  return entries.filter((entry) => entry.definition.status === "active" && !entry.secret).length;
}

// ---------------------------------------------------------------------------------------------
// Requests from agents (proposals)

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

/** Requests waiting for a decision: new secrets first (access requests depend on them), oldest first. */
export function sortPending(proposals: readonly SecretProposalView[] | undefined) {
  return [...(proposals ?? [])].sort((a, b) => (a.kind !== b.kind ? (a.kind === "secret" ? -1 : 1) : String(a.createdAt).localeCompare(String(b.createdAt))));
}

/** The decided statuses read for "Recently decided", each with `order=resolved&limit=`. */
export const DECIDED_STATUSES = ["approved", "rejected", "expired"] as const satisfies readonly SecretProposalStatus[];
export const DECIDED_LIMIT = 10;

/** The latest decisions across the decided lists, newest first. */
export function recentlyDecided(lists: readonly (readonly SecretProposalView[] | undefined)[], limit = DECIDED_LIMIT) {
  const at = (proposal: SecretProposalView) => String(proposal.resolvedAt ?? proposal.createdAt);
  return lists
    .flatMap((list, index) => (list ?? []).filter((proposal) => proposal.status === DECIDED_STATUSES[index]))
    .sort((a, b) => at(b).localeCompare(at(a)))
    .slice(0, limit);
}

/** "Approved · 2h ago". */
export function decidedLabel(proposal: SecretProposalView, now = new Date()) {
  const outcome = proposal.status === "approved" ? "Approved" : proposal.status === "rejected" ? "Declined" : "Expired";
  return `${outcome} · ${whenLabel(proposal.resolvedAt ?? proposal.createdAt, now)}`;
}

// ---------------------------------------------------------------------------------------------
// Vaults (provider configs)

/** The providers in the order the list shows them. GCP and HashiCorp Vault save settings only. */
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

/** New vaults of providers that can't store values yet are saved as drafts; so is turning one back on. */
export function vaultStatus(provider: SecretProvider): SecretProviderConfigStatus {
  return vaultComingSoon(provider) ? "coming_soon" : "ready";
}

/** Why a vault can't take new secrets or imports, or null. */
export function vaultBlockReason(config: Pick<CompanySecretProviderConfig, "status" | "healthStatus" | "healthMessage">): string | null {
  if (config.status === "disabled") return "It's turned off.";
  if (config.status === "coming_soon") return "Paperclip can't store or read secrets in it yet.";
  if (config.healthStatus === "error") return config.healthMessage ?? "Paperclip couldn't reach it.";
  return null;
}

/** How many secrets each vault holds, keyed by vault id, or `built-in:<provider>` for a provider's own storage. */
export function vaultSecretCounts(secrets: readonly Pick<CompanySecret, "provider" | "providerConfigId">[]) {
  const counts = new Map<string, number>();
  for (const secret of secrets) {
    const key = secret.providerConfigId ?? `built-in:${secret.provider}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The built-in rows at the top of the Vaults list: Paperclip's own storage always, and a provider
 * set up for the whole deployment (or still holding secrets there). Paperclip's is the default until
 * the organization has a usable Paperclip-encrypted vault.
 */
export function builtInStores(descriptors: readonly SecretProviderDescriptor[] | undefined, configs: readonly CompanySecretProviderConfig[] | undefined, counts: ReadonlyMap<string, number>) {
  const local = { provider: "local_encrypted" as SecretProvider, label: "Paperclip", isDefault: !selectableVault(configs, "local_encrypted"), count: counts.get("built-in:local_encrypted") ?? 0, configured: true };
  const others = [...(descriptors ?? [])]
    .filter((descriptor) => descriptor.id !== "local_encrypted" && (descriptor.configured === true || (counts.get(`built-in:${descriptor.id}`) ?? 0) > 0))
    .sort((a, b) => VAULT_PROVIDERS.indexOf(a.id) - VAULT_PROVIDERS.indexOf(b.id))
    .map((descriptor) => ({ provider: descriptor.id, label: descriptor.label, isDefault: false, count: counts.get(`built-in:${descriptor.id}`) ?? 0, configured: descriptor.configured === true }));
  return [local, ...others];
}

/** The organization's vaults in provider order. */
export function orderedVaults(configs: readonly CompanySecretProviderConfig[] | undefined) {
  return VAULT_PROVIDERS.flatMap((provider) => (configs ?? []).filter((config) => config.provider === provider));
}

/** The vault's badge: "Default" for the one new secrets go to, "Default for AWS…" for a provider's own default. */
export function vaultDefaultBadge(config: CompanySecretProviderConfig, configs: readonly CompanySecretProviderConfig[] | undefined, kind: string) {
  if (config.id === selectableVault(configs, "local_encrypted")?.id) return "Default";
  if (config.isDefault && config.provider !== "local_encrypted") return `Default for ${kind}`;
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

/** Vaults existing secrets can be imported from: AWS ones that work. */
export function importableVaults(configs: readonly CompanySecretProviderConfig[] | undefined) {
  return (configs ?? []).filter((config) => config.provider === "aws_secrets_manager" && (config.status === "ready" || config.status === "warning") && !vaultBlockReason(config));
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
// Folders (the old page's folder view, ui/src/pages/secrets/secret-path.ts)

/*
 * Folders come from slashes in secret names (`github/deploy-token`); the server keeps no folder
 * records. A folder exists while a secret is named under it, so a new folder is just the start of
 * the next secret's name. Folders are always on; a search lists matches across all of them.
 */

export type SecretFolder = { name: string; path: string; secretCount: number; folderCount: number };

function segments(path: string) {
  return path.split("/").filter(Boolean);
}

export function normalizeFolderPath(path: string) {
  return segments(path).join("/");
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** One folder's contents: the folders directly in it, with how many secrets and folders each holds, and its own secrets. */
export function folderListing<T extends { name: string }>(secrets: readonly T[], path: string): { folders: SecretFolder[]; secrets: T[] } {
  const base = segments(path);
  const folders = new Map<string, { secrets: number; folders: Set<string> }>();
  const own: T[] = [];
  for (const secret of secrets) {
    const parts = segments(secret.name);
    if (!base.every((part, index) => parts[index] === part)) continue;
    const depth = parts.length - base.length;
    if (depth < 1) continue;
    if (depth === 1) {
      own.push(secret);
      continue;
    }
    const name = parts[base.length]!;
    const entry = folders.get(name) ?? { secrets: 0, folders: new Set<string>() };
    entry.secrets += 1;
    if (depth > 2) entry.folders.add(parts[base.length + 1]!);
    folders.set(name, entry);
  }
  return {
    folders: [...folders.entries()]
      .map(([name, entry]) => ({ name, path: [...base, name].join("/"), secretCount: entry.secrets, folderCount: entry.folders.size }))
      .sort((a, b) => collator.compare(a.name, b.name)),
    secrets: own.sort((a, b) => collator.compare(a.name, b.name)),
  };
}

/** "12 secrets · 3 folders"; the folder part only when there are some. */
export function folderCountsLabel(secretCount: number, folderCount: number) {
  const parts = [secretCount === 1 ? "1 secret" : `${secretCount} secrets`];
  if (folderCount > 0) parts.push(folderCount === 1 ? "1 folder" : `${folderCount} folders`);
  return parts.join(" · ");
}

/** The trail from the top to `path`: each folder with its full path. */
export function folderCrumbs(path: string) {
  const parts = segments(path);
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
}

/** The folder above `path`: "" for the top. */
export function parentFolder(path: string) {
  return segments(path).slice(0, -1).join("/");
}

/** A secret's name inside the folder shown: `github/deploy-token` in `github` reads `deploy-token`. */
export function nameInFolder(name: string, path: string) {
  const base = normalizeFolderPath(path);
  return base && name.startsWith(`${base}/`) ? name.slice(base.length + 1) : name;
}

export function folderNameProblem(value: string): string | null {
  if (!value.trim()) return "Name the folder.";
  if (value.includes("/")) return "A folder name can't have a slash.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// References and new versions

/** What a reference looks like for a provider, as a placeholder. */
export function referencePlaceholder(provider: SecretProvider | undefined) {
  if (provider === "aws_secrets_manager") return "arn:aws:secretsmanager:region:account:secret:name";
  if (provider === "gcp_secret_manager") return "projects/my-project/secrets/name";
  if (provider === "vault") return "secret/data/team/name";
  return "The secret's name or path in the provider";
}

/**
 * How a secret takes a new version: a stored one takes a value; a reference can be pointed
 * elsewhere, and also take a value when its provider accepts writes (AWS).
 */
export function rotateKinds(secret: Pick<CompanySecret, "managedMode" | "provider" | "externalRef">, descriptors: readonly SecretProviderDescriptor[] | undefined): ("value" | "reference")[] {
  if (secret.managedMode !== "external_reference") return ["value"];
  const writes = descriptors?.find((descriptor) => descriptor.id === secret.provider)?.supportsExternalValueWrites === true;
  return writes && secret.externalRef ? ["value", "reference"] : ["reference"];
}

/** The action's words: "Replace value", or "Change reference" for a reference whose provider takes no writes. */
export function rotateLabel(secret: Pick<CompanySecret, "managedMode" | "provider" | "externalRef">, descriptors: readonly SecretProviderDescriptor[] | undefined) {
  return rotateKinds(secret, descriptors)[0] === "reference" ? "Change reference" : "Replace value";
}
