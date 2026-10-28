import type {
  ToolApplication,
  ToolConnection,
  ToolMcpGatewayClientSnippet,
  ToolMcpGatewayToken,
  ToolMcpGatewayWithTokens,
  ToolProfileWithDetails,
} from "@paperclipai/shared";
import type { ToolActivityEvent, ToolAuditOutcome } from "@/api/tool-access";
import type { Tone } from "@/ui/Status";
import { connectionState, displayName } from "../apps-model";

/*
 * View model for Gateways (`/apps/gateways`, the old UI's pages/apps/gateways/): a gateway is one
 * MCP endpoint that exposes only the tools its access profile allows, handed to a client like
 * Cursor with a token. Token states, what a gateway exposes, the client snippets, and the audit
 * rows its Activity tab and an agent's recent calls show. After gateway-helpers.ts.
 */

/** Days before expiry at which a token shows as Expiring. */
export const EXPIRING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TokenStatus = "active" | "expiring" | "expired" | "revoked";

export const TOKEN_STATUS: Record<TokenStatus, { label: string; tone: Tone | null }> = {
  active: { label: "Active", tone: "green" },
  expiring: { label: "Expiring", tone: "amber" },
  expired: { label: "Expired", tone: null },
  revoked: { label: "Revoked", tone: "red" },
};

function toTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function tokenStatus(token: Pick<ToolMcpGatewayToken, "revokedAt" | "expiresAt">, now = Date.now()): TokenStatus {
  if (token.revokedAt) return "revoked";
  const expires = toTime(token.expiresAt);
  if (expires === null) return "active";
  if (expires <= now) return "expired";
  return expires - now <= EXPIRING_DAYS * DAY_MS ? "expiring" : "active";
}

/** "pcgw_ab12•••": the token is shown in full once, then only its prefix. */
export function maskedToken(token: Pick<ToolMcpGatewayToken, "tokenPrefix">) {
  return `${token.tokenPrefix}•••`;
}

export function tokenCounts(gateway: ToolMcpGatewayWithTokens, now = Date.now()) {
  let active = 0;
  let expiring = 0;
  for (const token of gateway.tokens) {
    const status = tokenStatus(token, now);
    if (status === "active" || status === "expiring") active += 1;
    if (status === "expiring") expiring += 1;
  }
  return { active, expiring };
}

export function tokensLabel(gateway: ToolMcpGatewayWithTokens, now = Date.now()) {
  const { active, expiring } = tokenCounts(gateway, now);
  if (active === 0) return "no active tokens";
  return `${active} active ${active === 1 ? "token" : "tokens"}${expiring > 0 ? ` (${expiring} expiring)` : ""}`;
}

/** When any of its tokens was last used. */
export function lastUsed(gateway: ToolMcpGatewayWithTokens): string | null {
  let latest: string | null = null;
  for (const token of gateway.tokens) {
    const time = toTime(token.lastUsedAt);
    if (time !== null && (latest === null || time > new Date(latest).getTime())) latest = new Date(time).toISOString();
  }
  return latest;
}

export const isOn = (gateway: Pick<ToolMcpGatewayWithTokens, "status">) => gateway.status === "active";

/** "Organization", "Project · Website", "Agent · Bob". */
export function scopeLabel(gateway: ToolMcpGatewayWithTokens, projectNames: Map<string, string>, agentNames: Map<string, string>) {
  const short = (value: string) => (value.length > 12 ? `${value.slice(0, 8)}…` : value);
  if (gateway.contextScopeType !== "none" && gateway.contextScopeId) {
    if (gateway.contextScopeType === "project") return `Project · ${projectNames.get(gateway.contextScopeId) ?? short(gateway.contextScopeId)}`;
    if (gateway.contextScopeType === "agent") return `Agent · ${agentNames.get(gateway.contextScopeId) ?? short(gateway.contextScopeId)}`;
    if (gateway.contextScopeType === "company") return "Organization";
    return `${gateway.contextScopeType} · ${short(gateway.contextScopeId)}`;
  }
  if (gateway.projectId) return `Project · ${projectNames.get(gateway.projectId) ?? short(gateway.projectId)}`;
  if (gateway.agentId) return `Agent · ${agentNames.get(gateway.agentId) ?? short(gateway.agentId)}`;
  return "Organization";
}

/** How many tools a profile allows: "12 tools", "No tools allowed". */
export function allowedToolsLabel(profile: ToolProfileWithDetails | undefined) {
  if (!profile) return "Profile unavailable";
  const { accessMode, allowedToolCount, totalToolCount, excludedToolCount } = profile.summary;
  const count = accessMode === "all_except" ? Math.max(totalToolCount - excludedToolCount, 0) : allowedToolCount;
  if (count === 0) return "No tools allowed";
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

export type GatewayApp = {
  application: ToolApplication;
  connection: ToolConnection | null;
  name: string;
  toolCount: number;
  needsAttention: boolean;
};

/**
 * The apps a gateway exposes: its profile's include entries, joined to the company's applications
 * and connections. A connection that needs attention (expired sign-in, missing key) flags its app.
 */
export function gatewayApps(
  profile: ToolProfileWithDetails | undefined,
  applications: readonly ToolApplication[],
  connections: readonly ToolConnection[],
): GatewayApp[] {
  if (!profile) return [];
  const applicationsById = new Map(applications.map((application) => [application.id, application]));
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const toolCounts = new Map<string, number>();
  const included = new Set<string>();
  for (const entry of profile.entries ?? []) {
    if (entry.effect !== "include") continue;
    const applicationId = entry.applicationId ?? (entry.connectionId ? connectionsById.get(entry.connectionId)?.applicationId : null) ?? null;
    if (!applicationId) continue;
    included.add(applicationId);
    if (entry.catalogEntryId || entry.toolName) toolCounts.set(applicationId, (toolCounts.get(applicationId) ?? 0) + 1);
  }
  const rows: GatewayApp[] = [];
  for (const applicationId of included) {
    const application = applicationsById.get(applicationId);
    if (!application || application.status === "archived") continue;
    const own = connections.filter((connection) => connection.applicationId === applicationId);
    const connection = own.find((entry) => entry.status !== "archived") ?? own[0] ?? null;
    rows.push({
      application,
      connection,
      name: displayName(connection?.name ?? application.name),
      toolCount: toolCounts.get(applicationId) ?? 0,
      needsAttention: own.some((entry) => entry.status !== "archived" && connectionState(entry).kind === "attention"),
    });
  }
  return rows.sort((a, b) => a.application.name.localeCompare(b.application.name));
}

/** A gateway's endpoint as a full address on this board's origin. */
export function endpointUrl(endpointPath: string, origin: string) {
  try {
    return new URL(endpointPath, origin).toString();
  } catch {
    return endpointPath;
  }
}

const SNIPPET_ORDER: ToolMcpGatewayClientSnippet["client"][] = ["cursor", "claude_desktop", "vscode", "claude_code", "opencode"];

export function orderedSnippets(snippets: readonly ToolMcpGatewayClientSnippet[]) {
  return [...snippets].sort((a, b) => SNIPPET_ORDER.indexOf(a.client) - SNIPPET_ORDER.indexOf(b.client));
}

function fillValue(value: unknown, fill: { endpointPath: string; endpoint: string; token: string }): unknown {
  if (typeof value === "string") return value.split(fill.endpointPath).join(fill.endpoint).replaceAll("pcgw_...", fill.token);
  if (Array.isArray(value)) return value.map((item) => fillValue(item, fill));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillValue(item, fill)]));
  return value;
}

/** A client's config with this board's address and a token in place of the placeholders. */
export function filledSnippet(config: Record<string, unknown>, fill: { endpointPath: string; endpoint: string; token: string }) {
  return JSON.stringify(fillValue(config, fill), null, 2);
}

/** The generic `mcpServers` config the Overview shows, with the token masked. */
export function overviewSnippet(gateway: Pick<ToolMcpGatewayWithTokens, "displaySlug">, endpoint: string) {
  return JSON.stringify(
    { mcpServers: { [`paperclip-${gateway.displaySlug}`]: { url: endpoint, headers: { Authorization: "Bearer pcgw_•••_TOKEN" } } } },
    null,
    2,
  );
}

/** A new token's default name: the gateway's slug and the time, "cto-agents-202610281530". */
export function defaultTokenName(gateway: Pick<ToolMcpGatewayWithTokens, "displaySlug">, now = new Date()) {
  return `${gateway.displaySlug}-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

/** A date input's value 90 days from now. */
export function defaultExpiry(now = Date.now()) {
  return new Date(now + 90 * DAY_MS).toISOString().slice(0, 10);
}

/** The end of the chosen day, as the server stores it. */
export function expiryFromDate(date: string) {
  return date ? `${date}T23:59:59.000Z` : null;
}

// ---------------------------------------------------------------------------------------------
// The audit

export const OUTCOMES: Record<ToolAuditOutcome, { label: string; tone: Tone | null }> = {
  allowed: { label: "Allowed", tone: "green" },
  blocked: { label: "Blocked", tone: "red" },
  asked_first: { label: "Asked first", tone: "amber" },
  waiting: { label: "Waiting", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
  unknown: { label: "Recorded", tone: null },
};

function detail(details: Record<string, unknown> | null, key: string) {
  const value = details?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function summaryText(value: unknown): string | null {
  const summary = value && typeof value === "object" && !Array.isArray(value) ? (value as { summary?: unknown }).summary : null;
  if (typeof summary !== "string" || !summary) return null;
  try {
    return JSON.stringify(JSON.parse(summary), null, 2);
  } catch {
    return summary;
  }
}

export type ActivityLine = {
  actor: string;
  tool: string;
  app: string;
  outcome: { label: string; tone: Tone | null };
  facts: [string, string][];
  arguments: string | null;
  result: string | null;
};

/** "Bob used Search docs in Context7", its outcome, and the facts an opened row shows. */
export function activityLine(event: ToolActivityEvent): ActivityLine {
  const invocation = event.invocation;
  const rawTool = invocation?.toolName ?? detail(event.details, "tool") ?? detail(event.details, "toolName");
  const started = toTime(invocation?.startedAt);
  const completed = toTime(invocation?.completedAt);
  const facts: [string, string][] = [];
  if (rawTool) facts.push(["Tool", rawTool]);
  if (invocation?.status) facts.push(["Call status", invocation.status]);
  if (invocation?.policyDecision) facts.push(["Decision", invocation.policyDecision]);
  const reason = detail(event.details, "reasonCode");
  if (reason) facts.push(["Reason", reason]);
  if (started !== null && completed !== null && completed >= started) facts.push(["Duration", `${completed - started} ms`]);
  if (invocation?.id) facts.push(["Call ID", invocation.id]);
  if (invocation?.errorCode) facts.push(["Error code", invocation.errorCode]);
  if (invocation?.errorMessage) facts.push(["Error", invocation.errorMessage]);
  return {
    actor: event.agentDisplayName ?? event.actorDisplayName ?? "Client",
    tool: event.toolDisplayName ?? invocation?.toolName ?? "a tool",
    app: event.appDisplayName ?? event.connectionDisplayName ?? event.applicationDisplayName ?? "an app",
    outcome: OUTCOMES[event.normalizedOutcome] ?? OUTCOMES.unknown,
    facts,
    arguments: summaryText(invocation?.argumentsSummary ?? event.details?.argumentsSummary),
    result: summaryText(invocation?.resultSummary ?? event.details?.resultSummary),
  };
}
