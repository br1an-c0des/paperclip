import type { CaseHandoff, HandoffCaseInput, HandoffCaseResult, IssueLabel } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Cases and their workflows (M7, boards C1, C2 and C5), behind the instance's `enableCases`. The
 * requests follow ui/src/api/cases.ts and server/src/routes/cases.ts, case-handoffs.ts and
 * workflows.ts. The shapes the server returns aren't in @paperclipai/shared (only the hand-off's
 * are), so they're written out here, as the old UI does.
 *
 * Like upstream's own pages, the board only reads cases; agents write them. The exceptions are
 * linking a task to a case, starting a case's workflow and cancelling a queued hand-off. Case
 * documents, revisions and annotations aren't here: upstream moved a case's documents onto its main
 * task (#16959, Oct 20), and the case only lists them (`taskDocuments`).
 */

export const CASE_STATUSES = ["draft", "in_progress", "in_review", "approved", "done", "cancelled"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** How a task is linked to a case. The main task is linked as `work` and named by `workIssueId`. */
export type CaseLinkRole = "origin" | "work" | "reference";

export type CaseHandoffView = CaseHandoff & { fromAgentName?: string | null; toAgentName?: string | null };

/** The main task, as the list and the detail carry it. */
export type CaseWorkIssue = {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  statusVersion: number;
  assigneeAgentId: string | null;
  assigneeAgentName: string | null;
};

/** A case as the company's case list returns it. */
export type CaseSummary = {
  id: string;
  companyId: string;
  projectId: string | null;
  caseNumber: number;
  /** "TES-C3". */
  identifier: string;
  caseType: string;
  key: string | null;
  title: string;
  summary: string | null;
  status: CaseStatus;
  fields: Record<string, unknown>;
  workIssueId: string | null;
  workflowId: string | null;
  workflow: { id: string; name: string } | null;
  /** The current phase, as free text; the workflow's diagram names the phases, if it has one. */
  phase: string | null;
  handoffVersion: number;
  workIssue: CaseWorkIssue | null;
  pendingHandoff: CaseHandoffView | null;
  parentCaseId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaseIssueLink = {
  id: string;
  caseId: string;
  issueId: string;
  role: CaseLinkRole;
  createdAt: string;
  issue: { id: string; identifier: string | null; title: string; status: string };
};

/** One of the case's tasks' documents, listed by reference: the document lives on the task. */
export type CaseTaskDocument = {
  id: string;
  taskId: string;
  taskIdentifier: string | null;
  key: string;
  scope: "primary" | "linked";
  document: { id: string; title: string | null; latestRevisionNumber: number | null; updatedAt: string };
};

export type CaseAttachment = {
  id: string;
  asset: { id: string; contentType: string; byteSize: number; originalFilename: string | null };
  createdAt: string;
};

export type CaseDetail = CaseSummary & {
  parent: { id: string; identifier: string; title: string; caseType: string; status: CaseStatus } | null;
  labels: IssueLabel[];
  issueLinks: CaseIssueLink[];
  taskDocuments?: CaseTaskDocument[];
  taskDocumentsOmitted?: boolean;
  attachments: CaseAttachment[];
};

/** A case a task is linked to (`GET /issues/:id/cases`). */
export type IssueCaseLink = {
  id: string;
  role: CaseLinkRole;
  createdAt: string;
  case: {
    id: string;
    identifier: string;
    title: string;
    caseType: string;
    status: CaseStatus;
    workIssueId: string | null;
    phase: string | null;
    handoffVersion: number;
  };
};

export type CaseHandoffPage = { items: CaseHandoffView[]; nextCursor: string | null; canControl?: boolean };

/** A company's workflow template. The list leaves out the prompt; one workflow carries it. */
export type WorkflowSummary = { id: string; companyId: string; name: string; createdAt: string; updatedAt: string };
export type Workflow = WorkflowSummary & { prompt: string };

export function caseAssetUrl(attachment: CaseAttachment) {
  return `/api/assets/${attachment.asset.id}/content`;
}

export const casesApi = {
  /** Every case the viewer can read, newest change first (the server allows 200 at most). */
  list: (companyId: string, params: { parent?: string; limit?: number } = {}, signal?: AbortSignal) => {
    const search = new URLSearchParams({ limit: String(params.limit ?? 200) });
    if (params.parent) search.set("parent", params.parent);
    return api.get<CaseSummary[]>(`/companies/${companyId}/cases?${search}`, { signal });
  },
  /** One case by id or identifier ("TES-C3"), with its links; document bodies left out. */
  get: (ref: string, signal?: AbortSignal) =>
    api.get<CaseDetail>(`/cases/${encodeURIComponent(ref)}?includeDocumentBodies=false`, { signal }),
  forIssue: (issueRef: string, signal?: AbortSignal) => api.get<IssueCaseLink[]>(`/issues/${encodeURIComponent(issueRef)}/cases`, { signal }),
  link: (caseId: string, issueId: string, role: Exclude<CaseLinkRole, "origin">) =>
    api.post<{ id: string }>(`/cases/${caseId}/links`, { issueId, role }),
  handoffs: (caseId: string, cursor?: string | null, signal?: AbortSignal) =>
    api.get<CaseHandoffPage>(`/cases/${caseId}/handoffs?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }),
  cancelHandoff: (caseId: string, handoffId: string) => api.post<CaseHandoffView>(`/cases/${caseId}/handoffs/${handoffId}/cancel`, {}),
  /** Starts a draft case's workflow: hands it to an agent, which wakes them. */
  handoff: (companyId: string, input: HandoffCaseInput) => api.post<HandoffCaseResult>(`/companies/${companyId}/case-handoffs`, input),
  workflows: (companyId: string, signal?: AbortSignal) =>
    api.get<WorkflowSummary[]>(`/companies/${companyId}/workflows?limit=100`, { signal }),
  workflow: (id: string, signal?: AbortSignal) => api.get<Workflow>(`/workflows/${id}`, { signal }),
};
