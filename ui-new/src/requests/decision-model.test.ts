import type { DecisionOption } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { DecisionOutcome } from "@/api/decisions";
import {
  changedTargets,
  effectPreview,
  effectResult,
  effectTargetIds,
  heldBack,
  isArchiveProposal,
  referencedIssueIds,
  requestFromDecision,
  type IssueRef,
} from "./decision-model";

/*
 * Proposals (Decisions) can only be made by an agent run (`POST /companies/:id/decisions` needs run
 * context), so these cover the stored shapes `GET /decisions/:id` returns.
 */

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";

const refs: Record<string, IssueRef> = {
  [T1]: { id: T1, identifier: "TRA-45", title: "Start ML testing", status: "blocked" },
  [T2]: { id: T2, identifier: "TRA-41", title: "Backfill", status: "in_progress" },
  [T3]: { id: T3, identifier: "TRA-50", title: "New task", status: "todo" },
};
const resolve = (id: string) => refs[id] ?? null;
const nameOf = (agentId: string | null | undefined) => (agentId === "a2" ? "ML Engineer" : "someone");

const options: DecisionOption[] = [
  {
    id: "start",
    label: "Start with BTC and ETH now",
    effects: [
      { type: "resolve_blocker", targetIssueId: T1, staleness: "strict", removeBlockedByIssueIds: [T2] },
      { type: "update_issue_status", targetIssueId: T1, staleness: "lenient", status: "todo" },
    ],
  },
  {
    id: "hand",
    label: "Hand the SOL backfill to ML Engineer",
    effects: [{ type: "create_issue", targetIssueId: T1, staleness: "lenient", draft: { title: "SOL backfill", parentId: T1, assigneeAgentId: "a2" } }],
  },
  { id: "wait", label: "Keep waiting", effects: [] },
];

const decision: DecisionOutcome = {
  id: "d1",
  companyId: "c1",
  bundleId: null,
  originAgentId: "a1",
  originIssueId: T1,
  originRunId: "r1",
  ruleKey: null,
  title: "How should we unblock ML testing?",
  body: "TRA-45 has been blocked for 5 hours.",
  options,
  inputs: null,
  status: "open",
  executionStatus: null,
  chosenOptionId: null,
  inputValues: null,
  decidedByUserId: null,
  decidedAt: null,
  expiresAt: "2026-11-02T10:00:00Z",
  targetSnapshots: { [T1]: { status: "blocked", assigneeAgentId: "a1", assigneeUserId: null, updatedAt: "2026-10-26T10:00:00Z" } },
  continuationPolicy: "wake_origin_agent",
  metadata: {},
  createdAt: "2026-10-26T10:00:00Z",
  updatedAt: "2026-10-26T10:00:00Z",
  executions: [],
};

const ctx = {
  youId: "me",
  agentName: (id: string) => (id === "a1" ? "CEO" : undefined),
  personName: (id: string) => (id === "u2" ? "Sam K." : id),
  task: { id: T1, identifier: "TRA-45", title: "Start ML testing" },
  now: new Date("2026-10-27T10:00:00Z"),
};

describe("decision model", () => {
  it("lists the tasks an effect touches, and every task a decision names", () => {
    expect(effectTargetIds(options[0]!.effects[0]!)).toEqual([T1, T2]);
    expect(effectTargetIds(options[1]!.effects[0]!)).toEqual([T1]);
    const withArchive = { ...decision, targetSnapshots: { ...decision.targetSnapshots, "attention:approval:x": decision.targetSnapshots[T1]! } };
    expect(referencedIssueIds({ ...withArchive, executions: [{ ...execution("executed"), result: { issueId: T3 } }] }).sort()).toEqual([T1, T2, T3].sort());
  });

  it("previews each effect in words", () => {
    const snapshots = decision.targetSnapshots;
    expect(effectPreview(options[0]!.effects[0]!, resolve, snapshots, nameOf)).toBe("Unblock TRA-45: remove 1 blocker");
    expect(effectPreview(options[0]!.effects[1]!, resolve, snapshots, nameOf)).toBe("Set TRA-45 to Todo");
    expect(effectPreview(options[1]!.effects[0]!, resolve, snapshots, nameOf)).toBe('Create a task "SOL backfill" under TRA-45, for ML Engineer');
    expect(
      effectPreview({ type: "cancel_issue_tree", targetIssueId: T1, staleness: "strict", reasonComment: "No longer needed" }, resolve, { [T1]: { ...snapshots[T1]!, descendantCount: 3 } }, nameOf),
    ).toBe("Cancel TRA-45 and everything under it (4 tasks)");
  });

  it("holds back options whose strict changes touch a changed task", () => {
    const changed = changedTargets({ [T1]: false, [T2]: true });
    expect([...changed]).toEqual([T2]);
    expect(heldBack(options[0]!, changed)).toBe(true);
    expect(heldBack(options[1]!, changed)).toBe(false);
  });

  it("says what each effect did", () => {
    expect(effectResult({ ...execution("executed"), effectType: "create_issue", result: { issueId: T3 } }, resolve)).toMatchObject({ tone: "ok", text: "Created TRA-50", issueId: T3 });
    expect(effectResult({ ...execution("skipped") }, resolve)).toMatchObject({ tone: "mid", text: "Skipped TRA-45: it changed since the proposal" });
    expect(effectResult({ ...execution("failed"), error: "deny_decision_intersection" }, resolve)).toMatchObject({
      tone: "bad",
      text: "Failed on TRA-45: neither you nor the agent may make this change",
    });
  });

  it("builds an open proposal as a request", () => {
    const request = requestFromDecision(decision, ctx, { [T2]: true });
    expect(request).toMatchObject({
      key: "decision:d1",
      kind: "proposal",
      shape: "decision",
      state: "open",
      acts: true,
      askVerb: "proposes changes",
      title: "How should we unblock ML testing?",
      lifetime: "Expires in 6 days",
      respond: { allowed: true },
      subject: { kind: "task", label: "TRA-45", issueId: T1 },
    });
    expect(request.asker.name).toBe("CEO");
    expect(request.next).toBe("Choosing an option applies its changes now, then tells CEO. Dismiss changes nothing.");
    expect(request.source.type === "decision" && request.source.targetChanged).toEqual({ [T2]: true });
  });

  it("settles a decided, partly applied, dismissed or expired proposal", () => {
    const decided = requestFromDecision({ ...decision, status: "decided", chosenOptionId: "start", decidedByUserId: "u2", decidedAt: "2026-10-27T09:00:00Z", executionStatus: "partial" }, ctx);
    expect(decided.state).toBe("settled");
    expect(decided.verdict).toMatchObject({ text: "Sam K. chose Start with BTC and ETH now", tone: "ok" });
    expect(decided.result).toEqual({ text: "Some changes were applied, some weren't", tone: "mid" });

    const dismissed = requestFromDecision({ ...decision, status: "decided", chosenOptionId: "dismissed", decidedByUserId: "me", executionStatus: "succeeded" }, ctx);
    expect(dismissed.verdict?.text).toBe("You dismissed it: nothing changed");

    const expired = requestFromDecision({ ...decision, status: "expired", metadata: { expiredReason: "target_completed" } }, ctx);
    expect(expired.verdict?.text).toBe("Ended: the tasks it changes were finished first");
  });

  it("recognises an archive proposal, which applies no effects", () => {
    const archive = { ...decision, metadata: { kind: "attention_archive_proposal" }, options: [{ id: "archive", label: "Archive reviewed items", style: "destructive" as const, effects: [] }, { id: "keep", label: "Keep items", effects: [] }] };
    expect(isArchiveProposal(archive)).toBe(true);
    const request = requestFromDecision(archive, ctx);
    expect(request.acts).toBe(false);
    expect(request.askVerb).toBe("proposes archiving");
  });
});

function execution(status: "executed" | "skipped" | "failed" | "claimed") {
  return {
    id: `e-${status}`,
    decisionId: "d1",
    effectIndex: 0,
    effectType: "update_issue_status",
    targetIssueId: T1,
    status,
    result: null,
    error: null,
    activityLogId: null,
    executedAt: null,
  };
}
