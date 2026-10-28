import type {
  CreateToolMcpGateway,
  CreateToolMcpGatewayToken,
  McpJsonImportPreview,
  ToolConnectionLifecycleEventType,
  ToolMcpGatewayToken,
  ToolMcpGatewayTokenCreated,
  ToolMcpGatewayWithTokens,
  ToolProfileBinding,
  ToolProfileBindingTargetType,
  ToolProfileDefaultAction,
  ToolProfileEffectiveSummary,
  ToolProfileEntryEffect,
  ToolProfileEntrySelectorType,
  ToolProfileNewToolReviewDecision,
  ToolProfileNewToolsReview,
  ToolProfileNewToolsReviewResult,
  ToolProfileStatus,
  ToolProfileWithDetails,
  ToolRedactedValueSummary,
  ToolRiskLevel,
  UpdateToolMcpGateway,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The rest of Apps and tools, as ui/src/api/tools.ts has it for the pages ui-new adds in M6 round 3:
 *
 * - Gateways (`/companies/:id/tools/gateways`, `/tool-gateway/gateways/*`, `/tool-gateway/gateway-tokens/*`):
 *   named MCP endpoints, their tokens.
 * - The tool-call audit (`GET /tool-gateway/audit`): a gateway's or an agent's calls.
 * - Access profiles (`/companies/:id/tools/profiles*`, `/tool-profiles/*`): which tools a run gets,
 *   who they're assigned to, and the new tools waiting for review; an agent's effective profiles.
 * - Pasting an MCP config (`POST /companies/:id/tools/mcp/import-json`).
 *
 * The audit row, its outcome and the profile inputs aren't exported by the shared package; they're
 * declared here from the old UI's client (decision 10).
 */

const enc = encodeURIComponent;
const company = (companyId: string, rest: string) => `/companies/${enc(companyId)}/${rest}`;

export type GatewayTokenInput = Omit<CreateToolMcpGatewayToken, "expiresAt"> & { expiresAt?: string | null };
export type GatewayUpdate = Omit<UpdateToolMcpGateway, "companyId">;

/** The audit's outcome, normalised by the server for the activity feed. */
export type ToolAuditOutcome = "allowed" | "blocked" | "asked_first" | "waiting" | "failed" | "unknown";
export type ToolAuditWindow = "1h" | "24h" | "7d" | "30d" | "all";

/** One audited tool call or connection event (ui/src/api/tools.ts `ToolGatewayActivityEvent`). */
export type ToolActivityEvent = {
  id: string;
  companyId: string;
  action: string;
  actorType: string | null;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  agentId: string | null;
  runId: string | null;
  applicationId: string | null;
  connectionId: string | null;
  agentDisplayName: string | null;
  actorDisplayName?: string | null;
  appDisplayName: string | null;
  applicationDisplayName: string | null;
  connectionDisplayName: string | null;
  toolDisplayName: string | null;
  lifecycleType?: ToolConnectionLifecycleEventType | null;
  normalizedOutcome: ToolAuditOutcome;
  invocation: {
    id: string;
    toolName: string;
    status: string;
    policyDecision: string | null;
    approvalState: string;
    argumentsSummary: ToolRedactedValueSummary | null;
    resultSummary: ToolRedactedValueSummary | null;
    resultSizeBytes: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
};

export type ToolActivityPage = { events: ToolActivityEvent[]; nextCursor: string | null };

export type ToolActivityFilter = {
  gateway?: string | null;
  agent?: string | null;
  app?: string | null;
  outcome?: string | null;
  window?: ToolAuditWindow;
  limit?: number;
  cursor?: string | null;
};

export type ProfileEntryInput = {
  selectorType: ToolProfileEntrySelectorType;
  effect?: ToolProfileEntryEffect;
  applicationId?: string | null;
  connectionId?: string | null;
  catalogEntryId?: string | null;
  toolName?: string | null;
  riskLevel?: ToolRiskLevel | null;
  conditions?: Record<string, unknown> | null;
};

export type ProfileInput = {
  profileKey?: string;
  name?: string;
  description?: string | null;
  status?: ToolProfileStatus;
  defaultAction?: ToolProfileDefaultAction;
  metadata?: Record<string, unknown> | null;
  entries?: ProfileEntryInput[];
};

export type ProfileTarget = { targetType: ToolProfileBindingTargetType; targetId: string };

export const toolAccessApi = {
  // Gateways
  gateways: (companyId: string, signal?: AbortSignal) =>
    api.get<{ gateways: ToolMcpGatewayWithTokens[] }>(company(companyId, "tools/gateways"), { signal }),
  createGateway: (companyId: string, input: CreateToolMcpGateway) =>
    api.post<ToolMcpGatewayWithTokens>(company(companyId, "tools/gateways"), input),
  updateGateway: (companyId: string, gatewayId: string, input: GatewayUpdate) =>
    api.patch<ToolMcpGatewayWithTokens>(`/tool-gateway/gateways/${enc(gatewayId)}`, { ...input, companyId }),
  /** The token comes back once, in full; afterwards only its prefix. */
  createGatewayToken: (companyId: string, gatewayId: string, input: GatewayTokenInput) =>
    api.post<ToolMcpGatewayTokenCreated>(`/tool-gateway/gateways/${enc(gatewayId)}/tokens`, { ...input, companyId }),
  revokeGatewayToken: (companyId: string, tokenId: string) =>
    api.post<ToolMcpGatewayToken>(`/tool-gateway/gateway-tokens/${enc(tokenId)}/revoke`, { companyId }),

  // Audit
  activity: (companyId: string, filter: ToolActivityFilter = {}, signal?: AbortSignal) => {
    const search = new URLSearchParams({ companyId });
    if (filter.gateway) search.set("gateway", filter.gateway);
    if (filter.agent) search.set("agent", filter.agent);
    if (filter.app) search.set("app", filter.app);
    if (filter.outcome) search.set("outcome", filter.outcome);
    // No window is the API's all-time request (older servers don't know `all`).
    if (filter.window && filter.window !== "all") search.set("window", filter.window);
    if (filter.cursor) search.set("cursor", filter.cursor);
    search.set("limit", String(filter.limit ?? 25));
    return api.get<ToolActivityPage>(`/tool-gateway/audit?${search.toString()}`, { signal });
  },

  // Access profiles
  createProfile: (companyId: string, input: ProfileInput & { profileKey: string; name: string }) =>
    api.post<ToolProfileWithDetails>(company(companyId, "tools/profiles"), input),
  updateProfile: (profileId: string, input: ProfileInput) => api.patch<ToolProfileWithDetails>(`/tool-profiles/${enc(profileId)}`, input),
  duplicateProfile: (profileId: string, input: { name: string; includeAssignments?: boolean }) =>
    api.post<ToolProfileWithDetails>(`/tool-profiles/${enc(profileId)}/duplicate`, input),
  deleteProfile: (profileId: string) => api.delete<{ deleted: true }>(`/tool-profiles/${enc(profileId)}`),
  bindProfile: (companyId: string, profileId: string, target: ProfileTarget) =>
    api.post<ToolProfileBinding>(company(companyId, `tools/profiles/${enc(profileId)}/bind`), target),
  unbindProfile: (companyId: string, profileId: string, target: ProfileTarget) =>
    api.post<{ unbound: number }>(company(companyId, `tools/profiles/${enc(profileId)}/unbind`), target),
  newTools: (profileId: string, signal?: AbortSignal) =>
    api.get<ToolProfileNewToolsReview>(`/tool-profiles/${enc(profileId)}/new-tools`, { signal }),
  reviewNewTools: (profileId: string, decisions: { catalogEntryId: string; decision: ToolProfileNewToolReviewDecision }[]) =>
    api.post<ToolProfileNewToolsReviewResult>(`/tool-profiles/${enc(profileId)}/new-tools/review`, { decisions }),
  /** The profiles, tools and installed connections an agent's runs get. */
  effectiveForAgent: (companyId: string, agentId: string, signal?: AbortSignal) =>
    api.get<ToolProfileEffectiveSummary>(company(companyId, `tools/profiles/effective/agents/${enc(agentId)}`), { signal }),

  // Pasting an MCP config
  importMcpJson: (companyId: string, mcpJson: string) =>
    api.post<McpJsonImportPreview>(company(companyId, "tools/mcp/import-json"), { mcpJson }),
};
