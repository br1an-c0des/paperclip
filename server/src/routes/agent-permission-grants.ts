import { Router } from "express";
import { agents, companyMemberships, principalPermissionGrants, type Db } from "@paperclipai/db";
import { updateAgentPermissionGrantSchema, isUuidLike } from "@paperclipai/shared";
import { and, eq } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { logActivity, publishActivity, type ActivityPublication } from "../services/activity-log.js";
import { assertAuthenticated, assertBoard, assertCompanyAccess, hasCompanyAccess } from "./authz.js";

/** Permission keys whose agent grants became access actions in step 4a. */
const RETIRED_AGENT_GRANT_KEYS = new Set<string>(["tasks:assign", "tasks:assign_scope", "agents:create", "agents:configure"]);

export function agentPermissionGrantRoutes(db: Db) {
  const router = Router();

  router.patch("/agents/:id/permission-grants", validate(updateAgentPermissionGrantSchema), async (req, res) => {
    assertAuthenticated(req);
    assertBoard(req);
    const id = req.params.id as string;
    if (!isUuidLike(id)) throw badRequest("Agent ID must be a UUID");
    const { permissionKey, enabled } = req.body;
    // Since step 4a an agent's assignment, hiring and configure authority is its access level
    // (permissions.access): grants for those keys are no longer read for agents.
    if (RETIRED_AGENT_GRANT_KEYS.has(permissionKey)) {
      res.status(410).json({
        error: `Agent grants for ${permissionKey} are retired: set the agent's access level and overrides (permissions.access) with PATCH /api/agents/${id}/permissions.`,
        code: "agent_grant_retired",
      });
      return;
    }
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      const agent = await tx.select({ id: agents.id, companyId: agents.companyId, status: agents.status })
        .from(agents).where(eq(agents.id, id)).for("update").then(rows => rows[0]);
      if (!agent || !hasCompanyAccess(req, agent.companyId)) throw notFound("Agent not found");
      assertCompanyAccess(req, agent.companyId);
      const txDb = tx as unknown as Db;
      const access = accessService(txDb);
      if (req.actor.source !== "local_implicit"
        && !await access.canUser(agent.companyId, req.actor.userId, "users:manage_permissions")) {
        throw forbidden("Missing permission: users:manage_permissions");
      }
      if (enabled) {
        if (agent.status === "pending_approval" || agent.status === "terminated") {
          throw conflict("Cannot grant permissions to an unapproved or terminated agent");
        }
        const membership = await tx.select().from(companyMemberships).where(and(
          eq(companyMemberships.companyId, agent.companyId),
          eq(companyMemberships.principalType, "agent"),
          eq(companyMemberships.principalId, agent.id),
        )).for("update").then(rows => rows[0]);
        if (!membership || membership.status !== "active") {
          throw conflict("Agent company membership is not active");
        }
        await tx.insert(principalPermissionGrants).values({
          companyId: agent.companyId, principalType: "agent", principalId: agent.id,
          permissionKey, scope: null, grantedByUserId: req.actor.userId ?? null,
        }).onConflictDoUpdate({
          target: [principalPermissionGrants.companyId, principalPermissionGrants.principalType,
            principalPermissionGrants.principalId, principalPermissionGrants.permissionKey],
          set: { scope: null, grantedByUserId: req.actor.userId ?? null, updatedAt: new Date() },
        });
      } else {
        await tx.delete(principalPermissionGrants).where(and(
          eq(principalPermissionGrants.companyId, agent.companyId),
          eq(principalPermissionGrants.principalType, "agent"),
          eq(principalPermissionGrants.principalId, agent.id),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ));
      }
      await logActivity(txDb, {
        companyId: agent.companyId, actorType: "user", actorId: req.actor.userId ?? "board",
        action: "agent.permission_grant_updated", entityType: "agent", entityId: agent.id,
        details: { permissionKey, enabled },
      }, publications);
      return { agentId: agent.id, companyId: agent.companyId, permissionKey, enabled };
    });
    for (const publication of publications) publishActivity(publication);
    res.json(result);
  });

  return router;
}
