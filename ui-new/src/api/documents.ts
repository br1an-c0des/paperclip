import type {
  CreateDocumentAnnotationCommentRequest,
  CreateDocumentAnnotationThreadRequest,
  DocumentAnnotationComment,
  DocumentAnnotationThread,
  DocumentAnnotationThreadStatus,
  DocumentAnnotationThreadWithComments,
  DocumentRevision,
  IssueDocument,
  UpsertIssueDocument,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Keyed Markdown documents with revisions, locks and annotation threads, as ui/src/api/issues.ts
 * and ui/src/api/document-annotations.ts use them. Every call takes the document's owner, so the
 * editor in src/documents/ isn't tied to tasks: today only tasks hold documents a board user can
 * edit, and project documents (decision 1) would add an owner kind here.
 *
 * Locks are a freeze rather than an edit session: while a document is locked, nobody can save,
 * restore or delete it until someone unlocks it. Only board users can lock and unlock.
 */

export type DocumentOwner = { kind: "issue"; id: string };

export type AnnotationStatusFilter = "open" | "resolved" | "all";

function documentsPath(owner: DocumentOwner) {
  return `/issues/${encodeURIComponent(owner.id)}/documents`;
}

function documentPath(owner: DocumentOwner, key: string) {
  return `${documentsPath(owner)}/${encodeURIComponent(key)}`;
}

export const documentsApi = {
  list: (owner: DocumentOwner, signal?: AbortSignal) => api.get<IssueDocument[]>(documentsPath(owner), { signal }),
  get: (owner: DocumentOwner, key: string, signal?: AbortSignal) => api.get<IssueDocument>(documentPath(owner, key), { signal }),
  /**
   * Creates or updates a document. Updates need `baseRevisionId`, the revision the edit started
   * from; the server answers 409 "Document was updated by someone else" when it has moved on, and
   * 409 "Document is locked" while it's locked.
   */
  upsert: (owner: DocumentOwner, key: string, data: UpsertIssueDocument) => api.put<IssueDocument>(documentPath(owner, key), data),
  remove: (owner: DocumentOwner, key: string) => api.delete<{ ok: true }>(documentPath(owner, key)),
  lock: (owner: DocumentOwner, key: string) => api.post<IssueDocument>(`${documentPath(owner, key)}/lock`),
  unlock: (owner: DocumentOwner, key: string) => api.post<IssueDocument>(`${documentPath(owner, key)}/unlock`),
  revisions: (owner: DocumentOwner, key: string, signal?: AbortSignal) =>
    api.get<DocumentRevision[]>(`${documentPath(owner, key)}/revisions`, { signal }),
  /** Makes an earlier revision the latest again, as a new revision; history stays append-only. */
  restore: (owner: DocumentOwner, key: string, revisionId: string) =>
    api.post<IssueDocument>(`${documentPath(owner, key)}/revisions/${encodeURIComponent(revisionId)}/restore`),

  annotations: {
    list: (
      owner: DocumentOwner,
      key: string,
      options: { status?: AnnotationStatusFilter; includeComments?: boolean } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (options.status) params.set("status", options.status);
      if (options.includeComments) params.set("includeComments", "true");
      const qs = params.toString();
      return api.get<DocumentAnnotationThreadWithComments[]>(`${documentPath(owner, key)}/annotations${qs ? `?${qs}` : ""}`, {
        signal,
      });
    },
    create: (owner: DocumentOwner, key: string, data: CreateDocumentAnnotationThreadRequest) =>
      api.post<DocumentAnnotationThreadWithComments>(`${documentPath(owner, key)}/annotations`, data),
    reply: (owner: DocumentOwner, key: string, threadId: string, data: CreateDocumentAnnotationCommentRequest) =>
      api.post<DocumentAnnotationComment>(`${documentPath(owner, key)}/annotations/${encodeURIComponent(threadId)}/comments`, data),
    setStatus: (owner: DocumentOwner, key: string, threadId: string, status: DocumentAnnotationThreadStatus) =>
      api.patch<DocumentAnnotationThread>(`${documentPath(owner, key)}/annotations/${encodeURIComponent(threadId)}`, { status }),
  },
};
