import { classifyError, classifySendFailure, describeError, errorCodes, UncertainWriteError } from "./errors";
import { answerMatches, type QueuedWrite, type WriteRequest } from "./write-queue";

/*
 * Sending one queued write, and settling one whose result was lost (U13, after #17960).
 *
 * - **Resend** (comments posted on their own, new tasks, decisions): the server answers a known key
 *   with what it saved the first time (`clientRequestId`, `idempotencyKey`), so the same request
 *   is its own receipt. A comment's answer must look like a comment, or the result is still unknown.
 * - **Comment inside `PATCH /issues/:id`** (a reassignment or new run settings with the message): the
 *   change and the message commit together, but the change isn't deduped, so the thread is read
 *   first and the comment looked for by its client request id. Found, it's done; not found, nothing
 *   landed and it's sent again.
 * - **Document saves** send the revision the edit started from. A save that comes back as a
 *   conflict, or whose result was lost, is read back: the same text there means it was saved.
 * - **Request answers** re-read the task's requests (`GET /issues/:id/interactions`). Still open,
 *   it's sent again; settled with exactly this answer, it's done; settled otherwise, someone else
 *   answered and it fails for good.
 *
 * The server's `X-Paperclip-Receipt-Only` header (a receipt without a write) is honored only by
 * project creation, which ui-new doesn't queue; these writes recover through their keys instead.
 */

export type Transport = {
  send: (request: WriteRequest) => Promise<unknown>;
  get: (path: string) => Promise<unknown>;
};

export type WriteOutcome =
  | { kind: "done"; result: unknown }
  /** Not delivered, or not known to be: wait and send it again. */
  | { kind: "pending"; error: unknown }
  | { kind: "failed"; message: string; settled: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** A saved comment, as `hasCommentReceipt` in ui/src/api/issues.ts checks it. */
export function isCommentReceipt(value: unknown) {
  const row = record(value);
  return !!row && typeof row.id === "string" && UUID.test(row.id) && typeof row.issueId === "string" && UUID.test(row.issueId) && typeof row.body === "string";
}

/** The answer a write must come back with, or its result is still unknown. */
function confirm(write: QueuedWrite, result: unknown): unknown {
  if (write.kind === "comment") {
    const receipt = write.request.method === "PATCH" ? record(result)?.comment : result;
    if (!isCommentReceipt(receipt)) throw new UncertainWriteError();
  }
  if ((write.kind === "task" || write.kind === "document" || write.kind === "answer" || write.kind === "decision") && !record(result)) {
    throw new UncertainWriteError();
  }
  return result;
}

const documentBody = (write: QueuedWrite) => String(write.request.body.body ?? "");
const documentTitle = (write: QueuedWrite) => (write.request.body.title as string | null | undefined) ?? null;

function sameDocument(write: QueuedWrite, saved: unknown) {
  const row = record(saved);
  if (!row || row.body !== documentBody(write)) return false;
  const title = documentTitle(write);
  return title === null || (row.title ?? null) === title;
}

type Settle = { kind: "done"; result: unknown } | { kind: "send" } | { kind: "failed"; message: string; settled: boolean };

/** Finds out what happened to a write whose answer was lost. A read that fails throws: still unknown. */
async function settle(write: QueuedWrite, transport: Transport): Promise<Settle> {
  const recovery = write.recovery;
  if (recovery.kind === "resend") return { kind: "send" };
  if (recovery.kind === "comment") {
    const rows = await transport.get(`/issues/${recovery.issueId}/comments?order=desc&limit=100`);
    const found = Array.isArray(rows) ? rows.find((row) => record(row)?.clientRequestId === recovery.clientRequestId) : undefined;
    return found ? { kind: "done", result: { comment: found } } : { kind: "send" };
  }
  if (recovery.kind === "document") {
    try {
      const saved = await transport.get(recovery.path);
      return sameDocument(write, saved) ? { kind: "done", result: saved } : { kind: "send" };
    } catch (error) {
      // A document the save would create isn't there yet.
      if (classifyError(error) === "not_found") return { kind: "send" };
      throw error;
    }
  }
  const rows = await transport.get(`/issues/${recovery.issueId}/interactions`);
  const current = Array.isArray(rows) ? rows.map(record).find((row) => row?.id === recovery.interactionId) : null;
  if (!current) return { kind: "failed", message: "This request is gone from the task.", settled: true };
  if (current.status === "pending") return { kind: "send" };
  if (answerMatches(current as Parameters<typeof answerMatches>[0], recovery.match)) return { kind: "done", result: current };
  return { kind: "failed", message: "Someone else answered this request first.", settled: true };
}

/** A refusal that still means the write landed, or one that can't be fixed by trying again. */
async function afterRefusal(write: QueuedWrite, error: unknown, transport: Transport): Promise<WriteOutcome | null> {
  const codes = errorCodes(error);
  if (write.kind === "document" && classifyError(error) === "conflict") {
    const saved = await transport.get(write.recovery.kind === "document" ? write.recovery.path : write.request.path);
    if (sameDocument(write, saved)) return { kind: "done", result: saved };
    return { kind: "failed", message: "Someone saved this document after your edit started.", settled: true };
  }
  if (write.kind === "answer" && codes.includes("interaction_already_resolved")) {
    const settled = await settle(write, transport);
    if (settled.kind === "done") return settled;
    if (settled.kind === "failed") return { kind: "failed", message: settled.message, settled: true };
  }
  if (write.kind === "decision" && codes.some((code) => code === "decision_already_resolved" || code === "decision_expired")) {
    return { kind: "failed", message: codes.includes("decision_expired") ? "This proposal expired." : "This proposal was already decided.", settled: true };
  }
  return null;
}

export async function performWrite(write: QueuedWrite, transport: Transport): Promise<WriteOutcome> {
  try {
    if (write.uncertain) {
      const settled = await settle(write, transport);
      if (settled.kind === "done" || settled.kind === "failed") return settled;
    }
    for (const step of write.before ?? []) await transport.send(step);
    return { kind: "done", result: confirm(write, await transport.send(write.request)) };
  } catch (error) {
    if (classifySendFailure(error) === "pending") return { kind: "pending", error };
    try {
      const outcome = await afterRefusal(write, error, transport);
      if (outcome) return outcome;
    } catch (readError) {
      if (classifySendFailure(readError) === "pending") return { kind: "pending", error: readError };
    }
    return { kind: "failed", message: describeError(error, "Paperclip refused this change."), settled: false };
  }
}
