import type { Approval, PermissionRequestPayload } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { requestType } from "@/inbox/row-model";
import { argumentRows, missingActionWords, permissionExpired, permissionRequestOf, permissionResult, toolWords } from "./permission-model";
import { approvalTitle, requestFromApproval } from "./request-model";

const payload = (extra: Partial<PermissionRequestPayload> = {}): PermissionRequestPayload => ({
  version: 1,
  caller: { kind: "run", agentId: "a1", userId: null, runId: "r1", grantId: null },
  taskId: "t1",
  tool: "paperclip_delete_task",
  arguments: { issueId: "TES-12", hard: true },
  missingAction: "tasks:delete",
  summary: "Delete task TES-12",
  expiresAt: "2026-11-25T12:00:00Z",
  ...extra,
});

const approval = (extra: Partial<Approval> = {}, body: Partial<PermissionRequestPayload> = {}): Approval => ({
  id: "ap1",
  companyId: "co1",
  type: "permission_request",
  requestedByAgentId: "a1",
  requestedByUserId: null,
  status: "pending",
  payload: payload(body) as unknown as Record<string, unknown>,
  decisionNote: null,
  decidedByUserId: null,
  decidedAt: null,
  createdAt: new Date("2026-11-18T12:00:00Z"),
  updatedAt: new Date("2026-11-18T12:00:00Z"),
  ...extra,
});

const ctx = {
  youId: "me",
  agentName: (id: string) => (id === "a1" ? "Ada" : undefined),
  personName: (id: string) => (id === "u1" ? "Brian" : id),
  task: { id: "t1", identifier: "TES-12", title: "Clean up" },
  now: new Date("2026-11-20T12:00:00Z"),
};

describe("permission-model", () => {
  it("reads a well-formed payload only", () => {
    expect(permissionRequestOf(approval())?.tool).toBe("paperclip_delete_task");
    expect(permissionRequestOf({ type: "permission_request", payload: { tool: "x" } })).toBeNull();
    expect(permissionRequestOf({ type: "hire_agent", payload: payload() as never })).toBeNull();
  });

  it("puts the tool, its arguments and the missing action in plain words", () => {
    expect(toolWords("paperclip_delete_task")).toBe("Delete task");
    expect(toolWords("paperclip_manage_labels")).toBe("Manage labels");
    expect(argumentRows({ issueId: "TES-12", labelIds: ["a", "b"], patch: { status: "done" }, note: null })).toEqual([
      ["Issue id", "TES-12"],
      ["Label ids", "a, b"],
      ["Patch", '{"status":"done"}'],
      ["Note", "none"],
    ]);
    expect(missingActionWords({ missingAction: "tasks:delete" })).toBe("Delete tasks");
  });

  it("knows when it has expired", () => {
    expect(permissionExpired({ expiresAt: "2026-11-25T12:00:00Z" }, new Date("2026-11-20T12:00:00Z"))).toBe(false);
    expect(permissionExpired({ expiresAt: "2026-11-25T12:00:00Z" }, new Date("2026-11-26T12:00:00Z"))).toBe(true);
  });

  it("says what the replay did", () => {
    expect(permissionResult({ result: { status: "done", detail: "Deleted TES-12", at: "x" } })).toEqual({ text: "Ran: Deleted TES-12", tone: "ok" });
    expect(permissionResult({ result: { status: "refused", detail: "The task is locked by another run", at: "x" } })).toEqual({ text: "Refused when it ran: The task is locked by another run", tone: "bad" });
    expect(permissionResult({ result: { status: "refused", detail: "expired", at: "x" } })).toEqual({ text: "Not run: the request had expired", tone: "muted" });
    expect(permissionResult({ result: { status: "failed", detail: "", at: "x" } })).toEqual({ text: "Failed when it ran", tone: "bad" });
    expect(permissionResult({})).toBeNull();
  });
});

describe("a permission request as a request", () => {
  it("is a Permission, titled by its summary, asked by the agent, about its task", () => {
    const request = requestFromApproval(approval(), ctx);
    expect(requestType(request)).toBe("Permission");
    expect(approvalTitle(approval())).toBe("Delete task TES-12");
    expect(request).toMatchObject({
      title: "Delete task TES-12",
      asker: { agentId: "a1", userId: null, name: "Ada" },
      askVerb: "asks for permission",
      acts: true,
      state: "open",
      subject: { kind: "task", label: "TES-12", issueId: "t1" },
      respond: { allowed: true },
      lifetime: "Expires in 5 days",
    });
    expect(request.next).toContain("Approving runs “Delete task” once as Ada");
  });

  it("names a person who came in through an outside connection", () => {
    const request = requestFromApproval(
      approval({ requestedByAgentId: null, requestedByUserId: "u1" }, { caller: { kind: "oauth_person", agentId: null, userId: "u1", runId: null, grantId: "g1" }, taskId: null }),
      { ...ctx, task: null },
    );
    expect(request.asker).toEqual({ agentId: null, userId: "u1", name: "Brian (outside connection)" });
    expect(request.subject).toEqual({ kind: "company", label: "The company" });
  });

  it("links the task from the payload when the approval's task isn't loaded", () => {
    expect(requestFromApproval(approval(), { ...ctx, task: null }).subject).toEqual({ kind: "task", label: "Its task", issueId: "t1" });
  });

  it("says it has expired, and settles with the replay's result", () => {
    expect(requestFromApproval(approval(), { ...ctx, now: new Date("2026-11-26T00:00:00Z") })).toMatchObject({ lifetime: "Expired", lifetimeSoon: true, state: "open" });
    const decided = requestFromApproval(
      approval({ status: "approved", decidedByUserId: "me", decidedAt: new Date("2026-11-20T13:00:00Z") }, { result: { status: "done", detail: "Deleted TES-12", at: "2026-11-20T13:00:01Z" } }),
      ctx,
    );
    expect(decided).toMatchObject({ state: "settled", verdict: { text: "You approved", tone: "ok" }, result: { text: "Ran: Deleted TES-12", tone: "ok" } });
    expect(requestFromApproval(approval({ status: "rejected", decidedByUserId: "me" }), ctx).verdict).toMatchObject({ text: "You denied", tone: "bad" });
  });
});
