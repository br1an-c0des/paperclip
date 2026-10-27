import type { LiveEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { keysForEvent } from "./live-events";

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
