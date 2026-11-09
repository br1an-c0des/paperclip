import type { IssueBlockerAttention } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { blockedTitle, isQueued, shownStatus, statusLook, statusNote } from "./status-meta";

const attention = (patch: Partial<IssueBlockerAttention>): IssueBlockerAttention => ({
  state: "covered",
  reason: "active_child",
  unresolvedBlockerCount: 1,
  coveredBlockerCount: 1,
  stalledBlockerCount: 0,
  attentionBlockerCount: 0,
  sampleBlockerIdentifier: "TES-5",
  sampleStalledBlockerIdentifier: null,
  ...patch,
});

describe("statusLook", () => {
  it("draws a blocked task covered by an active sub-task in the queue, keeping the Blocked label", () => {
    const look = statusLook({ status: "blocked", blockerAttention: attention({}) });
    expect(look).toEqual({ status: "blocked", queued: true, label: "Blocked", title: "Blocked · waiting on active sub-task TES-5", tone: "run" });
    expect(statusNote(look)).toBe("Waiting on active sub-task TES-5");
  });

  it("leaves a blocked task that needs attention red", () => {
    const look = statusLook({
      status: "blocked",
      blockerAttention: attention({ state: "needs_attention", reason: "attention_required", attentionBlockerCount: 2, coveredBlockerCount: 1 }),
    });
    expect(look.queued).toBe(false);
    expect(look.tone).toBe("red");
    expect(look.title).toBe("Blocked · 2 blockers need attention; 1 covered by active work");
  });

  it("reads plain Blocked with no blocker state, or a count of none", () => {
    expect(statusLook({ status: "blocked" }).title).toBe("Blocked");
    expect(statusNote(statusLook({ status: "blocked" }))).toBeNull();
    // The server's summaries can say attention_required with every count at 0.
    expect(blockedTitle(attention({ state: "needs_attention", reason: "attention_required", unresolvedBlockerCount: 0, coveredBlockerCount: 0 }))).toBe("Blocked");
  });

  it("keeps Monitoring alongside", () => {
    expect(statusLook({ status: "in_progress", displayStatus: "monitoring" })).toMatchObject({ status: "monitoring", queued: false, label: "Monitoring", tone: "run" });
    expect(shownStatus({ status: "in_progress", displayStatus: "monitoring" })).toBe("monitoring");
  });

  it("shows what an in-progress task with no run waits on (#19453)", () => {
    for (const shown of ["todo", "in_review", "blocked", "monitoring", "in_progress"] as const) {
      expect(shownStatus({ status: "in_progress", displayStatus: shown })).toBe(shown);
    }
    expect(statusLook({ status: "in_progress", displayStatus: "todo" })).toMatchObject({ status: "todo", label: "Todo", tone: "amber" });
    // Projected to Blocked, it words and queues the blockers as a stored Blocked does.
    expect(statusLook({ status: "in_progress", displayStatus: "blocked", blockerAttention: attention({}) })).toMatchObject({
      status: "blocked",
      queued: true,
      title: "Blocked · waiting on active sub-task TES-5",
    });
  });

  it("lets a saved or optimistic status change win over a stale projection", () => {
    for (const status of ["done", "cancelled", "blocked", "in_review", "todo", "backlog"] as const) {
      expect(shownStatus({ status, displayStatus: "in_progress" })).toBe(status);
    }
    expect(statusLook({ status: "todo", displayStatus: "blocked", blockerAttention: attention({}) })).toMatchObject({ status: "todo", queued: false, title: "Todo" });
    expect(shownStatus({ status: "in_progress" })).toBe("in_progress");
    expect(shownStatus({ status: "done", displayStatus: null })).toBe("done");
  });

  it("only queues blocked tasks", () => {
    expect(isQueued({ status: "todo", blockerAttention: attention({}) })).toBe(false);
    expect(isQueued({ status: "blocked", blockerAttention: attention({ state: "stalled", reason: "stalled_review" }) })).toBe(false);
  });
});

describe("blockedTitle", () => {
  it("words each reason as the old UI does", () => {
    expect(blockedTitle(attention({ coveredBlockerCount: 3 }))).toBe("Blocked · waiting on 3 active sub-tasks");
    expect(blockedTitle(attention({ sampleBlockerIdentifier: null }))).toBe("Blocked · waiting on 1 active sub-task");
    expect(blockedTitle(attention({ reason: "active_dependency" }))).toBe("Blocked · covered by active dependency TES-5");
    expect(blockedTitle(attention({ reason: "active_dependency", coveredBlockerCount: 2 }))).toBe("Blocked · covered by 2 active dependencies");
    expect(blockedTitle(attention({ state: "stalled", reason: "stalled_review", stalledBlockerCount: 1, sampleStalledBlockerIdentifier: "TES-7" }))).toBe(
      "Blocked · review stalled on TES-7",
    );
    expect(blockedTitle(attention({ state: "stalled", reason: "stalled_review", stalledBlockerCount: 2 }))).toBe("Blocked · 2 reviews stalled with no clear next step");
    expect(blockedTitle(attention({ state: "needs_attention", reason: "attention_required", attentionBlockerCount: 1, coveredBlockerCount: 0 }))).toBe(
      "Blocked · 1 blocker needs attention",
    );
  });
});
