import type { QueryClient } from "@tanstack/solid-query";
import { casesApi } from "@/api/cases";
import { issuesApi } from "@/api/issues";
import { describeError } from "@/lib/offline/errors";
import type { QueuedWrite } from "@/lib/offline/write-queue";
import { pushToast } from "@/ui/Toast";
import { draftHasContent, emptyDraft, loadDraft, saveDraft, type NewTaskDraft } from "./new-task";

/*
 * New tasks saved in the background (U153, after #20831's useBackgroundSubmitQueue.ts). Create
 * closes the dialog at once: the task becomes a write in the write queue (task-write.ts, U13) with
 * its creation key and the draft it came from, and shows as pending on the task list until it
 * lands (PendingTasks.tsx).
 *
 * - **The creation key** (`idempotencyKey`) is the write's for its whole life, through Retry and a
 *   reload. A draft reopened after a failure keeps it too (saved beside the draft), so creating it
 *   again unchanged makes one task even if the first attempt reached the server.
 * - **Files** can't go into browser storage, so they wait in this tab's memory, keyed by the
 *   write, and are uploaded once the task exists. A reload loses them: the task is still created,
 *   and a notice names the files to attach again.
 * - **Landing** uploads the files, links the task to its case, says so in a toast and, for Create
 *   and open, opens it, but only if it's still the last task created here, so an earlier one
 *   can't pull the page away later.
 * - **A failure** reopens its draft, error and files in the dialog when the dialog is free: closed,
 *   with no other draft kept, in the same company. Otherwise the other draft stays as it is and a
 *   toast offers Retry; the failed task also waits, with Retry, Edit and Discard, at the top of the
 *   task list and of the dialog. A landed task never touches whatever draft is open.
 */

// ---------------------------------------------------------------------------------------------
// The draft's fingerprint and its creation key

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** The same for the same draft, whatever order its fields were stored in. */
export function draftFingerprint(draft: NewTaskDraft) {
  return JSON.stringify(stable(draft));
}

export type Submission = { fingerprint: string; key: string };

const SUBMISSION_KEY = (companyId: string) => `paperclip.ui-new.new-task-request.${companyId}`;

/** The creation key a kept draft was last sent with, so a resend after a reload reuses it. */
export function loadSubmission(companyId: string): Submission | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUBMISSION_KEY(companyId)) ?? "null") as Partial<Submission> | null;
    return parsed && typeof parsed.fingerprint === "string" && typeof parsed.key === "string" ? { fingerprint: parsed.fingerprint, key: parsed.key } : null;
  } catch {
    return null;
  }
}

export function saveSubmission(companyId: string, submission: Submission | null) {
  try {
    if (submission) localStorage.setItem(SUBMISSION_KEY(companyId), JSON.stringify(submission));
    else localStorage.removeItem(SUBMISSION_KEY(companyId));
  } catch {
    // Storage unavailable: the key lives while the dialog is open.
  }
}

// ---------------------------------------------------------------------------------------------
// Files and the last task created here, in this tab's memory

const heldFiles = new Map<string, File[]>();
let lastCreated: string | null = null;

/** Keeps a submitted task's files until it lands, and remembers it as the last one created here. */
export function holdSubmitted(writeId: string, files: readonly File[]) {
  if (files.length > 0) heldFiles.set(writeId, [...files]);
  lastCreated = writeId;
}

export function takeFiles(writeId: string): File[] | undefined {
  const files = heldFiles.get(writeId);
  heldFiles.delete(writeId);
  return files;
}

export function isLastCreated(writeId: string) {
  return lastCreated === writeId;
}

/** For tests. */
export function resetNewTaskSaves() {
  heldFiles.clear();
  lastCreated = null;
  restoring.clear();
  failureListeners.clear();
}

// ---------------------------------------------------------------------------------------------
// Landing

const issueHref = (prefix: string | undefined, row: { id: string; identifier?: unknown }) => {
  const ref = typeof row.identifier === "string" ? row.identifier : row.id;
  return prefix ? `/${prefix}/issues/${ref}` : `/issues/${ref}`;
};

/**
 * After a new task lands: its files, its case, a toast, and Create and open. Resolves once the
 * files are up, so its pending row stays until then.
 */
export async function landNewTask(
  client: QueryClient,
  write: QueuedWrite,
  result: unknown,
  navigate?: (href: string) => void,
  uploadAttachment: typeof issuesApi.uploadAttachment = issuesApi.uploadAttachment,
  link: typeof casesApi.link = casesApi.link,
) {
  const row = (result ?? {}) as Record<string, unknown>;
  if (typeof row.id !== "string") return;
  const issueId = row.id;
  const ref = typeof row.identifier === "string" ? row.identifier : "the task";
  const href = issueHref(write.after?.issuePrefix, { id: issueId, identifier: row.identifier });
  const problems: string[] = [];

  const files = takeFiles(write.id);
  const named = write.after?.fileNames ?? [];
  if (files) {
    const failed: string[] = [];
    for (const file of files) {
      try {
        await uploadAttachment(write.companyId, issueId, file);
      } catch {
        failed.push(file.name);
      }
    }
    if (failed.length > 0) problems.push(`Some files didn't upload: ${failed.join(", ")}.`);
  } else if (named.length > 0) {
    problems.push(`Its files were lost when the page reloaded. Attach them again: ${named.join(", ")}.`);
  }

  const caseLink = write.after?.caseLink;
  if (caseLink) {
    try {
      await link(caseLink.caseId, issueId, caseLink.role as Parameters<typeof casesApi.link>[2]);
      void client.invalidateQueries({ queryKey: ["cases", write.companyId] });
    } catch (error) {
      problems.push(`Couldn't add it to the case: ${describeError(error)}`);
    }
  }

  const opening = !!write.after?.openAfter && isLastCreated(write.id) && !!navigate;
  if (problems.length > 0) {
    pushToast({ tone: "warn", title: `Created ${ref}, with a problem`, body: problems.join(" "), action: { label: `Open ${ref}`, href } });
  } else {
    pushToast({
      tone: "success",
      title: `Created ${ref}`,
      body: typeof row.title === "string" ? row.title : undefined,
      action: opening ? undefined : { label: `Open ${ref}`, href },
    });
  }
  if (opening) navigate!(href);
}

// ---------------------------------------------------------------------------------------------
// Failures

const failureListeners = new Set<(write: QueuedWrite) => void>();

/** Called by the write queue when a new task fails for good (WriteQueueProvider.tsx). */
export function newTaskFailed(write: QueuedWrite) {
  for (const listener of failureListeners) listener(write);
}

/** The dialog's handler for failed tasks, while it's mounted. */
export function onNewTaskFailed(listener: (write: QueuedWrite) => void) {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

/** Whether the dialog can take a failed task's draft back: it's closed, holds no other draft, and the task is from this company. */
export function canReopen(write: Pick<QueuedWrite, "companyId" | "restore">, state: { companyId: string; dialogOpen: boolean }) {
  if (!write.restore || write.companyId !== state.companyId || state.dialogOpen) return false;
  const kept = loadDraft(state.companyId);
  return !kept || !draftHasContent(kept);
}

export type Restoring = { error: string | null; files: File[]; missingFiles: string[] };

const restoring = new Map<string, Restoring>();

/**
 * Puts a failed task back as the dialog's draft, with its creation key, error and files, for the
 * dialog to pick up when it opens (`takeRestoring`). The caller discards the write and opens it.
 */
export function restoreDraft(write: QueuedWrite) {
  const restore = write.restore!;
  saveDraft(write.companyId, emptyDraft(restore.draft as Partial<NewTaskDraft>));
  saveSubmission(write.companyId, { fingerprint: restore.fingerprint, key: write.idempotencyKey });
  const files = takeFiles(write.id) ?? [];
  const named = write.after?.fileNames ?? [];
  restoring.set(write.companyId, { error: write.error, files, missingFiles: files.length === 0 ? named : [] });
}

export function takeRestoring(companyId: string): Restoring | null {
  const found = restoring.get(companyId) ?? null;
  restoring.delete(companyId);
  return found;
}
