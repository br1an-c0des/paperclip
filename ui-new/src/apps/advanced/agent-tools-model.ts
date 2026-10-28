import type { ConnectionGrant, ToolCatalogEntry, ToolConnection, ToolPolicy, ToolProfileEffectiveSummary, ToolProfileWithDetails } from "@paperclipai/shared";
import { connectionGroup, connectionState, displayName, installState, type ConnectionState } from "../apps-model";
import { isAppProfile } from "./profile-model";

/*
 * View model for an agent's Tools section (src/agents/settings/ToolsSection.tsx, the old UI's
 * AgentToolsTab): which tools its runs get, which apps it carries on every run, the profiles and
 * policies behind that, and its GitHub identity.
 */

export type AgentAppRow = {
  connection: ToolConnection;
  name: string;
  state: ConnectionState;
  /** Its tools are loaded into every run. */
  installed: boolean;
  /** Installed for every agent from the app's page; it can't be removed for one agent. */
  installedForAll: boolean;
  /** A profile lets the agent use it (installed or not). */
  permitted: boolean;
};

/**
 * The company's tool connections as this agent sees them, installed ones first. AI accounts and
 * chat channels have their own sections; archived connections are gone.
 */
export function agentAppRows(connections: readonly ToolConnection[], effective: ToolProfileEffectiveSummary | undefined, agentId: string): AgentAppRow[] {
  const permitted = new Set<string>([
    ...(effective?.entries ?? []).filter((entry) => entry.effect === "include" && entry.connectionId).map((entry) => entry.connectionId!),
    ...(effective?.allowedTools ?? []).map((tool) => tool.connectionId),
  ]);
  return connections
    .filter((connection) => connection.status !== "archived" && connectionGroup(connection) === "tools")
    .map((connection) => {
      const install = installState(connection.installs);
      const installed = install.onAll || install.agentIds.has(agentId);
      return {
        connection,
        name: displayName(connection.name),
        state: connectionState(connection),
        installed,
        installedForAll: install.onAll,
        permitted: permitted.has(connection.id),
      };
    })
    .sort((a, b) => Number(b.installed) - Number(a.installed) || Number(b.permitted) - Number(a.permitted) || a.name.localeCompare(b.name));
}

function selectorList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return [];
}

/**
 * A policy applies to the agent when it names the agent, or names no agent and doesn't limit itself
 * to other kinds of caller, as the tool gateway reads its selectors.
 */
export function policyGovernsAgent(policy: Pick<ToolPolicy, "selectors">, agentId: string) {
  const selectors = (policy.selectors ?? {}) as Record<string, unknown>;
  const agentIds = [...selectorList(selectors.agentId), ...selectorList(selectors.agentIds)];
  if (agentIds.length > 0) return agentIds.includes(agentId);
  const actorTypes = [...selectorList(selectors.actorType), ...selectorList(selectors.actorTypes)];
  return actorTypes.length === 0 || actorTypes.includes("agent");
}

export const POLICY_EFFECT: Record<string, string> = {
  allow: "Allow",
  block: "Block",
  deny: "Block",
  require_approval: "Ask first",
  redact: "Redact",
  rate_limit: "Rate limit",
};

export type AgentPolicyRow = { policy: ToolPolicy; order: number; effect: string; connectionId: string | null };

/** The enabled policies that apply to the agent, in the order the gateway checks them. */
export function agentPolicies(policies: readonly ToolPolicy[], agentId: string): AgentPolicyRow[] {
  return policies
    .map((policy, index) => ({ policy, order: index + 1 }))
    .filter(({ policy }) => policy.enabled && policyGovernsAgent(policy, agentId))
    .map(({ policy, order }) => {
      const config = (policy.config ?? {}) as { connectionId?: unknown };
      const selectors = (policy.selectors ?? {}) as { connectionId?: unknown };
      const connectionId = typeof config.connectionId === "string" ? config.connectionId : typeof selectors.connectionId === "string" ? selectors.connectionId : null;
      return { policy, order, effect: POLICY_EFFECT[policy.policyType] ?? policy.policyType, connectionId };
    });
}

/** Active tools in the catalog the agent could name but would be blocked from. */
export function unavailableTools(catalog: readonly ToolCatalogEntry[], allowed: readonly ToolCatalogEntry[]) {
  const allowedIds = new Set(allowed.map((tool) => tool.id));
  const seen = new Set<string>();
  const out: ToolCatalogEntry[] = [];
  for (const tool of catalog) {
    if (tool.status !== "active" || allowedIds.has(tool.id) || seen.has(tool.id)) continue;
    seen.add(tool.id);
    out.push(tool);
  }
  return out.sort((a, b) => a.toolName.localeCompare(b.toolName));
}

/** Profiles that can be assigned to the agent: active, not an app's own, not already applying. */
export function assignableProfiles(profiles: readonly ToolProfileWithDetails[], applying: readonly Pick<ToolProfileWithDetails, "id">[]) {
  const have = new Set(applying.map((profile) => profile.id));
  return profiles
    .filter((profile) => profile.status === "active" && !isAppProfile(profile) && !have.has(profile.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether the agent has this profile itself (rather than through the organization default or an app). */
export function boundToAgent(profile: Pick<ToolProfileWithDetails, "bindings">, agentId: string) {
  return profile.bindings.some((binding) => binding.targetType === "agent" && binding.targetId === agentId);
}

// ---------------------------------------------------------------------------------------------
// GitHub identity

export function isGitHub(connection: ToolConnection) {
  return (connection.config?.sourceTemplateKey ?? connection.transportConfig?.sourceTemplateKey) === "github";
}

/** GitHub connections the agent carries on its runs, whose identities apply to it. */
export function agentGitHubConnections(connections: readonly ToolConnection[], agentId: string) {
  return connections.filter((connection) => {
    if (!isGitHub(connection) || !connection.enabled || connection.status !== "active") return false;
    const install = installState(connection.installs);
    return install.onAll || install.agentIds.has(agentId);
  });
}

export type GitHubIdentity = { connection: ToolConnection; grant: ConnectionGrant };

/**
 * The agent's own GitHub account when it has one (which wins), and yours, among the grants of its
 * GitHub connections.
 */
export function gitHubIdentities(sets: readonly { connection: ToolConnection; grants: readonly ConnectionGrant[]; currentUserId?: string | null }[], agentId: string) {
  let dedicated: GitHubIdentity | null = null;
  let personal: GitHubIdentity | null = null;
  for (const set of sets) {
    for (const grant of set.grants) {
      if (grant.status !== "active") continue;
      if (!dedicated && grant.kind === "agent" && grant.subjectAgentId === agentId) dedicated = { connection: set.connection, grant };
      if (!personal && grant.kind === "user" && set.currentUserId && grant.subjectUserId === set.currentUserId) personal = { connection: set.connection, grant };
    }
  }
  return { dedicated, personal };
}

export function gitHubLogin(identity: GitHubIdentity | null) {
  const tenant = identity?.grant.providerTenant as { github?: { login?: unknown } } | null | undefined;
  const login = tenant?.github?.login;
  return typeof login === "string" && login ? login : null;
}
