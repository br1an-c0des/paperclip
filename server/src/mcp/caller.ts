import type { Db } from "@paperclipai/db";
import { unauthorized } from "../errors.js";
import { loadAgentAccess } from "../services/agent-access.js";
import type { AuthorizationActor } from "../services/authorization.js";
import type { McpCaller } from "./catalog/types.js";

/**
 * Resolves the authenticated actor of an `/api/mcp/paperclip` request to a catalog caller: a run
 * token (`agent_jwt` with its signed run id) or an agent API key (no run id). Wave 2 adds the OAuth
 * kinds. Anything else is refused.
 */
export async function resolveMcpCaller(db: Db, actor: AuthorizationActor): Promise<McpCaller> {
  const agentId = actor.type === "agent" ? actor.agentId ?? null : null;
  const companyId = actor.type === "agent" ? actor.companyId ?? null : null;
  if (!agentId || !companyId) {
    throw unauthorized("The Paperclip MCP endpoint takes a run token or an agent API key");
  }
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
  throw unauthorized("The Paperclip MCP endpoint takes a run token or an agent API key");
}
