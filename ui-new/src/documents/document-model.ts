import type { DocumentRevision, IssueDocument, IssueDocumentSummary, UpsertIssueDocument } from "@paperclipai/shared";
import { ApiError } from "@/api/client";

/*
 * The document editor's view logic, kept free of components so it can be tested and reused by
 * project documents later: keys and titles, the draft being edited, revision history, the lock,
 * and what a failed save means.
 */

// Keys --------------------------------------------------------------------------------------------

/** The server's key rule: lowercase letters, numbers, `-` and `_`, starting with a letter or number. */
export const DOCUMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const DOCUMENT_KEY_MAX = 64;

/** Why a key can't be used, or null when it can. Empty keys aren't flagged until saving. */
export function keyProblem(key: string, existingKeys: readonly string[] = []): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.length > DOCUMENT_KEY_MAX) return `Keep the key to ${DOCUMENT_KEY_MAX} characters.`;
  if (!DOCUMENT_KEY_PATTERN.test(trimmed)) return "Use lowercase letters, numbers, - or _, starting with a letter or number.";
  if (existingKeys.includes(trimmed)) return "This task already has a document with that key.";
  return null;
}

/** A key from free text: "Data notes.md" → "data-notes". */
export function slugifyKey(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/\.(md|markdown)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DOCUMENT_KEY_MAX)
    .replace(/-+$/g, "");
  return slug || "document";
}

/** A title from a file name: "data_notes-v2.md" → "Data notes v2". */
export function titleFromFilename(name: string) {
  const words = name
    .replace(/\.[^.]+$/, "")
    .split(/[-_ ]+/g)
    .filter(Boolean)
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

export function isMarkdownFile(file: Pick<File, "name" | "type">) {
  const name = file.name.toLowerCase();
  return name.endsWith(".md") || name.endsWith(".markdown") || file.type === "text/markdown";
}

/** The `plan` document is the task's plan; it has no title of its own. */
export const isPlanKey = (key: string) => key.trim().toLowerCase() === "plan";

/** What a document is called in lists and headings. */
export function documentName(doc: Pick<IssueDocumentSummary, "key" | "title">) {
  if (isPlanKey(doc.key)) return "Plan";
  return doc.title?.trim() || doc.key;
}

/** Plan first, then the most recently updated. */
export function sortDocuments<T extends Pick<IssueDocumentSummary, "key" | "updatedAt">>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) => {
    if (isPlanKey(a.key) !== isPlanKey(b.key)) return isPlanKey(a.key) ? -1 : 1;
    return time(b.updatedAt) - time(a.updatedAt);
  });
}

function time(value: Date | string | null | undefined) {
  if (!value) return 0;
  const stamp = new Date(value).getTime();
  return Number.isNaN(stamp) ? 0 : stamp;
}

// The draft ---------------------------------------------------------------------------------------

export type Draft = {
  key: string;
  title: string;
  body: string;
  /** The revision the edit started from; null for a new document. */
  baseRevisionId: string | null;
  isNew: boolean;
};

export function newDraft(seed: Partial<Pick<Draft, "key" | "title" | "body">> = {}): Draft {
  return { key: seed.key ?? "", title: seed.title ?? "", body: seed.body ?? "", baseRevisionId: null, isNew: true };
}

export function draftFrom(doc: Pick<IssueDocument, "key" | "title" | "body" | "latestRevisionId">): Draft {
  return { key: doc.key, title: doc.title ?? "", body: doc.body, baseRevisionId: doc.latestRevisionId, isNew: false };
}

/** True when the draft differs from the saved document. A new draft is dirty once it has any text. */
export function isDirty(draft: Draft, doc?: Pick<IssueDocument, "title" | "body"> | null) {
  if (draft.isNew || !doc) return Boolean(draft.key.trim() || draft.title.trim() || draft.body.trim());
  return draft.body !== doc.body || draft.title !== (doc.title ?? "");
}

/** Why the draft can't be saved yet, or null. */
export function draftProblem(draft: Draft, existingKeys: readonly string[] = []): string | null {
  if (draft.isNew) {
    if (!draft.key.trim()) return "Give the document a key.";
    const problem = keyProblem(draft.key, existingKeys);
    if (problem) return problem;
  }
  if (!draft.body.trim()) return "A document can't be empty.";
  return null;
}

/** The PUT body for a draft. `baseRevisionId` overrides the draft's own, to overwrite after a conflict. */
export function upsertPayload(draft: Draft, baseRevisionId = draft.baseRevisionId): UpsertIssueDocument {
  return {
    title: isPlanKey(draft.key) ? null : draft.title.trim() || null,
    format: "markdown",
    body: draft.body,
    baseRevisionId: draft.isNew ? null : baseRevisionId,
  };
}

// Saving ------------------------------------------------------------------------------------------

export type SaveFailure =
  | { kind: "locked"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "exists"; message: string }
  | { kind: "error"; message: string };

/**
 * What a failed save means for the editor: locked, changed by someone else, a new document whose
 * key was taken meanwhile, or something else.
 */
export function classifySaveError(error: unknown, isNew = false): SaveFailure {
  if (error instanceof ApiError && error.status === 409) {
    if (/locked/i.test(error.message)) {
      return { kind: "locked", message: "Someone locked this document. Unlock it to save your changes." };
    }
    if (isNew || /already exists/i.test(error.message)) {
      return { kind: "exists", message: "This task already has a document with that key." };
    }
    return { kind: "conflict", message: "This document changed while you were editing." };
  }
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}

// Revisions ---------------------------------------------------------------------------------------

export type RevisionState = {
  /** The newest revision: the document as it stands. */
  current: DocumentRevision;
  /** Every revision, newest first, with the current one always included. */
  revisions: DocumentRevision[];
};

function sortRevisions(revisions: readonly DocumentRevision[]) {
  return [...revisions].sort(
    (a, b) => b.revisionNumber - a.revisionNumber || time(b.createdAt) - time(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/** The document as a revision, for when its history hasn't loaded yet. */
export function currentSnapshot(doc: IssueDocument): DocumentRevision {
  return {
    id: doc.latestRevisionId ?? `${doc.id}-latest`,
    companyId: doc.companyId,
    documentId: doc.id,
    issueId: doc.issueId,
    key: doc.key,
    revisionNumber: doc.latestRevisionNumber,
    title: doc.title,
    format: doc.format,
    body: doc.body,
    changeSummary: null,
    createdByAgentId: doc.updatedByAgentId ?? doc.createdByAgentId,
    createdByUserId: doc.updatedByUserId ?? doc.createdByUserId,
    createdAt: doc.updatedAt,
  };
}

/**
 * The revision list for a document, as ui/src/lib/document-revisions.ts derives it: newest first,
 * deduplicated, with the document's own state standing in for the newest revision until the
 * history arrives. If the history is ahead of the cached document, the history wins.
 */
export function revisionState(doc: IssueDocument, revisions: readonly DocumentRevision[]): RevisionState {
  const sorted = sortRevisions(revisions);
  const newest = sorted[0];
  const stale = Boolean(newest && newest.revisionNumber > doc.latestRevisionNumber);
  const current = stale ? newest! : (sorted.find((revision) => revision.id === doc.latestRevisionId) ?? currentSnapshot(doc));
  const seen = new Set<string>();
  const all = sortRevisions([current, ...sorted]).filter((revision) => {
    if (seen.has(revision.id)) return false;
    seen.add(revision.id);
    return true;
  });
  return { current, revisions: all };
}

/** The revision being shown: an earlier one picked from history, or null for the current one. */
export function viewedRevision(state: RevisionState, selectedId: string | null): DocumentRevision | null {
  if (!selectedId || selectedId === state.current.id) return null;
  return state.revisions.find((revision) => revision.id === selectedId) ?? null;
}

// The lock ----------------------------------------------------------------------------------------

export type LockHolder = { kind: "agent"; id: string } | { kind: "user"; id: string } | { kind: "unknown" };

export type LockState =
  | { locked: false }
  | { locked: true; holder: LockHolder; heldByYou: boolean; since: Date | string };

export function lockState(
  doc: Pick<IssueDocumentSummary, "lockedAt" | "lockedByAgentId" | "lockedByUserId">,
  youId: string | null,
): LockState {
  if (!doc.lockedAt) return { locked: false };
  const holder: LockHolder = doc.lockedByAgentId
    ? { kind: "agent", id: doc.lockedByAgentId }
    : doc.lockedByUserId
      ? { kind: "user", id: doc.lockedByUserId }
      : { kind: "unknown" };
  return { locked: true, holder, heldByYou: holder.kind === "user" && holder.id === youId, since: doc.lockedAt };
}

/** "Locked by you", "Locked by Quant Researcher", "Locked". */
export function lockLabel(state: LockState, nameOf: (holder: LockHolder) => string | null) {
  if (!state.locked) return "Unlocked";
  if (state.heldByYou) return "Locked by you";
  const name = nameOf(state.holder);
  return name ? `Locked by ${name}` : "Locked";
}

export type EditBlock = "locked" | "history" | "phone" | null;

/**
 * Why the document can't be edited right now: it's locked (nobody can save until it's unlocked,
 * including whoever locked it), an earlier revision is showing, or the viewport is a phone, where
 * documents are read-only (mobile.md).
 */
export function editBlock(input: { lock: LockState; viewingHistory: boolean; phone: boolean }): EditBlock {
  if (input.phone) return "phone";
  if (input.lock.locked) return "locked";
  if (input.viewingHistory) return "history";
  return null;
}

// Diff --------------------------------------------------------------------------------------------

export type DiffRow = { kind: "same" | "removed" | "added"; oldLine: number | null; newLine: number | null; text: string };

/** A line diff (longest common subsequence), as ui/src/lib/line-diff.ts draws it. */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Long documents would make the table quadratic; past this size, show a plain replacement.
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text, index) => ({ kind: "removed" as const, oldLine: index + 1, newLine: null, text })),
      ...b.map((text, index) => ({ kind: "added" as const, oldLine: null, newLine: index + 1, text })),
    ];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", oldLine: i + 1, newLine: j + 1, text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      rows.push({ kind: "removed", oldLine: i + 1, newLine: null, text: a[i]! });
      i += 1;
    } else {
      rows.push({ kind: "added", oldLine: null, newLine: j + 1, text: b[j]! });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) rows.push({ kind: "removed", oldLine: i + 1, newLine: null, text: a[i]! });
  for (; j < b.length; j += 1) rows.push({ kind: "added", oldLine: null, newLine: j + 1, text: b[j]! });
  return rows;
}

export function diffCounts(rows: readonly DiffRow[]) {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === "added") added += 1;
    else if (row.kind === "removed") removed += 1;
  }
  return { added, removed };
}

// Writing Markdown -----------------------------------------------------------------------------------

export type ListContinuation = { kind: "continue"; insert: string } | { kind: "end" };

/**
 * What Enter does at the end of a list item: start the next item ("- ", "2. ", "- [ ] "), or end
 * the list when the item is still empty. Null when the line isn't a list item.
 */
export function listContinuation(line: string): ListContinuation | null {
  const match = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
  if (!match) return null;
  if (line.trimEnd().length <= match[0].trimEnd().length) return { kind: "end" };
  const [, indent, bullet, number, delimiter, gap, task] = match;
  const marker = bullet ?? `${Number(number) + 1}${delimiter}`;
  return { kind: "continue", insert: `\n${indent}${marker}${gap}${task ? "[ ] " : ""}` };
}
