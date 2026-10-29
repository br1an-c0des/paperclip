import type {
  CompanySearchIssueSummary,
  CompanySearchQuery,
  CompanySearchResponse,
  CreateStatusCard,
  Issue,
  PatchStatusCard,
  StatusCard,
  StatusCardSummaryRevision,
  StatusCardUpdate,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Status cards (decision 39, D3; ui/src/api/statusCards.ts), behind `enableStatusCards`: the server
 * answers 404 while it's off. A card is a standing question in plain words; an agent compiles it
 * into search queries and keeps a summary of the matching tasks current. The client covers the
 * cards and their archive, the updates ledger, the summary document's revisions, a manual update,
 * a rebuild of the query, and a dry run of the query's current matches.
 */

/** The dry run: each compiled query with what it matches now, and the tasks the summary mentions. */
export interface StatusCardDryRun {
  cardId: string;
  queryVersion: number;
  queries: Array<{ query: CompanySearchQuery; result: CompanySearchResponse }>;
  /** Tasks the latest summary references, which join the watched set. */
  mentionedIssues: CompanySearchIssueSummary[];
}

/**
 * What a rebuild or an update answers: the card, the hidden task that runs it, and whether one was
 * already under way. (The old UI types these as a bare card.) An update that has nothing to do
 * isn't `enqueued`.
 */
export interface StatusCardRunResult {
  card: StatusCard;
  generatingIssue: Issue | null;
  alreadyGenerating: boolean;
  enqueued?: boolean;
}

export const statusCardsApi = {
  list: (companyId: string, archived: boolean, signal?: AbortSignal) =>
    api.get<StatusCard[]>(`/companies/${companyId}/status-cards?archived=${archived ? "true" : "false"}`, { signal }),
  get: (id: string, signal?: AbortSignal) => api.get<StatusCard>(`/status-cards/${id}`, { signal }),
  /**
   * Creating a card queues its setup (the query compile) at once, which wakes the card's agent. Without
   * a per-card agent the company's built-in Summarizer runs it; when that isn't set up the server
   * answers 422 `summarizer_not_configured` and keeps no card.
   */
  create: (companyId: string, body: CreateStatusCard) => api.post<StatusCard>(`/companies/${companyId}/status-cards`, body),
  /** Settings, `archived: true | false`; a new `interestPrompt` rebuilds the query, restoring queues an update. */
  patch: (id: string, body: PatchStatusCard) => api.patch<StatusCard>(`/status-cards/${id}`, body),
  remove: (id: string) => api.delete<void>(`/status-cards/${id}`),
  /** The updates ledger, newest first: compiles, full rebuilds and incremental updates, with cost. */
  updates: (id: string, signal?: AbortSignal) => api.get<StatusCardUpdate[]>(`/status-cards/${id}/updates`, { signal }),
  /** The summary document's revisions, newest first. */
  summaryRevisions: (id: string, signal?: AbortSignal) =>
    api.get<StatusCardSummaryRevision[]>(`/status-cards/${id}/summary-revisions`, { signal }),
  /** Queue an update now; `full` rewrites the summary from scratch instead of folding in the changes. */
  refresh: (id: string, full = false) => api.post<StatusCardRunResult>(`/status-cards/${id}/refresh`, { full }),
  /** Rebuild the query from the card's prompt (also the way to restart a setup that stalled). */
  recompile: (id: string) => api.post<StatusCardRunResult>(`/status-cards/${id}/recompile`, {}),
  /** Run the compiled queries now and return their matches; no agent runs. */
  dryRun: (id: string, signal?: AbortSignal) => api.get<StatusCardDryRun>(`/status-cards/${id}/dry-run`, { signal }),
};
