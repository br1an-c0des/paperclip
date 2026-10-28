import type { ResourceMemberships } from "@paperclipai/shared";

/*
 * Starring agents into your nav (ui/src/hooks/useResourceMemberships.ts): your stars live in your
 * memberships (`GET /companies/:id/resource-memberships/me`, `starredAgentIds`, newest first) and
 * change with `PUT …/resource-memberships/me/agents/:agentId { starred }`. The server's rules,
 * applied to the cached memberships so the star turns at once:
 *
 * - starring also joins the agent, and puts it first;
 * - unstarring leaves joined or left alone;
 * - leaving an agent clears its star.
 */

export function isAgentStarred(memberships: ResourceMemberships | undefined, agentId: string) {
  return memberships?.starredAgentIds?.includes(agentId) ?? false;
}

export function emptyMemberships(): ResourceMemberships {
  return {
    projectMemberships: {},
    agentMemberships: {},
    starredProjectIds: [],
    starredAgentIds: [],
    starredDocumentIds: [],
    projectStarredAt: {},
    agentStarredAt: {},
    documentStarredAt: {},
    updatedAt: null,
  };
}

export function applyAgentMembership(
  current: ResourceMemberships | undefined,
  agentId: string,
  change: { state?: "joined" | "left"; starred?: boolean },
  now = new Date(),
): ResourceMemberships {
  const base = current ?? emptyMemberships();
  const states = base.agentMemberships ?? {};
  const previous = states[agentId] === "left" ? "left" : "joined";
  const state = change.starred === true ? "joined" : (change.state ?? previous);
  const ids = base.starredAgentIds ?? [];
  const was = ids.includes(agentId);
  const starred = state === "left" ? false : (change.starred ?? was);
  const at = { ...(base.agentStarredAt ?? {}) };
  let next = ids;
  if (starred && !was) {
    next = [agentId, ...ids];
    at[agentId] = now;
  } else if (!starred && was) {
    next = ids.filter((id) => id !== agentId);
    delete at[agentId];
  }
  return { ...base, agentMemberships: { ...states, [agentId]: state }, starredAgentIds: next, agentStarredAt: at, updatedAt: now };
}

/** Your starred agents in star order (newest first), skipping ones that are gone or retired. */
export function starredAgents<T extends { id: string; status: string }>(memberships: ResourceMemberships | undefined, agents: readonly T[] | undefined): T[] {
  const byId = new Map((agents ?? []).map((agent) => [agent.id, agent]));
  return (memberships?.starredAgentIds ?? []).flatMap((id) => {
    const agent = byId.get(id);
    return agent && agent.status !== "terminated" ? [agent] : [];
  });
}
