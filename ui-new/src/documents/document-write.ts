import type { UpsertIssueDocument } from "@paperclipai/shared";
import type { DocumentOwner } from "@/api/documents";
import { newWrite } from "@/lib/offline/WriteQueueProvider";
import type { QueuedWrite } from "@/lib/offline/write-queue";
import { documentKeys, type DocumentHost } from "./host";

/*
 * A document save as a queued write (U13), for when it can't reach the server. It sends the
 * revision the edit started from, as any save does. Saves of the same document made while offline
 * fold into one (write-queue.ts `addWrite`). When it lands, the saved document goes into the
 * cache; when its result was lost, or it comes back as a conflict, the document is read back and
 * the same text there counts as saved (writes.ts).
 */

/** A document's address, as api/documents.ts builds it for `PUT`. */
function documentPath(owner: DocumentOwner, key: string) {
  return `/issues/${encodeURIComponent(owner.id)}/documents/${encodeURIComponent(key)}`;
}

/** The queue's name for a document, shared by its saves and the views that show them. */
export function documentTarget(host: DocumentHost, key: string) {
  return `document:${documentPath(host.owner, key)}`;
}

export function documentWrite(input: {
  userId: string;
  companyId: string;
  host: DocumentHost;
  docKey: string;
  payload: UpsertIssueDocument;
  /** "Plan", or the document's title, for the sync list. */
  name: string;
}): QueuedWrite {
  const path = documentPath(input.host.owner, input.docKey);
  return newWrite({
    userId: input.userId,
    companyId: input.companyId,
    kind: "document",
    target: documentTarget(input.host, input.docKey),
    label: `Edit to ${input.name}`,
    request: { method: "PUT", path, body: { ...input.payload } },
    idempotencyKey: `${path}:${input.payload.baseRevisionId ?? "new"}`,
    recovery: { kind: "document", path },
    refresh: [[...documentKeys.list(input.host)], [...documentKeys.revisions(input.host, input.docKey)]],
    store: [...documentKeys.doc(input.host, input.docKey)],
    preview: { title: input.name, text: input.payload.body.slice(0, 200) },
  });
}
