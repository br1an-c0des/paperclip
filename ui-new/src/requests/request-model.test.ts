import type { Approval, IssueThreadInteraction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { answerRefusal, expiryLabel, plainLine, refusalCode, SIGN_IN_NEEDED, planLabel, planReviewTarget, referenceImages, requestFromApproval, requestFromInteraction, requestFromReview, signoffOf, suggestedOwner, taskRequests, type RequestContext } from "./request-model";

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

  describe("an approved call waiting on sign-in (U99, #20340)", () => {
    const waiting = (toolAction: Record<string, unknown>, payloadTool: Record<string, unknown> = {}) =>
      interaction({
        kind: "request_confirmation",
        status: "accepted",
        resolvedByUserId: "me",
        payload: { version: 1, prompt: "Send the weekly digest?", toolAction: { previewMarkdown: "", expiresAt: null, connectionId: "conn-1", appDisplayName: "Gmail", ...payloadTool } },
        result: { version: 1, outcome: "accepted", toolAction },
      });

    it("keeps the approval and asks to reconnect the app, not 'Running the call…'", () => {
      const request = requestFromInteraction(waiting({ status: "approved", errorCode: "approved_action_connection_required" }), ctx);
      expect(request).toMatchObject({
        state: "settled",
        verdict: { text: "You approved · Sign-in needed", tone: "mid" },
        result: { text: SIGN_IN_NEEDED, tone: "mid" },
        reconnect: { connectionId: "conn-1", appName: "Gmail" },
      });
      expect(SIGN_IN_NEEDED).toBe("Your approval is saved. Reconnect the app to continue. Paperclip will check the account and action again before it runs.");
    });

    it("names the app generically when the call doesn't, and keeps the connection it has", () => {
      const request = requestFromInteraction(waiting({ status: "approved", errorCode: "approved_action_connection_required" }, { appDisplayName: null, connectionId: null }), ctx);
      expect(request.reconnect).toEqual({ connectionId: null, appName: "app" });
    });

    it("an approved call without the code is still running, with nothing to reconnect", () => {
      const request = requestFromInteraction(waiting({ status: "approved" }), ctx);
      expect(request).toMatchObject({ result: { text: "Running the call…" }, reconnect: null });
    });

    it("an open review reads null expiresAt as open until answered", () => {
      const open = requestFromInteraction(interaction({ kind: "request_confirmation", payload: { version: 1, prompt: "Send it?", toolAction: { previewMarkdown: "", expiresAt: null } } }), ctx);
      expect(open).toMatchObject({ lifetime: "Open until answered", reconnect: null });
    });
  });

  describe("answer refusals", () => {
    const refused = (message: string, body: unknown) => Object.assign(new Error(message), { status: 409, body });

    it("a reviewed call that changed before it ran: the server's reason, settled, no retry (#20340)", () => {
      const changed = refused("The app connection or destination changed. A new review is required.", {
        error: "The app connection or destination changed. A new review is required.",
        details: { code: "approved_tool_target_changed" },
      });
      expect(refusalCode(changed)).toBe("approved_tool_target_changed");
      expect(answerRefusal(changed)).toEqual({ message: "The app connection or destination changed. A new review is required.", settled: true });
      const managed = refused("Approved tool action managed arguments changed after review; request a new approval", { code: "approved_tool_managed_arguments_changed" });
      expect(answerRefusal(managed)).toEqual({ message: "Approved tool action managed arguments changed after review; request a new approval.", settled: true });
    });

    it("falls back to the code's own words when the server gave none", () => {
      expect(answerRefusal(refused("approved_tool_target_changed", { details: { code: "approved_tool_target_changed" } }))).toEqual({
        message: "The reviewed action is no longer current. A new review is required.",
        settled: true,
      });
      expect(answerRefusal(refused("Request failed: 409", { code: "approved_tool_managed_arguments_changed" })).message).toBe(
        "The call's arguments changed after review. A new review is required.",
      );
      expect(answerRefusal(refused("Request failed: 409", { code: "interaction_already_resolved" }))).toEqual({ message: "This request is no longer waiting for a decision.", settled: true });
    });

    it("anything else keeps its message and may be tried again", () => {
      expect(answerRefusal(refused("Agent is offline", { error: "Agent is offline" }))).toEqual({ message: "Agent is offline", settled: false });
      expect(answerRefusal(null)).toEqual({ message: "Couldn't send the answer. Try again.", settled: false });
    });
  });

  it("keeps a confirmation's prompt as Markdown, with a plain title from its first line (#18851)", () => {
    const prompt = "Review the [two screenshots](/TRA/issues/TRA-42#document-preview).\n\nSelect **Accept** to keep this design.\n\n![Review image](https://provider.invalid/review.png)";
    const confirm = interaction({ kind: "request_confirmation", payload: { version: 1, prompt, detailsMarkdown: "More context" } });
    const request = requestFromInteraction(confirm, ctx);
    expect(request.title).toBe("Review the two screenshots.");
    expect(request.prompt?.ownTitle).toBe(false);
    expect(request.prompt?.markdown).toContain("Select **Accept**");
    expect(request.prompt?.markdown).toContain("Image: Review image (https://provider.invalid/review.png)");
    expect(request.prompt?.markdown).not.toContain("![");
    expect(request.body).toBe("More context");

    const titled = requestFromInteraction({ ...confirm, title: "Pick a design" } as IssueThreadInteraction, ctx);
    expect(titled).toMatchObject({ title: "Pick a design", prompt: { ownTitle: true }, body: "More context" });

    const checkbox = interaction({ kind: "request_checkbox_confirmation", payload: { version: 1, prompt: "Keep **which** files?", options: [] } });
    expect(requestFromInteraction(checkbox, ctx)).toMatchObject({ title: "Keep which files?", prompt: { markdown: "Keep **which** files?", ownTitle: false } });
  });

  it("settles a plan review as the old UI's receipt does, naming the revision (U41)", () => {
    const target = { type: "issue_document", key: "plan", revisionId: "rev-2", revisionNumber: 2 };
    const review = interaction({ kind: "request_confirmation", payload: { version: 1, prompt: "Approve the plan?", acceptLabel: "Approve plan", rejectLabel: "Request changes", target } });
    expect(requestFromInteraction(review, ctx).askVerb).toBe("asks you to approve the plan");
    expect(planReviewTarget(review)).toEqual({ issueId: "t1", revisionId: "rev-2", revisionNumber: 2 });
    const approved = { ...review, status: "accepted", resolvedByUserId: "me" } as unknown as IssueThreadInteraction;
    expect(requestFromInteraction(approved, ctx).verdict).toMatchObject({ text: "You approved Plan v2", tone: "ok" });
    const changes = { ...review, status: "rejected", resolvedByUserId: "u2", result: { version: 1, outcome: "rejected", reason: " Split step 3 " } } as unknown as IssueThreadInteraction;
    expect(requestFromInteraction(changes, ctx).verdict).toMatchObject({ text: "Sam K. requested changes to Plan v2: Split step 3" });
    const unnumbered = { ...approved, payload: { ...review.payload, target: { ...target, revisionNumber: null } } } as unknown as IssueThreadInteraction;
    expect(requestFromInteraction(unnumbered, ctx).verdict?.text).toBe("You approved the plan");
    expect(planLabel(planReviewTarget(unnumbered)!)).toBe("Plan");
    const other = interaction({ kind: "request_confirmation", payload: { version: 1, prompt: "Keep it?", target: { ...target, key: "design" } } });
    expect(planReviewTarget(other)).toBeNull();
  });

  it("knows who may answer", () => {
    expect(requestFromInteraction({ ...question, addresseeUserId: "u2" } as IssueThreadInteraction, ctx).respond).toEqual({
      allowed: false,
      reason: "Waiting on Sam K. Only Sam K. can answer this.",
      waitingOn: "Sam K.",
    });
    expect(requestFromInteraction({ ...question, effectiveResolverPolicy: "not_creator", createdByAgentId: null, createdByUserId: "me" } as IssueThreadInteraction, ctx).respond.allowed).toBe(false);
    expect(requestFromInteraction({ ...question, addresseeUserId: "me" } as IssueThreadInteraction, ctx).audience.label).toBe("You");
  });
});

describe("plainLine and referenceImages", () => {
  it("takes the first line with text, without its formatting", () => {
    expect(plainLine("\n# Ship **v2**?\n\nMore")).toBe("Ship v2?");
    expect(plainLine("- Check `preview.png` and [the doc](/x)")).toBe("Check preview.png and the doc");
    expect(plainLine("```mermaid\nflowchart LR\n```\nApprove *this* plan")).toBe("Approve this plan");
    expect(plainLine("Keep snake_case_names and 2 * 3")).toBe("Keep snake_case_names and 2 * 3");
    expect(plainLine("x".repeat(200), 20)).toHaveLength(20);
  });

  it("turns images into references", () => {
    expect(referenceImages('See ![shot](https://a.invalid/s.png "Title") and ![](/api/x.png)')).toBe("See Image: shot (https://a.invalid/s.png) and Image: untitled (/api/x.png)");
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
    expect(request.next).toBe("Approving moves TRA-44 to its next stage: approval · CEO.");
    expect(request.createdAt.toISOString()).toBe("2026-10-26T11:30:00.000Z");
    expect(request.source.type === "review" && request.source.signoff.steps.map((step) => step.label)).toEqual(["Review · you", "Approval · CEO"]);
  });

  it("waits on someone else; a stalled review is any person's to decide", () => {
    const theirs = requestFromReview({ ...task, executionState: pending("u2") }, ctx);
    expect(theirs.title).toBe("Review pending with Sam K.");
    expect(theirs.respond).toEqual({ allowed: false, reason: "Waiting on Sam K.", waitingOn: "Sam K." });

    const stalled = requestFromReview({ ...task, executionState: pending("u2") }, ctx, { stalled: true, whyNow: "Nobody can review it" });
    expect(stalled.title).toBe("TRA-44 is in review with nobody to review it");
    expect(stalled.next).toMatch(/^Nobody can review TRA-44, so you decide: approving marks it done/);
    expect(stalled.respond).toEqual({ allowed: true, reason: null });
    expect(stalled.source.type === "review" && stalled.source.stalled).toBe(true);
  });

  it("settles once the task leaves review", () => {
    const approved = requestFromReview({ ...task, status: "done", executionState: { ...pending("me"), status: "completed", lastDecisionOutcome: "approved" } }, ctx);
    expect(approved.state).toBe("settled");
    expect(approved.verdict).toMatchObject({ text: "Approved", tone: "ok" });
    const sentBack = requestFromReview({ ...task, status: "in_progress", executionState: { ...pending("me"), lastDecisionOutcome: "changes_requested" } }, ctx);
    expect(sentBack.verdict).toMatchObject({ text: "Sent back with notes" });
  });
});

describe("suggestedOwner", () => {
  const names = { youId: "me", agentName: (id: string) => ({ bob: "Bob", ann: "Ann" })[id], personName: (id: string) => `Person ${id}` };

  it("names the chat's agent for a task proposed in a chat with nobody named", () => {
    expect(suggestedOwner({}, { ...names, chatAgentId: "bob" })).toBe("Bob");
    expect(suggestedOwner({ assigneeAgentId: null, assigneeUserId: null }, { ...names, chatAgentId: "bob" })).toBe("Bob");
  });

  it("keeps whoever the task names", () => {
    expect(suggestedOwner({ assigneeAgentId: "ann" }, { ...names, chatAgentId: "bob" })).toBe("Ann");
    expect(suggestedOwner({ assigneeUserId: "me" }, { ...names, chatAgentId: "bob" })).toBe("You");
    expect(suggestedOwner({ assigneeUserId: "u2" }, { ...names, chatAgentId: "bob" })).toBe("Person u2");
  });

  it("stays unassigned outside a chat", () => {
    expect(suggestedOwner({}, { ...names, chatAgentId: null })).toBe("Unassigned");
  });
});
