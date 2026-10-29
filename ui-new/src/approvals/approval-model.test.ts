import type { Approval } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { afterApproval, approvalFollowUps, approvalStatus, hiredAgentId, isOpenApproval, sortApprovals } from "./approval-model";

const approval = (over: Partial<Approval>) => ({ status: "pending", type: "approve_ceo_strategy", payload: {}, createdAt: new Date("2026-10-01"), ...over }) as Approval;

describe("approvalStatus", () => {
  it("names known statuses and falls back for others", () => {
    expect(approvalStatus("revision_requested").label).toBe("Changes requested");
    expect(approvalStatus("some_new_state")).toEqual({ label: "some new state", gradient: "ash" });
  });
});

describe("approvalFollowUps", () => {
  it("offers resubmitting a request sent back", () => {
    expect(approvalFollowUps(approval({ status: "revision_requested" })).resubmit).toBe(true);
    expect(approvalFollowUps(approval({ status: "pending" })).resubmit).toBe(false);
  });

  it("offers deleting the agent of a rejected hire", () => {
    const hire = approval({ status: "rejected", type: "hire_agent", payload: { agentId: "a1" } });
    expect(hiredAgentId(hire)).toBe("a1");
    expect(approvalFollowUps(hire).removeHire).toBe(true);
    expect(approvalFollowUps({ ...hire, payload: {} }).removeHire).toBe(false);
    expect(approvalFollowUps({ ...hire, status: "approved" }).removeHire).toBe(false);
  });

  it("links budget controls while a budget stop is open", () => {
    expect(approvalFollowUps(approval({ type: "budget_override_required" })).budget).toBe(true);
    expect(approvalFollowUps(approval({ type: "budget_override_required", status: "approved" })).budget).toBe(false);
  });
});

describe("afterApproval", () => {
  it("leads to the linked task, the new agent, or the Inbox", () => {
    expect(afterApproval(approval({}), [{ id: "i1", identifier: "TES-1" }])).toEqual({ label: "Review the linked task", href: "issues/TES-1" });
    expect(afterApproval(approval({}), [{ id: "i1", identifier: null }, { id: "i2", identifier: null }]).label).toBe("Review the linked tasks");
    expect(afterApproval(approval({ type: "hire_agent", payload: { agentId: "a1" } }), [], "nova")).toEqual({ label: "Open the new agent", href: "agents/nova" });
    expect(afterApproval(approval({}), []).href).toBe("inbox");
  });
});

describe("sortApprovals", () => {
  it("puts open ones first, then newest first", () => {
    const list = [
      approval({ id: "old-open", status: "pending", createdAt: new Date("2026-09-01") }),
      approval({ id: "new-done", status: "approved", createdAt: new Date("2026-10-20") }),
      approval({ id: "new-open", status: "revision_requested", createdAt: new Date("2026-10-10") }),
    ];
    expect(sortApprovals(list).map((entry) => entry.id)).toEqual(["new-open", "old-open", "new-done"]);
    expect(isOpenApproval(list[1]!)).toBe(false);
  });
});
