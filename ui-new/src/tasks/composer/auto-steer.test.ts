import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoSteer, resetAutoSteer } from "./auto-steer";

const entry = (id: string, at: number, extra: Partial<IssueQueuedCommentEntry> = {}): IssueQueuedCommentEntry =>
  ({
    comment: { id, body: `Message ${id}`, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() },
    position: 0,
    canEdit: true,
    canDiscard: true,
    ...extra,
  }) as unknown as IssueQueuedCommentEntry;

const queue = (entries: IssueQueuedCommentEntry[], extra: Partial<IssueQueuedCommentQueue> = {}): IssueQueuedCommentQueue => ({
  issueId: "t1",
  queueId: "q1",
  state: "queued",
  targetRunId: "r1",
  revision: "rev1",
  protocol: "paperclip_runner_v1",
  steeringDisposition: "available",
  entries,
  ...extra,
});

function setup(initial: IssueQueuedCommentQueue) {
  const [current, setQueue] = createSignal(initial);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const steer = vi.fn();
  let dispose = () => {};
  const auto = createRoot((done) => {
    dispose = done;
    return createAutoSteer({ queue: current, entries: () => current().entries, editingId, busy, steer });
  });
  return { auto, steer, setQueue, setEditingId, setBusy, dispose };
}

const advance = (ms: number) => vi.advanceTimersByTime(ms);

describe("createAutoSteer (U84, #19970)", () => {
  let start = 0;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z") });
    start = Date.now();
    resetAutoSteer();
  });
  afterEach(() => vi.useRealTimers());

  it("counts down five seconds, then steers the message once", () => {
    const view = setup(queue([entry("c1", start)]));
    expect(view.auto.secondsLeft("c1")).toBe(5);
    advance(2_100);
    expect(view.auto.secondsLeft("c1")).toBe(3);
    expect(view.steer).not.toHaveBeenCalled();
    advance(3_000);
    expect(view.steer).toHaveBeenCalledOnce();
    expect(view.steer.mock.calls[0]![0].comment.id).toBe("c1");
    // A failed attempt leaves it queued, with no new countdown and no retry.
    expect(view.auto.secondsLeft("c1")).toBeNull();
    advance(20_000);
    expect(view.steer).toHaveBeenCalledOnce();
    view.dispose();
  });

  it("does nothing while steering isn't available", () => {
    for (const steeringDisposition of ["temporarily_unavailable", "unsupported"] as const) {
      const view = setup(queue([entry("c1", start)], { steeringDisposition }));
      expect(view.auto.secondsLeft("c1")).toBeNull();
      advance(10_000);
      expect(view.steer).not.toHaveBeenCalled();
      view.dispose();
    }
  });

  it("gives a message that waited for steering its whole countdown once steering comes back", () => {
    const view = setup(queue([entry("c1", start)], { steeringDisposition: "temporarily_unavailable" }));
    advance(30_000);
    view.setQueue(queue([entry("c1", start)]));
    expect(view.auto.secondsLeft("c1")).toBe(5);
    advance(4_900);
    expect(view.steer).not.toHaveBeenCalled();
    advance(200);
    expect(view.steer).toHaveBeenCalledOnce();
    view.dispose();
  });

  it("Cancel keeps the message queued", () => {
    const view = setup(queue([entry("c1", start)]));
    advance(1_000);
    view.auto.cancel("c1");
    expect(view.auto.secondsLeft("c1")).toBeNull();
    advance(10_000);
    expect(view.steer).not.toHaveBeenCalled();
    view.dispose();
  });

  it("stops while the message is being edited, starts a whole window when the editor closes, and a new one for a saved edit", () => {
    const view = setup(queue([entry("c1", start)]));
    advance(4_000);
    view.setEditingId("c1");
    expect(view.auto.secondsLeft("c1")).toBeNull();
    advance(10_000);
    expect(view.steer).not.toHaveBeenCalled();
    // Closed without saving: five more seconds, not an instant send.
    view.setEditingId(null);
    expect(view.auto.secondsLeft("c1")).toBe(5);
    advance(2_000);
    view.setEditingId("c1");
    advance(1_000);
    // Saved: a new revision, counted from its change.
    const edited = entry("c1", Date.now());
    view.setQueue(queue([edited], { revision: "rev2" }));
    view.setEditingId(null);
    expect(view.auto.secondsLeft("c1")).toBe(5);
    advance(5_100);
    expect(view.steer).toHaveBeenCalledOnce();
    expect(view.steer.mock.calls[0]![0]).toBe(edited);
    view.dispose();
  });

  it("waits for another queue action to finish before sending", () => {
    const view = setup(queue([entry("c1", start)]));
    view.setBusy(true);
    advance(6_000);
    expect(view.steer).not.toHaveBeenCalled();
    view.setBusy(false);
    expect(view.steer).toHaveBeenCalledOnce();
    view.dispose();
  });

  it("never sends the same revision from two views of one queue", () => {
    const first = setup(queue([entry("c1", start)]));
    const second = setup(queue([entry("c1", start)]));
    advance(5_100);
    expect(first.steer.mock.calls.length + second.steer.mock.calls.length).toBe(1);
    first.dispose();
    second.dispose();
  });

  it("leaves other people's messages and request-card answers alone", () => {
    const view = setup(
      queue([
        entry("theirs", start, { canEdit: false }),
        entry("answer", start, { canEdit: false, source: { kind: "interaction", interactionId: "i", interactionKind: "ask_user_questions" } }),
      ]),
    );
    expect(view.auto.counting()).toBe(false);
    advance(10_000);
    expect(view.steer).not.toHaveBeenCalled();
    view.dispose();
  });
});
