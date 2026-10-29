import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { boardSendKey, parseRetainedSend, readRejection } from "./board-send";
import { resizedEnough } from "./integrations-model";

const kept = {
  body: "Shipping today",
  attachmentIds: ["a1"],
  attachmentNames: [{ id: "a1", name: "plan.pdf" }],
  idempotencyKey: "11111111-2222-4333-8444-555555555555",
  publication: null,
};

describe("a kept board send", () => {
  it("is keyed by company, task, endpoint and conversation", () => {
    expect(boardSendKey("c", "t", "e", "v")).toBe('ui-new:board-send:v1:["c","t","e","v"]');
  });

  it("reads back what was kept, and refuses anything it can't trust", () => {
    expect(parseRetainedSend(null)).toBeNull();
    expect(parseRetainedSend(JSON.stringify(kept))).toEqual(kept);
    expect(parseRetainedSend(JSON.stringify({ ...kept, publication: { id: "p1", state: "pending", attempts: 0 } }))?.publication?.id).toBe("p1");
    expect(() => parseRetainedSend(JSON.stringify({ ...kept, idempotencyKey: "short" }))).toThrow();
    expect(() => parseRetainedSend(JSON.stringify({ ...kept, publication: { id: "p1", state: "lost", attempts: 0 } }))).toThrow();
    expect(() => parseRetainedSend("{")).toThrow();
  });

  it("treats only this send's own 409 about bound files as a refusal", () => {
    const request = { endpointId: "e1", conversationId: "v1", idempotencyKey: kept.idempotencyKey, attachmentIds: ["a1"] };
    const details = { code: "chat_board_send_attachments_already_bound", attachmentIds: ["a1"], endpointId: "e1", conversationId: "v1", idempotencyKey: kept.idempotencyKey };
    expect(readRejection(new ApiError("Conflict", 409, { details }), request)).toEqual({ code: details.code, attachmentIds: ["a1"] });
    expect(readRejection(new ApiError("Conflict", 409, { details: { ...details, idempotencyKey: "other" } }), request)).toBeNull();
    expect(readRejection(new ApiError("Server", 500, { details }), request)).toBeNull();
    expect(readRejection(new Error("offline"), request)).toBeNull();
  });
});

describe("Fit follows the pane", () => {
  it("only once it changes by two pixels or more", () => {
    expect(resizedEnough(null, { width: 10, height: 10 })).toBe(true);
    expect(resizedEnough({ width: 10, height: 10 }, { width: 11, height: 10 })).toBe(false);
    expect(resizedEnough({ width: 10, height: 10 }, { width: 10, height: 12 })).toBe(true);
  });
});
