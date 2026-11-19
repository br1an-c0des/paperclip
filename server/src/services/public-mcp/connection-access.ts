import { and, asc, eq, notInArray } from "drizzle-orm";
import { agents, mcpOauthGrants, type Db } from "@paperclipai/db";
import {
  AGENT_ACCESS_LEVELS,
  agentAccessSchema,
  capAgentAccess,
  resolveAgentAccess,
  type AgentAccessLevel,
  type AgentAccessOverrides,
  type McpActAsAgentChoice,
  type ResolvedAgentAccess,
} from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "../authorization.js";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
type Grant = Pick<typeof mcpOauthGrants.$inferSelect, "accessLevel" | "accessOverrides">;

/** Agents a connection can't act as: gone, or not yet hired. */
const UNAVAILABLE_AGENT_STATUSES = ["terminated", "pending_approval"];

const READ_ONLY = resolveAgentAccess({ level: "read_only" });

/** The level a member may give a connection: a viewer's connection is read-only. */
export function maxConnectionAccessLevel(membershipRole: string | null | undefined): AgentAccessLevel {
  return membershipRole === "viewer" ? "read_only" : "admin";
}

export function levelWithin(level: AgentAccessLevel, max: AgentAccessLevel): boolean {
  return AGENT_ACCESS_LEVELS.indexOf(level) <= AGENT_ACCESS_LEVELS.indexOf(max);
}

/** The grant's stored level and overrides; a grant with none stored reads as read-only. */
export function storedConnectionAccess(grant: Grant): { level: AgentAccessLevel; overrides: AgentAccessOverrides } {
  const parsed = agentAccessSchema.safeParse({
    level: grant.accessLevel ?? "read_only",
    ...(grant.accessOverrides ? { overrides: grant.accessOverrides } : {}),
  });
  return parsed.success
    ? { level: parsed.data.level, overrides: parsed.data.overrides ?? {} }
    : { level: "read_only", overrides: {} };
}

/**
 * What a personal connection allows: its level and overrides, capped at read-only while the person
 * is a viewer member (membership can change after consent). For a connection acting as an agent,
 * this is the cap on the agent's own access.
 */
export function connectionAccess(grant: Grant, membershipRole: string | null | undefined): ResolvedAgentAccess {
  const stored = storedConnectionAccess(grant);
  const access = resolveAgentAccess(stored);
  return maxConnectionAccessLevel(membershipRole) === "read_only" ? capAgentAccess(access, READ_ONLY) : access;
}

/** Whether the person may configure the agent: the same check as changing its settings. */
export async function personMayConfigureAgent(
  db: DbOrTransaction,
  actor: AuthorizationActor,
  companyId: string,
  agentId: string,
): Promise<boolean> {
  if (actor.type !== "board" || !actor.userId) return false;
  const decision = await authorizationService(db as Db).decide({
    actor,
    action: "agent_config:update",
    resource: { type: "agent", companyId, agentId },
  });
  // A suggest-only grant (changes go through consent) isn't configuring.
  return decision.allowed && decision.reason !== "allow_consented_change";
}

/** The agents in the company the person may choose for a connection to act as. */
export async function actAsAgentChoices(
  db: DbOrTransaction,
  actor: AuthorizationActor,
  companyId: string,
): Promise<McpActAsAgentChoice[]> {
  if (actor.type !== "board" || !actor.userId) return [];
  const rows = await db.select({ id: agents.id, name: agents.name }).from(agents)
    .where(and(eq(agents.companyId, companyId), notInArray(agents.status, UNAVAILABLE_AGENT_STATUSES)))
    .orderBy(asc(agents.name));
  const allowed = await Promise.all(rows.map(row => personMayConfigureAgent(db, actor, companyId, row.id)));
  return rows.filter((_row, index) => allowed[index]);
}

/** The agent a connection is to act as, if the person may choose it; else null. */
export async function actAsAgentIfAllowed(
  db: DbOrTransaction,
  actor: AuthorizationActor,
  companyId: string,
  agentId: string,
): Promise<{ id: string; name: string } | null> {
  const [agent] = await db.select({ id: agents.id, name: agents.name, status: agents.status }).from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!agent || UNAVAILABLE_AGENT_STATUSES.includes(agent.status)) return null;
  return await personMayConfigureAgent(db, actor, companyId, agent.id) ? { id: agent.id, name: agent.name } : null;
}
