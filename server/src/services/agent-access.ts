import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { agents, temporaryAccessGrants, type Db } from "@paperclipai/db";
import {
  AGENT_ACCESS_ACTIONS,
  DEFAULT_AGENT_ACCESS_LEVEL,
  NEW_CEO_ACCESS_LEVEL,
  agentAccessSchema,
  capAgentAccess,
  resolveAgentAccess,
  type AgentAccess,
  type AgentAccessAction,
  type ResolvedAgentAccess,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { permissionsImplyLowTrust } from "../lib/agent-permissions.js";

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
  const capped = accessCaps.getStore();
  return capped?.agentId === agentId ? capAgentAccess(access, capped.cap) : access;
}

/**
 * A cap on one agent's access for the rest of a request: an outside connection acting as the agent
 * may do no more than the connection's level allows (step 4a, section 1). The route policy opens it,
 * so every access check in the request, the routes' own included, sees the capped access.
 */
const accessCaps = new AsyncLocalStorage<{ agentId: string; cap: ResolvedAgentAccess }>();

export function runWithAccessCap<T>(agentId: string, cap: ResolvedAgentAccess, fn: () => T): T {
  return accessCaps.run({ agentId, cap }, fn);
}

/**
 * The agent's stored access with one override set, starting from the default level when it has
 * none stored yet. For callers that change a single action (the old hiring toggle).
 */
export function withAccessOverride(permissions: unknown, action: AgentAccessAction, value: boolean): AgentAccess {
  const record = permissions && typeof permissions === "object" && !Array.isArray(permissions)
    ? permissions as Record<string, unknown>
    : {};
  const parsed = agentAccessSchema.safeParse(record.access);
  const current: AgentAccess = parsed.success ? parsed.data : { level: DEFAULT_AGENT_ACCESS_LEVEL };
  return { ...current, overrides: { ...current.overrides, [action]: value } };
}

/**
 * The access a new agent starts with (decided 2026-11-18), from the permissions its creator sent:
 *
 * - an explicit `access` is kept when `explicitAllowed` (a person, or the server, created it); an
 *   agent never chooses a level, so an agent creator's `access` is dropped;
 * - otherwise a CEO starts at manager with the `agents:create` override, which a low-trust CEO gets
 *   only when `canCreateAgents: true` was sent (a plain `false` on a CEO isn't a restriction, as in
 *   `normalizeAgentPermissions`; a recorded hiring denial is applied after creation);
 * - and any other agent sent with `canCreateAgents: true` gets the `agents:create` override at the
 *   default level.
 *
 * Null means store no access: the agent resolves to the default level.
 */
export function newAgentAccess(input: {
  role: string | null | undefined;
  requestedPermissions: unknown;
  explicitAllowed: boolean;
}): AgentAccess | null {
  const requested = input.requestedPermissions && typeof input.requestedPermissions === "object" && !Array.isArray(input.requestedPermissions)
    ? input.requestedPermissions as Record<string, unknown>
    : {};
  if (input.explicitAllowed && requested.access !== undefined) {
    const parsed = agentAccessSchema.safeParse(requested.access);
    if (!parsed.success) throw unprocessable("permissions.access must be an access level with optional overrides");
    return parsed.data;
  }
  const hiring = { overrides: { "agents:create": true } } as const;
  if (input.role === "ceo") {
    const hires = requested.canCreateAgents === true || !permissionsImplyLowTrust(requested);
    return { level: NEW_CEO_ACCESS_LEVEL, ...(hires ? hiring : {}) };
  }
  return requested.canCreateAgents === true ? { level: DEFAULT_AGENT_ACCESS_LEVEL, ...hiring } : null;
}

/** `permissions` with `access` set to the given value, or without `access` when it's null. */
export function withStoredAccess<T extends Record<string, unknown>>(permissions: T, access: AgentAccess | null): T {
  const { access: _previous, ...rest } = permissions;
  return (access ? { ...rest, access } : rest) as T;
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
 * An allow for one action on one resource (or a whole company), held only by the async chain of an
 * approved permission request's replay (step 4a, section 7). Every write the replayed tool makes is
 * covered, however many there are, and nothing outside the replay is: there is no stored grant, and
 * the allow is switched off when the replay ends, so work it left running doesn't keep it.
 */
export interface ReplayAccess {
  companyId: string;
  principal: TemporaryAccessPrincipal;
  action: AgentAccessAction;
  resource: TemporaryAccessResource;
}

const replayAccess = new AsyncLocalStorage<ReplayAccess & { active: boolean }>();

export async function runWithReplayAccess<T>(allow: ReplayAccess, fn: () => Promise<T>): Promise<T> {
  const scope = { ...allow, active: true };
  try {
    return await replayAccess.run(scope, fn);
  } finally {
    scope.active = false;
  }
}

function replayAllows(input: {
  companyId: string;
  principal: TemporaryAccessPrincipal;
  action: AgentAccessAction;
  resource: TemporaryAccessResource;
}): boolean {
  const allow = replayAccess.getStore();
  if (!allow?.active) return false;
  if (allow.companyId !== input.companyId || allow.action !== input.action) return false;
  if (allow.principal.type !== input.principal.type || allow.principal.id !== input.principal.id) return false;
  return allow.resource.type === "company"
    ? allow.resource.id === input.companyId
    : allow.resource.type === input.resource.type && allow.resource.id === input.resource.id;
}

/**
 * True when an unexpired grant matches the principal, action and resource (or covers the whole
 * company), or a permission request's replay holds an allow for them. A grant without a use limit
 * is never used up; otherwise one use is taken atomically, so two concurrent calls can't both spend
 * a one-use grant.
 */
export async function consumeTemporaryAccess(db: DbOrTransaction, input: {
  companyId: string;
  principal: TemporaryAccessPrincipal;
  action: AgentAccessAction;
  resource: TemporaryAccessResource;
}): Promise<boolean> {
  if (replayAllows(input)) return true;
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
  // One plain read first, preferring a standing grant: most checks that get here have no grant at
  // all, and they must not write or take row locks (a denied check runs on read paths too).
  const [usable] = await db.select({ usesLeft: temporaryAccessGrants.usesLeft }).from(temporaryAccessGrants)
    .where(and(matches, or(isNull(temporaryAccessGrants.usesLeft), gt(temporaryAccessGrants.usesLeft, 0))))
    .orderBy(sql`${temporaryAccessGrants.usesLeft} is null desc`)
    .limit(1);
  if (!usable) return false;
  if (usable.usesLeft === null) return true;
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
