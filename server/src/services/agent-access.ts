import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { agents, temporaryAccessGrants, type Db } from "@paperclipai/db";
import {
  AGENT_ACCESS_ACTIONS,
  agentAccessSchema,
  resolveAgentAccess,
  type AgentAccessAction,
  type ResolvedAgentAccess,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TemporaryAccessPrincipal = { type: "agent" | "user"; id: string };
export type TemporaryAccessResource = { type: "issue" | "agent" | "project" | "company"; id: string };

/**
 * The agent's effective access, from `agents.permissions.access`, widened by any unexpired
 * company-wide temporary grant without a use limit (a standing grant such as a watch). A missing or
 * unreadable value resolves to the default level, never something wider. One-use and
 * resource-scoped grants don't widen it: `authorizationService.decide` checks those per call.
 */
export async function loadAgentAccess(db: Db, agentId: string): Promise<ResolvedAgentAccess> {
  const [row] = await db.select({ companyId: agents.companyId, permissions: agents.permissions })
    .from(agents).where(eq(agents.id, agentId));
  if (!row) throw notFound("Agent not found");
  const stored = agentAccessSchema.safeParse(row.permissions?.access);
  const access = resolveAgentAccess(stored.success ? stored.data : null);
  const standing = await db.selectDistinct({ action: temporaryAccessGrants.action })
    .from(temporaryAccessGrants)
    .where(and(
      eq(temporaryAccessGrants.companyId, row.companyId),
      eq(temporaryAccessGrants.principalType, "agent"),
      eq(temporaryAccessGrants.principalId, agentId),
      isNull(temporaryAccessGrants.usesLeft),
      gt(temporaryAccessGrants.expiresAt, new Date()),
      sql`${temporaryAccessGrants.resource}->>'type' = 'company'`,
      sql`${temporaryAccessGrants.resource}->>'id' = ${row.companyId}`,
    ));
  for (const { action } of standing) {
    if (isAgentAccessAction(action) && access[action] === false) access[action] = true;
  }
  return access;
}

export function isAgentAccessAction(value: unknown): value is AgentAccessAction {
  return typeof value === "string" && (AGENT_ACCESS_ACTIONS as readonly string[]).includes(value);
}

/** Records a time-limited allow for one action on one resource (or a whole company). */
export async function grantTemporaryAccess(db: DbOrTransaction, input: {
  companyId: string;
  principal: TemporaryAccessPrincipal;
  action: AgentAccessAction;
  resource: TemporaryAccessResource;
  expiresAt: Date;
  reason: string;
  usesLeft?: number;
}): Promise<{ id: string }> {
  const [row] = await db.insert(temporaryAccessGrants).values({
    companyId: input.companyId,
    principalType: input.principal.type,
    principalId: input.principal.id,
    action: input.action,
    resource: input.resource,
    expiresAt: input.expiresAt,
    reason: input.reason,
    usesLeft: input.usesLeft ?? null,
  }).returning({ id: temporaryAccessGrants.id });
  return { id: row.id };
}

/**
 * True when an unexpired grant matches the principal, action and resource (or covers the whole
 * company). A grant without a use limit is never used up; otherwise one use is taken atomically, so
 * two concurrent calls can't both spend a one-use grant.
 */
export async function consumeTemporaryAccess(db: DbOrTransaction, input: {
  companyId: string;
  principal: TemporaryAccessPrincipal;
  action: AgentAccessAction;
  resource: TemporaryAccessResource;
}): Promise<boolean> {
  const matches = and(
    eq(temporaryAccessGrants.companyId, input.companyId),
    eq(temporaryAccessGrants.principalType, input.principal.type),
    eq(temporaryAccessGrants.principalId, input.principal.id),
    eq(temporaryAccessGrants.action, input.action),
    gt(temporaryAccessGrants.expiresAt, new Date()),
    or(
      and(
        sql`${temporaryAccessGrants.resource}->>'type' = ${input.resource.type}`,
        sql`${temporaryAccessGrants.resource}->>'id' = ${input.resource.id}`,
      ),
      and(
        sql`${temporaryAccessGrants.resource}->>'type' = 'company'`,
        sql`${temporaryAccessGrants.resource}->>'id' = ${input.companyId}`,
      ),
    ),
  );
  const [standing] = await db.select({ id: temporaryAccessGrants.id }).from(temporaryAccessGrants)
    .where(and(matches, isNull(temporaryAccessGrants.usesLeft))).limit(1);
  if (standing) return true;
  const used = await db.update(temporaryAccessGrants)
    .set({ usesLeft: sql`${temporaryAccessGrants.usesLeft} - 1` })
    .where(inArray(
      temporaryAccessGrants.id,
      db.select({ id: temporaryAccessGrants.id }).from(temporaryAccessGrants)
        .where(and(matches, gt(temporaryAccessGrants.usesLeft, 0)))
        .orderBy(temporaryAccessGrants.createdAt)
        .limit(1)
        .for("update", { skipLocked: true }),
    ))
    .returning({ id: temporaryAccessGrants.id });
  return used.length > 0;
}

/**
 * One request's temporary-grant uses. The route policy opens a scope per request, and within it a
 * grant for an action is spent at most once however many checks ask (the policy, then the route's
 * own decide calls, which may name the resource differently).
 */
const requestGrantUses = new AsyncLocalStorage<Map<string, Promise<boolean>>>();

export function runWithTemporaryAccessScope<T>(fn: () => T): T {
  return requestGrantUses.run(new Map(), fn);
}

export function consumeTemporaryAccessOncePerRequest(
  db: DbOrTransaction,
  input: Parameters<typeof consumeTemporaryAccess>[1],
): Promise<boolean> {
  const uses = requestGrantUses.getStore();
  if (!uses) return consumeTemporaryAccess(db, input);
  const key = `${input.companyId}:${input.principal.type}:${input.principal.id}:${input.action}`;
  const earlier = uses.get(key);
  if (earlier) {
    return earlier.then(granted => granted ? true : consumeAndRemember());
  }
  return consumeAndRemember();

  function consumeAndRemember() {
    const result = consumeTemporaryAccess(db, input);
    uses!.set(key, result);
    return result;
  }
}
