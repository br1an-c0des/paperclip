import type { AttentionItem, AttentionSourceKind } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  archivedTasks,
  feedKind,
  filterByKind,
  groupFeed,
  inboxKeyAction,
  itemKind,
  kindCounts,
  placement,
  selectionAfterRemoval,
  signoffOf,
  snoozeLabel,
  stepSelection,
  tabFromPath,
  unreadCount,
  type Pending,
} from "./inbox-model";

function item(id: string, sourceKind: AttentionSourceKind, extra: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    companyId: "c1",
    sourceKind,
    subject: { kind: "issue", id: `s-${id}`, companyId: "c1", title: id, identifier: null, status: null, href: null },
    whyNow: "",
    decisionVerbs: [],
    inlineResolvable: false,
    entryRule: "",
    exitRule: "",
    dedupKey: id,
    dismissalKey: `attention:${id}`,
    dismissal: null,
    severity: "medium",
    rank: 10,
    activityAt: "2026-10-27T10:00:00.000Z",
    createdAt: "2026-10-27T10:00:00.000Z",
    updatedAt: "2026-10-27T10:00:00.000Z",
    relatedIssue: null,
    project: null,
    workspace: null,
    expiresAt: null,
    ruleKey: null,
    originAgentName: null,
    queues: [],
    shelf: false,
    retentionDays: 30,
    keep: false,
    archivedAt: null,
    retentionVersion: 1,
    decideBy: null,
    decideByAttribution: null,
    snoozedUntil: null,
    detail: null,
    trainingExampleId: null,
    ...extra,
  };
}

const snoozed = (until: string) => ({ kind: "snooze" as const, dismissedAt: "2026-10-27T09:00:00.000Z", snoozedUntil: until, isActive: true });
const cleared = (at: string) => ({ kind: "dismiss" as const, dismissedAt: at, snoozedUntil: null, isActive: true });

describe("tabFromPath", () => {
  it("reads the tab from the path, and sends the old Inbox's paths to the closest tab", () => {
    expect(tabFromPath(undefined)).toBe("needs");
    expect(tabFromPath("")).toBe("needs");
    expect(tabFromPath("alerts")).toBe("alerts");
    expect(tabFromPath("cleared")).toBe("cleared");
    expect(tabFromPath("mine")).toBe("updates");
    expect(tabFromPath("unread")).toBe("updates");
    expect(tabFromPath("blocked")).toBe("alerts");
    expect(tabFromPath("nonsense")).toBe("needs");
  });
});

describe("groupFeed", () => {
  it("puts requests in Needs you and breakages in Alerts, most urgent first", () => {
    const groups = groupFeed([
      item("question", "issue_thread_interaction", { rank: 3 }),
      item("run", "failed_run", { rank: 1 }),
      item("approval", "approval", { rank: 1 }),
      item("blocker", "blocker_attention", { rank: 2 }),
      item("review", "review", { rank: 2, severity: "high" }),
      item("join", "join_request", { rank: 2, severity: "low" }),
    ]);
    expect(groups.needs.map((entry) => entry.id)).toEqual(["approval", "review", "join", "question"]);
    expect(groups.alerts.map((entry) => entry.id)).toEqual(["run", "blocker"]);
  });

  it("files snoozed and cleared items apart; snoozed by when they return, cleared newest first", () => {
    const groups = groupFeed([
      item("later", "approval", { dismissal: snoozed("2026-10-29T09:00:00.000Z") }),
      item("soon", "failed_run", { dismissal: snoozed("2026-10-28T09:00:00.000Z") }),
      item("old", "approval", { dismissal: cleared("2026-10-20T09:00:00.000Z") }),
      item("new", "review", { dismissal: cleared("2026-10-26T09:00:00.000Z") }),
      item("expired", "approval", { dismissal: { ...snoozed("2026-10-01T00:00:00.000Z"), isActive: false } }),
    ]);
    expect(groups.snoozed.map((entry) => entry.id)).toEqual(["soon", "later"]);
    expect(groups.cleared.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(groups.needs.map((entry) => entry.id)).toEqual(["expired"]);
  });

  it("shows a triage step at once, ahead of the feed", () => {
    const pending = new Map<string, Pending>([
      ["a", { action: "clear" }],
      ["b", { action: "snooze", until: "2026-10-28T09:00:00.000Z" }],
      ["c", { action: "restore" }],
    ]);
    const groups = groupFeed(
      [item("a", "approval"), item("b", "failed_run"), item("c", "approval", { dismissal: cleared("2026-10-26T09:00:00.000Z") }), item("d", "approval")],
      pending,
    );
    expect(groups.cleared.map((entry) => entry.id)).toEqual(["a"]);
    expect(groups.snoozed.map((entry) => entry.id)).toEqual(["b"]);
    expect(groups.needs.map((entry) => entry.id).sort()).toEqual(["c", "d"]);
  });
});

describe("placement", () => {
  it("follows the dismissal, unless a step taken here says otherwise", () => {
    expect(placement({ dismissal: null })).toBe("active");
    expect(placement({ dismissal: snoozed("2026-10-28T09:00:00.000Z") })).toBe("snoozed");
    expect(placement({ dismissal: cleared("2026-10-26T09:00:00.000Z") })).toBe("cleared");
    expect(placement({ dismissal: cleared("2026-10-26T09:00:00.000Z") }, { action: "restore" })).toBe("active");
  });
});

describe("kinds and the kind filter", () => {
  it("reads a kind from the feed until the card loads", () => {
    expect(feedKind(item("a", "approval"))).toBe("approval");
    expect(feedKind(item("r", "review"))).toBe("signoff");
    expect(feedKind(item("d", "decision"))).toBe("proposal");
    const question = item("q", "issue_thread_interaction", {
      subject: { kind: "interaction", id: "i1", companyId: "c1", title: null, identifier: null, status: "pending", href: null, metadata: { kind: "ask_user_questions" } },
    });
    const suggested = item("s", "issue_thread_interaction", {
      subject: { kind: "interaction", id: "i2", companyId: "c1", title: null, identifier: null, status: "pending", href: null, metadata: { kind: "suggest_tasks" } },
    });
    expect(feedKind(question)).toBe("question");
    expect(feedKind(suggested)).toBe("proposal");
    // A confirmation that runs a tool is a proposal: only its card knows.
    expect(itemKind(question, { kind: "proposal" })).toBe("proposal");
  });

  it("counts and filters by kind", () => {
    const items = [item("a", "approval"), item("b", "approval"), item("r", "review"), item("d", "decision")];
    expect(kindCounts(items, feedKind)).toEqual({ all: 4, question: 0, proposal: 1, approval: 2, signoff: 1 });
    expect(filterByKind(items, "approval", feedKind).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(filterByKind(items, "all", feedKind)).toHaveLength(4);
  });
});

describe("keyboard triage", () => {
  it("maps the old inbox's keys", () => {
    expect(inboxKeyAction("j")).toBe("next");
    expect(inboxKeyAction("ArrowUp")).toBe("previous");
    expect(inboxKeyAction("Enter")).toBe("open");
    expect(inboxKeyAction("y")).toBe("clear");
    expect(inboxKeyAction("x")).toBe("clear");
    expect(inboxKeyAction("s")).toBe("snooze");
    expect(inboxKeyAction("a")).toBe("answer");
    expect(inboxKeyAction("r")).toBe("read");
    expect(inboxKeyAction("U")).toBe("unread");
    expect(inboxKeyAction("u")).toBe("restore");
    expect(inboxKeyAction("q")).toBeNull();
  });

  it("moves the cursor, stopping at the ends", () => {
    const ids = ["a", "b", "c"];
    expect(stepSelection(ids, null, 1)).toBe("a");
    expect(stepSelection(ids, null, -1)).toBe("c");
    expect(stepSelection(ids, "a", 1)).toBe("b");
    expect(stepSelection(ids, "c", 1)).toBe("c");
    expect(stepSelection(ids, "a", -1)).toBe("a");
    expect(stepSelection([], null, 1)).toBeNull();
  });

  it("hands the cursor on when its row leaves", () => {
    expect(selectionAfterRemoval(["a", "b", "c"], "b")).toBe("c");
    expect(selectionAfterRemoval(["a", "b", "c"], "c")).toBe("b");
    expect(selectionAfterRemoval(["a"], "a")).toBeNull();
  });
});

describe("snoozeLabel", () => {
  const now = new Date("2026-10-27T10:00:00.000Z");
  it("says when a snoozed item comes back", () => {
    expect(snoozeLabel("2026-10-27T10:40:00.000Z", now)).toBe("Back in 40m");
    expect(snoozeLabel("2026-10-27T13:00:00.000Z", now)).toBe("Back in 3h");
    expect(snoozeLabel("2026-10-29T10:00:00.000Z", now)).toBe("Back in 2d");
    expect(snoozeLabel("2026-10-27T09:00:00.000Z", now)).toBe("Back soon");
    expect(snoozeLabel(null, now)).toBe("Back soon");
  });
});

describe("Updates", () => {
  it("counts unread tasks and finds archived ones", () => {
    expect(unreadCount([{ isUnreadForMe: true }, { isUnreadForMe: false }, {}])).toBe(1);
    expect(unreadCount(undefined)).toBe(0);
    expect(archivedTasks([{ id: "a" }, { id: "b" }, { id: "c" }], [{ id: "b" }]).map((task) => task.id)).toEqual(["a", "c"]);
  });
});

describe("signoffOf", () => {
  const nameOf = (key: string) => ({ "user:me": "You", "user:sam": "Sam", "agent:se": "Strategy Engineer", "user:ceo": "CEO" })[key] ?? key;
  const policy = {
    stages: [
      { id: "s1", type: "review", participants: [{ type: "user", userId: "me", agentId: null }] },
      { id: "s2", type: "approval", participants: [{ type: "user", userId: "ceo", agentId: null }] },
    ],
  };
  const state = (participant: string, extra: object = {}) => ({
    status: "pending" as const,
    currentStageId: "s1",
    currentStageIndex: 0,
    currentStageType: "review" as const,
    currentParticipant: { type: "user" as const, userId: participant, agentId: null },
    returnAssignee: { type: "agent" as const, agentId: "se", userId: null },
    reviewRequest: null,
    completedStageIds: [],
    lastDecisionId: null,
    lastDecisionOutcome: null,
    ...extra,
  });

  it("marks the current stage, where the task returns, and that it's your turn", () => {
    const result = signoffOf({ executionPolicy: policy, executionState: state("me") }, "me", nameOf);
    expect(result.steps).toEqual([
      { type: "review", label: "Review · you", now: true },
      { type: "approval", label: "Approval · CEO", now: false },
    ]);
    expect(result.returns).toBe("Returns to Strategy Engineer if sent back · round 1 of 3");
    expect(result.yours).toBe(true);
    expect(result.waitingOn).toBeNull();
  });

  it("says who it waits on when it isn't you, and counts rounds", () => {
    const result = signoffOf({ executionPolicy: { ...policy, maxReviewRounds: 2 }, executionState: state("sam", { changesRequestedCount: 1 }) }, "me", nameOf);
    expect(result.yours).toBe(false);
    expect(result.waitingOn).toBe("Sam");
    expect(result.steps[0]!.label).toBe("Review · Sam");
    expect(result.returns).toBe("Returns to Strategy Engineer if sent back · round 2 of 2");
  });

  it("treats a task in review assigned to you, without stages, as yours", () => {
    const result = signoffOf({ executionPolicy: null, executionState: null, assigneeUserId: "me" }, "me", nameOf);
    expect(result).toEqual({ steps: [], returns: null, yours: true, waitingOn: null });
  });
});
