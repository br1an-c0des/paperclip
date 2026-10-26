import type { LiveEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  activityToast,
  admitToast,
  createToastGate,
  quietAfterReconnect,
  runStatusToast,
  toastForEvent,
  type ToastLookup,
} from "./live-toasts";

const lookup = (overrides: Partial<ToastLookup> = {}): ToastLookup => ({
  prefix: "GEA",
  userId: "me",
  agentName: (id) => (id === "a1" ? "Ada" : null),
  agentRef: (id) => id,
  userName: () => null,
  issue: (id) => (id === "i1" ? { id: "i1", identifier: "GEA-1", title: "Fix login" } : null),
  visibleIssueRef: () => null,
  ...overrides,
});

const activity = (action: string, extra: Record<string, unknown> = {}) => ({
  entityType: "issue",
  entityId: "i1",
  action,
  actorType: "agent",
  actorId: "a1",
  ...extra,
});

const event = (type: LiveEvent["type"], payload: Record<string, unknown>, toastEligible = true): LiveEvent => ({
  id: 1,
  companyId: "c1",
  type,
  createdAt: new Date().toISOString(),
  toastEligible,
  payload,
});

describe("activityToast", () => {
  it("names the actor and links to the task", () => {
    const toast = activityToast(lookup(), activity("issue.created"));
    expect(toast).toMatchObject({ title: "Ada created GEA-1", body: "Fix login", tone: "success" });
    expect(toast?.action?.href).toBe("/GEA/issues/GEA-1");
  });

  it("stays quiet for your own activity, the open task, and comment-sourced updates", () => {
    expect(activityToast(lookup(), activity("issue.created", { actorType: "user", actorId: "me" }))).toBeNull();
    expect(activityToast(lookup({ visibleIssueRef: () => "GEA-1" }), activity("issue.updated"))).toBeNull();
    expect(activityToast(lookup(), activity("issue.updated", { details: { source: "comment" } }))).toBeNull();
  });

  it("describes what an update changed", () => {
    const toast = activityToast(lookup(), activity("issue.updated", { details: { status: "in_review" } }));
    expect(toast?.body).toBe("Fix login · status → in review");
  });
});

describe("runStatusToast", () => {
  const run = { runId: "r1", agentId: "a1", status: "failed", error: "Out of credits" };

  it("reports failures with a link to the run", () => {
    expect(runStatusToast(lookup(), run)).toMatchObject({ title: "Ada's run failed", body: "Out of credits", tone: "error" });
    expect(runStatusToast(lookup(), run)?.action?.href).toBe("/GEA/agents/a1/runs/r1");
  });

  it("skips successes, interrupts and workspace contention", () => {
    expect(runStatusToast(lookup(), { ...run, status: "succeeded" })).toBeNull();
    expect(runStatusToast(lookup(), { ...run, errorCode: "operator_interrupted" })).toBeNull();
    expect(runStatusToast(lookup(), { ...run, errorCode: "workspace_busy" })).toBeNull();
  });
});

describe("the toast gate", () => {
  it("is quiet right after a reconnect and caps each kind", () => {
    const gate = createToastGate();
    quietAfterReconnect(gate, 1000);
    expect(admitToast(gate, "x", 2000)).toBe(false);
    expect([3100, 3200, 3300, 3400].map((at) => admitToast(gate, "x", at))).toEqual([true, true, true, false]);
    expect(admitToast(gate, "y", 3400)).toBe(true);
    expect(admitToast(gate, "x", 14_000)).toBe(true);
  });

  it("needs eligibility for task toasts and shows each run outcome once", () => {
    const gate = createToastGate();
    expect(toastForEvent(gate, lookup(), event("activity.logged", activity("issue.created"), false))).toBeNull();
    const failed = event("heartbeat.run.status", { runId: "r1", agentId: "a1", status: "failed", finishedAt: new Date().toISOString() });
    expect(toastForEvent(gate, lookup(), failed)?.kind).toBe("run-status");
    expect(toastForEvent(gate, lookup(), failed)).toBeNull();
  });

  it("lets join requests through without eligibility", () => {
    const join = event("activity.logged", { entityType: "join_request", entityId: "j1", action: "join.requested" }, false);
    expect(toastForEvent(createToastGate(), lookup(), join)?.toast.title).toBe("Someone wants to join");
  });
});
