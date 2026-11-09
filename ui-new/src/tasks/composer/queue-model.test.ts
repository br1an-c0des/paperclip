import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  AUTO_STEER_DELAY_MS,
  autoSteerDeadline,
  autoSteerEligible,
  autoSteerKey,
  deferredMessage,
  entryLabel,
  moveEntry,
  preview,
  queueErrorMessage,
  queuedSummary,
  rowDelivery,
  secondsLeft,
  visibleEntries,
} from "./queue-model";

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

  it("offers Interrupt where a native run can't take a message now, saying why (#19450)", () => {
    expect(rowDelivery(queue({ steeringDisposition: "unsupported" }), entry("c1", 0))).toMatchObject({
      action: "interrupt",
      enabled: true,
      hint: expect.stringMatching(/^This agent's runner can't take messages mid-run\. Stop the current run/),
    });
    expect(rowDelivery(queue({ steeringDisposition: "temporarily_unavailable" }), entry("c1", 0))).toMatchObject({
      action: "interrupt",
      enabled: true,
      hint: expect.stringMatching(/^Steering isn't available right now\./),
    });
    expect(rowDelivery(queue({ queueId: null }), entry("c1", 0))?.enabled).toBe(false);
  });

  it("offers Send for a queue waiting on a run that hasn't started, and nothing else without a run (#19370)", () => {
    expect(rowDelivery(queue({ targetRunId: null, state: "deferred" }), entry("c1", 0))).toMatchObject({ action: "send", enabled: true });
    expect(rowDelivery(queue({ targetRunId: null, state: "deferred", queueId: null }), entry("c1", 0))?.enabled).toBe(false);
    expect(rowDelivery(queue({ targetRunId: null }), entry("c1", 0))).toBeNull();
    expect(rowDelivery(queue({ targetRunId: null, state: null }), entry("c1", 0))).toBeNull();
  });

  it("says a kept Send is still queued, in the queue's words when it has them", () => {
    expect(deferredMessage({ executionWait: null })).toBe("Messages are still queued. They'll send when the task is ready.");
    expect(deferredMessage({ executionWait: { reason: "workspace_busy", message: "Waiting for the workspace." } })).toBe("Waiting for the workspace.");
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

describe("entryLabel", () => {
  const receipt = (summary?: string) =>
    entry("r1", 0, {
      canEdit: false,
      comment: { id: "r1", body: `Rejected: Connect Slack\n\n${JSON.stringify({ interactionId: "slack-1", kind: "connection_intent" }, null, 2)}` } as IssueQueuedCommentEntry["comment"],
      source: { kind: "interaction", interactionId: "slack-1", interactionKind: "connection_intent", ...(summary === undefined ? {} : { summary }) },
    });

  it("shows a fixed answer by its receipt's summary, never its JSON", () => {
    expect(entryLabel(receipt("Declined: Slack connection"))).toBe("Declined: Slack connection");
    expect(entryLabel(receipt())).toBe("Rejected: Connect Slack");
    expect(entryLabel(receipt("  "))).toBe("Rejected: Connect Slack");
    expect(entryLabel(receipt())).not.toContain("{");
  });

  it("shows a message by its first line", () => {
    expect(entryLabel(entry("c1", 0, { comment: { id: "c1", body: "\nFirst\nsecond" } as IssueQueuedCommentEntry["comment"] }))).toBe("First");
  });

  it("keeps the user's own messages next to a receipt, and movable once it's gone", () => {
    const own = [entry("a", 0), entry("b", 1)];
    expect(visibleEntries(queue({ entries: [receipt("Declined: Slack connection"), ...own] }), new Set()).map((item) => item.comment.id)).toEqual(["r1", "a", "b"]);
    expect(moveEntry([receipt(), ...own], "a", 1)).toBeNull();
    expect(moveEntry(own, "a", 1)).toEqual(["b", "a"]);
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

describe("automatic steering (U84, #19970)", () => {
  const at = "2026-11-09T12:00:00.000Z";
  const mine = (extra: Partial<IssueQueuedCommentEntry> = {}) =>
    entry("c1", 0, { comment: { id: "c1", body: "Also check the tests", createdAt: at, updatedAt: at } as unknown as IssueQueuedCommentEntry["comment"], ...extra });
  const eligible = (current: IssueQueuedCommentQueue, item: IssueQueuedCommentEntry, extra: { cancelled?: string[]; attempted?: string[]; editingId?: string | null } = {}) =>
    autoSteerEligible({ queue: current, entry: item, cancelledIds: new Set(extra.cancelled), attemptedKeys: new Set(extra.attempted), editingId: extra.editingId ?? null });

  it("offers your own plain follow-up while a native runner can take it", () => {
    expect(eligible(queue(), mine())).toBe(true);
  });

  it("needs steering available on paperclip_runner_v1, with a queue and a run", () => {
    expect(eligible(queue({ steeringDisposition: "temporarily_unavailable" }), mine())).toBe(false);
    expect(eligible(queue({ steeringDisposition: "unsupported" }), mine())).toBe(false);
    expect(eligible(queue({ protocol: "legacy" }), mine())).toBe(false);
    expect(eligible(queue({ queueId: null }), mine())).toBe(false);
    expect(eligible(queue({ targetRunId: null }), mine())).toBe(false);
  });

  it("never sends someone else's message, a request-card answer, a fresh-session entry or an unsaved one", () => {
    expect(eligible(queue(), mine({ canEdit: false }))).toBe(false);
    expect(eligible(queue(), mine({ source: { kind: "interaction", interactionId: "x", interactionKind: "ask_user_questions" } }))).toBe(false);
    expect(eligible(queue(), mine({ source: { requiresFreshSession: true } as never }))).toBe(false);
    const optimistic = mine();
    optimistic.comment = { ...optimistic.comment, id: "optimistic-1" };
    expect(eligible(queue(), optimistic)).toBe(false);
  });

  it("waits while it's being edited, and stops once cancelled", () => {
    expect(eligible(queue(), mine(), { editingId: "c1" })).toBe(false);
    expect(eligible(queue(), mine(), { editingId: "c2" })).toBe(true);
    expect(eligible(queue(), mine(), { cancelled: ["c1"] })).toBe(false);
  });

  it("tries each revision once: a saved edit is a new revision", () => {
    const first = mine();
    expect(eligible(queue(), first, { attempted: [autoSteerKey(first)] })).toBe(false);
    const edited = mine();
    edited.comment = { ...edited.comment, updatedAt: "2026-11-09T12:00:09.000Z" as never };
    expect(autoSteerKey(edited)).not.toBe(autoSteerKey(first));
    expect(eligible(queue(), edited, { attempted: [autoSteerKey(first)] })).toBe(true);
  });

  it("counts down five seconds from the last change, but never less than five from when it was offered", () => {
    const changed = Date.parse(at);
    expect(AUTO_STEER_DELAY_MS).toBe(5_000);
    expect(autoSteerDeadline(mine(), changed - 60_000)).toBe(changed + 5_000);
    // A message that waited while steering was unavailable still gets its whole countdown.
    expect(autoSteerDeadline(mine(), changed + 30_000)).toBe(changed + 35_000);
    const undated = mine();
    undated.comment = { ...undated.comment, createdAt: undefined as never, updatedAt: undefined as never };
    expect(autoSteerDeadline(undated, 1_000, 2_000)).toBe(3_000);
  });

  it("shows whole seconds left, never below zero", () => {
    expect(secondsLeft(10_000, 5_000)).toBe(5);
    expect(secondsLeft(10_000, 7_100)).toBe(3);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });
});
