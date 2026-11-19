import type { RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { mcpOauthGrants, type Db } from "@paperclipai/db";
import { capAgentAccess, hasAgentAccess, type AgentAccessAction, type ResolvedAgentAccess } from "@paperclipai/shared";
import {
  consumeTemporaryAccessOncePerRequest,
  loadAgentAccess,
  runWithAccessCap,
  runWithTemporaryAccessScope,
  type TemporaryAccessPrincipal,
  type TemporaryAccessResource,
} from "../services/agent-access.js";
import { connectionAccess } from "../services/public-mcp/connection-access.js";
import { agentRouteRequirement } from "./agent-route-policy-table.js";

/**
 * For a person's outside connection, a write route that checks access itself (`route_checks`)
 * needs some write action: the person's membership rules decide the rest, so a read-only
 * connection can't write through them.
 */
const PERSON_WRITE_ACTIONS: readonly AgentAccessAction[] = [
  "tasks:comment", "tasks:update_own", "tasks:update_any", "tasks:create", "requests:create",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_SEGMENTS: Record<string, TemporaryAccessResource["type"]> = {
  issues: "issue",
  agents: "agent",
  projects: "project",
  companies: "company",
};

/**
 * The resources a temporary grant for this request could name: each id in the path, typed by the
 * segment before it (`/issues/:id` is an issue), then the company. Identifiers that aren't UUIDs
 * (a task's `TES-12`) don't match a grant here; replays use UUID paths.
 */
function grantResources(path: string, companyId: string): TemporaryAccessResource[] {
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  const resources: TemporaryAccessResource[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const type = RESOURCE_SEGMENTS[segments[index - 1]!];
    const id = segments[index]!;
    if (type && UUID.test(id)) resources.push({ type, id });
  }
  resources.push({ type: "company", id: companyId });
  return resources;
}

function phrase(action: AgentAccessAction, who: "agent" | "connection") {
  if (who === "connection") {
    return action === "api:raw"
      ? "This route is not open to this connection without api:raw (admin access)."
      : `This connection's access level does not include ${action}.`;
  }
  return action === "api:raw"
    ? "This route is not open to agents without api:raw (admin access)."
    : `This agent's access level does not include ${action}.`;
}

function deny(res: Response, missingAction: AgentAccessAction, write: boolean, who: "agent" | "connection") {
  res.status(403).json({
    error: phrase(missingAction, who),
    code: "access_denied",
    missingAction,
    // Reads are never requestable; a write refused by the level or overrides is.
    requestable: write,
  });
}

/** Whether `access` covers the request, or a one-use temporary grant stands in for it. */
async function allowed(db: Db, input: {
  access: ResolvedAgentAccess;
  actions: readonly AgentAccessAction[];
  write: boolean;
  path: string;
  companyId: string | null | undefined;
  principal: TemporaryAccessPrincipal;
}): Promise<boolean> {
  if (hasAgentAccess(input.access, input.actions)) return true;
  if (!input.write || !input.companyId) return false;
  for (const action of input.actions) {
    for (const resource of grantResources(input.path, input.companyId)) {
      if (await consumeTemporaryAccessOncePerRequest(db, {
        companyId: input.companyId, principal: input.principal, action, resource,
      })) return true;
    }
  }
  return false;
}

/**
 * Enforces agent access levels on the whole REST API (step 4a, section 3). Mounted first on the
 * API router, so in-process dispatch (the MCP tools re-entering REST) passes through it too. A
 * caller acting as an agent needs the action its route is tagged with in `AGENT_ROUTE_POLICY`;
 * an untagged write needs `api:raw`; a read needs `tasks:read`. A temporary grant can stand in for
 * a missing action once. People are left to the routes' membership checks.
 *
 * Each agent request runs in a temporary-grant scope, so a one-use grant is spent once per request
 * however many checks (this policy, then the route's own) consult it.
 */
export function agentRoutePolicy(db: Db): RequestHandler {
  return (req, res, next) => {
    const actor = req.actor;
    const connection = actor?.source === "mcp_oauth" && actor.grantId ? actor.grantId : null;
    if (connection && actor.type === "board" && actor.userId) {
      const userId = actor.userId;
      // A person's outside connection: the connection's level caps what the person may do.
      runWithTemporaryAccessScope(() => {
        void (async () => {
          const [grant] = await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.id, connection));
          if (!grant || grant.revokedAt || grant.userId !== userId) {
            res.status(401).json({ error: "This connection is no longer available." });
            return false;
          }
          const requirement = agentRouteRequirement(req.method, req.path);
          const actions = requirement.write && requirement.routeChecks ? PERSON_WRITE_ACTIONS : requirement.actions;
          const membership = actor.memberships?.find(entry => entry.companyId === grant.companyId);
          if (await allowed(db, {
            access: connectionAccess(grant, membership?.membershipRole), actions, write: requirement.write,
            path: req.path, companyId: grant.companyId, principal: { type: "user", id: userId },
          })) return true;
          deny(res, actions[0]!, requirement.write, "connection");
          return false;
        })().then((ok) => {
          if (ok) next();
        }, next);
      });
      return;
    }
    if (actor?.type !== "agent" || !actor.agentId) {
      next();
      return;
    }
    const agentId = actor.agentId;
    runWithTemporaryAccessScope(() => {
      void (async () => {
        const requirement = agentRouteRequirement(req.method, req.path);
        let cap: ResolvedAgentAccess | null = null;
        if (connection) {
          // An outside connection acting as the agent: the agent's access, capped by the connection.
          const [grant] = await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.id, connection));
          if (!grant || grant.revokedAt || grant.actAsAgentId !== agentId) {
            res.status(401).json({ error: "This connection is no longer available." });
            return null;
          }
          cap = connectionAccess(grant, null);
        }
        const own = await loadAgentAccess(db, agentId);
        const access = cap ? capAgentAccess(own, cap) : own;
        if (await allowed(db, {
          access, actions: requirement.actions, write: requirement.write,
          path: req.path, companyId: actor.companyId, principal: { type: "agent", id: agentId },
        })) return { cap };
        deny(res, requirement.actions[0]!, requirement.write, connection ? "connection" : "agent");
        return null;
      })().then((outcome) => {
        if (!outcome) return;
        // The cap holds for the rest of the request, so the routes' own checks see it too.
        if (outcome.cap) runWithAccessCap(agentId, outcome.cap, () => next());
        else next();
      }, next);
    });
  };
}
