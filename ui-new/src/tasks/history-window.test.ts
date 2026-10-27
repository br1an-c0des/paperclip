import type { ActivityEvent, IssueComment } from "@paperclipai/shared";
import { describe, expect, it, vi } from "vitest";
import type { RunForIssue } from "@/api/issues";
import { commentInputs } from "./activity-format";
import {
  catchUpComments,
  historyFrom,
  mergeActivity,
  mergeComments,
  mergeRuns,
  RECENT_ACTIVITY_LIMIT,
  windowThread,
  type CommentWindow,
} from "./history-window";

const names = {
  agent: (id: string) => ({ a1: "Ada", a2: "Ben" })[id],
  person: (id: string) => `User ${id}`,
  youId: () => "u1",
};

const at = (minute: number) => new Date(Date.UTC(2026, 9, 26, 10, minute)).toISOString();

function comment(id: string, minute: number) {
  return { id, body: id, createdAt: at(minute), authorType: "user", authorUserId: "u1", authorAgentId: null } as unknown as IssueComment;
}

function event(id: string, minute: number, action = "issue.updated", details: Record<string, unknown> = { priority: "high", _previous: { priority: "low" } }) {
  return { id, action, details, createdAt: at(minute), actorType: "agent", actorId: "a1", agentId: "a1" } as unknown as ActivityEvent;
}

function run(id: string, status: string, minute: number) {
  return { runId: id, status, agentId: "a2", startedAt: at(minute), finishedAt: status === "running" ? null : at(minute + 1), createdAt: at(minute) } as RunForIssue;
}

const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe("mergeComments", () => {
  it("keeps each comment once, the later copy, oldest first", () => {
    const edited = { ...comment("c2", 2), body: "edited" };
    const merged = mergeComments([comment("c3", 3), comment("c2", 2)], [edited, comment("c1", 1)]);
    expect(ids(merged)).toEqual(["c1", "c2", "c3"]);
    expect(merged[1]!.body).toBe("edited");
  });
});

describe("catchUpComments", () => {
  it("takes the first answer as the window, holding everything from its fourth newest comment", async () => {
    const window = await catchUpComments(
      undefined,
      { comments: [comment("c9", 9), comment("c8", 8), comment("c7", 7), comment("c6", 6), comment("c1", 1)], latestCommentId: "c9", hasMore: true },
      vi.fn(),
    );
    expect(ids(window.comments)).toEqual(["c1", "c6", "c7", "c8", "c9"]);
    expect(window.from).toBe(at(6));
    expect(window.hasMore).toBe(true);
  });

  it("holds everything when there's nothing older", async () => {
    const window = await catchUpComments(undefined, { comments: [comment("c1", 1)], latestCommentId: "c1", hasMore: false }, vi.fn());
    expect(window.from).toBeNull();
  });

  it("catches up from the newest comment seen, so a burst isn't lost", async () => {
    const previous: CommentWindow = { comments: [comment("c1", 1), comment("c2", 2)], latestCommentId: "c2", hasMore: true, from: at(1) };
    const fetchAfter = vi.fn(async (cursor: string | null) => (cursor === "c2" ? [comment("c3", 3), comment("c4", 4), comment("c5", 5)] : []));
    const window = await catchUpComments(
      previous,
      { comments: [comment("c8", 8), comment("c7", 7), comment("c6", 6), comment("c5", 5)], latestCommentId: "c8", hasMore: true },
      fetchAfter,
    );
    expect(fetchAfter).toHaveBeenCalledWith("c2");
    // c3 and c4 came between the two refreshes: only the catch-up read them.
    expect(ids(window.comments)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
    expect(window.from).toBe(at(1));
    expect(window.latestCommentId).toBe("c5");
  });

  it("starts again from the comment before when the cursor was deleted", async () => {
    const previous: CommentWindow = { comments: [comment("c1", 1), comment("c2", 2)], latestCommentId: "c2", hasMore: false, from: null };
    const fetchAfter = vi.fn(async (cursor: string | null) => (cursor === "c1" ? [comment("c3", 3)] : []));
    const window = await catchUpComments(previous, { comments: [comment("c3", 3), comment("c1", 1)], latestCommentId: "c3", hasMore: false }, fetchAfter);
    expect(fetchAfter.mock.calls.map((call) => call[0])).toEqual(["c2", "c1"]);
    // c2 (a cancelled queued message) is newer than the answer's run of comments yet missing from it.
    expect(ids(window.comments)).toEqual(["c1", "c3"]);
  });

  it("doesn't read anything when nothing is new", async () => {
    const previous: CommentWindow = { comments: [comment("c1", 1)], latestCommentId: "c1", hasMore: false, from: null };
    const fetchAfter = vi.fn();
    await catchUpComments(previous, { comments: [comment("c1", 1)], latestCommentId: "c1", hasMore: false }, fetchAfter);
    expect(fetchAfter).not.toHaveBeenCalled();
  });
});

describe("mergeActivity", () => {
  it("holds everything from the first full answer's oldest row, and keeps every row seen", () => {
    const full = Array.from({ length: RECENT_ACTIVITY_LIMIT }, (_, index) => event(`e${index}`, 59 - index));
    const first = mergeActivity(undefined, full);
    expect(first.from).toBe(at(59 - RECENT_ACTIVITY_LIMIT + 1));
    const next = mergeActivity(first, [event("new", 59)]);
    expect(next.events).toHaveLength(RECENT_ACTIVITY_LIMIT + 1);
    expect(next.from).toBe(first.from);
    expect(mergeActivity(undefined, [event("e1", 1)]).from).toBeNull();
  });
});

describe("mergeRuns", () => {
  it("holds everything from the older of the latest two runs, and keeps every run seen", async () => {
    const fetchAll = vi.fn();
    const first = await mergeRuns(undefined, [run("r3", "running", 30), run("r2", "succeeded", 20)], fetchAll);
    expect(first.from).toBe(at(21));
    const next = await mergeRuns(first, [run("r3", "succeeded", 30), run("r2", "succeeded", 20)], fetchAll);
    expect(next.runs.map((item) => [item.runId, item.status])).toEqual([
      ["r3", "succeeded"],
      ["r2", "succeeded"],
    ]);
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it("reads every run once when a run that was going drops out of the latest two", async () => {
    const all = [run("r5", "succeeded", 50), run("r4", "succeeded", 40), run("r3", "succeeded", 30)];
    const fetchAll = vi.fn(async () => all);
    const previous = { runs: [run("r3", "running", 30)], from: null };
    const next = await mergeRuns(previous, [run("r5", "succeeded", 50), run("r4", "succeeded", 40)], fetchAll);
    expect(fetchAll).toHaveBeenCalledOnce();
    expect(next).toEqual({ runs: all, from: null });
  });
});

describe("historyFrom", () => {
  it("is the latest starting point, or null when every window is whole", () => {
    expect(historyFrom(null, undefined)).toBeNull();
    expect(historyFrom(at(5), null, at(9))).toBe(new Date(at(9)).getTime());
  });
});

describe("windowThread", () => {
  it("holds back changes and runs from before the windows start, and marks the gap", () => {
    const items = windowThread({
      comments: [comment("first", 1), comment("c8", 8), comment("c9", 9)],
      events: [event("old", 3), event("new", 7)],
      runs: [run("r-old", "succeeded", 2), run("r-new", "succeeded", 5)],
      names,
      from: new Date(at(5)).getTime(),
    });
    expect(items.map((item) => item.kind)).toEqual(["comment", "gap", "lines", "comment", "comment"]);
    const lines = items.find((item) => item.kind === "lines");
    expect(lines?.kind === "lines" && lines.lines.map((line) => line.key)).toEqual(["run:r-new", "event:new"]);
  });

  it("puts the gap first when nothing comes before it, and leaves it out for a whole history", () => {
    const input = { comments: [comment("c8", 8)], events: [], runs: [], names };
    expect(windowThread({ ...input, from: new Date(at(8)).getTime() }).map((item) => item.kind)).toEqual(["gap", "comment"]);
    expect(windowThread({ ...input, from: null }).map((item) => item.kind)).toEqual(["comment"]);
  });
});

describe("commentInputs", () => {
  it("reads what each comment did to the run, ignoring replayed steers", () => {
    const inputs = commentInputs([
      event("e1", 1, "issue.comment_added", { commentId: "c1", interruptedRunId: "r1", reopened: true }),
      event("e2", 2, "issue.queued_comment_steered", { commentId: "c2", targetRunId: "r2", duplicate: false }),
      event("e3", 3, "issue.queued_comment_steered", { commentId: "c3", targetRunId: "r3", duplicate: true }),
      event("e4", 4, "issue.comment_added", { commentId: "c4" }),
    ]);
    expect(Object.fromEntries(inputs)).toEqual({
      c1: { interruptedRunId: "r1", reopened: true },
      c2: { steeredRunId: "r2" },
    });
  });
});
