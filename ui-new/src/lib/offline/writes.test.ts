import { describe, expect, it, vi } from "vitest";
import { write } from "@/test/offline";
import { UncertainWriteError } from "./errors";
import { performWrite, type Transport } from "./writes";
import type { QueuedWrite } from "./write-queue";

const ISSUE = "11111111-1111-4111-8111-111111111111";
const COMMENT = { id: "22222222-2222-4222-8222-222222222222", issueId: ISSUE, body: "hi", clientRequestId: "c-1" };

class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown = null,
  ) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `Request failed: ${status}`);
  }
}

function transport(overrides: Partial<Transport> = {}) {
  return {
    send: vi.fn<Transport["send"]>(overrides.send ?? (async () => COMMENT)),
    get: vi.fn<Transport["get"]>(overrides.get ?? (async () => [])),
  };
}

const commentInPatch = (fields: Partial<QueuedWrite> = {}) =>
  write({
    request: { method: "PATCH", path: `/issues/${ISSUE}`, body: { comment: "hi", assigneeAgentId: "a1", clientRequestId: "c-1" } },
    recovery: { kind: "comment", issueId: ISSUE, clientRequestId: "c-1" },
    ...fields,
  });

const documentSave = (fields: Partial<QueuedWrite> = {}) =>
  write({
    kind: "document",
    request: { method: "PUT", path: "/issues/i1/documents/plan", body: { body: "new text", title: "Plan", baseRevisionId: "rev-1" } },
    recovery: { kind: "document", path: "/issues/i1/documents/plan" },
    ...fields,
  });

const answer = (fields: Partial<QueuedWrite> = {}) =>
  write({
    kind: "answer",
    request: { method: "POST", path: `/issues/${ISSUE}/interactions/int-1/accept`, body: {} },
    recovery: { kind: "answer", issueId: ISSUE, interactionId: "int-1", match: { action: "accept" } },
    ...fields,
  });

describe("performWrite", () => {
  it("sends the setup steps, then the write with its key, and lands on a receipt", async () => {
    const net = transport();
    const row = write({ before: [{ method: "PATCH", path: `/issues/${ISSUE}`, body: { workMode: "plan" } }] });
    expect(await performWrite(row, net)).toEqual({ kind: "done", result: COMMENT });
    expect(net.send.mock.calls.map(([request]) => request.method)).toEqual(["PATCH", "POST"]);
    expect(net.send.mock.calls[1]![0].body).toMatchObject({ clientRequestId: row.request.body.clientRequestId });
  });

  it("keeps a write whose answer doesn't look like a receipt, or that hit an outage", async () => {
    expect((await performWrite(write(), transport({ send: async () => "<html>" }))).kind).toBe("pending");
    expect((await performWrite(write(), transport({ send: async () => Promise.reject(new HttpError(502)) }))).kind).toBe("pending");
    expect((await performWrite(write(), transport({ send: async () => Promise.reject(new TypeError("Failed to fetch")) }))).kind).toBe("pending");
    expect((await performWrite(write(), transport({ send: async () => Promise.reject(new UncertainWriteError()) }))).kind).toBe("pending");
  });

  it("fails a write the server refuses, with its reason", async () => {
    const outcome = await performWrite(write(), transport({ send: async () => Promise.reject(new HttpError(422, { error: "Comments are closed" })) }));
    expect(outcome).toEqual({ kind: "failed", message: "Comments are closed", settled: false });
  });

  it("resends an unknown write with the same key", async () => {
    const net = transport();
    const row = write({ uncertain: true });
    expect((await performWrite(row, net)).kind).toBe("done");
    expect(net.get).not.toHaveBeenCalled();
    expect(net.send.mock.calls[0]![0]).toEqual(row.request);
  });

  describe("a comment inside PATCH /issues/:id", () => {
    it("finds it by its client request id instead of sending it again", async () => {
      const net = transport({ get: vi.fn(async () => [{ ...COMMENT, clientRequestId: "other" }, COMMENT]) });
      expect(await performWrite(commentInPatch({ uncertain: true }), net)).toEqual({ kind: "done", result: { comment: COMMENT } });
      expect(net.get).toHaveBeenCalledWith(`/issues/${ISSUE}/comments?order=desc&limit=100`);
      expect(net.send).not.toHaveBeenCalled();
    });

    it("sends it again when it isn't there, and needs a comment in the answer", async () => {
      const net = transport({ send: vi.fn(async () => ({ id: ISSUE, comment: COMMENT })) });
      expect((await performWrite(commentInPatch({ uncertain: true }), net)).kind).toBe("done");
      expect(net.send).toHaveBeenCalledTimes(1);
      expect((await performWrite(commentInPatch(), transport({ send: async () => ({ id: ISSUE }) }))).kind).toBe("pending");
    });

    it("stays unknown while the thread can't be read", async () => {
      const net = transport({ get: async () => Promise.reject(new HttpError(503)) });
      expect((await performWrite(commentInPatch({ uncertain: true }), net)).kind).toBe("pending");
      expect(net.send).not.toHaveBeenCalled();
    });
  });

  describe("a document save", () => {
    it("is done when reading it back shows the same text", async () => {
      const saved = { body: "new text", title: "Plan", latestRevisionId: "rev-2" };
      const net = transport({ get: vi.fn(async () => saved) });
      expect(await performWrite(documentSave({ uncertain: true }), net)).toEqual({ kind: "done", result: saved });
      expect(net.send).not.toHaveBeenCalled();
    });

    it("is sent again when the read-back differs, or the document doesn't exist yet", async () => {
      const differs = transport({ get: async () => ({ body: "old text" }), send: vi.fn(async () => ({ body: "new text" })) });
      expect((await performWrite(documentSave({ uncertain: true }), differs)).kind).toBe("done");
      expect(differs.send).toHaveBeenCalledTimes(1);
      const missing = transport({ get: async () => Promise.reject(new HttpError(404)), send: vi.fn(async () => ({ body: "new text" })) });
      expect((await performWrite(documentSave({ uncertain: true }), missing)).kind).toBe("done");
    });

    it("turns a conflict into done when the text is already saved, and fails for good otherwise", async () => {
      const conflict = async () => Promise.reject(new HttpError(409, { error: "revision_conflict" }));
      expect((await performWrite(documentSave(), transport({ send: conflict, get: async () => ({ body: "new text", title: "Plan" }) }))).kind).toBe("done");
      expect(await performWrite(documentSave(), transport({ send: conflict, get: async () => ({ body: "their text" }) }))).toEqual({
        kind: "failed",
        message: "Someone saved this document after your edit started.",
        settled: true,
      });
    });
  });

  describe("a request answer", () => {
    it("re-reads the requests: open sends it, the same answer is done", async () => {
      const open = transport({ get: async () => [{ id: "int-1", kind: "request_confirmation", status: "pending" }], send: vi.fn(async () => ({ id: "int-1" })) });
      expect((await performWrite(answer({ uncertain: true }), open)).kind).toBe("done");
      expect(open.send).toHaveBeenCalledTimes(1);

      const landed = { id: "int-1", kind: "request_confirmation", status: "accepted" };
      const done = transport({ get: vi.fn(async () => [landed]) });
      expect(await performWrite(answer({ uncertain: true }), done)).toEqual({ kind: "done", result: landed });
      expect(done.send).not.toHaveBeenCalled();
    });

    it("fails for good when someone else answered, or the request is gone", async () => {
      const other = transport({ get: async () => [{ id: "int-1", kind: "request_confirmation", status: "rejected", result: { reason: null } }] });
      expect(await performWrite(answer({ uncertain: true }), other)).toMatchObject({ kind: "failed", settled: true, message: "Someone else answered this request first." });
      expect(await performWrite(answer({ uncertain: true }), transport())).toMatchObject({ kind: "failed", settled: true });
    });

    it("reads an already-resolved refusal back: its own answer is done", async () => {
      const net = transport({
        send: async () => Promise.reject(new HttpError(409, { error: "interaction_already_resolved" })),
        get: async () => [{ id: "int-1", kind: "request_confirmation", status: "accepted" }],
      });
      expect((await performWrite(answer(), net)).kind).toBe("done");
    });
  });

  it("fails a decision that was already decided or expired, for good", async () => {
    const decision = write({ kind: "decision", request: { method: "POST", path: "/decisions/d1/resolve", body: { idempotencyKey: "k" } } });
    const refused = (code: string) => transport({ send: async () => Promise.reject(new HttpError(409, { error: code })) });
    expect(await performWrite(decision, refused("decision_already_resolved"))).toMatchObject({ kind: "failed", settled: true, message: "This proposal was already decided." });
    expect(await performWrite(decision, refused("decision_expired"))).toMatchObject({ kind: "failed", settled: true, message: "This proposal expired." });
  });
});
