import type { Approval, ApprovalComment, Issue } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Approvals, as ui/src/api/approvals.ts and ui/src/api/issues.ts call them: the ones linked to a
 * task, deciding one, and its own discussion thread; for the approval page (src/approvals/), one by
 * id with its linked tasks, the company's list, resubmitting after Request changes, and removing a
 * rejected hire's agent (`DELETE /agents/:id`, which the old approval page offers).
 */

export const approvalsApi = {
  forIssue: (issueId: string, signal?: AbortSignal) => api.get<Approval[]>(`/issues/${issueId}/approvals`, { signal }),
  get: (id: string, signal?: AbortSignal) => api.get<Approval>(`/approvals/${encodeURIComponent(id)}`, { signal }),
  issues: (id: string, signal?: AbortSignal) => api.get<Issue[]>(`/approvals/${encodeURIComponent(id)}/issues`, { signal }),
  list: (companyId: string, status?: string, signal?: AbortSignal) =>
    api.get<Approval[]>(`/companies/${companyId}/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`, { signal }),
  approve: (id: string, decisionNote?: string) => api.post<Approval>(`/approvals/${id}/approve`, { decisionNote }),
  reject: (id: string, decisionNote?: string) => api.post<Approval>(`/approvals/${id}/reject`, { decisionNote }),
  requestRevision: (id: string, decisionNote?: string) => api.post<Approval>(`/approvals/${id}/request-revision`, { decisionNote }),
  /** Marks a request that was sent back as resubmitted; the payload stays as it is unless one is given. */
  resubmit: (id: string, payload?: Record<string, unknown>) => api.post<Approval>(`/approvals/${id}/resubmit`, { payload }),
  comments: (id: string, signal?: AbortSignal) => api.get<ApprovalComment[]>(`/approvals/${id}/comments`, { signal }),
  addComment: (id: string, body: string) => api.post<ApprovalComment>(`/approvals/${id}/comments`, { body }),
  /** Deletes the agent a rejected hire created (it waits in `pending_approval` until then). */
  removeAgent: (agentId: string) => api.delete<{ ok: true }>(`/agents/${encodeURIComponent(agentId)}`),
};
