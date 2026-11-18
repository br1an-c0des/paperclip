import type { RequestHandler } from "express";
import type { Db } from "@paperclipai/db";
import { hasAgentAccess, type AgentAccessAction } from "@paperclipai/shared";
import {
  consumeTemporaryAccessOncePerRequest,
  loadAgentAccess,
  runWithTemporaryAccessScope,
  type TemporaryAccessResource,
} from "../services/agent-access.js";
import { agentRouteRequirement } from "./agent-route-policy-table.js";

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

function phrase(action: AgentAccessAction) {
  return action === "api:raw"
    ? "This route is not open to agents without api:raw (admin access)."
    : `This agent's access level does not include ${action}.`;
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
    if (actor?.type !== "agent" || !actor.agentId) {
      next();
      return;
    }
    const agentId = actor.agentId;
    runWithTemporaryAccessScope(() => {
      void (async () => {
        const requirement = agentRouteRequirement(req.method, req.path);
        const access = await loadAgentAccess(db, agentId);
        if (hasAgentAccess(access, requirement.actions)) return true;
        if (requirement.write && actor.companyId) {
          for (const action of requirement.actions) {
            for (const resource of grantResources(req.path, actor.companyId)) {
              if (await consumeTemporaryAccessOncePerRequest(db, {
                companyId: actor.companyId, principal: { type: "agent", id: agentId }, action, resource,
              })) return true;
            }
          }
        }
        const missingAction = requirement.actions[0]!;
        res.status(403).json({
          error: phrase(missingAction),
          code: "access_denied",
          missingAction,
          // Reads are never requestable; a write refused by the level or overrides is.
          requestable: requirement.write,
        });
        return false;
      })().then((allowed) => {
        if (allowed) next();
      }, next);
    });
  };
}
