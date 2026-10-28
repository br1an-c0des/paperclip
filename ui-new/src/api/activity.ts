import type { AgentCommentaryDetail, AgentCommentaryKind, AgentCommentaryPage } from "@paperclipai/shared";
import { api, ApiError, errorMessage, readApiJson } from "./client";

/*
 * The Activity pages' requests (src/activity/), as ui/src/api/audit.ts and agentCommentary.ts make
 * them:
 *
 * - The activity log is the audit feed (`GET /companies/:id/audit/agent-actions`). With
 *   `actorScope=all` every company reader gets it: people, agents and Paperclip itself. Readers with
 *   `audit:view_agent_actions` get the "full" tier, with who an agent acted for and the run behind
 *   each entry; others get the "basic" tier with those stripped, and the server refuses the filters
 *   that need them (agent, responsible person, run). Pages are cursor-based, newest first, and each
 *   row comes with short snippets of its task, comment and document, so the log needn't look them up.
 * - The CSV export streams the same feed (`.csv`); it needs the full tier and logs itself as
 *   activity (`audit.exported`).
 * - Commentary is what agents send in while working (`GET /companies/:id/agent-commentary`, `/:id`),
 *   paged by offset.
 */

/** The snippets each log row carries, so it can name its task without another request. */
export type AuditEntitySnippet = {
  case?: { id: string; identifier: string; title: string } | null;
  issue: { id: string; identifier: string | null; title: string | null } | null;
  comment: { id: string; excerpt: string } | null;
  document: { id: string; key: string } | null;
};

export type AuditActorType = "agent" | "user" | "system" | "plugin";

/** One row of the activity log: an `activity_log` row with its snippets. */
export type AuditRecord = {
  id: string;
  companyId: string;
  actorType: AuditActorType | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  agentId: string | null;
  runId: string | null;
  responsibleUserId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  entity: AuditEntitySnippet;
};

export type AuditPage = {
  items: AuditRecord[];
  nextCursor: string | null;
  /** "full" readers see attribution and can filter by agent or person, and export. */
  accessTier: "basic" | "full";
};

/** The log's filters, as the server takes them. All optional. */
export type AuditFilters = {
  /** "all" is everyone's activity; "agents" is agents' actions only (full tier). */
  actorScope?: "all" | "agents";
  actorType?: AuditActorType | null;
  agentId?: string | null;
  responsibleUserId?: string | null;
  runId?: string | null;
  entityType?: string | null;
  /** An exact entity id; for cases, an identifier such as CAS-C1 works too. */
  entityId?: string | null;
  /** An action or a prefix of one, such as `issue.`. */
  action?: string | null;
  /** ISO times. */
  from?: string | null;
  to?: string | null;
};

export function auditQuery(filters: AuditFilters, page: { cursor?: string | null; limit?: number } = {}) {
  const params = new URLSearchParams();
  const entries: [string, string | null | undefined][] = [
    ["actorScope", filters.actorScope ?? "all"],
    ["actorType", filters.actorType],
    ["agentId", filters.agentId],
    ["responsibleUserId", filters.responsibleUserId],
    ["runId", filters.runId],
    ["entityType", filters.entityType],
    ["entityId", filters.entityId],
    ["action", filters.action],
    ["from", filters.from],
    ["to", filters.to],
    ["cursor", page.cursor],
    ["limit", page.limit === undefined ? undefined : String(page.limit)],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  return params.toString();
}

export type CommentaryFilters = { q?: string; agentId?: string; kind?: AgentCommentaryKind; offset?: number; limit?: number };

const company = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`;

export const activityApi = {
  log: (companyId: string, filters: AuditFilters, page: { cursor?: string | null; limit?: number }, signal?: AbortSignal) =>
    api.get<AuditPage>(`${company(companyId)}/audit/agent-actions?${auditQuery(filters, page)}`, { signal }),

  /** The filtered log as a CSV file (full tier only). */
  exportCsv: async (companyId: string, filters: AuditFilters): Promise<Blob> => {
    const response = await fetch(`/api${company(companyId)}/audit/agent-actions.csv?${auditQuery(filters)}`, {
      credentials: "include",
      headers: { Accept: "text/csv" },
    });
    if (!response.ok) {
      const body = await readApiJson<unknown>(response).catch(() => null);
      throw new ApiError(errorMessage(body, response.status), response.status, body);
    }
    return response.blob();
  },

  commentary: (companyId: string, filters: CommentaryFilters, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
    return api.get<AgentCommentaryPage>(`${company(companyId)}/agent-commentary?${params}`, { signal });
  },
  commentaryEntry: (companyId: string, id: string, signal?: AbortSignal) =>
    api.get<AgentCommentaryDetail>(`${company(companyId)}/agent-commentary/${encodeURIComponent(id)}`, { signal }),
};
