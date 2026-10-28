import type { AgentCommentaryKind } from "@paperclipai/shared";
import type { AuditActorType, AuditFilters, CommentaryFilters } from "@/api/activity";

/*
 * The Activity page's view model, apart from the components so it can be tested: the log's filters
 * as the address keeps them, the requests they make, the commentary's filters, and where the old
 * UI's activity, audit and costs addresses land.
 *
 * The log's filters live in the address so links can open it filtered, as the old UI's do:
 * `?entityType=case&entityId=CAS-C1` (a case's history), `?mode=agents&agentId=…` (an agent's
 * actions), `?runId=…` (one run's), `?action=issue.` (one kind of action).
 */

export const LOG_PAGE_SIZE = 50;

/** Kinds of action, by prefix (the server matches the start of the action). */
export const ACTION_DOMAINS: readonly { value: string; label: string }[] = [
  { value: "issue.", label: "Tasks" },
  { value: "case.", label: "Cases" },
  { value: "agent.", label: "Agents" },
  { value: "heartbeat.", label: "Runs" },
  { value: "approval.", label: "Approvals" },
  { value: "project.", label: "Projects" },
  { value: "goal.", label: "Goals" },
  { value: "routine.", label: "Recurring tasks" },
  { value: "company.skill", label: "Skills" },
  { value: "tool_", label: "Apps and tools" },
  { value: "cost.", label: "Costs" },
  { value: "budget.", label: "Budgets" },
  { value: "company.", label: "Organization" },
];

/** Kinds of thing an entry is about (the server matches exactly). */
export const ENTITY_TYPES: readonly { value: string; label: string; cases?: true }[] = [
  { value: "issue", label: "Task" },
  { value: "case", label: "Case", cases: true },
  { value: "agent", label: "Agent" },
  { value: "heartbeat_run", label: "Run" },
  { value: "routine", label: "Recurring task" },
  { value: "project", label: "Project" },
  { value: "goal", label: "Goal" },
  { value: "company_skill", label: "Skill" },
  { value: "company", label: "Organization" },
  { value: "tool_connection", label: "Connection" },
];

/** Who acted, by kind. A specific agent is its id. */
export const ACTOR_KINDS: readonly { value: string; label: string; type: AuditActorType }[] = [
  { value: "people", label: "People", type: "user" },
  { value: "agents", label: "Agents", type: "agent" },
  { value: "paperclip", label: "Paperclip", type: "system" },
  { value: "plugins", label: "Plugins", type: "plugin" },
];

/** The log's part of the address. Every value is optional; absent means "all". */
export type LogSearch = {
  /** "people", "agents", "paperclip", "plugins", or an agent's id. */
  actor?: string;
  /** The old UI's agent link (`agentAuditHref`); same as `actor=<id>`. */
  agentId?: string;
  /** "agents": agents' actions only, with attribution (the old Agent Actions view). */
  mode?: string;
  runId?: string;
  /** A person an agent acted for. */
  for?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  /** Days, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  /** "1" shows reads and housekeeping too. */
  all?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The start of a local day, as an ISO time, or undefined for anything that isn't a day. */
export function dayStart(day: string | undefined) {
  if (!day || !DAY.test(day)) return undefined;
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The end of a local day, as an ISO time. */
export function dayEnd(day: string | undefined) {
  if (!day || !DAY.test(day)) return undefined;
  const date = new Date(`${day}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function actorKind(search: LogSearch) {
  return ACTOR_KINDS.find((kind) => kind.value === search.actor);
}

/** The agent the log is narrowed to, if any. */
export function actorAgentId(search: LogSearch) {
  if (search.actor && !actorKind(search)) return search.actor;
  return search.agentId || undefined;
}

/** The requests' filters for what the address says. */
export function logFilters(search: LogSearch): AuditFilters {
  const kind = actorKind(search);
  const entityType = search.entityType || undefined;
  return {
    actorScope: search.mode === "agents" ? "agents" : "all",
    actorType: kind?.type,
    agentId: actorAgentId(search),
    runId: search.runId || undefined,
    responsibleUserId: search.for || undefined,
    entityType,
    entityId: entityType && search.entityId?.trim() ? search.entityId.trim() : undefined,
    action: search.action || undefined,
    from: dayStart(search.from),
    to: dayEnd(search.to),
  };
}

/** A stable cache key for a set of filters. */
export function filtersKey(filters: AuditFilters) {
  return JSON.stringify(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

/** Filters that need the full tier: the server refuses them for basic readers. */
export function needsFullTier(filters: AuditFilters) {
  return filters.actorScope === "agents" || Boolean(filters.agentId || filters.responsibleUserId || filters.runId);
}

const FILTER_KEYS = ["actor", "agentId", "mode", "runId", "for", "entityType", "entityId", "action", "from", "to"] as const;

export function hasFilters(search: LogSearch) {
  return FILTER_KEYS.some((key) => Boolean(search[key]));
}

/** The address with every filter cleared, keeping `all`. */
export function clearedSearch(): Record<(typeof FILTER_KEYS)[number], undefined> {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined])) as Record<(typeof FILTER_KEYS)[number], undefined>;
}

/** The label for a value of one of the menus, or the fallback. */
export function labelOf(list: readonly { value: string; label: string }[], value: string | undefined, fallback: string) {
  return list.find((entry) => entry.value === value)?.label ?? fallback;
}

// ---------------------------------------------------------------------------------------------
// Commentary

export const COMMENTARY_PAGE_SIZE = 50;

export type CommentarySearch = { q?: string; agentId?: string; kind?: string; offset?: string; entry?: string };

export function commentaryFilters(search: CommentarySearch): CommentaryFilters {
  const offset = Math.min(100_000, Math.max(0, Math.floor(Number(search.offset) || 0)));
  const kind: AgentCommentaryKind | undefined = search.kind === "suggestion" || search.kind === "complaint" ? search.kind : undefined;
  return { q: search.q?.trim() || undefined, agentId: search.agentId || undefined, kind, offset, limit: COMMENTARY_PAGE_SIZE };
}

/** "1–50 of 120". */
export function pageRange(offset: number, shown: number, total: number) {
  if (shown === 0) return `0 of ${total}`;
  return `${offset + 1}–${offset + shown} of ${total}`;
}

// ---------------------------------------------------------------------------------------------
// Where old addresses land

/**
 * The old UI's activity, audit, runs and costs addresses (under the company), mapped to this page's.
 * `rest` is the path after the company prefix without its leading slash, `search` the query string.
 * Returns null when the address is already one of this page's own.
 */
export function legacyActivityHref(rest: string, search: string): string | null {
  const query = search.startsWith("?") || search === "" ? search : `?${search}`;
  const path = rest.replace(/\/+$/, "");
  const withQuery = (to: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams(query);
    for (const [key, value] of Object.entries(extra ?? {})) if (!params.has(key)) params.set(key, value);
    const text = params.toString();
    return `${to}${text ? `?${text}` : ""}`;
  };
  switch (path) {
    case "audit":
    case "audit/activity":
      return withQuery("activity", { mode: "agents" });
    case "runs":
    case "audit/runs":
      return withQuery("activity/runs");
    case "costs":
    case "audit/costs":
      return withQuery("activity/costs");
    case "budgets":
    case "audit/budgets":
    case "activity/budgets":
      return `${withQuery("activity/costs")}#budgets`;
    case "timeline":
    case "audit/timeline":
    case "activity/timeline":
      // The work timeline isn't ported: Workload (board 33) draws the company's runs over time.
      return "workload";
    default:
      return null;
  }
}
