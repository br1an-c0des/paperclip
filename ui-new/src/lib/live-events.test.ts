import type { LiveEvent } from "@paperclipai/shared";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { createTrailingRefetch, keysForEvent, LIST_CACHE_HOLD_MS, LIVE_RUNS_HOLD_MS } from "./live-events";

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

  it("refreshes the skill library on skill, version and source activity", () => {
    const skill = keysForEvent("c1", event("activity.logged", { entityType: "company_skill", entityId: "s1", action: "company.skill_file_updated" }));
    expect(skill).toContainEqual(queryKeys.skills.all("c1"));
    expect(skill).not.toContainEqual(queryKeys.skills.sources("c1"));
    const version = keysForEvent("c1", event("activity.logged", { entityType: "company_skill_version", entityId: "v1", action: "company.skill_version_created" }));
    expect(version).toContainEqual(queryKeys.skills.all("c1"));
    const source = keysForEvent("c1", event("activity.logged", { entityType: "company_skill_source", entityId: "src1", action: "skill_source.refreshed" }));
    expect(source).toEqual(expect.arrayContaining([queryKeys.skills.all("c1"), queryKeys.skills.sources("c1")]));
    const imported = keysForEvent("c1", event("activity.logged", { entityType: "company", entityId: "c1", action: "company.skills_imported" }));
    expect(imported).toEqual(expect.arrayContaining([queryKeys.skills.all("c1"), queryKeys.skills.sources("c1")]));
    expect(keysForEvent("c1", event("activity.logged", { entityType: "company", entityId: "c1", action: "company.updated" }))).not.toContainEqual(queryKeys.skills.all("c1"));
  });

  it("refreshes an agent's skills and the library's counts when its skills are synced", () => {
    const keys = keysForEvent("c1", event("activity.logged", { entityType: "agent", entityId: "a1", action: "agent.skills_synced" }));
    // The detail key is a prefix of the agent page's skills query, so it refreshes too.
    expect(keys).toContainEqual(queryKeys.agents.detail("a1"));
    expect(queryKeys.agents.part("a1", "skills").slice(0, 3)).toEqual([...queryKeys.agents.detail("a1")]);
    expect(keys).toContainEqual(queryKeys.skills.all("c1"));
    expect(keysForEvent("c1", event("activity.logged", { entityType: "agent", entityId: "a1", action: "agent.updated" }))).not.toContainEqual(queryKeys.skills.all("c1"));
  });

  it("refreshes the plugins and what they add to the UI when a plugin is installed, switched or removed", () => {
    for (const action of ["plugin.installed", "plugin.enabled", "plugin.disabled", "plugin.upgraded", "plugin.uninstalled"]) {
      const keys = keysForEvent("c1", event("activity.logged", { entityType: "plugin", entityId: "p1", action }));
      expect(keys).toContainEqual(["plugins"]);
      // A prefix of the UI contributions every plugin outlet reads.
      expect(queryKeys.plugins.uiContributions.slice(0, 1)).toEqual(["plugins"]);
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

  it("fetches the live runs once more after a run changes state, sooner than the tasks", () => {
    const { invalidate, trailing } = setup();
    // A run starts, and finishes a moment later: the second refetch can join the first in flight.
    trailing.add(keysForEvent("c1", event("heartbeat.run.status", { agentId: "a1", runId: "r1", status: "running" })));
    vi.advanceTimersByTime(500);
    trailing.add(keysForEvent("c1", event("heartbeat.run.status", { agentId: "a1", runId: "r1", status: "succeeded" })));
    vi.advanceTimersByTime(LIVE_RUNS_HOLD_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([{ queryKey: queryKeys.liveRuns("c1"), exact: true }]);
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS * 4);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("gives a run event on a task both fetches, each on its own delay", () => {
    const { invalidate, trailing } = setup();
    trailing.add(keysForEvent("c1", event("heartbeat.run.status", { agentId: "a1", issueId: "i1", runId: "r1" })));
    vi.advanceTimersByTime(LIVE_RUNS_HOLD_MS);
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([{ queryKey: queryKeys.liveRuns("c1"), exact: true }]);
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS - LIVE_RUNS_HOLD_MS);
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: queryKeys.liveRuns("c1"), exact: true },
      { queryKey: queryKeys.issues.detail("i1"), exact: true },
    ]);
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
    trailing.add(keysForEvent("c1", event("heartbeat.run.status", { agentId: "a1", runId: "r1" })));
    trailing.cancel();
    vi.advanceTimersByTime(LIST_CACHE_HOLD_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
