import type { LiveEvent } from "@paperclipai/shared";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { createTrailingRefetch, keysForEvent, LIST_CACHE_HOLD_MS } from "./live-events";

const event = (type: LiveEvent["type"], payload: Record<string, unknown>): LiveEvent => ({
  id: 1,
  companyId: "c1",
  type,
  createdAt: "2026-10-25T00:00:00.000Z",
  payload,
});

describe("keysForEvent", () => {
  it("refreshes the task, its list and the company counts when a task changes", () => {
    const keys = keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1" }));
    expect(keys).toEqual(
      expect.arrayContaining([queryKeys.issues.list("c1"), queryKeys.issues.detail("i1"), queryKeys.companies.stats]),
    );
  });

  it("refreshes the run, its agent and its task when a run changes state", () => {
    const keys = keysForEvent("c1", event("heartbeat.run.status", { agentId: "a1", issueId: "i1", runId: "r1" }));
    expect(keys).toEqual(
      expect.arrayContaining([
        queryKeys.liveRuns("c1"),
        queryKeys.agents.detail("a1"),
        queryKeys.issues.detail("i1"),
        ["heartbeat-run", "r1"],
      ]),
    );
  });

  it("refreshes the Inbox's feed when a request on a task is added, answered or ends", () => {
    const keys = keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action: "issue.thread_interaction_accepted" }));
    expect(keys).toContainEqual(queryKeys.inbox.attention("c1"));
    expect(keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action: "issue.updated" }))).toContainEqual(
      queryKeys.inbox.attention("c1"),
    );
  });

  it("leaves the Inbox's feed alone for other task activity", () => {
    const keys = keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action: "issue.comment_added" }));
    expect(keys).not.toContainEqual(queryKeys.inbox.attention("c1"));
  });

  it("refreshes the Inbox's feed on decision and approval activity", () => {
    for (const entityType of ["decision", "approval"]) {
      const keys = keysForEvent("c1", event("activity.logged", { entityType, entityId: "x1", action: `${entityType}.created` }));
      expect(keys).toContainEqual(queryKeys.inbox.attention("c1"));
    }
  });

  it("leaves streamed run output to subscribers", () => {
    expect(keysForEvent("c1", event("heartbeat.run.log", { runId: "r1" }))).toEqual([]);
  });

  it("ignores ids that aren't strings", () => {
    const keys = keysForEvent("c1", event("agent.status", { agentId: 42 }));
    expect(keys).not.toContainEqual(queryKeys.agents.detail("42"));
  });
});

describe("createTrailingRefetch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    return { invalidate, trailing: createTrailingRefetch(client) };
  };
  const taskEvent = (action: string) => keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action }));

  it("fetches the tasks once, after the last event of a burst has had time to clear the list cache", () => {
    const { invalidate, trailing } = setup();
    // An agent comments, then changes the status a second later.
    trailing.add(taskEvent("issue.comment_added"));
    vi.advanceTimersByTime(1_000);
    trailing.add(taskEvent("issue.updated"));
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: queryKeys.issues.list("c1"), exact: false },
      { queryKey: queryKeys.issues.detail("i1"), exact: true },
    ]);
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS * 4);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("leaves events that don't touch tasks alone", () => {
    const { invalidate, trailing } = setup();
    trailing.add(keysForEvent("c1", event("agent.status", { agentId: "a1" })));
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("drops a burst in progress when cancelled", () => {
    const { invalidate, trailing } = setup();
    trailing.add(taskEvent("issue.updated"));
    trailing.cancel();
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
