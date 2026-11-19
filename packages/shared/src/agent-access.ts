import { z } from "zod";

/** What an agent (or a connection acting as one) may do. See fork/step-4a-mcp-and-permissions.md, section 2. */
export const AGENT_ACCESS_ACTIONS = [
  "tasks:read",
  "tasks:comment",
  "tasks:update_own",
  "tasks:create",
  "requests:create",
  "tasks:update_any",
  "tasks:assign",
  "labels:manage",
  "projects:manage",
  "agents:configure",
  "agents:create",
  "api:raw",
  "tasks:delete",
] as const;
export type AgentAccessAction = (typeof AGENT_ACCESS_ACTIONS)[number];

export const AGENT_ACCESS_LEVELS = ["read_only", "worker", "manager", "admin"] as const;
export type AgentAccessLevel = (typeof AGENT_ACCESS_LEVELS)[number];

const READ_ONLY_ACTIONS = ["tasks:read"] as const satisfies readonly AgentAccessAction[];
const WORKER_ACTIONS = [
  ...READ_ONLY_ACTIONS,
  "tasks:comment",
  "tasks:update_own",
  "tasks:create",
  "requests:create",
] as const satisfies readonly AgentAccessAction[];
const MANAGER_ACTIONS = [
  ...WORKER_ACTIONS,
  "tasks:update_any",
  "tasks:assign",
  "labels:manage",
  "projects:manage",
] as const satisfies readonly AgentAccessAction[];
const ADMIN_ACTIONS = [
  ...MANAGER_ACTIONS,
  "agents:configure",
  "agents:create",
  "api:raw",
] as const satisfies readonly AgentAccessAction[];

/** The actions each level allows. `tasks:delete` is in none: only an override grants it. */
export const AGENT_ACCESS_LEVEL_ACTIONS: Record<AgentAccessLevel, readonly AgentAccessAction[]> = {
  read_only: READ_ONLY_ACTIONS,
  worker: WORKER_ACTIONS,
  manager: MANAGER_ACTIONS,
  admin: ADMIN_ACTIONS,
};

/** Agents created without `access` get this level. */
export const DEFAULT_AGENT_ACCESS_LEVEL: AgentAccessLevel = "worker";
/** A new agent with the CEO role starts here, with the `agents:create` override (decided 2026-11-18). */
export const NEW_CEO_ACCESS_LEVEL: AgentAccessLevel = "manager";
/** Agents that existed when access levels were introduced (migration 0491) start here. */
export const EXISTING_AGENT_ACCESS_LEVEL: AgentAccessLevel = "manager";
/** An outside connection acting as the person defaults to this level. */
export const DEFAULT_CONNECTION_ACCESS_LEVEL: AgentAccessLevel = "manager";

export type AgentAccessOverride = boolean | { scope: Record<string, unknown> };

export interface AgentAccess {
  level: AgentAccessLevel;
  overrides?: Partial<Record<AgentAccessAction, AgentAccessOverride>>;
}

export type ResolvedAgentAccess = Record<AgentAccessAction, false | true | { scope: Record<string, unknown> }>;

const agentAccessOverrideSchema = z.union([
  z.boolean(),
  z.object({ scope: z.record(z.string(), z.unknown()) }).strict(),
]);

const overridesShape = Object.fromEntries(
  AGENT_ACCESS_ACTIONS.map(action => [action, agentAccessOverrideSchema.optional()]),
) as Record<AgentAccessAction, z.ZodOptional<typeof agentAccessOverrideSchema>>;

export const agentAccessSchema = z.object({
  level: z.enum(AGENT_ACCESS_LEVELS),
  overrides: z.object(overridesShape).strict().optional(),
}).strict();

function isAllowed(value: ResolvedAgentAccess[AgentAccessAction]): boolean {
  return value === true || (typeof value === "object" && value !== null);
}

/** Works out every action's value: the level's default, replaced by an override where one is set. */
export function resolveAgentAccess(access: AgentAccess | null | undefined): ResolvedAgentAccess {
  const levelActions = new Set<AgentAccessAction>(
    AGENT_ACCESS_LEVEL_ACTIONS[access?.level ?? DEFAULT_AGENT_ACCESS_LEVEL]
      ?? AGENT_ACCESS_LEVEL_ACTIONS[DEFAULT_AGENT_ACCESS_LEVEL],
  );
  const overrides = access?.overrides ?? {};
  return Object.fromEntries(AGENT_ACCESS_ACTIONS.map(action => {
    const override = overrides[action];
    return [action, override === undefined ? levelActions.has(action) : override];
  })) as ResolvedAgentAccess;
}

/**
 * Limits `access` by `cap`: an action is allowed only if both allow it. When both are scoped,
 * `access`'s scope is kept; when only the cap is scoped, the cap's scope applies.
 */
export function capAgentAccess(access: ResolvedAgentAccess, cap: ResolvedAgentAccess): ResolvedAgentAccess {
  return Object.fromEntries(AGENT_ACCESS_ACTIONS.map(action => {
    const own = access[action];
    const limit = cap[action];
    if (!isAllowed(own) || !isAllowed(limit)) return [action, false];
    return [action, own === true ? limit : own];
  })) as ResolvedAgentAccess;
}

/** Whether `access` allows the action, or any of them when given an array. A scoped value counts as allowed. */
export function hasAgentAccess(
  access: ResolvedAgentAccess,
  action: AgentAccessAction | readonly AgentAccessAction[],
): boolean {
  const actions: readonly AgentAccessAction[] = typeof action === "string" ? [action] : action;
  return actions.some(candidate => isAllowed(access[candidate]));
}
