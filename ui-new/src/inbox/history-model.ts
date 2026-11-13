import type { DecisionHistoryItem, DecisionHistoryQuery } from "@paperclipai/shared";
import type { Tone } from "@/ui/Status";

/*
 * The Inbox's History tab (`GET /companies/:id/attention/history`): what was decided, a page at a
 * time, as the old UI's "Decision history" panel lists it. Each row is a receipt that opens its
 * task; it isn't a second answer form. History covers questions and proposals answered on a task
 * (interactions and Decisions) and, since upstream #20959, approvals, which may have no task.
 *
 * - Filters, as the old panel offers them: whose (`scope`: by or for you, the default, or
 *   everyone's), outcome (with "Handled for me", `handledForMe`), the agent that asked, the
 *   project, newest or oldest first. The Inbox's search box is the history's `search` (titles and
 *   task IDs, on the server).
 * - A row says what the person did in the receipt's words ("Approved by Sam"), and for whom when
 *   someone else handled it ("for Riley").
 * - Newest first is grouped by when it was decided, as Updates groups by activity; oldest first
 *   is one list.
 */

export const HISTORY_PAGE_SIZE = 40;

export type HistoryOutcome = "" | "accepted" | "answered" | "rejected" | "decided" | "withdrawn" | "expired" | "issue_closed" | "cancelled" | "handled_for_me";

/**
 * The outcome choices (the server's `DECISION_HISTORY_OUTCOME_FILTERS`, upstream #20959), and
 * "Handled for me", which isn't an outcome but who the card was for: it's sent as `handledForMe`.
 */
export const HISTORY_OUTCOMES: readonly { value: HistoryOutcome; label: string }[] = [
  { value: "", label: "All outcomes" },
  { value: "handled_for_me", label: "Handled for me" },
  { value: "accepted", label: "Approved" },
  { value: "answered", label: "Answered" },
  { value: "rejected", label: "Changes requested" },
  { value: "decided", label: "Decided" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "expired", label: "Expired" },
  { value: "issue_closed", label: "Closed with its task" },
  { value: "cancelled", label: "Cancelled" },
];

export type HistorySort = "newest" | "oldest";

/** Whose history (#20959): handled by you or for you (the default, as upstream's), or everyone's. */
export type HistoryScope = "mine" | "all";

export const HISTORY_SCOPES: readonly { value: HistoryScope; label: string }[] = [
  { value: "mine", label: "By or for me" },
  { value: "all", label: "Everyone's" },
];

export type HistoryFilters = { search: string; outcome: HistoryOutcome; agentId: string; projectId: string; sort: HistorySort; scope: HistoryScope };

export const NO_HISTORY_FILTERS: HistoryFilters = { search: "", outcome: "", agentId: "", projectId: "", sort: "newest", scope: "mine" };

/** The request's query for one page. Empty filters are left out; newest and everyone's are the server's defaults. */
export function historyQuery(filters: HistoryFilters, cursor?: string): DecisionHistoryQuery {
  const query: DecisionHistoryQuery = { limit: HISTORY_PAGE_SIZE };
  if (filters.scope === "mine") query.scope = "mine";
  const search = filters.search.trim();
  if (search) query.search = search.slice(0, 200);
  if (filters.outcome === "handled_for_me") query.handledForMe = true;
  else if (filters.outcome) query.outcome = filters.outcome;
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
    case "approved":
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

/**
 * A row's "who did what" line (#20959): "Approved by Sam for Riley", "Withdrawn by you",
 * "Decided by an agent". Rows without a recorded action fall back to who resolved it. Null when
 * nobody acted (it expired, closed with its task).
 */
export function actionLine(
  item: Pick<DecisionHistoryItem, "action" | "resolvedByUserId" | "resolvedByAgentId" | "handledForUserId">,
  names: { youId: string | null; person: (id: string) => string; agent: (id: string) => string | undefined },
  verb: (outcome: NonNullable<DecisionHistoryItem["action"]>["outcome"]) => string,
): string | null {
  const by = decidedBy(item, names);
  if (!by) return null;
  const who = by === "You" ? "you" : by;
  const head = item.action ? `${verb(item.action.outcome)} by ${who}` : `Decided by ${who}`;
  const forId = item.handledForUserId;
  if (!forId || forId === item.resolvedByUserId) return head;
  return `${head} for ${forId === names.youId ? "you" : names.person(forId)}`;
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
