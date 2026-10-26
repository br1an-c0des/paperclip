import type { Issue, IssueAttachment, IssueLabel } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Tasks (issues), as ui/src/api/issues.ts uses them. M1 needs creating a task, its attachments,
 * labels, and a small search for the palette and the new-task pickers; the list views port in M2.
 */

export type IssueSearch = { q?: string; limit?: number; status?: string };

function searchParams(filters: IssueSearch) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

export const issuesApi = {
  search: (companyId: string, filters: IssueSearch, signal?: AbortSignal) => {
    const qs = searchParams(filters);
    return api.get<Issue[]>(`/companies/${companyId}/issues${qs ? `?${qs}` : ""}`, { signal });
  },
  create: (companyId: string, data: Record<string, unknown>) => api.post<Issue>(`/companies/${companyId}/issues`, data),
  uploadAttachment: (companyId: string, issueId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<IssueAttachment>(`/companies/${companyId}/issues/${issueId}/attachments`, form);
  },
  listLabels: (companyId: string) => api.get<IssueLabel[]>(`/companies/${companyId}/labels`),
};

/** The URL path of a task, under the company prefix. */
export function issuePath(prefix: string, issue: Pick<Issue, "id" | "identifier">) {
  return `/${prefix}/issues/${issue.identifier ?? issue.id}`;
}
