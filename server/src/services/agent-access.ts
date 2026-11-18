import { eq } from "drizzle-orm";
import { agents, type Db } from "@paperclipai/db";
import { agentAccessSchema, resolveAgentAccess, type ResolvedAgentAccess } from "@paperclipai/shared";
import { notFound } from "../errors.js";

/**
 * The agent's effective access, from `agents.permissions.access`. A missing or unreadable value
 * resolves to the default level, never something wider.
 */
export async function loadAgentAccess(db: Db, agentId: string): Promise<ResolvedAgentAccess> {
  const [row] = await db.select({ permissions: agents.permissions }).from(agents).where(eq(agents.id, agentId));
  if (!row) throw notFound("Agent not found");
  const stored = agentAccessSchema.safeParse(row.permissions?.access);
  return resolveAgentAccess(stored.success ? stored.data : null);
}
