import type {
  Agent,
  GenerateSummarySlotResponse,
  GetSummarySlotResponse,
  ListSummarySlotRevisionsResponse,
  SummarySlotKey,
  SummarySlotScopeKind,
} from "@paperclipai/shared";
import { api } from "@/api/client";

/*
 * AI summaries ("summary slots", `enableSummaries`), as ui/src/api/summarySlots.ts uses them: a
 * Markdown document per scope (a project, an execution workspace, the Workspaces overview) that the
 * built-in Summarizer agent writes in a task of its own. Reading needs the flag (the routes answer
 * 404 without it); Generate starts that task and spends tokens.
 *
 * Kept inside src/projects/ on purpose: the Status page (src/status-cards/) has its own summary
 * pieces, and the two aren't shared.
 *
 * Whether the Summarizer is set up comes from the built-in agents list
 * (`GET /companies/:id/built-in-agents`, `enableBuiltInAgents`). Only the fields read here are
 * declared; the type lives in the old UI (ui/src/api/builtInAgents.ts).
 */

export type SummarySlotSelector = {
  companyId: string;
  scopeKind: SummarySlotScopeKind;
  scopeId?: string | null;
  slotKey: SummarySlotKey;
};

/** One built-in agent's state, for the Summarizer's setup note. */
export type BuiltInAgentSummary = {
  definition: { key: string; displayName: string };
  status: "not_provisioned" | "pending_approval" | "needs_setup" | "ready" | "paused";
  agentId: string | null;
  agent: Pick<Agent, "id" | "name" | "urlKey"> | null;
};

function slotPath(selector: SummarySlotSelector, suffix = "") {
  const query = selector.scopeId ? `?${new URLSearchParams({ scopeId: selector.scopeId })}` : "";
  return `/companies/${encodeURIComponent(selector.companyId)}/summary-slots/${selector.scopeKind}/${selector.slotKey}${suffix}${query}`;
}

export const summaryApi = {
  get: (selector: SummarySlotSelector, signal?: AbortSignal) => api.get<GetSummarySlotResponse>(slotPath(selector), { signal }),
  revisions: (selector: SummarySlotSelector, signal?: AbortSignal) =>
    api.get<ListSummarySlotRevisionsResponse>(slotPath(selector, "/revisions"), { signal }),
  /** Starts the Summarizer on a new summary; answers at once with the task it works in. */
  generate: (selector: SummarySlotSelector) =>
    api.post<GenerateSummarySlotResponse>(slotPath(selector, "/generate"), { scopeId: selector.scopeId ?? null }),
  builtInAgents: (companyId: string, signal?: AbortSignal) =>
    api.get<BuiltInAgentSummary[]>(`/companies/${encodeURIComponent(companyId)}/built-in-agents`, { signal }),
};
