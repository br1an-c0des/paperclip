import type { DecisionHistoryPage, DecisionHistoryQuery } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Attention reads beside the feed (`src/api/inbox.ts`), as ui/src/api/attention.ts calls them:
 *
 * - Decision history (`GET /companies/:id/attention/history`): what was decided on tasks, newest
 *   first, a cursor page at a time (at most 100). It covers questions and proposals answered on a
 *   task (interactions and Decisions), not approvals. Filters: words (`search`), `outcome`, agent,
 *   project, `sort`, `since`.
 *
 * `GET …/attention/summary` (counts without the cards) isn't read: its counts include requests on the
 * aging shelf, which Needs you leaves out, so it can't be the nav's count (decision 24).
 */

export function historyParams(query: DecisionHistoryQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

export const attentionApi = {
  history: (companyId: string, query: DecisionHistoryQuery = {}, signal?: AbortSignal) => {
    const params = historyParams(query);
    return api.get<DecisionHistoryPage>(`/companies/${companyId}/attention/history${params ? `?${params}` : ""}`, { signal });
  },
};
