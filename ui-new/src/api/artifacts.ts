import type { CompanyArtifact, CompanyArtifactGroupBy, CompanyArtifactsResponse } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's artifacts, as ui/src/api/artifacts.ts calls them: every task's documents,
 * attachments and `artifact` work products, flattened into one card-ready list
 * (`GET /companies/:companyId/artifacts`).
 *
 * Grouped by task (`groupBy=task`), the response is a page of groups, each with a count and up to
 * three preview artifacts, and no flat list. Asking for one group (`groupIssueId`) returns that
 * task's artifacts in full. Pages hold at most 100 entries (`COMPANY_ARTIFACTS_MAX_LIMIT`).
 */

export const ARTIFACTS_PAGE_SIZE = 100;

export type ArtifactListParams = {
  projectId?: string;
  groupBy?: CompanyArtifactGroupBy;
  groupIssueId?: string;
  limit?: number;
  cursor?: string;
};

function listQuery(params: ArtifactListParams) {
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.groupBy && params.groupBy !== "none") search.set("groupBy", params.groupBy);
  if (params.groupIssueId) search.set("groupIssueId", params.groupIssueId);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const artifactsApi = {
  /** The old UI also accepts a bare array from older servers; so does this. */
  list: async (companyId: string, params: ArtifactListParams = {}, signal?: AbortSignal): Promise<CompanyArtifactsResponse> => {
    const raw = await api.get<CompanyArtifactsResponse | CompanyArtifact[]>(
      `/companies/${encodeURIComponent(companyId)}/artifacts${listQuery(params)}`,
      { signal },
    );
    if (Array.isArray(raw)) return { artifacts: raw, nextCursor: null };
    return { artifacts: raw.artifacts ?? [], groups: raw.groups, selectedGroup: raw.selectedGroup, nextCursor: raw.nextCursor ?? null };
  },
};
