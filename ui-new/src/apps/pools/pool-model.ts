import type {
  Agent,
  AiConnectionPool,
  AiConnectionPoolConfig,
  AiConnectionPoolMember,
  AiManagedConnectionSummary,
  AppDefinition,
  ToolConnection,
} from "@paperclipai/shared";

/*
 * View model for AI connection pools (src/apps/pools/): a plugin-provided AI connection that hands
 * each new task to one of several AI connections the company already has. The shared package's
 * router helpers (`aiConnectionRouterSlug`, `aiConnectionRouterPluginKey`,
 * `aiConnectionRouterAppDefinition`) are copied here, as decision 10 says, and the member defaults
 * follow ui/src/components/ai-connections/AiConnectionPoolConnector.tsx.
 */

/** The gallery slug of a pool plugin's entry: its key, hex-encoded (stable across reinstalls). */
export function poolSlug(pluginKey: string): string {
  return `ai-router-${Array.from(pluginKey, (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;
}

/** The plugin that runs a pool connection, or null for any other connection. */
export function poolPluginKey(connection: Pick<ToolConnection, "config"> | null | undefined): string | null {
  const router = connection?.config?.aiRouter;
  return router && typeof router === "object" && "pluginKey" in router && typeof router.pluginKey === "string" ? router.pluginKey : null;
}

/** The gallery entry the server offers for a pool plugin, or a stand-in when the plugin is gone. */
export function poolApp(apps: readonly AppDefinition[], pluginKey: string): AppDefinition {
  return (
    apps.find((app) => app.aiConnectionRouter?.pluginKey === pluginKey) ?? {
      schemaVersion: 1,
      slug: poolSlug(pluginKey),
      name: "AI connection pool",
      description: "Use existing AI connections.",
      categories: ["ai"],
      branding: { logoUrl: "/brands/apps/connection-pool.svg" },
      urlPatterns: [],
      aiConnectionRouter: { pluginKey },
      availability: { available: false, reason: "Enable the connection pool plugin in Plugins." },
      methods: [],
    }
  );
}

/** The pool plugins the gallery offers (shown under AI connections, not in the app gallery). */
export function poolApps(apps: readonly AppDefinition[]): AppDefinition[] {
  return apps.filter((app) => app.aiConnectionRouter).sort((a, b) => a.name.localeCompare(b.name));
}

export function configOf(pool: AiConnectionPoolConfig): AiConnectionPoolConfig {
  return { name: pool.name, enabled: pool.enabled, members: pool.members, mode: pool.mode, thresholdPercent: pool.thresholdPercent };
}

/** A new pool starts paused, in turn, skipping at 90% when usage-aware is turned on. */
export function emptyConfig(name = "AI connection pool"): AiConnectionPoolConfig {
  return { name, enabled: false, members: [], mode: "round_robin", thresholdPercent: 90 };
}

/**
 * A member for one AI connection: its grant (shared, or delegated for a personal one) and the
 * harness and model its turns run on, the old UI's defaults per provider.
 */
export function memberOf(account: AiManagedConnectionSummary, id: string = crypto.randomUUID()): AiConnectionPoolMember {
  const profile: AiConnectionPoolMember["profile"] =
    account.provider === "openai"
      ? { provider: "codex", model: "gpt-5.6-sol" }
      : account.provider === "anthropic"
        ? { provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5" }
        : account.provider === "xai"
          ? { provider: "acpx", acpxAgent: "grok", model: "grok-4.7" }
          : { provider: "opencode", model: "openrouter/anthropic/claude-sonnet-4.6" };
  return {
    id,
    binding: {
      mode: account.ownership === "shared" ? "shared" : "delegated",
      provider: account.provider,
      method: account.method,
      connectionId: account.id,
      grantId: account.grantId,
    } as AiConnectionPoolMember["binding"],
    profile,
  };
}

export function memberAccount(member: AiConnectionPoolMember, accounts: readonly AiManagedConnectionSummary[]) {
  return accounts.find((account) => account.id === member.binding.connectionId && account.grantId === member.binding.grantId) ?? null;
}

/** Ticks or unticks a connection in the picker. One member per connection. */
export function toggleMember(
  members: readonly AiConnectionPoolMember[],
  account: AiManagedConnectionSummary,
  on: boolean,
): AiConnectionPoolMember[] {
  if (!on) return members.filter((member) => member.binding.connectionId !== account.id);
  if (members.some((member) => member.binding.connectionId === account.id)) return [...members];
  return [...members, memberOf(account)];
}

/** Whether a connection can be ticked: connected, and not already in the pool through another grant. */
export function pickable(members: readonly AiConnectionPoolMember[], account: AiManagedConnectionSummary) {
  const existing = members.find((member) => member.binding.connectionId === account.id);
  if (existing) return existing.binding.grantId === account.grantId;
  return account.status === "connected";
}

export function moveMember(members: readonly AiConnectionPoolMember[], index: number, offset: number): AiConnectionPoolMember[] {
  const target = index + offset;
  if (target < 0 || target >= members.length) return [...members];
  const next = [...members];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Sets a member's model, or its effort (an empty effort is left out). */
export function withProfile(
  members: readonly AiConnectionPoolMember[],
  memberId: string,
  change: { model?: string; effort?: string },
): AiConnectionPoolMember[] {
  return members.map((member) => {
    if (member.id !== memberId) return member;
    const profile = { ...member.profile };
    if (change.model !== undefined) profile.model = change.model;
    if (change.effort !== undefined) {
      delete profile.effort;
      if (change.effort.trim()) profile.effort = change.effort.trim();
    }
    return { ...member, profile };
  });
}

/** Why the pool can't be saved yet, or null. */
export function poolProblem(config: AiConnectionPoolConfig): string | null {
  if (!config.name.trim()) return "Give the pool a name.";
  if (config.members.length === 0) return "Add at least one connection.";
  if (!Number.isInteger(config.thresholdPercent) || config.thresholdPercent < 1 || config.thresholdPercent > 100) {
    return "The usage threshold is a whole number from 1 to 100.";
  }
  if (config.members.some((member) => !member.profile.model.trim())) return "Every connection needs a model.";
  return null;
}

/** The pool behind a connection, when the viewer can see it. */
export function poolFor(pools: readonly AiConnectionPool[] | undefined, connectionId: string, pluginKey: string) {
  return pools?.find((pool) => pool.id === connectionId && pool.pluginKey === pluginKey) ?? null;
}

/** Agents whose runs use this pool, by name. */
export function agentsUsingPool(agents: readonly Agent[] | undefined, connectionId: string): Agent[] {
  return (agents ?? [])
    .filter((agent) => {
      if (agent.status === "terminated") return false;
      const binding = (agent.runtimeConfig as { aiConnection?: { mode?: string; connectionId?: string } } | null)?.aiConnection;
      return binding?.mode === "router" && binding.connectionId === connectionId;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
