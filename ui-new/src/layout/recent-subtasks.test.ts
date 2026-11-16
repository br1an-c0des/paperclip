import type { CompactIssue, LiveEvent } from "@paperclipai/shared";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { createTrailingRefetch } from "@/lib/live-events";
import type { RecentTask } from "./nav-model";
import {
  changesTaskAudience,
  nextSubtaskPage,
  parentHints,
  RECENT_SUBTASK_CONCURRENCY,
  RECENT_SUBTASK_PAGE_SIZE,
  readRecentSubtasks,
  recentNavTargets,
  recentTaskTree,
  refreshRecentNav,
  refreshRecentNavForTasks,
  subtaskView,
  toggleUnfolded,
} from "./recent-subtasks";

const recent = (id: string, extra: Partial<RecentTask> = {}): RecentTask => ({ id, identifier: `T-${id}`, title: id, status: "todo", at: 0, ...extra });
const child = (id: string, parentId: string, extra: Partial<CompactIssue> = {}) =>
  ({ id, companyId: "c1", parentId, identifier: `T-${id}`, title: id, status: "todo", ...extra }) as CompactIssue;

describe("recentTaskTree", () => {
  const entries = [recent("p", { subtaskCount: 3 }), recent("c", { parentId: "p" }), recent("x", { parentId: "elsewhere" })];

  it("keeps a folded parent's subtask as its own row", () => {
    const tree = recentTaskTree(entries, new Set());
    expect(tree.top.map((task) => task.id)).toEqual(["p", "c", "x"]);
    expect(tree.nested.size).toBe(0);
  });

  it("moves a recent subtask into its unfolded parent's group", () => {
    const tree = recentTaskTree(entries, new Set(["p"]));
    expect(tree.top.map((task) => task.id)).toEqual(["p", "x"]);
    expect(tree.nested.get("p")?.map((task) => task.id)).toEqual(["c"]);
  });

  it("nests only under a parent with subtasks, and one level deep", () => {
    expect(recentTaskTree([recent("p"), recent("c", { parentId: "p" })], new Set(["p"])).top).toHaveLength(2);
    const chain = [recent("p", { subtaskCount: 1 }), recent("c", { parentId: "p", subtaskCount: 1 }), recent("g", { parentId: "c" })];
    const tree = recentTaskTree(chain, new Set(["p", "c"]));
    // c sits in p's group, so g can't sit in c's: it's listed at the top.
    expect(tree.top.map((task) => task.id)).toEqual(["p", "g"]);
    expect(tree.nested.get("p")?.map((task) => task.id)).toEqual(["c"]);
  });

  it("leaves a cycle in the parents as plain rows", () => {
    const cycle = [recent("a", { parentId: "b", subtaskCount: 1 }), recent("b", { parentId: "a", subtaskCount: 1 }), recent("d", { parentId: "a" })];
    const tree = recentTaskTree(cycle, new Set(["a", "b"]));
    expect(tree.top.map((task) => task.id)).toEqual(["a", "b", "d"]);
  });
});

describe("toggleUnfolded", () => {
  it("unfolds and folds, forgetting parents no longer recent", () => {
    expect(toggleUnfolded([], "p", ["p"])).toEqual(["p"]);
    expect(toggleUnfolded(["p", "old"], "q", ["p", "q"])).toEqual(["p", "q"]);
    expect(toggleUnfolded(["p", "q"], "p", ["p", "q"])).toEqual(["q"]);
  });
});

describe("subtaskView", () => {
  const page = (from: number, count: number, parentId = "p") =>
    Array.from({ length: count }, (_, index) => child(`s${from + index}`, parentId, { isUnreadForMe: (from + index) % 4 === 0 }));

  it("shows the first page and counts the rest, and their unread", () => {
    const view = subtaskView({ parentId: "p", companyId: "c1", pages: [page(0, 10)], pinned: [], showAll: false, count: 14, unread: 5 });
    expect(view.rows).toHaveLength(10);
    expect(view.remaining).toBe(4);
    // s0, s4 and s8 are unread on the page.
    expect(view.hiddenUnread).toBe(2);
    expect(view.loadedHidden).toBe(false);
  });

  it("pins a recent subtask past the first page in the page's last place", () => {
    const view = subtaskView({ parentId: "p", companyId: "c1", pages: [page(0, 10)], pinned: [recent("late", { parentId: "p" })], showAll: false, count: 14, unread: 0 });
    expect(view.rows.map((row) => row.id)).toEqual([...page(0, 9).map((row) => row.id), "late"]);
    expect(view.remaining).toBe(4);
    expect(view.loadedHidden).toBe(true);
  });

  it("shows every loaded page after Show more, without other parents' rows", () => {
    const view = subtaskView({ parentId: "p", companyId: "c1", pages: [page(0, 10), [...page(10, 2), child("other", "q")]], pinned: [], showAll: true, count: 12, unread: 0 });
    expect(view.rows).toHaveLength(12);
    expect(view.remaining).toBe(0);
  });

  it("asks for the next page only after a full one", () => {
    expect(nextSubtaskPage(page(0, RECENT_SUBTASK_PAGE_SIZE))).toBe("s9");
    expect(nextSubtaskPage(page(0, 3))).toBeUndefined();
  });
});

describe("readRecentSubtasks", () => {
  it("runs three reads at once, and a cancelled waiting read never starts", async () => {
    const releases: (() => void)[] = [];
    let started = 0;
    const read = () =>
      new Promise<void>((resolve) => {
        started++;
        releases.push(resolve);
      });
    const reads = Array.from({ length: RECENT_SUBTASK_CONCURRENCY }, () => readRecentSubtasks(new AbortController().signal, read));
    const cancelled = new AbortController();
    const waiting = readRecentSubtasks(cancelled.signal, read);
    const last = readRecentSubtasks(new AbortController().signal, read);
    await Promise.resolve();
    expect(started).toBe(RECENT_SUBTASK_CONCURRENCY);
    cancelled.abort();
    await expect(waiting).rejects.toBeDefined();
    releases[0]!();
    await reads[0];
    await vi.waitFor(() => expect(started).toBe(RECENT_SUBTASK_CONCURRENCY + 1));
    releases.slice(1).forEach((release) => release());
    await Promise.all([...reads, last]);
  });
});

const event = (type: LiveEvent["type"], payload: Record<string, unknown>): LiveEvent => ({ id: 1, companyId: "c1", type, createdAt: "2026-11-15T00:00:00.000Z", payload });
const YOU = "user-1";

/** Three unfolded groups (p1, p2, p3; p3 lists s3) and one summary batch of recent tasks. */
function cachedClient() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const parent of ["p1", "p2", "p3"]) {
    client.setQueryData(queryKeys.recentSubtasks("c1", YOU, parent), { pages: [[child(parent === "p3" ? "s3" : `s-${parent}`, parent)]], pageParams: [undefined] });
  }
  client.setQueryData(queryKeys.recentSubtasks("c1", "someone-else", "p1"), { pages: [[]], pageParams: [undefined] });
  client.setQueryData(queryKeys.recentTasks("c1", ["p1", "p2", "r1"]), [
    { id: "p1", parentId: null },
    { id: "p2", parentId: null },
    { id: "r1", parentId: "p9" },
  ]);
  return client;
}
const subtasks = (parent: string, viewer = YOU) => queryKeys.recentSubtasks("c1", viewer, parent);
const batch = queryKeys.recentTasks("c1", ["p1", "p2", "r1"]);
const activity = (entityId: string, parents: string[] | undefined, extra: Record<string, unknown> = {}) =>
  event("activity.logged", { entityType: "issue", entityId, action: "issue.comment_added", ...(parents ? { recentSubtaskParentIds: parents } : {}), ...extra });

describe("recentNavTargets", () => {
  it("refreshes only the group and batch of the parent an event names", () => {
    const client = cachedClient();
    const targets = recentNavTargets(client, "c1", activity("new-child", ["p2"]), { userId: YOU });
    expect(targets.keys).toEqual([subtasks("p2"), batch]);
  });

  it("refreshes nothing for a task outside the recent tasks", () => {
    const client = cachedClient();
    expect(recentNavTargets(client, "c1", activity("elsewhere", ["unlisted"]), { userId: YOU }).keys).toEqual([]);
    expect(recentNavTargets(client, "c1", activity("elsewhere", []), { userId: YOU }).keys).toEqual([]);
  });

  it("refreshes a group that lists the task, and a batch whose task's parent it is", () => {
    const client = cachedClient();
    expect(recentNavTargets(client, "c1", activity("s3", []), { userId: YOU }).keys).toEqual([subtasks("p3")]);
    expect(recentNavTargets(client, "c1", activity("r1", []), { userId: YOU }).keys).toEqual([batch]);
  });

  it("refreshes every batch, but only the named groups, without the server's parent hints", () => {
    const client = cachedClient();
    expect(recentNavTargets(client, "c1", activity("p1", undefined), { userId: YOU }).keys).toEqual([subtasks("p1"), subtasks("p1", "someone-else"), batch]);
  });

  it("refreshes for your read marks, only your groups, and not for someone else's", () => {
    const client = cachedClient();
    const read = (userId: string) => activity("s-p1", ["p1"], { action: "issue.read_marked", details: { userId } });
    expect(recentNavTargets(client, "c1", read("other-user"), { userId: YOU }).keys).toEqual([]);
    expect(recentNavTargets(client, "c1", read(YOU), { userId: YOU }).keys).toEqual([subtasks("p1"), batch]);
  });

  it("refreshes for a run on a recent task's subtask, and not for a run without a task", () => {
    const client = cachedClient();
    expect(recentNavTargets(client, "c1", event("heartbeat.run.status", { issueId: "s-p2", recentSubtaskParentIds: ["p2"] }), { userId: YOU }).keys).toEqual([
      subtasks("p2"),
      batch,
    ]);
    expect(recentNavTargets(client, "c1", event("heartbeat.run.status", { runId: "r" }), { userId: YOU }).keys).toEqual([]);
  });

  it("ignores workspace file reads and other entities, and starts over when who sees what changes", () => {
    const client = cachedClient();
    expect(recentNavTargets(client, "c1", activity("p1", ["p1"], { action: "issue.file_resource_list" }), { userId: YOU }).keys).toEqual([]);
    expect(recentNavTargets(client, "c1", event("activity.logged", { entityType: "agent", entityId: "a1", action: "agent.updated" }), { userId: YOU }).keys).toEqual([]);
    expect(recentNavTargets(client, "c1", event("activity.logged", { entityType: "issue", entityId: "p1", action: "issue_access_grant.created" }), { userId: YOU }).reset).toBe(true);
    expect(changesTaskAudience("company_membership.updated")).toBe(true);
    expect(changesTaskAudience("issue.updated")).toBe(false);
  });

  it("reads the parent hints only when the server sends them", () => {
    expect(parentHints({ recentSubtaskParentIds: ["a", 3, "b"] })).toEqual(["a", "b"]);
    expect(parentHints({})).toBeUndefined();
  });
});

describe("refreshRecentNav", () => {
  afterEach(() => vi.useRealTimers());

  it("invalidates exactly the named queries, once more after the burst, and leaves the other groups alone", () => {
    vi.useFakeTimers();
    const client = cachedClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const trailing = createTrailingRefetch(client, 100);
    trailing.add(refreshRecentNav(client, "c1", activity("new-child", ["p2"]), { userId: YOU }));
    const refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(refreshed()).toEqual([subtasks("p2"), batch]);
    vi.advanceTimersByTime(100);
    expect(refreshed()).toEqual([subtasks("p2"), batch, subtasks("p2"), batch]);
    expect(invalidate.mock.calls.every(([filters]) => filters?.exact === true)).toBe(true);
    expect(client.getQueryState(subtasks("p1"))?.isInvalidated).toBe(false);
    expect(client.getQueryState(subtasks("p3"))?.isInvalidated).toBe(false);
  });

  it("drops every recent summary and group when who sees what changes", () => {
    const client = cachedClient();
    refreshRecentNav(client, "c1", event("activity.logged", { entityType: "issue", action: "issue.privacy_updated" }), { userId: YOU });
    expect(client.getQueryData(subtasks("p1"))).toBeUndefined();
    expect(client.getQueryData(batch)).toBeUndefined();
  });

  it("a task-list refresh elsewhere doesn't reach the recent tasks", async () => {
    const client = cachedClient();
    await client.invalidateQueries({ queryKey: queryKeys.issues.list("c1") });
    expect(client.getQueryState(subtasks("p1"))?.isInvalidated).toBe(false);
    expect(client.getQueryState(batch)?.isInvalidated).toBe(false);
  });

  it("refreshes a task's group and its parent's after you mark it read here", () => {
    const client = cachedClient();
    refreshRecentNavForTasks(client, "c1", [{ id: "s-p1", parentId: "p1" }], YOU);
    expect(client.getQueryState(subtasks("p1"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(subtasks("p1", "someone-else"))?.isInvalidated).toBe(false);
    expect(client.getQueryState(subtasks("p2"))?.isInvalidated).toBe(false);
    expect(client.getQueryState(batch)?.isInvalidated).toBe(true);
  });
});
