import type { DocumentRevision, IssueDocument } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  classifySaveError,
  diffCounts,
  documentName,
  draftFrom,
  draftProblem,
  editBlock,
  isDirty,
  isMarkdownFile,
  keyProblem,
  lineDiff,
  listContinuation,
  lockLabel,
  lockState,
  newDraft,
  revisionState,
  slugifyKey,
  sortDocuments,
  titleFromFilename,
  upsertPayload,
  viewedRevision,
} from "./document-model";

function doc(overrides: Partial<IssueDocument> = {}): IssueDocument {
  return {
    id: "d1",
    companyId: "c1",
    issueId: "i1",
    key: "notes",
    title: "Notes",
    format: "markdown",
    body: "Hello",
    latestRevisionId: "r3",
    latestRevisionNumber: 3,
    createdByAgentId: null,
    createdByUserId: "u1",
    updatedByAgentId: "a1",
    updatedByUserId: null,
    lockedAt: null,
    lockedByAgentId: null,
    lockedByUserId: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-02T10:00:00Z"),
    ...overrides,
  };
}

function revision(id: string, number: number, body = `body ${number}`): DocumentRevision {
  return {
    id,
    companyId: "c1",
    documentId: "d1",
    issueId: "i1",
    key: "notes",
    revisionNumber: number,
    title: "Notes",
    format: "markdown",
    body,
    changeSummary: null,
    createdByAgentId: null,
    createdByUserId: "u1",
    createdAt: new Date(`2026-10-0${number}T10:00:00Z`),
  };
}

describe("keys and names", () => {
  it("checks keys against the server's rule and the task's other documents", () => {
    expect(keyProblem("")).toBeNull();
    expect(keyProblem("data-notes_2")).toBeNull();
    expect(keyProblem("Data")).toMatch(/lowercase/);
    expect(keyProblem("-lead")).toMatch(/starting/);
    expect(keyProblem("x".repeat(65))).toMatch(/64/);
    expect(keyProblem("plan", ["plan", "notes"])).toMatch(/already/);
  });

  it("turns file names into keys and titles", () => {
    expect(slugifyKey("Data notes.md")).toBe("data-notes");
    expect(slugifyKey("  ***  ")).toBe("document");
    expect(slugifyKey("a".repeat(70))).toHaveLength(64);
    expect(titleFromFilename("data_notes-v2.md")).toBe("Data notes v2");
    expect(isMarkdownFile({ name: "README.MD", type: "" })).toBe(true);
    expect(isMarkdownFile({ name: "x.txt", type: "text/plain" })).toBe(false);
  });

  it("names the plan Plan, and others by title, then key", () => {
    expect(documentName({ key: "plan", title: "Ignored" })).toBe("Plan");
    expect(documentName({ key: "notes", title: " " })).toBe("notes");
    expect(documentName({ key: "notes", title: "Data notes" })).toBe("Data notes");
  });

  it("puts the plan first, then the most recently updated", () => {
    const sorted = sortDocuments([
      { key: "old", updatedAt: new Date("2026-01-01") },
      { key: "new", updatedAt: new Date("2026-03-01") },
      { key: "plan", updatedAt: new Date("2025-01-01") },
    ]);
    expect(sorted.map((entry) => entry.key)).toEqual(["plan", "new", "old"]);
  });
});

describe("drafts", () => {
  it("is dirty once it differs from the saved document", () => {
    const saved = doc();
    const draft = draftFrom(saved);
    expect(draft).toMatchObject({ key: "notes", title: "Notes", baseRevisionId: "r3", isNew: false });
    expect(isDirty(draft, saved)).toBe(false);
    expect(isDirty({ ...draft, body: "Hello!" }, saved)).toBe(true);
    expect(isDirty({ ...draft, title: "Other" }, saved)).toBe(true);
    expect(isDirty(newDraft(), null)).toBe(false);
    expect(isDirty(newDraft({ key: "x" }), null)).toBe(true);
  });

  it("explains what stops a save", () => {
    expect(draftProblem(newDraft({ body: "x" }))).toMatch(/key/);
    expect(draftProblem(newDraft({ key: "Bad", body: "x" }))).toMatch(/lowercase/);
    expect(draftProblem(newDraft({ key: "notes", body: "x" }), ["notes"])).toMatch(/already/);
    expect(draftProblem(newDraft({ key: "notes", body: "  " }))).toMatch(/empty/);
    expect(draftProblem({ ...draftFrom(doc()), body: "fine" })).toBeNull();
  });

  it("builds the PUT body, with no title for the plan and no base for a new document", () => {
    expect(upsertPayload({ ...draftFrom(doc()), title: "  " })).toEqual({ title: null, format: "markdown", body: "Hello", baseRevisionId: "r3" });
    expect(upsertPayload(draftFrom(doc()), "r9").baseRevisionId).toBe("r9");
    expect(upsertPayload(newDraft({ key: "plan", title: "Plan", body: "x" }))).toEqual({
      title: null,
      format: "markdown",
      body: "x",
      baseRevisionId: null,
    });
  });

  it("classifies failed saves", () => {
    expect(classifySaveError(new ApiError("Document is locked", 409, null)).kind).toBe("locked");
    expect(classifySaveError(new ApiError("Document was updated by someone else", 409, null)).kind).toBe("conflict");
    expect(classifySaveError(new ApiError("Document update requires baseRevisionId", 409, null), true).kind).toBe("exists");
    expect(classifySaveError(new ApiError("Document key already exists on this issue", 409, null)).kind).toBe("exists");
    expect(classifySaveError(new ApiError("Nope", 500, null))).toEqual({ kind: "error", message: "Nope" });
  });
});

describe("revisions", () => {
  it("stands the document in for its newest revision until history loads", () => {
    const state = revisionState(doc(), []);
    expect(state.current).toMatchObject({ id: "r3", revisionNumber: 3, body: "Hello", createdByAgentId: "a1" });
    expect(state.revisions).toHaveLength(1);
  });

  it("lists history newest first without duplicates", () => {
    const state = revisionState(doc(), [revision("r1", 1), revision("r3", 3), revision("r2", 2)]);
    expect(state.revisions.map((entry) => entry.id)).toEqual(["r3", "r2", "r1"]);
    expect(state.current.body).toBe("body 3");
  });

  it("trusts history that is ahead of a stale document", () => {
    const state = revisionState(doc(), [revision("r4", 4), revision("r3", 3)]);
    expect(state.current.id).toBe("r4");
  });

  it("shows an earlier revision only when one is picked", () => {
    const state = revisionState(doc(), [revision("r1", 1), revision("r3", 3)]);
    expect(viewedRevision(state, null)).toBeNull();
    expect(viewedRevision(state, "r3")).toBeNull();
    expect(viewedRevision(state, "r1")?.revisionNumber).toBe(1);
    expect(viewedRevision(state, "missing")).toBeNull();
  });
});

describe("locks", () => {
  it("knows who holds the lock", () => {
    expect(lockState(doc(), "u1")).toEqual({ locked: false });
    const mine = lockState(doc({ lockedAt: new Date(), lockedByUserId: "u1" }), "u1");
    expect(mine).toMatchObject({ locked: true, heldByYou: true, holder: { kind: "user", id: "u1" } });
    const agent = lockState(doc({ lockedAt: new Date(), lockedByAgentId: "a1" }), "u1");
    expect(agent).toMatchObject({ locked: true, heldByYou: false, holder: { kind: "agent", id: "a1" } });
    expect(lockState(doc({ lockedAt: new Date() }), "u1")).toMatchObject({ holder: { kind: "unknown" } });
  });

  it("labels the lock", () => {
    const name = () => "Quant Researcher";
    expect(lockLabel({ locked: false }, name)).toBe("Unlocked");
    expect(lockLabel(lockState(doc({ lockedAt: new Date(), lockedByUserId: "u1" }), "u1"), name)).toBe("Locked by you");
    expect(lockLabel(lockState(doc({ lockedAt: new Date(), lockedByAgentId: "a1" }), "u1"), name)).toBe("Locked by Quant Researcher");
    expect(lockLabel(lockState(doc({ lockedAt: new Date() }), "u1"), () => null)).toBe("Locked");
  });

  it("blocks editing while locked, on an earlier revision, or on a phone", () => {
    const locked = lockState(doc({ lockedAt: new Date(), lockedByUserId: "u1" }), "u1");
    expect(editBlock({ lock: { locked: false }, viewingHistory: false, phone: false })).toBeNull();
    expect(editBlock({ lock: locked, viewingHistory: false, phone: false })).toBe("locked");
    expect(editBlock({ lock: { locked: false }, viewingHistory: true, phone: false })).toBe("history");
    expect(editBlock({ lock: locked, viewingHistory: true, phone: true })).toBe("phone");
  });
});

describe("line diff", () => {
  it("marks added, removed and unchanged lines", () => {
    const rows = lineDiff("a\nb\nc", "a\nc\nd");
    expect(rows.map((row) => `${row.kind}:${row.text}`)).toEqual(["same:a", "removed:b", "same:c", "added:d"]);
    expect(rows[3]).toMatchObject({ oldLine: null, newLine: 3 });
    expect(diffCounts(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("treats identical text as unchanged", () => {
    expect(diffCounts(lineDiff("same\ntext", "same\ntext"))).toEqual({ added: 0, removed: 0 });
  });
});

describe("list continuation", () => {
  it("continues bullets, numbers and task items", () => {
    expect(listContinuation("- one")).toEqual({ kind: "continue", insert: "\n- " });
    expect(listContinuation("  * nested")).toEqual({ kind: "continue", insert: "\n  * " });
    expect(listContinuation("9. nine")).toEqual({ kind: "continue", insert: "\n10. " });
    expect(listContinuation("1) one")).toEqual({ kind: "continue", insert: "\n2) " });
    expect(listContinuation("- [x] done")).toEqual({ kind: "continue", insert: "\n- [ ] " });
  });

  it("ends the list on an empty item, and ignores other lines", () => {
    expect(listContinuation("- ")).toEqual({ kind: "end" });
    expect(listContinuation("- [ ] ")).toEqual({ kind: "end" });
    expect(listContinuation("Plain text")).toBeNull();
    expect(listContinuation("-not a list")).toBeNull();
  });
});
