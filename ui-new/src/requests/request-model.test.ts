import type { Approval, IssueThreadInteraction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { expiryLabel, requestFromApproval, requestFromInteraction, requestFromReview, signoffOf, taskRequests, type RequestContext } from "./request-model";

const ctx: RequestContext = {
  youId: "me",
  agentName: (id) => ({ a1: "Quant Researcher", a2: "CEO" })[id],
  personName: (id) => ({ u2: "Sam K." })[id] ?? "Someone else",
  task: { id: "t1", identifier: "TRA-41", title: "H4 download" },
  now: new Date("2026-10-26T12:00:00Z"),
};

const base = {
  id: "i1",
  companyId: "c1",
  issueId: "t1",
  status: "pending",
  continuationPolicy: "wake_assignee",
  createdByAgentId: "a1",
  resolverPolicy: "anyone",
  requestedResolverPolicy: "anyone",
  effectiveResolverPolicy: "anyone",
  resolverPolicyProvenance: "explicit",
  effectiveResolverPolicySource: "requested",
  legacyResolverPolicyAliases: { requested: null, effective: null },
  createdAt: "2026-10-26T11:00:00Z",
  updatedAt: "2026-10-26T11:00:00Z",
};

const interaction = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as IssueThreadInteraction;

const question = interaction({
  kind: "ask_user_questions",
  payload: {
    version: 1,
    supersedeOnUserComment: true,
    questions: [{ id: "q1", prompt: "How far back?", selectionMode: "single", options: [{ id: "o1", label: "From 2022" }] }],
  },
});

describe("interactions as requests", () => {
  it("makes a question that returns its answer to the agent", () => {
    const request = requestFromInteraction(question, ctx);
    expect(request).toMatchObject({
      kind: "question",
      shape: "form",
      outcome: "return",
      state: "open",
      title: "How far back?",
      askVerb: "asks you",
      lifetime: "Ends if you comment instead",
      audience: { kind: "anyone", label: "Anyone" },
      subject: { kind: "task", label: "TRA-41", title: "H4 download" },
      respond: { allowed: true },
    });
    expect(request.asker.name).toBe("Quant Researcher");
    expect(request.next).toBe("Your answer goes to Quant Researcher, which continues TRA-41.");
  });

  it("sets a dismissed request aside, still answerable", () => {
    const request = requestFromInteraction({ ...question, dismissedAt: "2026-10-26T11:30:00Z" } as IssueThreadInteraction, ctx);
    expect(request.state).toBe("set_aside");
    expect(request.respond.allowed).toBe(true);
  });

  it("settles an answered question with the picked options", () => {
    const answered = { ...question, status: "answered", resolvedByUserId: "me", result: { version: 1, answers: [{ questionId: "q1", optionIds: ["o1"], otherText: "and 2021" }] } } as unknown as IssueThreadInteraction;
    const request = requestFromInteraction(answered, ctx);
    expect(request.state).toBe("settled");
    expect(request.verdict).toMatchObject({ text: "You answered From 2022, and 2021", tone: "ok" });
    expect(request.result).toEqual({ text: "Sent to Quant Researcher", tone: "muted" });
  });

  it("says when a question ended without an answer", () => {
    const ended = { ...question, status: "expired", result: { version: 1, answers: [], expirationReason: "superseded_by_comment" } } as unknown as IssueThreadInteraction;
    expect(requestFromInteraction(ended, ctx).verdict?.text).toMatch(/commented on the task instead/);
  });

  it("makes suggested tasks a proposal that applies", () => {
    const suggest = interaction({ kind: "suggest_tasks", payload: { version: 1, tasks: [{ clientKey: "k1", title: "A" }, { clientKey: "k2", title: "B" }] } });
    expect(requestFromInteraction(suggest, ctx)).toMatchObject({ kind: "proposal", shape: "suggested_tasks", outcome: "apply", askVerb: "suggests 2 tasks", title: "Create these 2 tasks?" });
    const created = { ...suggest, status: "accepted", resolvedByUserId: "me", result: { version: 1, createdTasks: [{ clientKey: "k1", issueId: "x", identifier: "TRA-50" }] } } as unknown as IssueThreadInteraction;
    expect(requestFromInteraction(created, ctx)).toMatchObject({ verdict: { text: "You created 1 task" }, result: { text: "TRA-50" } });
  });

  it("marks tool calls as acting, with expiry, and reports a failed call apart from the approval", () => {
    const tool = interaction({
      kind: "request_confirmation",
      effectiveResolverPolicy: "human_only",
      payload: {
        version: 1,
        prompt: "Merge PR #14?",
        toolAction: { rememberActionScope: "merges to repo", previewMarkdown: "", expiresAt: "2026-10-26T12:10:00Z" },
      },
    });
    const request = requestFromInteraction(tool, ctx);
    expect(request).toMatchObject({ shape: "tool_call", outcome: "apply_and_remember", acts: true, lifetime: "Expires in 10 minutes", lifetimeSoon: true, audience: { label: "People only" } });
    const failed = { ...tool, status: "accepted", resolvedByUserId: "me", result: { version: 1, outcome: "accepted", toolAction: { status: "failed", errorMessage: "checks failed" } } } as unknown as IssueThreadInteraction;
    expect(requestFromInteraction(failed, ctx)).toMatchObject({ verdict: { text: "You approved and ran it", tone: "ok" }, result: { text: "The call failed: checks failed", tone: "bad" } });
  });

  it("knows who may answer", () => {
    expect(requestFromInteraction({ ...question, addresseeUserId: "u2" } as IssueThreadInteraction, ctx).respond).toEqual({
      allowed: false,
      reason: "Waiting on Sam K.. Only Sam K. can answer this.",
    });
    expect(requestFromInteraction({ ...question, effectiveResolverPolicy: "not_creator", createdByAgentId: null, createdByUserId: "me" } as IssueThreadInteraction, ctx).respond.allowed).toBe(false);
    expect(requestFromInteraction({ ...question, addresseeUserId: "me" } as IssueThreadInteraction, ctx).audience.label).toBe("You");
  });
});

describe("approvals as requests", () => {
  const approval = (extra: Partial<Approval>): Approval =>
    ({
      id: "ap1",
      companyId: "c1",
      type: "hire_agent",
      requestedByAgentId: "a2",
      requestedByUserId: null,
      status: "pending",
      payload: { name: "Risk Analyst" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: new Date("2026-10-26T10:00:00Z"),
      updatedAt: new Date("2026-10-26T10:00:00Z"),
      ...extra,
    }) as Approval;

  it("makes a formal, people-only request that applies a hire", () => {
    expect(requestFromApproval(approval({}), ctx)).toMatchObject({
      kind: "approval",
      formal: true,
      outcome: "apply",
      title: "Hire Risk Analyst",
      subject: { kind: "agent", label: "New agent: Risk Analyst" },
      next: "Approving activates Risk Analyst. It can then be assigned work.",
      respond: { allowed: true },
    });
  });

  it("keeps budget stops away from approve and reject", () => {
    const request = requestFromApproval(approval({ type: "budget_override_required", payload: { scopeName: "Frontend" } }), ctx);
    expect(request.respond.allowed).toBe(false);
    expect(request.subject?.label).toBe("Budget: Frontend");
  });

  it("settles with the decision and its note", () => {
    const request = requestFromApproval(approval({ type: "request_board_approval", payload: { title: "Q4 plan" }, status: "rejected", decidedByUserId: "me", decisionNote: "Not yet" }), ctx);
    expect(request).toMatchObject({ state: "settled", title: "Q4 plan", verdict: { text: "You rejected", tone: "bad" }, result: { text: "Not yet" } });
  });

  it("orders a task's requests oldest first", () => {
    expect(taskRequests({ interactions: [question], approvals: [approval({})] }, ctx).map((request) => request.key)).toEqual(["approval:ap1", "interaction:i1"]);
  });
});

describe("expiryLabel", () => {
  it("counts down in the largest sensible unit", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(expiryLabel(new Date("2026-11-01T12:00:00Z"), now)).toEqual({ text: "Expires in 6 days", soon: false });
    expect(expiryLabel(new Date("2026-10-26T15:00:00Z"), now)).toEqual({ text: "Expires in 3 hours", soon: false });
    expect(expiryLabel(new Date("2026-10-26T11:00:00Z"), now)).toEqual({ text: "Expired", soon: true });
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

describe("review sign-offs as requests", () => {
  const policy = {
    stages: [
      { id: "s1", type: "review", participants: [{ type: "user", userId: "me", agentId: null }] },
      { id: "s2", type: "approval", participants: [{ type: "agent", agentId: "a2", userId: null }] },
    ],
  };
  const pending = (userId: string) => ({
    status: "pending" as const,
    currentStageId: "s1",
    currentStageIndex: 0,
    currentStageType: "review" as const,
    currentParticipant: { type: "user" as const, userId, agentId: null },
    returnAssignee: { type: "agent" as const, agentId: "a1", userId: null },
    reviewRequest: null,
    completedStageIds: [],
    lastDecisionId: null,
    lastDecisionOutcome: null,
  });
  const task = { id: "t1", identifier: "TRA-44", title: "Liquidation sweep", status: "in_review", executionPolicy: policy, updatedAt: "2026-10-26T11:00:00Z" };

  it("asks you to sign when the stage waits on you", () => {
    const request = requestFromReview({ ...task, executionState: pending("me") }, ctx, { since: "2026-10-26T11:30:00Z" });
    expect(request).toMatchObject({
      key: "review:t1",
      kind: "signoff",
      shape: "signoff",
      state: "open",
      title: "Your sign-off is needed: approve, or send back",
      askVerb: "handed this to you for review",
      audience: { kind: "named", label: "You" },
      subject: { kind: "task", label: "TRA-44", title: "Liquidation sweep", issueId: "t1" },
      respond: { allowed: true },
    });
    expect(request.asker).toEqual({ agentId: "a1", userId: null, name: "Quant Researcher" });
    expect(request.next).toBe("Approving moves TRA-44 to its next stage: approval · ceo.");
    expect(request.createdAt.toISOString()).toBe("2026-10-26T11:30:00.000Z");
    expect(request.source.type === "review" && request.source.signoff.steps.map((step) => step.label)).toEqual(["Review · you", "Approval · CEO"]);
  });

  it("waits on someone else, or on a review path when it's stalled", () => {
    const theirs = requestFromReview({ ...task, executionState: pending("u2") }, ctx);
    expect(theirs.title).toBe("Review pending with Sam K.");
    expect(theirs.respond).toEqual({ allowed: false, reason: "Waiting on Sam K." });

    const stalled = requestFromReview({ ...task, executionState: pending("me") }, ctx, { stalled: true, whyNow: "Nobody can review it" });
    expect(stalled.title).toBe("TRA-44 is in review with nobody to review it");
    expect(stalled.next).toBe("Nobody can review it");
    expect(stalled.respond.allowed).toBe(false);
  });

  it("settles once the task leaves review", () => {
    const approved = requestFromReview({ ...task, status: "done", executionState: { ...pending("me"), status: "completed", lastDecisionOutcome: "approved" } }, ctx);
    expect(approved.state).toBe("settled");
    expect(approved.verdict).toMatchObject({ text: "Approved", tone: "ok" });
    const sentBack = requestFromReview({ ...task, status: "in_progress", executionState: { ...pending("me"), lastDecisionOutcome: "changes_requested" } }, ctx);
    expect(sentBack.verdict).toMatchObject({ text: "Sent back with notes" });
  });
});
