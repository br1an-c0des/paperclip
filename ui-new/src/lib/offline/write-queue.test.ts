import { describe, expect, it } from "vitest";
import { memoryStorage, write } from "@/test/offline";
import { addWrite, answerMatches, nextWrite, readWrites, rebaseDocumentSaves, removeWrite, updateWrite, writesKey, type QueuedWrite } from "./write-queue";

function docSave(fields: Partial<QueuedWrite> & { body: string; baseRevisionId: string | null }): QueuedWrite {
  const { body, baseRevisionId, ...rest } = fields;
  return write({
    kind: "document",
    target: "document:/issues/i1/documents/plan",
    request: { method: "PUT", path: "/issues/i1/documents/plan", body: { body, baseRevisionId, format: "markdown" } },
    recovery: { kind: "document", path: "/issues/i1/documents/plan" },
    ...rest,
  });
}

describe("write storage", () => {
  it("keeps writes per user and company, oldest first", () => {
    const storage = memoryStorage();
    const later = write({ createdAt: 20 });
    const earlier = write({ companyId: "company-2", createdAt: 10 });
    const someoneElse = write({ userId: "user-2", createdAt: 5 });
    for (const row of [later, earlier, someoneElse]) expect(addWrite(storage, row).stored).toBe(true);

    expect(readWrites(storage, "user-1").map((row) => row.id)).toEqual([earlier.id, later.id]);
    expect(readWrites(storage, "user-2").map((row) => row.id)).toEqual([someoneElse.id]);
    expect(storage.data.has(writesKey("user-1", "company-1"))).toBe(true);
    expect(storage.data.has(writesKey("user-1", "company-2"))).toBe(true);
  });

  it("ignores records filed under the wrong user or company, and unreadable ones", () => {
    const storage = memoryStorage();
    storage.setItem(writesKey("user-1", "company-1"), JSON.stringify([write({ userId: "user-2" }), { id: "junk" }]));
    storage.setItem(writesKey("user-1", "company-2"), "{not json");
    expect(readWrites(storage, "user-1")).toEqual([]);
  });

  it("reports storage that refuses a write, so the caller keeps it in memory", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    expect(addWrite(storage, write()).stored).toBe(false);
  });

  it("updates and removes a write, and drops the key once it's empty", () => {
    const storage = memoryStorage();
    const row = addWrite(storage, write()).write;
    expect(updateWrite(storage, { ...row, status: "failed", error: "no" })).toBe(true);
    expect(readWrites(storage, "user-1")[0]).toMatchObject({ status: "failed", error: "no" });
    expect(updateWrite(storage, { ...row, id: "missing" })).toBe(false);
    removeWrite(storage, row);
    expect(storage.data.size).toBe(0);
  });
});

describe("document saves", () => {
  it("fold into the save already waiting, keeping its revision, key and place in line", () => {
    const storage = memoryStorage();
    const first = addWrite(storage, docSave({ body: "one", baseRevisionId: "rev-1" })).write;
    const comment = addWrite(storage, write()).write;
    const second = addWrite(storage, docSave({ body: "two", baseRevisionId: "rev-9" })).write;

    expect(second.id).toBe(first.id);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    const rows = readWrites(storage, "user-1");
    expect(rows.map((row) => row.id)).toEqual([first.id, comment.id]);
    expect(rows[0]!.request.body).toMatchObject({ body: "two", baseRevisionId: "rev-1" });
  });

  it("don't fold into a save that's on its way; later ones move to the revision it made", () => {
    const storage = memoryStorage();
    const first = addWrite(storage, docSave({ body: "one", baseRevisionId: "rev-1", status: "sending" })).write;
    const second = addWrite(storage, docSave({ body: "two", baseRevisionId: "rev-1" })).write;
    expect(second.id).not.toBe(first.id);

    rebaseDocumentSaves(storage, first, "rev-2");
    const rows = readWrites(storage, "user-1");
    expect(rows.find((row) => row.id === first.id)!.request.body.baseRevisionId).toBe("rev-1");
    expect(rows.find((row) => row.id === second.id)!.request.body.baseRevisionId).toBe("rev-2");
  });
});

describe("nextWrite", () => {
  it("is the oldest waiting write, skipping failed and in-flight ones", () => {
    const a = write({ status: "failed" });
    const b = write();
    const c = write();
    expect(nextWrite([a, b, c], new Set())?.id).toBe(b.id);
    expect(nextWrite([a, b, c], new Set([b.id]))?.id).toBe(c.id);
    expect(nextWrite([a], new Set())).toBeNull();
  });

  it("treats a write left sending by a page that's gone as unknown", () => {
    const stale = write({ status: "sending" });
    expect(nextWrite([stale], new Set())).toMatchObject({ id: stale.id, status: "queued", uncertain: true });
  });
});

describe("answerMatches", () => {
  it("matches an accept of a confirmation, and of picked suggested tasks", () => {
    expect(answerMatches({ kind: "request_confirmation", status: "accepted" }, { action: "accept" })).toBe(true);
    const suggested = { kind: "suggest_tasks", status: "accepted", payload: { tasks: [{ clientKey: "a" }, { clientKey: "b" }] }, result: { skippedClientKeys: ["b"] } };
    expect(answerMatches(suggested, { action: "accept", selectedClientKeys: ["a"] })).toBe(true);
    expect(answerMatches(suggested, { action: "accept" })).toBe(false);
  });

  it("matches a reject by its reason, and answers by question", () => {
    expect(answerMatches({ kind: "request_confirmation", status: "rejected", result: { reason: " too soon " } }, { action: "reject", reason: "too soon" })).toBe(true);
    expect(answerMatches({ kind: "request_confirmation", status: "rejected", result: { reason: "other" } }, { action: "reject", reason: "too soon" })).toBe(false);
    const answered = { kind: "ask_user_questions", status: "answered", result: { answers: [{ questionId: "q1", optionIds: ["x", "y"] }] } };
    expect(answerMatches(answered, { action: "respond", answers: [{ questionId: "q1", optionIds: ["y", "x"] }] })).toBe(true);
    expect(answerMatches(answered, { action: "respond", answers: [{ questionId: "q1", optionIds: ["x"] }] })).toBe(false);
    expect(answerMatches({ kind: "request_confirmation", status: "pending" }, { action: "accept" })).toBe(false);
  });
});
