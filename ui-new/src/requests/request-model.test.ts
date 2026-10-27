import type { Approval, IssueThreadInteraction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { expiryLabel, requestFromApproval, requestFromInteraction, taskRequests, type RequestContext } from "./request-model";

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
      subject: { kind: "task", label: "TRA-41" },
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
