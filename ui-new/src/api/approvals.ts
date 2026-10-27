import type { Approval, ApprovalComment } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Approvals, as ui/src/api/approvals.ts and ui/src/api/issues.ts call them: the ones linked to a
 * task, deciding one, and its own discussion thread.
 */

export const approvalsApi = {
  forIssue: (issueId: string, signal?: AbortSignal) => api.get<Approval[]>(`/issues/${issueId}/approvals`, { signal }),
  approve: (id: string, decisionNote?: string) => api.post<Approval>(`/approvals/${id}/approve`, { decisionNote }),
  reject: (id: string, decisionNote?: string) => api.post<Approval>(`/approvals/${id}/reject`, { decisionNote }),
  requestRevision: (id: string, decisionNote?: string) => api.post<Approval>(`/approvals/${id}/request-revision`, { decisionNote }),
  comments: (id: string, signal?: AbortSignal) => api.get<ApprovalComment[]>(`/approvals/${id}/comments`, { signal }),
  addComment: (id: string, body: string) => api.post<ApprovalComment>(`/approvals/${id}/comments`, { body }),
};
