import type { AttentionItem, CompactIssue, InboxMineSnapshot, TaskInterruptionPresentation } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { interruptionOf, keepsRowsOnError, parentOf, sourceNotices, splitMine, tabFromPath } from "./inbox-model";
import { needsYouCount } from "./needs-you";

// Updates' one read (U3), Retry state on its rows (U14), the History tab's path (U33), and why the
// nav's count can't come from `attention/summary` (U32).

function task(id: string, extra: Partial<CompactIssue> = {}): CompactIssue {
  return { id, identifier: id.toUpperCase(), title: `Task ${id}`, parentId: null, interruption: null, ...extra } as CompactIssue;
}

function interruption(extra: Partial<TaskInterruptionPresentation> = {}): TaskInterruptionPresentation {
  return {
    intentId: null,
    responsibility: "system",
    state: "failed",
    nextRetryAt: null,
    canRetry: true,
    userAction: null,
    sourceRunIds: ["r1"],
    observedRunId: "r1",
    ...extra,
  } as TaskInterruptionPresentation;
}

function snapshot(extra: Partial<InboxMineSnapshot> = {}): InboxMineSnapshot {
  return { userId: "u1", issues: [], contextIssues: [], failureRuns: [], failureIssueIds: [], ...extra };
}

describe("splitMine", () => {
  it("gives a row behind a failed run the interruption its context row carries", () => {
    const failed = interruption();
    const { rows, context, sources } = splitMine(
      snapshot({
        issues: [task("a"), task("b", { parentId: "p" })],
        contextIssues: [task("a", { interruption: failed }), task("p")],
        failureIssueIds: ["a"],
      }),
    );
    expect(rows[0]!.interruption).toEqual(failed);
    expect(rows[1]!.interruption).toBeNull();
    expect(context.map((row) => row.id)).toEqual(["a", "p"]);
    expect(sources).toEqual({ userId: "u1", failureIssueIds: ["a"], failureError: null, contextError: null });
  });

  it("leaves a row alone when its context row isn't a failure's, and keeps a row's own state", () => {
    const own = interruption({ state: "retry_scheduled" });
    const { rows } = splitMine(
      snapshot({
        issues: [task("a"), task("b", { interruption: own })],
        contextIssues: [task("a", { interruption: interruption() }), task("b", { interruption: interruption() })],
        failureIssueIds: ["b"],
      }),
    );
    expect(rows[0]!.interruption).toBeNull();
    expect(rows[1]!.interruption).toBe(own);
  });

  it("carries each source's error", () => {
    const { sources } = splitMine(snapshot({ failureError: { status: 403, message: "No run access" }, contextError: { status: 503, message: "Could not load task context" } }));
    expect(sources.failureError?.status).toBe(403);
    expect(sourceNotices(sources).map((notice) => [notice.source, notice.detail])).toEqual([
      ["failures", "No run access"],
      ["context", "Could not load task context"],
    ]);
  });
});

describe("sourceNotices", () => {
  it("says nothing while every source loaded", () => {
    expect(sourceNotices(undefined)).toEqual([]);
    expect(sourceNotices(splitMine(snapshot()).sources)).toEqual([]);
  });
});

describe("interruptionOf", () => {
  it("reads a task's own row first, then the failure context", () => {
    const own = interruption({ state: "retry_scheduled" });
    const context = interruption();
    expect(interruptionOf("a", [task("a", { interruption: own })], [task("a", { interruption: context })])).toBe(own);
    expect(interruptionOf("a", [task("a")], [task("a", { interruption: context })])).toBe(context);
    expect(interruptionOf("z", [task("a")], [task("b", { interruption: context })])).toBeNull();
    expect(interruptionOf("a", undefined, undefined)).toBeNull();
  });
});

describe("parentOf", () => {
  it("finds a subtask's parent among the rows or the context rows", () => {
    const rows = [task("a", { parentId: "b" }), task("b"), task("c", { parentId: "p" }), task("d", { parentId: "gone" })];
    const context = [task("p")];
    expect(parentOf(rows[0]!, rows, context)?.id).toBe("b");
    expect(parentOf(rows[2]!, rows, context)?.id).toBe("p");
    expect(parentOf(rows[3]!, rows, context)).toBeNull();
    expect(parentOf(rows[1]!, rows, context)).toBeNull();
  });
});

describe("keepsRowsOnError", () => {
  it("keeps the last rows through an outage, a 429 or a 5xx, not after a refusal", () => {
    expect(keepsRowsOnError(new ApiError("Busy", 429, null), true)).toBe(true);
    expect(keepsRowsOnError(new ApiError("Down", 503, null), true)).toBe(true);
    expect(keepsRowsOnError(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(keepsRowsOnError(new ApiError("Forbidden", 403, null), true)).toBe(false);
    expect(keepsRowsOnError(new ApiError("Your account changed.", 409, null), true)).toBe(false);
    expect(keepsRowsOnError(new ApiError("Down", 503, null), false)).toBe(false);
  });
});

describe("tabFromPath: History", () => {
  it("opens History, and the old Decided path lands there", () => {
    expect(tabFromPath("history")).toBe("history");
    expect(tabFromPath("decided")).toBe("history");
  });
});

/*
 * `GET /attention/summary` counts what's active by source kind (cleared and snoozed left out), but
 * it counts requests on the aging shelf too, and Needs you leaves those out (decision 39). With the
 * shelf in use the two disagree, so the nav keeps counting from the feed (decision 24).
 */
describe("the nav count against attention/summary", () => {
  const base = { companyId: "c1", subject: { kind: "issue", id: "s", companyId: "c1", title: "t", identifier: null, status: null, href: null } };
  const make = (id: string, sourceKind: AttentionItem["sourceKind"], extra: Partial<AttentionItem> = {}) =>
    ({ ...base, id, sourceKind, dismissal: null, shelf: false, keep: false, rank: 0, severity: "medium", activityAt: "2026-11-01T00:00:00Z", createdAt: "2026-11-01T00:00:00Z", ...extra }) as AttentionItem;
  const items = [make("a", "approval"), make("b", "issue_thread_interaction", { shelf: true }), make("c", "review"), make("d", "failed_run")];
  // The summary's counts for these items: everything active, by kind.
  const summaryCounts = { approval: 1, issue_thread_interaction: 1, review: 1, failed_run: 1 };
  const alertKinds = new Set(["failed_run", "budget_alert", "agent_error_alert", "blocker_attention"]);
  const fromSummary = Object.entries(summaryCounts).reduce((sum, [kind, count]) => (alertKinds.has(kind) ? sum : sum + count), 0);

  it("differs by the shelf", () => {
    expect(needsYouCount(items)).toBe(2);
    expect(fromSummary).toBe(3);
  });
});
