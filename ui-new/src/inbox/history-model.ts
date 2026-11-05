import type { DecisionHistoryItem, DecisionHistoryQuery } from "@paperclipai/shared";
import type { Tone } from "@/ui/Status";

/*
 * The Inbox's History tab (`GET /companies/:id/attention/history`): what was decided on tasks, a
 * page at a time, as the old UI's Coordinator "Decision history" panel lists it. Each row is a
 * receipt that opens its task; it isn't a second answer form. History covers questions and
 * proposals answered on a task (interactions and Decisions); approvals aren't in it.
 *
 * - Filters, as the old panel offers them: outcome, the agent that asked, the project, newest or
 *   oldest first. The Inbox's search box is the history's `search` (titles and task IDs, on the
 *   server).
 * - Newest first is grouped by when it was decided, as Updates groups by activity; oldest first
 *   is one list.
 */

export const HISTORY_PAGE_SIZE = 40;

export type HistoryOutcome = "" | "accepted" | "answered" | "rejected" | "decided" | "cancelled" | "expired";

/** The old panel's outcome choices; `outcome` is what the server filters on. */
export const HISTORY_OUTCOMES: readonly { value: HistoryOutcome; label: string }[] = [
  { value: "", label: "All outcomes" },
  { value: "accepted", label: "Approved" },
  { value: "answered", label: "Answered" },
  { value: "rejected", label: "Changes requested" },
  { value: "decided", label: "Decided" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

export type HistorySort = "newest" | "oldest";

export type HistoryFilters = { search: string; outcome: HistoryOutcome; agentId: string; projectId: string; sort: HistorySort };

export const NO_HISTORY_FILTERS: HistoryFilters = { search: "", outcome: "", agentId: "", projectId: "", sort: "newest" };

/** The request's query for one page. Empty filters are left out; newest is the server's default. */
export function historyQuery(filters: HistoryFilters, cursor?: string): DecisionHistoryQuery {
  const query: DecisionHistoryQuery = { limit: HISTORY_PAGE_SIZE };
  const search = filters.search.trim();
  if (search) query.search = search.slice(0, 200);
  if (filters.outcome) query.outcome = filters.outcome;
  if (filters.agentId) query.agentId = filters.agentId;
  if (filters.projectId) query.projectId = filters.projectId;
  if (filters.sort === "oldest") query.sort = "oldest";
  if (cursor) query.cursor = cursor;
  return query;
}

/** The filters as a query key part: only what's set, so equal filters share a cache entry. */
export function historyKey(filters: HistoryFilters): Record<string, string> {
  const { limit: _limit, ...rest } = historyQuery(filters);
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, String(value)]));
}

export function filtersActive(filters: HistoryFilters) {
  return !!(filters.search.trim() || filters.outcome || filters.agentId || filters.projectId);
}

/**
 * The pill an outcome wears: approved green, changes requested amber, answered or decided blue;
 * cancelled, expired and superseded stay plain. Decisions carry their status (`decided`…) and the
 * chosen option's label; item reviews a mixed verdict label.
 */
export function outcomeTone(item: Pick<DecisionHistoryItem, "outcome" | "label">): Tone | null {
  switch (item.outcome) {
    case "accepted":
      return "green";
    case "rejected":
      return "amber";
    case "answered":
    case "decided":
      return "run";
    default:
      return null;
  }
}

/** Pages put together, in order, with any row a later page repeats dropped. */
export function historyItems(pages: readonly { items: readonly DecisionHistoryItem[] }[] | undefined): DecisionHistoryItem[] {
  const seen = new Set<string>();
  const items: DecisionHistoryItem[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

/** "Jane Doe" or "an agent": who decided, from the people the board knows. */
export function decidedBy(
  item: Pick<DecisionHistoryItem, "resolvedByUserId" | "resolvedByAgentId">,
  names: { youId: string | null; person: (id: string) => string; agent: (id: string) => string | undefined },
): string | null {
  if (item.resolvedByUserId) return item.resolvedByUserId === names.youId ? "You" : names.person(item.resolvedByUserId);
  if (item.resolvedByAgentId) return names.agent(item.resolvedByAgentId) ?? "An agent";
  return null;
}
