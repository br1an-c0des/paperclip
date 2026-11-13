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

/*
 * Your own order for starred agents (since the 2026-11-13 sync, upstream #20830): starred agents are
 * ui-new's chat pins (U66), and they lead the nav's agents in an order you can drag. As in the old
 * UI, the order is kept per person in this browser; the server's stars have no order of their own
 * beyond newest first. Agents starred since you last arranged them lead, newest first; the rest
 * follow in your order.
 */

/** Starred ids in your order: ones you haven't arranged first (in star order), then your order. */
export function inPinOrder(starredIds: readonly string[], saved: readonly string[]): string[] {
  const starred = new Set(starredIds);
  const arranged = new Set(saved.filter((id) => starred.has(id)));
  return [...starredIds.filter((id) => !arranged.has(id)), ...arranged];
}

/** A saved order read back from storage: unique strings, anything else dropped. */
export function parsePinOrder(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))] : [];
  } catch {
    return [];
  }
}

/** Where your order is kept: per person and company, in this browser. */
export function pinOrderKey(userId: string, companyId: string) {
  return `paperclip.ui-new.agent-pin-order.v1:${encodeURIComponent(userId)}:${companyId}`;
}
