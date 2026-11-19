import { z } from "zod";
import {
  AGENT_ACCESS_LEVELS,
  agentAccessOverridesSchema,
  type AgentAccessLevel,
  type AgentAccessOverrides,
} from "./agent-access.js";

export const DOT_RUNNER_MCP_PATH = "/mcp/runner";
export const DOT_RUNNER_MCP_SCOPES = ["paperclip:agent", "offline_access"] as const;
export const PUBLIC_MCP_PATH = "/mcp/paperclip";
export const PUBLIC_MCP_SCOPES = ["paperclip:read", "paperclip:write", "paperclip:configure", "offline_access"] as const;

/**
 * The person's answer on the consent screen (step 4a, section 1). A connection acts as the person
 * (`actAsAgentId` null or absent) or as an agent the person may configure. Its access level caps
 * what it may do: as the person, the level is the connection's access (a viewer member may only
 * choose `read_only`); as an agent, the agent's own access capped by this level. The level defaults
 * to `DEFAULT_CONNECTION_ACCESS_LEVEL` (manager). The OAuth scopes the client asked for are recorded
 * but don't decide access.
 */
export const mcpConsentSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  companyId: z.string().uuid().optional(),
  actAsAgentId: z.string().uuid().nullable().optional(),
  accessLevel: z.enum(AGENT_ACCESS_LEVELS).optional(),
}).strict();
export type McpConsent = z.infer<typeof mcpConsentSchema>;

/**
 * `PATCH /mcp/connections/:id`: change who a connection acts as, its level, or its overrides
 * (replacing them; `{}` clears them). Open to the person who made the connection, or to a person
 * who may configure the agent it acts as.
 */
export const updateMcpConnectionSchema = z.object({
  actAsAgentId: z.string().uuid().nullable().optional(),
  accessLevel: z.enum(AGENT_ACCESS_LEVELS).optional(),
  accessOverrides: agentAccessOverridesSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Supply a change");
export type UpdateMcpConnection = z.infer<typeof updateMcpConnectionSchema>;

/** An agent a connection may act as: one the signed-in person may configure. */
export interface McpActAsAgentChoice {
  id: string;
  name: string;
}

export interface McpConnectionRequest {
  id: string;
  clientName: string;
  redirectOrigin: string;
  clientOrigin?: string | null;
  agentConnection?: boolean;
  requestedWrite: boolean;
  requestedConfigure?: boolean;
  offlineAccess: boolean;
  requiresSignIn: boolean;
  /** Fixed by the authorization request; null permits direct-instance selection. */
  requestedCompanyId: string | null;
  companies: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    canWrite: boolean;
    /** The highest level the person may give the connection: `read_only` for a viewer, else `admin`. */
    maxAccessLevel: AgentAccessLevel;
    /** The agents the person may choose under "acts as" (agents they may configure). */
    actAsAgents: McpActAsAgentChoice[];
  }>;
  setupUrl: string | null;
}

export interface McpConnectionSetup {
  enabled: boolean;
  serverUrl: string;
  invitationUrl: string;
  invitation: string;
}

export interface McpConnection {
  companyPrefix?: string;
  agent?: { id: string; name: string; provider: string } | null;
  id: string;
  companyId: string;
  clientName: string;
  companyName: string;
  /** The signed-in person who authorized this connection; absent on older servers. */
  user?: { name: string; image: string | null } | null;
  scopes: string[];
  /** The agent this connection acts as; null when it acts as the person. */
  actAsAgent: { id: string; name: string } | null;
  /** The connection's level (acting as an agent: the cap on the agent's own access). */
  accessLevel: AgentAccessLevel;
  accessOverrides: AgentAccessOverrides;
  /** The agents the person may switch "acts as" to, in this connection's company. */
  actAsAgentChoices: McpActAsAgentChoice[];
  createdAt: string;
  revokedAt: string | null;
}

/** Code-scoped details shown before activating an operator-approved Dot agent. */
export interface McpDotPairingPreview {
  providerKind?: "openai_dot" | "grok_bot";
  authorizingPerson?: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  permissions: string;
  accessDuration: string;
  pairingExpiresAt: string;
}
