import type {
  AttentionClaimResult,
  AttentionCloseInput,
  AttentionCloseResult,
  AttentionFeed,
  AttentionSourceKind,
  AttentionTransferInput,
  AttentionTransferResult,
  DecisionHistoryPage,
  DecisionHistoryQuery,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Attention reads and routing beside the feed (`src/api/inbox.ts`), as ui/src/api/attention.ts calls
 * them:
 *
 * - Decision history (`GET /companies/:id/attention/history`): what was decided, newest first, a
 *   cursor page at a time (at most 100). It covers questions and proposals answered on a task
 *   (interactions and Decisions) and, since upstream #20959, approvals (`issueId` can be null).
 *   Filters: words (`search`), `outcome`, agent, project, `sort`, `since`, whose (`scope`: `mine` is
 *   handled by you or for you, `all` everyone's) and `handledForMe`.
 * - For you's receipts (`GET …/attention?view=mine&limit=1`): what someone else did with a request
 *   that was yours. Only the `mine` view carries them; one card is enough, since the Inbox reads the
 *   cards from its own feed. The same read returns the server's `viewCounts` and `deskBadgeCount`.
 * - Routing (#20959), one card by its source: claim an ownerless one (`…/claim`), route it to
 *   another person (`…/transfer`, `{ userId, reason? }`), and the Close… menu (`…/close`):
 *   `withdraw` for everyone, or `archive` / `snooze` for you. The Inbox hides cards for you through
 *   the inbox dismissals (`src/api/inbox.ts`) with the card's `changeFingerprint`, which is what
 *   `archive` and `snooze` do here; it uses `close` to withdraw.
 *
 * `GET …/attention/summary` (counts without the cards) isn't read: its counts include requests on the
 * aging shelf, which Needs you leaves out, so it can't be the nav's count (decision 24).
 */

export function historyParams(query: DecisionHistoryQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

function cardPath(companyId: string, sourceKind: AttentionSourceKind, sourceId: string, action: "claim" | "transfer" | "close") {
  return `/companies/${companyId}/attention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}/${action}`;
}

export const attentionApi = {
  history: (companyId: string, query: DecisionHistoryQuery = {}, signal?: AbortSignal) => {
    const params = historyParams(query);
    return api.get<DecisionHistoryPage>(`/companies/${companyId}/attention/history${params ? `?${params}` : ""}`, { signal });
  },
  /** For you's receipts and the view counts; its one card isn't used. */
  receipts: (companyId: string, signal?: AbortSignal) => api.get<AttentionFeed>(`/companies/${companyId}/attention?view=mine&limit=1`, { signal }),
  claim: (companyId: string, sourceKind: AttentionSourceKind, sourceId: string) =>
    api.post<AttentionClaimResult>(cardPath(companyId, sourceKind, sourceId, "claim"), {}),
  transfer: (companyId: string, sourceKind: AttentionSourceKind, sourceId: string, input: AttentionTransferInput) =>
    api.post<AttentionTransferResult>(cardPath(companyId, sourceKind, sourceId, "transfer"), input),
  close: (companyId: string, sourceKind: AttentionSourceKind, sourceId: string, input: AttentionCloseInput) =>
    api.post<AttentionCloseResult>(cardPath(companyId, sourceKind, sourceId, "close"), input),
};
