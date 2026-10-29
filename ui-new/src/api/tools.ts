import type {
  AppDefinition,
  ConnectToolApp,
  ConnectToolAppResult,
  ConnectionAgentInstructions,
  ConnectionGrantsResponse,
  EmailEndpointSummary,
  FinishToolAppResult,
  ToolActionRequest,
  ToolActionRequestStatus,
  ToolActionRequestsResponse,
  ToolApplication,
  ToolAppsAttentionResponse,
  ToolCatalogEntry,
  ToolCatalogRefreshResult,
  ToolConnection,
  ToolConnectionCreateCapabilities,
  ToolConnectionHealthCheckResult,
  ToolConnectionInstall,
  ToolConnectionInstallSnapshot,
  ToolConnectionRemovalSummary,
  ToolOAuthStartResult,
  ToolPolicy,
  ToolProfileWithDetails,
  ToolConnectionTestAgentAccessResponse,
  ToolConnectionTestAgentsResponse,
  ToolConnectionTestCallResult,
  ToolConnectionTestCallStatus,
  ConfigureRailwaySsh,
  RailwaySshSetup,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Apps and tools (`/api/companies/:companyId/tools/*`, `/api/tool-connections/*`,
 * `/api/tool-gateway/*`), as ui/src/api/tools.ts uses them for the pages ui-new has: the app
 * gallery and your connections, connecting an app (gallery, API key, OAuth, your own MCP server),
 * one connection's tools, agents, installs and settings, and the Ask-first review queue.
 *
 * The email inboxes list is `GET /companies/:companyId/email/inboxes` (ui/src/api/email.ts).
 */

export type ToolGalleryResponse = {
  apps: AppDefinition[];
  /** The OAuth callback address the server registers; missing when it has no browser origin. */
  oauthCallbackUrl?: string;
  capabilities: ToolConnectionCreateCapabilities;
  /** Credentials kept outside Paperclip's vault; only Vercel Connect so far. */
  credentialSources?: { vercelConnect: VercelConnectAvailability };
};

export type VercelConnectAvailability = {
  available: boolean;
  enabled: boolean;
  authentication: "workload_oidc" | "access_token" | null;
  manageUrl: string;
  /** Why it's unavailable; null when it's available. */
  reason: string | null;
};

export type AccessSelection = "all_agents" | { agentIds: string[] };

export type FinishAppInput = {
  enabledCatalogEntryIds: string[];
  askFirstCatalogEntryIds: string[];
  reviewedCatalogEntryIds?: string[];
  agentInstructions?: ConnectionAgentInstructions | null;
  access: AccessSelection;
};

export type InstallTarget = { targetType: "company" | "agent"; targetId: string };

export type UpdateConnectionInput = {
  name?: string;
  enabled?: boolean;
  agentInstructions?: ConnectionAgentInstructions | null;
};

const enc = encodeURIComponent;
const company = (companyId: string, rest: string) => `/companies/${enc(companyId)}/${rest}`;
const connection = (connectionId: string, rest = "") => `/tool-connections/${enc(connectionId)}${rest}`;

export const toolsApi = {
  gallery: (companyId: string, signal?: AbortSignal) => api.get<ToolGalleryResponse>(company(companyId, "tools/gallery"), { signal }),
  applications: (companyId: string, signal?: AbortSignal) =>
    api.get<{ applications: ToolApplication[] }>(company(companyId, "tools/applications"), { signal }),
  connections: (companyId: string, signal?: AbortSignal) =>
    api.get<{ connections: ToolConnection[] }>(company(companyId, "tools/connections"), { signal }),
  attention: (companyId: string, signal?: AbortSignal) =>
    api.get<ToolAppsAttentionResponse>(company(companyId, "tools/apps/attention"), { signal }),
  profiles: (companyId: string, signal?: AbortSignal) =>
    api.get<{ profiles: ToolProfileWithDetails[] }>(company(companyId, "tools/profiles"), { signal }),
  policies: (companyId: string, signal?: AbortSignal) =>
    api.get<{ policies: ToolPolicy[] }>(company(companyId, "tools/policies"), { signal }),

  /** Connects a gallery app or a pasted address. OAuth methods come back as a draft with `auth`. */
  connectApp: (companyId: string, input: ConnectToolApp) => api.post<ConnectToolAppResult>(company(companyId, "tools/apps/connect"), input),
  /** Turns the connection on: which actions are on or ask first, and which agents may use it. */
  finishApp: (companyId: string, connectionId: string, input: FinishAppInput) =>
    api.post<FinishToolAppResult>(company(companyId, `tools/apps/${enc(connectionId)}/finish`), input),
  startOAuth: (connectionId: string, input: { asCurrentUser?: boolean; asAgentId?: string } = {}) =>
    api.post<ToolOAuthStartResult>(`/tools/oauth/${enc(connectionId)}/start`, input),

  connection: (connectionId: string, signal?: AbortSignal) => api.get<ToolConnection>(connection(connectionId), { signal }),
  updateConnection: (connectionId: string, input: UpdateConnectionInput) => api.patch<ToolConnection>(connection(connectionId), input),
  /** Removes the connection and revokes its credentials. */
  archiveConnection: (connectionId: string) =>
    api.delete<ToolConnection & { removal: ToolConnectionRemovalSummary }>(connection(connectionId)),
  healthCheck: (connectionId: string) => api.post<ToolConnectionHealthCheckResult>(connection(connectionId, "/health-check"), {}),
  /** Replaces an API-key connection's credentials. */
  reconnect: (connectionId: string, credentialValues: Record<string, string>) =>
    api.post<ToolConnectionHealthCheckResult>(connection(connectionId, "/reconnect"), { credentialValues }),
  catalog: (connectionId: string, signal?: AbortSignal) =>
    api.get<{ catalog: ToolCatalogEntry[] }>(connection(connectionId, "/catalog"), { signal }),
  refreshCatalog: (connectionId: string) => api.post<ToolCatalogRefreshResult>(connection(connectionId, "/catalog/refresh"), {}),
  installs: (connectionId: string, signal?: AbortSignal) =>
    api.get<{ connectionId: string; installs: ToolConnectionInstall[] }>(connection(connectionId, "/installs"), { signal }),
  /** Which agents carry the connection's tools on every run; the server extends access to match. */
  putInstalls: (connectionId: string, installs: InstallTarget[]) =>
    api.put<ToolConnectionInstallSnapshot>(connection(connectionId, "/installs"), { installs }),
  grants: (connectionId: string, signal?: AbortSignal) =>
    api.get<ConnectionGrantsResponse>(connection(connectionId, "/grants"), { signal }),

  /*
   * Testing an action as an agent (the old UI's ActionTestDialog): the agents you may act as, how
   * each action behaves for one of them, and a real call with their permissions and credentials.
   * An Ask-first call waits in Review; its status is polled until it's done.
   */
  testAgents: (connectionId: string, signal?: AbortSignal) =>
    api.get<ToolConnectionTestAgentsResponse>(connection(connectionId, "/test-agents"), { signal }),
  testAgentAccess: (connectionId: string, agentId: string, signal?: AbortSignal) =>
    api.get<ToolConnectionTestAgentAccessResponse>(connection(connectionId, `/test-agents/${enc(agentId)}/access`), { signal }),
  runTestCall: (connectionId: string, input: { agentId: string; toolName: string; parameters?: Record<string, unknown> }) =>
    api.post<ToolConnectionTestCallResult>(connection(connectionId, "/test-calls"), input),
  testCallStatus: (connectionId: string, actionRequestId: string, signal?: AbortSignal) =>
    api.get<ToolConnectionTestCallStatus>(connection(connectionId, `/test-calls/${enc(actionRequestId)}`), { signal }),

  /** Railway: an SSH key pair for direct container access, and the verified host key. */
  configureRailwaySsh: (connectionId: string, input: ConfigureRailwaySsh) =>
    api.post<RailwaySshSetup>(connection(connectionId, "/railway/ssh"), input),

  actionRequests: (companyId: string, status: ToolActionRequestStatus = "pending", signal?: AbortSignal) =>
    api.get<ToolActionRequestsResponse>(company(companyId, `tools/action-requests?status=${enc(status)}`), { signal }),
  /** `rememberAction` also creates a trust rule, so the agent isn't asked again. */
  approveActionRequest: (companyId: string, requestId: string, rememberAction = false) =>
    api.post<ToolActionRequest>(`/tool-gateway/action-requests/${enc(requestId)}/approve`, { companyId, rememberAction }),
  declineActionRequest: (companyId: string, requestId: string, reason?: string) =>
    api.post<ToolActionRequest>(`/tool-gateway/action-requests/${enc(requestId)}/decline`, { companyId, reason }),

  emailInboxes: (companyId: string, signal?: AbortSignal) =>
    api.get<EmailEndpointSummary[]>(company(companyId, "email/inboxes"), { signal }),
};
