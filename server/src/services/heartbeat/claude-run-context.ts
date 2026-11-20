import {
  DEFAULT_AGENT_ACCESS_LEVEL,
  agentAccessSchema,
  type AgentAccessLevel,
  type AgentAccessOverrides,
} from "@paperclipai/shared";

/**
 * Step 4b: the agent's access as the run's context carries it (`context.paperclipAgentAccess`),
 * for the run manifest. This is the stored `permissions.access`, not the resolved per-action map:
 * the level and its overrides, with the overrides defaulted to `{}`. When nothing is stored or it
 * doesn't parse, the agent runs at the default level with no overrides (as `loadAgentAccess`
 * enforces it), and that's what this reports. The return type stays nullable to match the
 * manifest contract, but this function never returns `null`. Standing temporary grants don't show.
 */
export function readRunAgentAccess(
  permissions: unknown,
): { level: AgentAccessLevel; overrides: AgentAccessOverrides } | null {
  const record = permissions && typeof permissions === "object" && !Array.isArray(permissions)
    ? permissions as Record<string, unknown>
    : null;
  const parsed = agentAccessSchema.safeParse(record?.access);
  if (!parsed.success) return { level: DEFAULT_AGENT_ACCESS_LEVEL, overrides: {} };
  return { level: parsed.data.level, overrides: parsed.data.overrides ?? {} };
}
