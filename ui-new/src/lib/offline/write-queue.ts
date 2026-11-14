import type { AskUserQuestionsAnswer } from "@paperclipai/shared";

/*
 * The write queue's records and their storage (U13, after #17960's ui/src/lib/pending-send.ts and
 * useDurableSubmit.ts). Comments, document saves, new tasks, request answers and decisions that
 * can't reach the server wait here and are sent again, in order, when it's back. New tasks always
 * go through it, so the dialog can close at once (U153, after #20831).
 *
 * - A record is written to local storage before the first attempt, so a reload, a crash or a
 *   closed tab mid-request loses nothing. Records are kept per user and company
 *   (`paperclip.ui-new.writes.v1:<user>:<company>`) and only that user's session sends them.
 * - Each keeps the key the server dedupes by (`clientRequestId` for comments, `idempotencyKey` for
 *   new tasks and decisions) for its whole life, so a resend lands once.
 * - When a send's result is unknown (the connection dropped after sending), `recovery` says how to
 *   find out before sending again: resend with the same key, look for the comment, read the
 *   document back, or re-read the task's requests (writes.ts).
 * - Saves of the same document fold into one, which keeps the revision the first one started from.
 *
 * This is apart from the composer's queued messages (tasks/composer/queue-model.ts), which are the
 * server's queue of messages waiting for an agent's next turn.
 */

export type WriteKind = "comment" | "document" | "task" | "answer" | "decision";

export type WriteRequest = { method: "POST" | "PUT" | "PATCH"; path: string; body: Record<string, unknown> };

/** What a request card's answer was, to tell it from someone else's when the card is already settled. */
export type AnswerMatch =
  | { action: "accept"; selectedClientKeys?: string[]; selectedOptionIds?: string[] }
  | { action: "reject"; reason: string | null }
  | { action: "respond"; answers: AskUserQuestionsAnswer[] };

/** How a write whose result is unknown is settled before it's sent again. */
export type Recovery =
  /** The server answers a known key with what it saved the first time. */
  | { kind: "resend" }
  /** A comment sent inside `PATCH /issues/:id`: look for it by its client request id. */
  | { kind: "comment"; issueId: string; clientRequestId: string }
  /** A document save: read it back and compare. */
  | { kind: "document"; path: string }
  /** A request answer: re-read the task's requests (`GET /issues/:id/interactions`). */
  | { kind: "answer"; issueId: string; interactionId: string; match: AnswerMatch };

export type WriteStatus = "queued" | "sending" | "failed";

export type QueuedWrite = {
  id: string;
  userId: string;
  companyId: string;
  kind: WriteKind;
  /** What it's about, for the views that show it: `issue:<id>`, `document:<path>`, `interaction:<id>`, `decision:<id>`, `new-task`. */
  target: string;
  /** One line for the sync list ("Comment on TES-12"). */
  label: string;
  /** Sent first, each setting an absolute value so sending it twice is harmless (a work mode). */
  before?: WriteRequest[];
  request: WriteRequest;
  /** The key the server dedupes by, or the record's own id when the write has none. */
  idempotencyKey: string;
  recovery: Recovery;
  /** Query keys to refresh once it lands. */
  refresh: unknown[][];
  /** Puts the server's answer under this key (a saved document). */
  store?: unknown[];
  /** What the views show: a comment's text, a task's or document's title. */
  preview?: { text?: string; title?: string };
  /**
   * Follow-ups after it lands: the case a new task goes into, the prefix its link uses, the files to
   * attach (held in the tab's memory, tasks/new-task-saves.ts) and whether to open it.
   */
  after?: { caseLink?: { caseId: string; role: string }; issuePrefix?: string; fileNames?: string[]; openAfter?: boolean };
  /** What a failed write's screen restores to edit it again: a new task's draft and its fingerprint. */
  restore?: { draft: Record<string, unknown>; fingerprint: string };
  status: WriteStatus;
  /** The last attempt may have reached the server: settle that before sending again. */
  uncertain: boolean;
  attempts: number;
  error: string | null;
  /** Failed for good as it is: a conflict, or an answer someone else gave. Retry won't help. */
  settled?: boolean;
  createdAt: number;
  updatedAt: number;
};

export const WRITES_PREFIX = "paperclip.ui-new.writes.v1:";

export type WriteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function writesKey(userId: string, companyId: string) {
  return `${WRITES_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(companyId)}`;
}

function isWrite(value: unknown, userId: string, companyId: string): value is QueuedWrite {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<QueuedWrite>;
  return (
    typeof row.id === "string" &&
    row.userId === userId &&
    row.companyId === companyId &&
    typeof row.kind === "string" &&
    typeof row.target === "string" &&
    typeof row.idempotencyKey === "string" &&
    !!row.request &&
    typeof row.request.path === "string" &&
    !!row.recovery &&
    typeof row.createdAt === "number"
  );
}

function readScope(storage: WriteStorage, userId: string, companyId: string): QueuedWrite[] {
  try {
    const raw = storage.getItem(writesKey(userId, companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((row) => isWrite(row, userId, companyId)) : [];
  } catch {
    return [];
  }
}

/** Returns false when storage refused it (full, or blocked): the caller keeps the write in memory. */
function saveScope(storage: WriteStorage, userId: string, companyId: string, rows: QueuedWrite[]): boolean {
  try {
    if (rows.length === 0) storage.removeItem(writesKey(userId, companyId));
    else storage.setItem(writesKey(userId, companyId), JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

/** Every company this user has writes waiting in. */
function scopesFor(storage: WriteStorage, userId: string): string[] {
  const prefix = `${WRITES_PREFIX}${encodeURIComponent(userId)}:`;
  const companies: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) companies.push(decodeURIComponent(key.slice(prefix.length)));
    }
  } catch {
    // Unreadable storage holds nothing.
  }
  return companies;
}

const byAge = (a: QueuedWrite, b: QueuedWrite) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** All of a user's writes, oldest first: the order they're sent in. */
export function readWrites(storage: WriteStorage, userId: string): QueuedWrite[] {
  return scopesFor(storage, userId)
    .flatMap((companyId) => readScope(storage, userId, companyId))
    .sort(byAge);
}

/**
 * Adds a write, or folds a document save into the one already waiting for the same document: the
 * newer body wins, and the older save's base revision, key and place in line are kept, since the
 * server hasn't seen either. A save already on its way isn't touched; the new one waits behind it.
 */
export function addWrite(storage: WriteStorage, write: QueuedWrite): { write: QueuedWrite; stored: boolean } {
  const rows = readScope(storage, write.userId, write.companyId);
  const waiting = write.kind === "document" ? rows.find((row) => row.target === write.target && row.status !== "sending") : undefined;
  let next: QueuedWrite = write;
  if (waiting) {
    next = {
      ...write,
      id: waiting.id,
      idempotencyKey: waiting.idempotencyKey,
      createdAt: waiting.createdAt,
      uncertain: waiting.uncertain,
      request: { ...write.request, body: { ...write.request.body, baseRevisionId: waiting.request.body.baseRevisionId ?? write.request.body.baseRevisionId ?? null } },
    };
  }
  const merged = waiting ? rows.map((row) => (row.id === waiting.id ? next : row)) : [...rows, next];
  return { write: next, stored: saveScope(storage, write.userId, write.companyId, merged) };
}

export function updateWrite(storage: WriteStorage, write: QueuedWrite): boolean {
  const rows = readScope(storage, write.userId, write.companyId);
  if (!rows.some((row) => row.id === write.id)) return false;
  return saveScope(storage, write.userId, write.companyId, rows.map((row) => (row.id === write.id ? write : row)));
}

export function removeWrite(storage: WriteStorage, write: Pick<QueuedWrite, "id" | "userId" | "companyId">) {
  const rows = readScope(storage, write.userId, write.companyId);
  saveScope(storage, write.userId, write.companyId, rows.filter((row) => row.id !== write.id));
}

/**
 * A saved document's later saves start from the revision it made. Saves that waited behind it
 * still carry the revision the first one started from, which would now conflict.
 */
export function rebaseDocumentSaves(storage: WriteStorage, saved: QueuedWrite, revisionId: string | null) {
  if (saved.kind !== "document" || !revisionId) return;
  const rows = readScope(storage, saved.userId, saved.companyId);
  if (!rows.some((row) => row.kind === "document" && row.target === saved.target && row.id !== saved.id)) return;
  saveScope(
    storage,
    saved.userId,
    saved.companyId,
    rows.map((row) =>
      row.kind === "document" && row.target === saved.target && row.id !== saved.id
        ? { ...row, request: { ...row.request, body: { ...row.request.body, baseRevisionId: revisionId } } }
        : row,
    ),
  );
}

/**
 * The next write to send: the oldest one waiting, skipping failed ones (they wait for Retry or
 * Discard) and ones this page is already sending. A write on its way from a page that's gone (a
 * reload mid-request) counts as waiting, and its result as unknown.
 */
export function nextWrite(rows: readonly QueuedWrite[], inFlight: ReadonlySet<string>): QueuedWrite | null {
  for (const row of rows) {
    if (inFlight.has(row.id) || row.status === "failed") continue;
    return row.status === "sending" ? { ...row, status: "queued", uncertain: true } : row;
  }
  return null;
}

// Request answers, matched as ui/src/api/issues.ts does (`acceptedResolutionMatches` and the rest):
// an answer that landed while its response was lost reads back as exactly what was sent.

function sameSet(left: readonly string[] | null | undefined, right: readonly string[] | null | undefined) {
  const a = new Set(left ?? []);
  const b = new Set(right ?? []);
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function sameText(left: string | null | undefined, right: string | null | undefined) {
  return (left?.trim() || null) === (right?.trim() || null);
}

type SettledInteraction = {
  kind: string;
  status: string;
  payload?: { tasks?: { clientKey: string }[] } | null;
  result?: Record<string, unknown> | null;
};

/** Whether a settled request card records exactly this answer. */
export function answerMatches(current: SettledInteraction, match: AnswerMatch): boolean {
  const result = (current.result ?? {}) as Record<string, unknown>;
  if (match.action === "accept") {
    if (current.status !== "accepted") return false;
    if (current.kind === "suggest_tasks") {
      const all = (current.payload?.tasks ?? []).map((task) => task.clientKey);
      const picked = new Set(match.selectedClientKeys ?? all);
      return sameSet(result.skippedClientKeys as string[] | undefined, all.filter((key) => !picked.has(key)));
    }
    if (current.kind === "request_checkbox_confirmation") return sameSet(result.selectedOptionIds as string[] | undefined, match.selectedOptionIds);
    return !match.selectedClientKeys && !match.selectedOptionIds;
  }
  if (match.action === "reject") {
    if (current.status !== "rejected") return false;
    return sameText((current.kind === "suggest_tasks" ? result.rejectionReason : result.reason) as string | null | undefined, match.reason);
  }
  if (current.status !== "answered" || current.kind !== "ask_user_questions") return false;
  const saved = (result.answers ?? []) as AskUserQuestionsAnswer[];
  if (saved.length !== match.answers.length) return false;
  return match.answers.every((answer) => {
    const found = saved.find((row) => row.questionId === answer.questionId);
    return !!found && sameSet(found.optionIds, answer.optionIds) && sameText(found.otherText, answer.otherText);
  });
}
