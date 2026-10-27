import type {
  AiAuthMethod,
  AiConnectionList,
  AiConnectionLoginIntent,
  AiConnectionUsage,
  AiConnectionUsageLimit,
  AiManagedConnectionSummary,
  AiProvider,
  CreateAiConnection,
} from "@paperclipai/shared";
import type { HealthStatus } from "@/api/health";
import type { Tone } from "@/ui/Status";

/*
 * View model for the Connectors page: labels for a connection's provider, method, owner and status,
 * who may make it their default or reconnect it, and the setup draft's validation and requests.
 * The rules follow the server (server/src/routes/ai-connections.ts) and the old UI's
 * AiProviderSetup and AiConnectionAccountControls.
 */

export type Connection = AiManagedConnectionSummary;
export type Ownership = Connection["ownership"];

const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "Grok",
  github: "GitHub Copilot",
  google: "Google",
};

export function providerName(provider: AiProvider) {
  return PROVIDER_NAMES[provider] ?? provider;
}

export function methodLabel(method: AiAuthMethod) {
  return method === "subscription" ? "Subscription" : "API key";
}

export const STATUS_META: Record<Connection["status"], { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "green" },
  needs_attention: { label: "Needs attention", tone: "amber" },
  expired: { label: "Expired", tone: "red" },
  revoked: { label: "Revoked", tone: "red" },
};

/** "Personal · You", "Personal · Ada", "Shared with the company". */
export function ownerLabel(connection: Connection, currentUserId: string) {
  if (connection.ownership === "shared") return "Shared with the company";
  const owner = connection.ownerUserId === currentUserId ? "You" : connection.ownerName || "Account owner";
  return `Personal · ${owner}`;
}

export function isOwnPersonal(connection: Connection, currentUserId: string) {
  return connection.ownership === "personal" && connection.ownerUserId === currentUserId;
}

/**
 * Only your own connected personal account can be your default (`PUT /default` rejects the rest),
 * and custom-routed accounts are chosen on the agent instead.
 */
export function canMakeDefault(connection: Connection, currentUserId: string) {
  return (
    !connection.isDefault &&
    isOwnPersonal(connection, currentUserId) &&
    connection.status === "connected" &&
    !connection.routing
  );
}

/**
 * Reconnect an expired or failing account. The server lets only its owner (or, for a shared one, its
 * creator) do it. The list doesn't say who created a shared account, so managers are offered it and
 * the server has the last word.
 */
export function canReconnect(connection: Connection, list: Pick<AiConnectionList, "currentUserId" | "canManageConnections">) {
  if (connection.status !== "expired" && connection.status !== "needs_attention") return false;
  // Reconnecting a custom endpoint needs its routing settings, which this page doesn't edit.
  if (connection.routing) return false;
  if (connection.provider !== "anthropic") return false;
  return connection.ownership === "personal"
    ? connection.ownerUserId === list.currentUserId
    : list.canManageConnections;
}

/** Subscription sign-in runs a CLI on the server's machine, which only some deployments allow. */
export function localLoginSupported(health: (HealthStatus & { localAiLoginSupported?: boolean }) | undefined) {
  if (!health) return false;
  return health.localAiLoginSupported ?? health.deploymentMode === "local_trusted";
}

export type SetupDraft = {
  method: AiAuthMethod;
  name: string;
  ownership: Ownership;
  allAgents: boolean;
  agentIds: string[];
  apiKey: string;
  /** Set when reconnecting: the account keeps its method, name and access. */
  connectionId?: string;
};

export function defaultConnectionName(ownership: Ownership, method: AiAuthMethod) {
  return `${ownership === "personal" ? "My" : "Company"} Claude ${method === "subscription" ? "subscription" : "API key"}`;
}

/** A new draft: managers share with every agent by default, others keep it personal. */
export function newDraft(canManage: boolean, method: AiAuthMethod = "subscription"): SetupDraft {
  const ownership: Ownership = canManage ? "shared" : "personal";
  return { method, name: defaultConnectionName(ownership, method), ownership, allAgents: canManage, agentIds: [], apiKey: "" };
}

/** Reconnecting keeps the account's identity; access was set when it was created. */
export function reconnectDraft(connection: Connection, canManage: boolean): SetupDraft {
  return {
    method: connection.method,
    name: connection.name,
    ownership: connection.ownership,
    allAgents: canManage,
    agentIds: [],
    apiKey: "",
    connectionId: connection.id,
  };
}

/** Why the draft can't go ahead yet, or null. The API key itself is checked at its own step. */
export function draftProblem(draft: SetupDraft, canManage: boolean): string | null {
  if (!draft.name.trim()) return "Name the connection.";
  if (draft.connectionId) return null;
  if (!canManage && (draft.ownership === "shared" || draft.allAgents))
    return "Only a connection manager can share a connection with everyone or give every agent access.";
  if (draft.ownership === "shared" && !draft.allAgents && draft.agentIds.length === 0)
    return "Choose at least one agent, or give every agent access.";
  return null;
}

export function loginIntent(draft: SetupDraft): AiConnectionLoginIntent {
  return {
    provider: "anthropic",
    method: "subscription",
    name: draft.name.trim(),
    ownership: draft.ownership,
    agentIds: draft.allAgents ? [] : draft.agentIds,
    allAgents: draft.allAgents,
    ...(draft.connectionId ? { connectionId: draft.connectionId } : {}),
  };
}

export function apiKeyInput(draft: SetupDraft): CreateAiConnection {
  return {
    provider: "anthropic",
    method: "api_key",
    name: draft.name.trim(),
    ownership: draft.ownership,
    apiKey: draft.apiKey.trim(),
    agentIds: draft.allAgents ? [] : draft.agentIds,
    allAgents: draft.allAgents,
    ...(draft.connectionId ? { connectionId: draft.connectionId } : {}),
  };
}

/* Usage, after ui/src/components/ai-connections/AiConnectionUsagePanel.tsx, without the overage details. */

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const amount = (value: number, unit: string | null) =>
  unit === "USD"
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
    : `${number(value)}${unit ? ` ${unit}` : ""}`;

export function usageLimitValue(limit: AiConnectionUsageLimit) {
  if (limit.used != null && limit.limit != null) return `${amount(limit.used, limit.unit)} of ${amount(limit.limit, limit.unit)}`;
  if (limit.usedPercent != null) return `${number(limit.usedPercent)}% used`;
  if (limit.used != null) return `${amount(limit.used, limit.unit)} used`;
  if (limit.remainingPercent != null) return `${number(limit.remainingPercent)}% left`;
  return "Not reported";
}

/** Percent used, for the meter, when the provider says. */
export function usagePercent(limit: AiConnectionUsageLimit): number | null {
  if (limit.usedPercent != null) return Math.max(0, Math.min(100, limit.usedPercent));
  if (limit.used != null && limit.limit) return Math.max(0, Math.min(100, (limit.used / limit.limit) * 100));
  if (limit.remainingPercent != null) return Math.max(0, Math.min(100, 100 - limit.remainingPercent));
  return null;
}

export function usageError(usage: AiConnectionUsage) {
  switch (usage.errorCode) {
    case "authentication_required":
      return "Sign in again to check usage.";
    case "permission_denied":
      return "Usage access denied.";
    case "rate_limited":
      return "Too many checks. Try again later.";
    case "provider_unavailable":
      return "Provider unavailable. Try again.";
    case "invalid_response":
      return "Couldn't read usage. Try again.";
    case "connection_unavailable":
      return "Reconnect to check usage.";
    case "unsupported":
      return "Usage unavailable.";
    default:
      return usage.message ?? "Usage unavailable.";
  }
}
