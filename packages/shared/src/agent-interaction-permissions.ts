import { z } from "zod";
import type { AgentAccessAction } from "./agent-access.js";

/**
 * The interaction switches still enforced: two actor-side restrictions (what this agent may do to
 * others) and the five receiver-side consents (what other agents may do to this one).
 */
export const AGENT_INTERACTION_PERMISSION_KEYS = [
  "canReceiveAssignmentsFromAgents",
  "canMentionAgents",
  "canReceiveMentionsFromAgents",
  "canCommentOnOtherTasks",
  "canReceiveCommentsFromAgents",
  "canReceiveTaskEditsFromAgents",
  "canReceiveConfigurationChangesFromAgents",
] as const;

export type AgentInteractionPermissionKey = (typeof AGENT_INTERACTION_PERMISSION_KEYS)[number];
export type AgentInteractionPermissions = Partial<Record<AgentInteractionPermissionKey, boolean>>;
export type AgentInteractionPermissionsPatch = Partial<Record<AgentInteractionPermissionKey, boolean | null>>;

/**
 * The four actor-side switches that became access actions in step 4a. Migration 0491 copied a
 * stored `false` into the matching access override; the switches are no longer read, reported or
 * accepted, and a leftover stored value is dropped the next time the interactions are written.
 */
export const RETIRED_AGENT_INTERACTION_PERMISSION_ACTIONS = {
  canAssignTasksToAgents: "tasks:assign",
  canAssignTasksToHumans: "tasks:assign",
  canEditOtherTasks: "tasks:update_any",
  canConfigureOtherAgents: "agents:configure",
} as const satisfies Record<string, AgentAccessAction>;

export type RetiredAgentInteractionPermissionKey = keyof typeof RETIRED_AGENT_INTERACTION_PERMISSION_ACTIONS;
export const RETIRED_AGENT_INTERACTION_PERMISSION_KEYS = Object.keys(
  RETIRED_AGENT_INTERACTION_PERMISSION_ACTIONS,
) as RetiredAgentInteractionPermissionKey[];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The retired switches present in `value` (a stored `interactions` record or a patch body). */
export function retiredAgentInteractionPermissionKeys(value: unknown): RetiredAgentInteractionPermissionKey[] {
  const source = record(value);
  return source ? RETIRED_AGENT_INTERACTION_PERMISSION_KEYS.filter(key => Object.hasOwn(source, key)) : [];
}

/** `value` without the retired switches, for reading interactions stored before step 4a. */
export function withoutRetiredAgentInteractionPermissions(value: unknown): unknown {
  const source = record(value);
  if (!source || retiredAgentInteractionPermissionKeys(source).length === 0) return value;
  const next = { ...source };
  for (const key of RETIRED_AGENT_INTERACTION_PERMISSION_KEYS) delete next[key];
  return next;
}

const shape = Object.fromEntries(AGENT_INTERACTION_PERMISSION_KEYS.map(key => [key, z.boolean().optional()])) as
  Record<AgentInteractionPermissionKey, z.ZodOptional<z.ZodBoolean>>;
const patchShape = Object.fromEntries(AGENT_INTERACTION_PERMISSION_KEYS.map(key => [key, z.boolean().nullable().optional()])) as
  Record<AgentInteractionPermissionKey, z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;

export const agentInteractionPermissionsSchema = z.object(shape).strict();
export const updateAgentInteractionPermissionsSchema = z.object(patchShape).strict()
  .refine(value => Object.keys(value).length > 0, "Provide at least one interaction permission");

export function resolveAgentInteractionPermissions(value: unknown): Record<AgentInteractionPermissionKey, boolean> {
  const source = record(value) ?? {};
  return Object.fromEntries(AGENT_INTERACTION_PERMISSION_KEYS.map(key => [key, source[key] !== false])) as
    Record<AgentInteractionPermissionKey, boolean>;
}

export interface AgentInteractionPermissionsState {
  agentId: string;
  companyId: string;
  overrides: AgentInteractionPermissions;
  effective: Record<AgentInteractionPermissionKey, boolean>;
}
