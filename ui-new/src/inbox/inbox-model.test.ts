import type { AttentionItem, AttentionSourceKind } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  activityGroups,
  agingLabel,
  archivedTasks,
  arrivalGroups,
  feedKind,
  filterByKind,
  groupFeed,
  inboxKeyAction,
  isFresh,
  itemKind,
  itemWords,
  lastLookedLabel,
  matchesTerms,
  kindCounts,
  placement,
  searchTerms,
  selectionAfterRemoval,
  snoozeLabel,
  stepSelection,
  tabFromPath,
  unreadCount,
  withStep,
  type Pending,
} from "./inbox-model";
import { needsYouCount } from "./needs-you";

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

describe("the nav's count", () => {
  it("counts what Needs you holds: active requests, not alerts, snoozed or cleared", () => {
    const items = [
      item("question", "issue_thread_interaction"),
      item("review", "review"),
      item("run", "failed_run"),
      item("later", "approval", { dismissal: snoozed("2026-10-29T09:00:00.000Z") }),
      item("gone", "approval", { dismissal: cleared("2026-10-26T09:00:00.000Z") }),
      item("back", "approval", { dismissal: { ...snoozed("2026-10-01T00:00:00.000Z"), isActive: false } }),
    ];
    expect(needsYouCount(items)).toBe(3);
  });

  it("leaves out requests on the aging shelf, but counts one you kept", () => {
    expect(needsYouCount([item("old", "approval", { shelf: true }), item("kept", "approval", { shelf: true, keep: true }), item("new", "review")])).toBe(2);
  });

  it("moves with a triage step patched into the cached feed", () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    const question = item("question", "issue_thread_interaction");
    const snoozedNow = withStep(question, { action: "snooze", until: "2026-10-28T09:00:00.000Z" }, now);
    expect(snoozedNow.dismissal).toEqual({ kind: "snooze", dismissedAt: now.toISOString(), snoozedUntil: "2026-10-28T09:00:00.000Z", isActive: true });
    expect(needsYouCount([snoozedNow])).toBe(0);
    expect(placement(withStep(question, { action: "clear" }, now))).toBe("cleared");
    expect(needsYouCount([withStep(snoozedNow, { action: "restore" }, now)])).toBe(1);
  });
});

describe("kinds and the kind filter", () => {
  it("reads a kind from the feed until the card loads", () => {
    expect(feedKind(item("a", "approval"))).toBe("approval");
    expect(feedKind(item("r", "review"))).toBe("signoff");
    expect(feedKind(item("d", "decision"))).toBe("proposal");
    expect(feedKind(item("j", "join_request"))).toBe("approval");
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

describe("the aging shelf", () => {
  it("takes requests idle past their retention days out of Needs you, newest activity first, until kept", () => {
    const groups = groupFeed([
      item("fresh", "approval"),
      item("old", "approval", { shelf: true, activityAt: "2026-09-01T00:00:00.000Z" }),
      item("older", "review", { shelf: true, activityAt: "2026-08-01T00:00:00.000Z" }),
      item("kept", "approval", { shelf: true, keep: true }),
      item("broken", "failed_run", { shelf: true }),
    ]);
    expect(groups.needs.map((entry) => entry.id)).toEqual(["fresh", "kept"]);
    expect(groups.aging.map((entry) => entry.id)).toEqual(["old", "older"]);
    // Alerts don't age.
    expect(groups.alerts.map((entry) => entry.id)).toEqual(["broken"]);
  });

  it("names the group after the shortest retention", () => {
    expect(agingLabel([{ retentionDays: 30 }])).toBe("Older than 30 days");
    expect(agingLabel([{ retentionDays: 30 }, { retentionDays: 1 }])).toBe("Older than 1 day");
  });
});

describe("time", () => {
  const now = new Date(2026, 9, 28, 15, 0);
  it("splits Needs you into New today and Earlier, keeping the order", () => {
    const groups = arrivalGroups(
      [item("b", "approval", { createdAt: new Date(2026, 9, 27, 23, 0).toISOString() }), item("a", "approval", { createdAt: new Date(2026, 9, 28, 1, 0).toISOString() })],
      now,
    );
    expect(groups.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ["New today", ["a"]],
      ["Earlier", ["b"]],
    ]);
  });

  it("groups Updates by latest activity", () => {
    const at = (h: number, d = 28) => new Date(2026, 9, d, h, 0).toISOString();
    const tasks = [
      { id: "1", at: at(14, 28) },
      { id: "2", at: at(9) },
      { id: "3", at: at(9, 27) },
      { id: "4", at: at(9, 24) },
      { id: "5", at: at(9, 1) },
    ];
    expect(activityGroups(tasks, (task) => task.at, now).map((group) => [group.label, group.items.map((task) => task.id)])).toEqual([
      ["Last hour", ["1"]],
      ["Earlier today", ["2"]],
      ["Yesterday", ["3"]],
      ["Earlier this week", ["4"]],
      ["Older", ["5"]],
    ]);
  });

  it("marks what arrived after you last looked, and says when that was", () => {
    expect(isFresh({ createdAt: "2026-10-28T10:00:00.000Z" }, Date.parse("2026-10-28T09:00:00.000Z"))).toBe(true);
    expect(isFresh({ createdAt: "2026-10-28T08:00:00.000Z" }, Date.parse("2026-10-28T09:00:00.000Z"))).toBe(false);
    expect(lastLookedLabel(new Date(2026, 9, 28, 9, 40).getTime(), now)).toBe("at 9:40 am");
    expect(lastLookedLabel(new Date(2026, 9, 27, 18, 5).getTime(), now)).toBe("yesterday at 6:05 pm");
    expect(lastLookedLabel(new Date(2026, 9, 20, 18, 5).getTime(), now)).toBe("on Oct 20");
  });
});

describe("search", () => {
  it("matches every word against the item's subject, task, reason and who raised it", () => {
    const found = item("q", "issue_thread_interaction", {
      subject: { kind: "interaction", id: "i1", companyId: "c1", title: "Which strategies first?", identifier: null, status: null, href: null },
      relatedIssue: { kind: "issue", id: "t1", companyId: "c1", title: "Port strategies", identifier: "TRA-38", status: "todo", href: null },
      originAgentName: "Quant Researcher",
    });
    expect(matchesTerms(searchTerms("  tra-38 QUANT "), itemWords(found))).toBe(true);
    expect(matchesTerms(searchTerms("tra-38 budget"), itemWords(found))).toBe(false);
    expect(matchesTerms(searchTerms(""), [])).toBe(true);
  });
});
