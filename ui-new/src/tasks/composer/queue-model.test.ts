import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { moveEntry, preview, queueErrorMessage, queuedSummary, rowDelivery, visibleEntries } from "./queue-model";

const entry = (id: string, position: number, extra: Partial<IssueQueuedCommentEntry> = {}): IssueQueuedCommentEntry =>
  ({ comment: { id, body: `Message ${id}` }, position, canEdit: true, canDiscard: true, ...extra }) as IssueQueuedCommentEntry;

const queue = (extra: Partial<IssueQueuedCommentQueue> = {}): IssueQueuedCommentQueue => ({
  issueId: "i1",
  queueId: "q1",
  state: "queued",
  targetRunId: "r1",
  revision: "rev1",
  protocol: "paperclip_runner_v1",
  steeringDisposition: "available",
  entries: [entry("c2", 1), entry("c1", 0)],
  ...extra,
});

describe("rowDelivery", () => {
  it("steers into a native run, and interrupts a legacy one", () => {
    expect(rowDelivery(queue(), entry("c1", 0))).toMatchObject({ action: "steer", enabled: true });
    expect(rowDelivery(queue({ protocol: "legacy" }), entry("c1", 0))).toMatchObject({ action: "interrupt", enabled: true });
    const fresh = entry("c1", 0, { source: { kind: "interaction", interactionId: "x", interactionKind: "ask_user_questions", requiresFreshSession: true } });
    expect(rowDelivery(queue(), fresh)?.action).toBe("interrupt");
  });

  it("says why steering is off, and offers nothing without a run", () => {
    expect(rowDelivery(queue({ steeringDisposition: "unsupported" }), entry("c1", 0))).toMatchObject({ enabled: false, hint: expect.stringMatching(/can't take/) });
    expect(rowDelivery(queue({ targetRunId: null }), entry("c1", 0))).toBeNull();
    expect(rowDelivery(queue({ queueId: null }), entry("c1", 0))?.enabled).toBe(false);
  });
});

describe("visibleEntries and moveEntry", () => {
  it("orders by position and hides messages being delivered", () => {
    expect(visibleEntries(queue(), new Set()).map((item) => item.comment.id)).toEqual(["c1", "c2"]);
    expect(visibleEntries(queue(), new Set(["c1"])).map((item) => item.comment.id)).toEqual(["c2"]);
    expect(visibleEntries(null, new Set())).toEqual([]);
  });

  it("moves within bounds, and never around fixed answers", () => {
    const entries = [entry("a", 0), entry("b", 1), entry("c", 2)];
    expect(moveEntry(entries, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveEntry(entries, "c", 1)).toBeNull();
    const fixed = [entry("a", 0), entry("b", 1, { source: { kind: "interaction", interactionId: "x", interactionKind: "k" } })];
    expect(moveEntry(fixed, "a", 1)).toBeNull();
  });
});

describe("words", () => {
  it("summarises and previews", () => {
    expect(queuedSummary(1)).toBe("1 message queued");
    expect(queuedSummary(3)).toBe("3 messages queued");
    expect(preview("\n  First line\nsecond")).toBe("First line");
    expect(preview("x".repeat(200), 10)).toHaveLength(10);
  });

  it("explains failures", () => {
    expect(queueErrorMessage(new ApiError("x", 409, {}), "steer")).toMatch(/changed in another tab/);
    expect(queueErrorMessage(new ApiError("x", 422, { code: "queued_comment_already_dispatching" }), "discard")).toMatch(/Too late/);
    expect(queueErrorMessage(new Error("boom"), "interrupt")).toMatch(/still queued/);
  });
});
