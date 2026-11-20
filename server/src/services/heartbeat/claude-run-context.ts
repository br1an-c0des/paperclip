import { agentAccessSchema, type AgentAccessLevel, type AgentAccessOverrides } from "@paperclipai/shared";

/**
 * Step 4b: the agent's access as the run's context carries it (`context.paperclipAgentAccess`),
 * for the run manifest. This is the stored `permissions.access`, not the resolved per-action map:
 * the level and its overrides, with the overrides defaulted to `{}`. `null` when nothing is stored
 * or it doesn't parse, so the manifest never claims a level the agent wasn't given.
 */
export function readRunAgentAccess(
  permissions: unknown,
): { level: AgentAccessLevel; overrides: AgentAccessOverrides } | null {
  const record = permissions && typeof permissions === "object" && !Array.isArray(permissions)
    ? permissions as Record<string, unknown>
    : null;
  const parsed = agentAccessSchema.safeParse(record?.access);
  if (!parsed.success) return null;
  return { level: parsed.data.level, overrides: parsed.data.overrides ?? {} };
}
