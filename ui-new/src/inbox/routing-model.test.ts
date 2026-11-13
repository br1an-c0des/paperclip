import type { AttentionAudience, AttentionItem, AttentionReceipt, AttentionSourceKind } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { tabFromPath } from "./inbox-model";
import {
  alreadyClosed,
  alreadyClosedText,
  claimable,
  closeMenu,
  filterByView,
  inView,
  liveReceipts,
  ownerLine,
  receiptLine,
  unassignedNote,
  viewCounts,
  viewFromParam,
  withdrawPrompt,
  withOwner,
} from "./routing-model";

// Personal request routing (U133, upstream #20959).

const YOU = "u1";
const names: Record<string, string> = { u1: "Brian", u2: "Sam", u3: "Riley" };
const personName = (id: string) => names[id] ?? "Someone";

function item(id: string, audience: AttentionAudience, extra: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    sourceKind: "issue_thread_interaction" as AttentionSourceKind,
    subject: { kind: "interaction", id: `s-${id}`, companyId: "c1", title: id, identifier: null, status: null, href: null },
    relatedIssue: { kind: "issue", id: "i1", companyId: "c1", title: "Task", identifier: "TES-1", status: "todo", href: "/TES/issues/TES-1" },
    audience,
    stale: null,
    closeModes: ["withdraw", "archive", "snooze"],
    changeFingerprint: `fp-${id}`,
    ...extra,
  } as AttentionItem;
}

const mine: AttentionAudience = { kind: "user", userId: YOU, reason: "assignee" };
const sams: AttentionAudience = { kind: "user", userId: "u2", reason: "addressee" };
const pool: AttentionAudience = { kind: "pool", userId: null, reason: "none" };
const company: AttentionAudience = { kind: "company", userId: null, reason: "none" };
const budgetOwner: AttentionAudience = { kind: "user", userId: YOU, reason: "budget_owner", alsoInCompany: true };

describe("views", () => {
  it("opens on For you, and reads the others from ?view=", () => {
    expect(viewFromParam(undefined)).toBe("mine");
    expect(viewFromParam("unassigned")).toBe("unassigned");
    expect(viewFromParam(["company"])).toBe("company");
    expect(viewFromParam("all")).toBe("all");
    // The server's Archived view is the Inbox's Snoozed and Archived tabs.
    expect(viewFromParam("archived")).toBe("mine");
    expect(viewFromParam("nonsense")).toBe("mine");
  });

  it("places cards by the server's rule", () => {
    expect(inView(mine, "mine", YOU)).toBe(true);
    expect(inView(sams, "mine", YOU)).toBe(false);
    expect(inView(mine, "mine", null)).toBe(false);
    expect(inView(pool, "unassigned", YOU)).toBe(true);
    expect(inView(company, "unassigned", YOU)).toBe(false);
    expect(inView(company, "company", YOU)).toBe(true);
    // A budget stop with a budget owner is theirs and the company's.
    expect(inView(budgetOwner, "mine", YOU)).toBe(true);
    expect(inView(budgetOwner, "company", YOU)).toBe(true);
    expect(inView(sams, "all", YOU)).toBe(true);
    expect(inView(undefined, "mine", YOU)).toBe(false);
  });

  it("counts each view, Everyone being every card", () => {
    const items = [item("a", mine), item("b", sams), item("c", pool), item("d", pool), item("e", company), item("f", budgetOwner)];
    expect(viewCounts(items, YOU)).toEqual({ mine: 2, unassigned: 2, company: 2, all: 6 });
    expect(filterByView(items, "unassigned", YOU).map((entry) => entry.id)).toEqual(["c", "d"]);
    expect(viewCounts(items, "u2").mine).toBe(1);
  });

  it("names how many have no owner", () => {
    expect(unassignedNote(1)).toBe("1 request has no owner");
    expect(unassignedNote(4)).toBe("4 requests have no owner");
  });
});

describe("who it's for, and Claim", () => {
  it("says why a card is yours, or whose it is", () => {
    expect(ownerLine(item("a", mine), YOU, personName)).toEqual({ kind: "mine", text: "Assigned to you" });
    expect(ownerLine(item("a", { ...mine, reason: "project_owner" }), YOU, personName)?.text).toBe("You own this project's decisions");
    expect(ownerLine(item("a", { ...mine, reason: "addressee", transferredByUserId: "u2" }), YOU, personName)?.text).toBe("Transferred to you by Sam");
    expect(ownerLine(item("b", sams), YOU, personName)).toEqual({ kind: "other", userId: "u2", name: "Sam", text: "For Sam" });
  });

  it("claims only an ownerless card that can hold an owner", () => {
    expect(claimable(item("c", pool))).toBe(true);
    expect(claimable(item("c", company, { stale: { reason: "unowned" } }))).toBe(true);
    expect(claimable(item("a", mine))).toBe(false);
    expect(claimable(item("c", pool, { sourceKind: "approval" }))).toBe(false);
    expect(ownerLine(item("c", pool), YOU, personName)).toEqual({ kind: "pool", text: "No owner yet", claimable: true, why: null });
  });

  it("says what to do with an ownerless card Claim can't take", () => {
    const approval = item("p", pool, { sourceKind: "approval", relatedIssue: null, subject: { kind: "approval", id: "ap", companyId: "c1", title: "Approve", identifier: null, status: null, href: null } });
    expect(ownerLine(approval, YOU, personName)).toMatchObject({ kind: "pool", claimable: false, why: "It has no task to assign, so it can't be claimed." });
    expect(ownerLine(item("r", pool, { sourceKind: "review" }), YOU, personName)).toMatchObject({ claimable: false, why: "Assign its task to give it an owner." });
    expect(ownerLine(item("e", company, { sourceKind: "failed_run" }), YOU, personName)).toEqual({ kind: "company", text: "For the company's operators", claimable: false, why: null });
  });

  it("patches the owner a claim or transfer leaves", () => {
    expect(withOwner(item("c", pool), YOU, null).audience).toEqual({ kind: "user", userId: YOU, reason: "addressee" });
    const moved = withOwner(item("a", mine), "u2", YOU);
    expect(moved.audience).toEqual({ kind: "user", userId: "u2", reason: "addressee", transferredByUserId: YOU });
    expect(inView(moved.audience, "mine", YOU)).toBe(false);
  });
});

describe("the Close… menu", () => {
  it("offers the card's close modes, and Transfer where it can hold an owner", () => {
    expect(closeMenu(item("a", mine))).toEqual({ withdraw: true, archive: true, snooze: true, transfer: true });
    expect(closeMenu(item("h", mine, { sourceKind: "approval", closeModes: ["archive", "snooze"] }))).toEqual({ withdraw: false, archive: true, snooze: true, transfer: false });
    expect(closeMenu(item("x", company, { sourceKind: "failed_run", closeModes: [] }))).toEqual({ withdraw: false, archive: false, snooze: false, transfer: false });
  });

  it("warns before withdrawing someone else's", () => {
    expect(withdrawPrompt(ownerLine(item("a", mine), YOU, personName))).toBe("The request ends for everyone and the agent is told. It isn't approved.");
    expect(withdrawPrompt(ownerLine(item("b", sams), YOU, personName))).toMatch(/^This is for Sam\. /);
  });

  it("reads who answered first from a 409", () => {
    const details = { code: "attention_already_closed", sourceKind: "approval", sourceId: "a", status: "approved", resolvedByUserId: "u2", resolvedByAgentId: null, resolvedAt: null };
    const error = new ApiError("Already closed", 409, { error: "Already closed", details });
    expect(alreadyClosed(error)).toEqual(details);
    expect(alreadyClosedText(details as never, YOU, personName)).toBe("Already answered by Sam");
    expect(alreadyClosedText({ ...details, resolvedByUserId: YOU } as never, YOU, personName)).toBe("Already answered by you");
    expect(alreadyClosedText({ ...details, resolvedByUserId: null, resolvedByAgentId: "ag" } as never, YOU, personName)).toBe("Already answered by an agent");
    expect(alreadyClosed(new ApiError("Nope", 409, { error: "Nope" }))).toBeNull();
    expect(alreadyClosed(new Error("offline"))).toBeNull();
  });
});

describe("receipts", () => {
  const receipt = (id: string, extra: Partial<AttentionReceipt> = {}): AttentionReceipt => ({
    id,
    dismissalKey: `receipt:${id}`,
    outcome: "answered",
    sourceKind: "issue_thread_interaction",
    sourceId: id,
    title: "A question",
    reason: null,
    actorUserId: "u2",
    transferredToUserId: null,
    issue: null,
    href: null,
    createdAt: "2026-11-12T10:00:00.000Z",
    expiresAt: "2026-11-19T10:00:00.000Z",
    ...extra,
  });

  it("says who handled it, and to whom a transfer went", () => {
    expect(receiptLine(receipt("a"), personName)).toBe("Answered by Sam");
    expect(receiptLine(receipt("b", { outcome: "withdrawn" }), personName)).toBe("Withdrawn by Sam");
    expect(receiptLine(receipt("c", { outcome: "transferred", transferredToUserId: "u3" }), personName)).toBe("Transferred to Riley by Sam");
  });

  it("drops dismissed and expired ones", () => {
    const now = new Date("2026-11-13T00:00:00.000Z");
    const all = [receipt("a"), receipt("b"), receipt("old", { expiresAt: "2026-11-12T00:00:00.000Z" })];
    expect(liveReceipts(all, new Set(["receipt:b"]), now).map((entry) => entry.id)).toEqual(["a"]);
    expect(liveReceipts(undefined, new Set(), now)).toEqual([]);
  });
});

describe("the Archived tab", () => {
  it("is at /inbox/archived, and the old Cleared path lands there", () => {
    expect(tabFromPath("archived")).toBe("cleared");
    expect(tabFromPath("cleared")).toBe("cleared");
  });
});
