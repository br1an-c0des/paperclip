import type { LiveEvent } from "@paperclipai/shared";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { createTrailingRefetch, keysForEvent, LIST_CACHE_HOLD_MS, LIVE_RUNS_HOLD_MS, RunInterests } from "./live-events";

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

  it("leaves the task alone when its workspace files are only listed or read", () => {
    for (const action of ["issue.file_resource_list", "issue.file_resource_content_read", "issue.file_resource_resolve"]) {
      expect(keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action }))).toEqual([queryKeys.activity("c1")]);
    }
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

  it("refreshes Apps on tool activity and AI connections on their changes", () => {
    const tool = keysForEvent("c1", event("activity.logged", { entityType: "tool_connection", entityId: "t1", action: "tool_gateway.approval_requested" }));
    expect(tool).toContainEqual(queryKeys.tools.all("c1"));
    expect(queryKeys.tools.connectionPart("c1", "t1", "catalog").slice(0, 2)).toEqual([...queryKeys.tools.all("c1")]);
    const ai = keysForEvent("c1", event("activity.logged", { entityType: "company", entityId: "c1", action: "ai_connection.created" }));
    expect(ai).toEqual(expect.arrayContaining([queryKeys.aiConnections.list("c1"), queryKeys.tools.all("c1")]));
    expect(keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action: "issue.updated" }))).not.toContainEqual(queryKeys.tools.all("c1"));
  });

  it("leaves streamed run output to subscribers", () => {
    expect(keysForEvent("c1", event("heartbeat.run.log", { runId: "r1" }))).toEqual([]);
  });

  it("refreshes only the task's activity when someone else marks it read", () => {
    for (const action of ["issue.read_marked", "issue.read_unmarked"]) {
      const keys = keysForEvent("c1", event("activity.logged", { entityType: "issue", entityId: "i1", action, actorType: "user", actorId: "u2" }), { userId: "u1" });
      expect(keys).toEqual([queryKeys.activity("c1"), queryKeys.issues.section("i1", "activity")]);
    }
  });

  it("refreshes your own lists, counts and chat dots when you mark a task read", () => {
    const keys = keysForEvent(
      "c1",
      event("activity.logged", { entityType: "issue", entityId: "i1", action: "issue.read_marked", actorType: "user", actorId: "u1", details: { userId: "u1" } }),
      { userId: "u1" },
    );
    expect(keys).toEqual(
      expect.arrayContaining([queryKeys.issues.section("i1", "activity"), ["issues", "c1", "inbox"], queryKeys.sidebarBadges("c1"), queryKeys.chat.list("c1")]),
    );
    // The Inbox's lists sit under that prefix.
    expect(queryKeys.inbox.tasks("c1").slice(0, 3)).toEqual(["issues", "c1", "inbox"]);
    expect(keys).not.toContainEqual(queryKeys.issues.detail("i1"));
    expect(keys).not.toContainEqual(queryKeys.issues.list("c1"));
    expect(keys).not.toContainEqual(queryKeys.dashboard("c1"));
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

describe("RunInterests", () => {
  const frames = (sent: string[]) => sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);

  it("says hello, then sends the runs held once the server can filter", () => {
    const sent: string[] = [];
    const interests = new RunInterests();
    const release = interests.acquire(["r2", "r1"]);
    interests.open({ send: (data) => sent.push(data) });
    expect(frames(sent)).toEqual([{ type: "live.hello", version: 1, capabilities: ["run-interests"] }]);
    expect(interests.receive({ type: "live.capabilities", version: 1, capabilities: ["run-interests"] })).toBe(true);
    expect(frames(sent)[1]).toEqual({ type: "live.interests", version: 1, revision: 1, runIds: ["r1", "r2"] });
    release();
    expect(frames(sent)[2]).toEqual({ type: "live.interests", version: 1, revision: 2, runIds: [] });
  });

  it("sends nothing more to a server that doesn't answer the hello", () => {
    const sent: string[] = [];
    const interests = new RunInterests();
    interests.open({ send: (data) => sent.push(data) });
    interests.acquire(["r1"]);
    expect(sent).toHaveLength(1);
    expect(interests.streaming("r1")).toBe(false);
  });

  it("says a run is streaming once the server acknowledges it, and not after a resync", () => {
    const interests = new RunInterests();
    const heard = vi.fn();
    interests.listen(heard);
    interests.acquire(["r1"]);
    interests.open({ send: () => undefined });
    interests.receive({ type: "live.capabilities", version: 1, capabilities: ["run-interests"] });
    expect(interests.streaming("r1")).toBe(false);
    interests.receive({ type: "live.subscribed", version: 1, revision: 1 });
    expect(interests.streaming("r1")).toBe(true);
    interests.receive({ type: "live.resync", version: 1, revision: 1, reason: "controller_change" });
    expect(interests.streaming("r1")).toBe(false);
    interests.receive({ type: "live.subscribed", version: 1, revision: 2 });
    expect(interests.streaming("r1")).toBe(true);
    interests.close();
    expect(interests.streaming("r1")).toBe(false);
    expect(heard).toHaveBeenCalled();
  });

  it("changes the set only when a run's first holder comes or its last goes", () => {
    const sent: string[] = [];
    const interests = new RunInterests();
    interests.open({ send: (data) => sent.push(data) });
    interests.receive({ type: "live.capabilities", version: 1, capabilities: ["run-interests"] });
    const first = interests.acquire(["r1"]);
    const second = interests.acquire(["r1"]);
    first();
    first();
    expect(sent).toHaveLength(3);
    second();
    expect(frames(sent).at(-1)).toMatchObject({ revision: 3, runIds: [] });
  });

  it("sends the set again on a resync and recovers once that is acknowledged", () => {
    const sent: string[] = [];
    const recovered = vi.fn();
    const interests = new RunInterests();
    interests.acquire(["r1"]);
    interests.open({ send: (data) => sent.push(data) });
    interests.receive({ type: "live.capabilities", version: 1, capabilities: ["run-interests"] });
    interests.receive({ type: "live.subscribed", version: 1, revision: 1 }, recovered);
    expect(recovered).not.toHaveBeenCalled();
    expect(interests.receive({ type: "live.resync", version: 1, revision: 1, reason: "controller_change" }, recovered)).toBe(true);
    expect(frames(sent).at(-1)).toEqual({ type: "live.interests", version: 1, revision: 2, runIds: ["r1"] });
    // A stale acknowledgement doesn't count; the one for the resent set does, once.
    interests.receive({ type: "live.subscribed", version: 1, revision: 1 }, recovered);
    expect(recovered).not.toHaveBeenCalled();
    interests.receive({ type: "live.subscribed", version: 1, revision: 2 }, recovered);
    interests.receive({ type: "live.subscribed", version: 1, revision: 2 }, recovered);
    expect(recovered).toHaveBeenCalledTimes(1);
    // A resync for a revision never sent, or one already handled, is ignored.
    interests.receive({ type: "live.resync", version: 1, revision: 1, reason: "delivery_overflow" }, recovered);
    interests.receive({ type: "live.resync", version: 1, revision: 9, reason: "delivery_overflow" }, recovered);
    expect(sent).toHaveLength(3);
  });

  it("passes ordinary events through", () => {
    expect(new RunInterests().receive({ type: "activity.logged", companyId: "c1", payload: {} })).toBe(false);
  });
});
