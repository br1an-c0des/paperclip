import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  AUTO_STEER_DELAY_MS,
  autoSteerDeadline,
  autoSteerEligible,
  autoSteerKey,
  canCancel,
  deferredMessage,
  discardLabel,
  entryLabel,
  firstTurnIds,
  fullOrder,
  moveEntry,
  preview,
  queueErrorMessage,
  queuedBody,
  queuedImages,
  queuedPlain,
  queuedSummary,
  rowDelivery,
  secondsLeft,
  targetGone,
  visibleEntries,
  withoutImageLines,
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
    // No queue id: a chat message held in the outbox (U101), which has nothing to send.
    expect(rowDelivery(queue({ targetRunId: null, state: "deferred", queueId: null }), entry("c1", 0))).toBeNull();
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

  it("leaves out messages a starting run's first turn takes, and keeps their place in a reorder (U127, #20822)", () => {
    const all = [entry("boot", 0), entry("a", 1), entry("b", 2)];
    const booting = queue({ state: "deferred", entries: all, firstTurnCommentIds: ["boot"] });
    expect([...firstTurnIds(booting)]).toEqual(["boot"]);
    const shown = visibleEntries(booting, new Set());
    expect(shown.map((item) => item.comment.id)).toEqual(["a", "b"]);
    expect(moveEntry(shown, "b", -1, booting.entries)).toEqual(["boot", "b", "a"]);
    // Without a run to take them, the ids mean nothing.
    expect(firstTurnIds(queue({ targetRunId: null, firstTurnCommentIds: ["c1"] })).size).toBe(0);
    expect(firstTurnIds(null).size).toBe(0);
  });

  it("keeps messages the strip hides in their place in the whole order", () => {
    const all = [entry("a", 0), entry("x", 1), entry("b", 2), entry("c", 3)];
    expect(fullOrder(all, ["c", "a", "b"])).toEqual(["c", "x", "a", "b"]);
  });
});

describe("canCancel (U117, #20553)", () => {
  it("lets you cancel your own saved message, never one the outbox holds or one not yet saved", () => {
    expect(canCancel(entry("c1", 0))).toBe(true);
    expect(canCancel(entry("c1", 0, { canDiscard: false }))).toBe(false);
    expect(canCancel(entry("optimistic-1", 0))).toBe(false);
  });
});

describe("discardLabel (U162, #21458)", () => {
  it("cancels your own message and discards an agent's", () => {
    expect(discardLabel(entry("c1", 0))).toBe("Cancel message");
    expect(discardLabel(entry("c1", 0, { comment: { id: "c1", body: "x", authorAgentId: "agent-1" } as IssueQueuedCommentEntry["comment"] }))).toBe("Discard message");
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

  it("says why an edit wasn't saved (U118, #20583)", () => {
    for (const code of ["queued_comment_revision_conflict", "queued_comment_stale_queue"]) {
      expect(queueErrorMessage(new ApiError("x", 409, { details: { code } }), "edit")).toMatch(/save again to apply it to the latest queue/);
    }
    for (const code of ["queued_comment_stale_target", "queued_comment_not_pending"]) {
      const failure = new ApiError("x", 409, { error: "x", details: { code } });
      expect(targetGone(failure)).toBe(true);
      expect(queueErrorMessage(failure, "edit")).toMatch(/already sent or removed\. Your text is still here; you can queue it as a new message/);
      expect(queueErrorMessage(failure, "discard")).toMatch(/already sent or removed/);
    }
    expect(queueErrorMessage(new ApiError("x", 409, {}), "edit")).toMatch(/save again/);
    expect(targetGone(new ApiError("x", 409, { code: "queued_comment_revision_conflict" }))).toBe(false);
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

describe("a queued row's Markdown and pictures (U100, #20367)", () => {
  const body = (text: string, extra: Partial<IssueQueuedCommentEntry> = {}) => entry("c1", 0, { comment: { id: "c1", body: text } as IssueQueuedCommentEntry["comment"], ...extra });

  it("takes Paperclip's images on their own lines out of the text, as thumbnails", () => {
    const message = "Use **this** layout:\n\n![Screen 1](/api/attachments/a1/content)\n![Screen 2](/api/assets/a2/content?v=2) ![Screen 2](/api/assets/a2/content?v=2)\n\nThanks";
    expect(queuedImages(message)).toEqual([
      { name: "Screen 1", url: "/api/attachments/a1/content" },
      { name: "Screen 2", url: "/api/assets/a2/content?v=2" },
    ]);
    expect(queuedBody(body(message))).toEqual({ text: "Use **this** layout:\n\nThanks", images: queuedImages(message), more: 0 });
    expect(queuedPlain(body(message))).toBe("Use **this** layout: Thanks");
  });

  it("leaves out other images, and keeps an image woven into a sentence in the text", () => {
    expect(queuedImages("![x](https://example.com/x.png)\n![y](/api/attachments/a1/other)\n![z](/api/issues/a1/content)")).toEqual([]);
    expect(withoutImageLines("![x](https://example.com/x.png)\nSee ![inline](/api/attachments/a1/content) here")).toBe("See ![inline](/api/attachments/a1/content) here");
    expect(queuedImages("See ![inline](/api/attachments/a1/content) here")).toEqual([]);
    expect(queuedPlain(body("See ![inline](/api/attachments/a1/content) here"))).toBe("See here");
    expect(queuedImages("![A \\[draft\\]](/api/attachments/a1/content)")).toEqual([{ name: "A [draft]", url: "/api/attachments/a1/content" }]);
  });

  it("shows three thumbnails, then counts the rest", () => {
    const message = [1, 2, 3, 4, 5].map((n) => `![${n}](/api/attachments/a${n}/content)`).join("\n");
    const shown = queuedBody(body(message));
    expect(shown.text).toBe("");
    expect(shown.images.map((image) => image.name)).toEqual(["1", "2", "3"]);
    expect(shown.more).toBe(2);
    expect(queuedPlain(body(message))).toBe("Images");
  });

  it("a fixed answer keeps its receipt's one line, without pictures", () => {
    const fixed = body("Declined\n![x](/api/attachments/a1/content)", { source: { kind: "interaction", summary: "Declined: Slack connection" } as IssueQueuedCommentEntry["source"] });
    expect(queuedBody(fixed)).toEqual({ text: "Declined: Slack connection", images: [], more: 0 });
  });
});

describe("a chat message held at the agent's daily limit (U101, #20292)", () => {
  it("offers nothing to send or steer: the outbox delivers it, and the queue has no id", () => {
    const held = queue({ queueId: null, targetRunId: null, state: "deferred", executionWait: { reason: "daily_limit", message: "The agent has reached its daily limit. Your message is saved until work can resume." } });
    expect(rowDelivery(held, entry("c1", 0, { canEdit: false, canDiscard: false }))).toBeNull();
    expect(autoSteerEligible({ queue: held, entry: entry("c1", 0), cancelledIds: new Set(), attemptedKeys: new Set(), editingId: null })).toBe(false);
  });
});
