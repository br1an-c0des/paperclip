import { currentPluginInteractionOrigin } from "./plugin-interaction-context.js";
import { and, eq } from "drizzle-orm";
import { agents, type Db } from "@paperclipai/db";
import {
  agentInteractionPermissionsSchema, resolveAgentInteractionPermissions, updateAgentInteractionPermissionsSchema,
  RETIRED_AGENT_INTERACTION_PERMISSION_ACTIONS, retiredAgentInteractionPermissionKeys,
  withoutRetiredAgentInteractionPermissions,
  type AgentInteractionPermissionsPatch, type AgentInteractionPermissionsState,
} from "@paperclipai/shared";
import { conflict, forbidden, HttpError, notFound } from "../errors.js";
import { accessService } from "./access.js";
import type { AuthorizationActor } from "./authorization.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";

/**
 * Refuses a patch that sets one of the four switches retired in step 4a (410, like retired agent
 * grants): they're access actions now, set with `PATCH /api/agents/:id/permissions`.
 */
export function assertNoRetiredAgentInteractionPermissions(agentId: string, body: unknown) {
  const retired = retiredAgentInteractionPermissionKeys(body);
  if (!retired.length) return;
  const actions = [...new Set(retired.map(key => RETIRED_AGENT_INTERACTION_PERMISSION_ACTIONS[key]))];
  throw new HttpError(410,
    `${retired.join(", ")} ${retired.length === 1 ? "is" : "are"} retired: set the agent's access `
    + `(${actions.join(", ")}, in permissions.access) with PATCH /api/agents/${agentId}/permissions.`,
    { code: "agent_interaction_permission_retired", keys: retired, actions });
}

function state(agent: { id: string; companyId: string; permissions: Record<string, unknown> }): AgentInteractionPermissionsState {
  // Interactions stored before step 4a may still hold a retired switch. It isn't read, so it's left
  // out here, and the next write through this service drops it.
  const parsed = agentInteractionPermissionsSchema.safeParse(
    withoutRetiredAgentInteractionPermissions(agent.permissions.interactions ?? {}));
  if (!parsed.success) throw conflict("Stored interaction permissions are invalid", { code: "invalid_agent_interaction_permissions" });
  return { agentId: agent.id, companyId: agent.companyId, overrides: parsed.data,
    effective: resolveAgentInteractionPermissions(parsed.data) };
}

export async function readAgentInteractionPermissions(db: Db, actor: AuthorizationActor, companyId: string, agentId: string) {
  const decision = await accessService(db).decide({ actor, action: "agent_config:read",
    resource: { type: "agent", companyId, agentId }, scope: { agentId, targetAgentId: agentId } });
  if (!decision.allowed) throw forbidden(decision.explanation);
  const [agent] = await db.select({ id: agents.id, companyId: agents.companyId, permissions: agents.permissions })
    .from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!agent) throw notFound("Agent not found");
  return state(agent);
}

export async function updateAgentInteractionPermissions(db: Db, actor: AuthorizationActor, companyId: string,
  agentId: string, input: AgentInteractionPermissionsPatch) {
  if (actor.type !== "board" || currentPluginInteractionOrigin()) throw forbidden("Only human permission managers can change interaction permissions");
  assertNoRetiredAgentInteractionPermissions(agentId, input);
  const patch = updateAgentInteractionPermissionsSchema.parse(input);
  const publications: ActivityPublication[] = [];
  const result = await db.transaction(async tx => {
    const transactionDb = tx as unknown as Db;
    const decision = await accessService(transactionDb).decide({ actor, action: "users:manage_permissions",
      resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
    const [agent] = await tx.select().from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).for("update");
    if (!agent) throw notFound("Agent not found");
    if (agent.status === "pending_approval") throw conflict("Pending approval agent permissions cannot be changed before board approval");
    const before = state(agent).overrides;
    const overrides = { ...before };
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      const value = patch[key];
      if (value === null) delete overrides[key];
      else if (value !== undefined) overrides[key] = value;
    }
    const permissions = { ...agent.permissions };
    if (Object.keys(overrides).length) permissions.interactions = overrides;
    else delete permissions.interactions;
    await tx.update(agents).set({ permissions, updatedAt: new Date() }).where(eq(agents.id, agentId));
    await logActivity(transactionDb, { companyId, actorType: "user", actorId: actor.userId ?? "local-board",
      action: "agent.interaction_permissions_updated", entityType: "agent", entityId: agentId,
      details: { before, after: overrides } }, publications);
    return state({ ...agent, permissions });
  });
  for (const publication of publications) publishActivity(publication);
  return result;
}
