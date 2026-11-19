import { eq } from "drizzle-orm";
import { mcpOauthGrants, type Db } from "@paperclipai/db";
import { capAgentAccess } from "@paperclipai/shared";
import { unauthorized } from "../errors.js";
import { loadAgentAccess } from "../services/agent-access.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { connectionAccess } from "../services/public-mcp/connection-access.js";
import type { McpCaller } from "./catalog/types.js";

type Grant = typeof mcpOauthGrants.$inferSelect;

const refused = () => unauthorized("The Paperclip MCP endpoint takes a run token, an agent API key or an outside connection");

async function grantFor(db: Db, actor: AuthorizationActor, grant: Grant | undefined): Promise<Grant> {
  if (grant) return grant;
  if (!actor.grantId) throw refused();
  const [row] = await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.id, actor.grantId));
  if (!row || row.revokedAt) throw refused();
  return row;
}

/**
 * Resolves an authenticated actor to a catalog caller (step 4a, section 1):
 *
 * - a run token (`agent_jwt` with its signed run id) is a `run`; an agent API key an `agent_key`
 *   with no run id;
 * - an outside connection (`mcp_oauth`) acting as the person is `oauth_person`, with the
 *   connection's level as its access (the person's membership checks still apply in the routes);
 * - one acting as an agent is `oauth_agent`: the agent's access capped by the connection's level;
 * - a dormant Dot, Grok Bot or Muse agent grant (no `grantId` on its actor) is `oauth_agent` on its
 *   agent, uncapped.
 *
 * Anything else is refused. `grant` saves a lookup when the caller already holds the grant row.
 */
export async function resolveMcpCaller(db: Db, actor: AuthorizationActor, options: { grant?: Grant } = {}): Promise<McpCaller> {
  if (actor.source === "mcp_oauth") {
    if (actor.type === "board" && actor.userId) {
      const grant = await grantFor(db, actor, options.grant);
      const membership = actor.memberships?.find(entry => entry.companyId === grant.companyId);
      return {
        kind: "oauth_person", actor: { ...actor, grantId: grant.id }, companyId: grant.companyId, agentId: null,
        userId: actor.userId, runId: null, grantId: grant.id,
        access: connectionAccess(grant, membership?.membershipRole),
      };
    }
    if (actor.type === "agent" && actor.agentId && actor.companyId) {
      const own = await loadAgentAccess(db, actor.agentId);
      if (!actor.grantId && !options.grant) {
        return {
          kind: "oauth_agent", actor: { ...actor, runId: null }, companyId: actor.companyId, agentId: actor.agentId,
          userId: null, runId: null, grantId: null, access: own,
        };
      }
      const grant = await grantFor(db, actor, options.grant);
      return {
        kind: "oauth_agent", actor: { ...actor, runId: null, grantId: grant.id }, companyId: actor.companyId, agentId: actor.agentId,
        userId: grant.userId, runId: null, grantId: grant.id,
        access: capAgentAccess(own, connectionAccess(grant, null)),
      };
    }
    throw refused();
  }
  const agentId = actor.type === "agent" ? actor.agentId ?? null : null;
  const companyId = actor.type === "agent" ? actor.companyId ?? null : null;
  if (!agentId || !companyId) throw refused();
  if (actor.source === "agent_jwt" && actor.runId) {
    return {
      kind: "run", actor, companyId, agentId, userId: null, runId: actor.runId, grantId: null,
      access: await loadAgentAccess(db, agentId),
    };
  }
  if (actor.source === "agent_key") {
    // A key's run id comes from a client header, not a signed claim: the key caller has no run.
    return {
      kind: "agent_key", actor: { ...actor, runId: null }, companyId, agentId, userId: null, runId: null, grantId: null,
      access: await loadAgentAccess(db, agentId),
    };
  }
  throw refused();
}
