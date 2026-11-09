import type { Approval, AttentionItem, AttentionSourceKind, IssueThreadInteraction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { CompanyJoinRequest } from "@/api/access";
import type { DecisionOutcome } from "@/api/decisions";
import { requestFromDecision } from "@/requests/decision-model";
import { requestFromJoin } from "@/requests/join-model";
import { requestFromApproval, requestFromInteraction, requestFromReview, type RequestContext } from "@/requests/request-model";
import { money, rowExpiry, rowModel, shortAge } from "./row-model";

const NOW = new Date("2026-11-09T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const M = 60_000;
const H = 60 * M;
const D = 24 * H;

const ctx: RequestContext = {
  youId: "me",
  agentName: (id) => ({ a1: "Backend Engineer", a2: "CEO", a3: "Mobile Engineer" })[id],
  personName: (id) => ({ u2: "Sam K." })[id] ?? "Someone else",
  task: { id: "t1", identifier: "HAR-41", title: "Move invoices to the new ledger" },
  now: NOW,
};

function item(sourceKind: AttentionSourceKind, extra: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: `${sourceKind}:x`,
    companyId: "c1",
    sourceKind,
    subject: { kind: "interaction", id: "s1", companyId: "c1", title: "From the feed", identifier: null, status: null, href: null },
    whyNow: "",
    decisionVerbs: [],
    inlineResolvable: false,
    entryRule: "",
    exitRule: "",
    dedupKey: "x",
    dismissalKey: "attention:x",
    dismissal: null,
    severity: "medium",
    rank: 1,
    activityAt: ago(H),
    createdAt: ago(H),
    updatedAt: ago(H),
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

const interaction = (extra: Record<string, unknown>) =>
  ({
    id: "i1",
    companyId: "c1",
    issueId: "t1",
    status: "pending",
    continuationPolicy: "wake_assignee",
    createdByAgentId: "a1",
    effectiveResolverPolicy: "anyone",
    createdAt: ago(40 * M),
    updatedAt: ago(40 * M),
    ...extra,
  }) as unknown as IssueThreadInteraction;

const open = { identifier: "HAR-41", title: "Move invoices to the new ledger", status: "in_progress" };
const blocked = { ...open, status: "blocked" };
const row = (request: ReturnType<typeof requestFromInteraction>, task: typeof open | null = open, feed = item("issue_thread_interaction")) => rowModel({ item: feed, request, task, now: NOW });

describe("the collapsed row's labels", () => {
  it("shows an expiry only under a day, red under an hour", () => {
    expect(rowExpiry(new Date(ahead(38 * M)), NOW)).toEqual({ text: "38m left", soon: true });
    expect(rowExpiry(new Date(ahead(6 * H + 5 * M)), NOW)).toEqual({ text: "6h left", soon: false });
    expect(rowExpiry(new Date(ahead(2 * D)), NOW)).toBeNull();
    expect(rowExpiry(new Date(ago(M)), NOW)).toEqual({ text: "Expired", soon: true });
    expect(rowExpiry(null, NOW)).toBeNull();
  });

  it("says how old a request is, briefly", () => {
    expect(shortAge(new Date(ago(20_000)), NOW)).toBe("now");
    expect(shortAge(new Date(ago(6 * M)), NOW)).toBe("6m");
    expect(shortAge(new Date(ago(5 * H)), NOW)).toBe("5h");
    expect(shortAge(new Date(ago(2 * D)), NOW)).toBe("2d");
    expect(shortAge(new Date("2026-10-18T10:00:00Z"), NOW)).toBe("Oct 18");
  });

  it("writes money without empty cents", () => {
    expect(money(8000)).toBe("$80");
    expect(money(8025)).toBe("$80.25");
    expect(money(125000)).toBe("$1,250");
  });
});

describe("the collapsed row, kind by kind", () => {
  it("a tool call: its type and the expiry, in red within the hour", () => {
    const request = requestFromInteraction(
      interaction({ kind: "request_confirmation", payload: { version: 1, prompt: "Merge PR #212 into main?", toolAction: { toolName: "github.merge", expiresAt: ahead(38 * M), previewMarkdown: "" } } }),
      ctx,
    );
    expect(row(request)).toMatchObject({ kind: "proposal", type: "Tool call", title: "Merge PR #212 into main?", signs: [{ tone: "soon", icon: "clock", text: "38m left" }], who: { kind: "agent", agentId: "a1" } });
  });

  it("one question on a blocked task: the question is the title, and it blocks the task", () => {
    const request = requestFromInteraction(
      interaction({ kind: "ask_user_questions", payload: { version: 1, questions: [{ id: "q1", prompt: "Where should refunds live?", selectionMode: "single", options: [] }] } }),
      ctx,
    );
    const result = row(request, blocked);
    expect(result).toMatchObject({ type: "Question", title: "Where should refunds live?", questions: [], blocks: true });
    expect(result.signs).toEqual([{ tone: "block", icon: "block", text: "Blocks HAR-41" }]);
  });

  it("several questions: up to three lines, then how many more, and the count", () => {
    const prompts = ["One?", "Two?", "Three?", "Four?", "Five?"];
    const request = requestFromInteraction(
      interaction({ kind: "ask_user_questions", title: "Offline mode: five choices", payload: { version: 1, questions: prompts.map((prompt, i) => ({ id: `q${i}`, prompt, selectionMode: "single", options: [] })) } }),
      ctx,
    );
    expect(row(request)).toMatchObject({ type: "Questions", title: "Offline mode: five choices", questions: ["One?", "Two?", "Three?"], moreQuestions: 2, signs: [{ text: "5 questions" }] });
    const three = requestFromInteraction(
      interaction({ kind: "ask_user_questions", payload: { version: 1, questions: prompts.slice(0, 3).map((prompt, i) => ({ id: `q${i}`, prompt, selectionMode: "single", options: [] })) } }),
      ctx,
    );
    expect(row(three)).toMatchObject({ questions: ["One?", "Two?", "Three?"], moreQuestions: 0, signs: [{ text: "3 questions" }] });
  });

  it("a plan review names the revision", () => {
    const request = requestFromInteraction(
      interaction({ kind: "request_confirmation", payload: { version: 1, prompt: "Approve the plan?", target: { type: "issue_document", issueId: "t1", key: "plan", revisionId: "r2", revisionNumber: 2 } } }),
      ctx,
    );
    expect(row(request)).toMatchObject({ kind: "question", type: "Plan review", signs: [{ icon: "plan", text: "Plan v2" }] });
  });

  it("pick several, verdicts, suggested tasks and a secret", () => {
    const pick = requestFromInteraction(interaction({ kind: "request_checkbox_confirmation", payload: { version: 1, prompt: "Which screens?", options: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, label: `${n}` })) } }), ctx);
    expect(row(pick)).toMatchObject({ type: "Pick several", signs: [{ text: "Pick from 4" }] });
    const verdicts = requestFromInteraction(interaction({ kind: "request_item_verdicts", payload: { version: 1, prompt: "Quarantine?", items: [1, 2, 3, 4].map((n) => ({ id: `i${n}`, label: `${n}` })) } }), ctx);
    expect(row(verdicts)).toMatchObject({ type: "Verdicts", signs: [{ text: "4 items" }] });
    const tasks = requestFromInteraction(
      interaction({ kind: "suggest_tasks", payload: { version: 1, tasks: [{ clientKey: "a", title: "A" }, { clientKey: "b", title: "B" }, { clientKey: "c", title: "C" }, { clientKey: "d", title: "D", hiddenInPreview: true }] } }),
      ctx,
    );
    expect(row(tasks)).toMatchObject({ kind: "proposal", type: "Suggested tasks", signs: [{ text: "3 tasks" }] });
    const secret = requestFromInteraction(interaction({ kind: "request_confirmation", payload: { version: 1, prompt: "Store it?", secretProposal: { justification: "", expiresAt: ahead(2 * D) } } }), ctx);
    expect(row(secret)).toMatchObject({ type: "Secret", signs: [] });
  });

  it("a connection request names the app and nothing else", () => {
    const request = requestFromInteraction(
      interaction({ kind: "connection_intent", payload: { version: 1, serviceSlug: "sentry", serviceName: "Sentry", requestingAgentId: "a3", requestingAgentName: "Mobile Engineer", phase: "requested" } }),
      ctx,
    );
    expect(row(request)).toMatchObject({ type: "Connection", title: "Connect Sentry", signs: [] });
  });

  it("waiting on someone else is a quieter row that says who", () => {
    const request = requestFromInteraction(interaction({ kind: "request_confirmation", addresseeUserId: "u2", payload: { version: 1, prompt: "US-only?" } }), ctx);
    expect(row(request)).toMatchObject({ type: "Confirm", waiting: true, signs: [{ tone: "wait", text: "Waiting on Sam K." }] });
  });

  it("a proposal: task changed and how many options; the expiry only under a day", () => {
    const decision = {
      id: "d1",
      originAgentId: "a2",
      title: "How should we unblock the rollout?",
      body: "",
      options: [
        { id: "a", label: "Roll out", effects: [{ type: "set_status" }] },
        { id: "b", label: "Wait", effects: [] },
        { id: "c", label: "Cancel", effects: [] },
      ],
      status: "open",
      expiresAt: ahead(5 * D),
      targetSnapshots: {},
      metadata: {},
      continuationPolicy: "wake_origin_agent",
      createdAt: ago(5 * H),
      updatedAt: ago(5 * H),
      executions: [],
    } as unknown as DecisionOutcome;
    const request = requestFromDecision(decision, ctx, { t1: true });
    expect(row(request, open, item("decision"))).toMatchObject({ type: "Proposal", signs: [{ tone: "warn", text: "Task changed" }, { text: "3 options" }], expiry: null, who: { kind: "agent", agentId: "a2" } });
    const archive = requestFromDecision({ ...decision, metadata: { kind: "attention_archive_proposal" }, expiresAt: ahead(6 * H + M), targetSnapshots: { a: {}, b: {}, c: {} } } as unknown as DecisionOutcome, ctx);
    expect(row(archive, null, item("decision"))).toMatchObject({ type: "Archive", signs: [{ tone: "time", text: "6h left" }, { text: "3 items" }] });
    const partial = requestFromDecision({ ...decision, status: "decided", chosenOptionId: "a", decidedByUserId: "me", executionStatus: "partial" } as unknown as DecisionOutcome, ctx);
    expect(row(partial, blocked, item("decision"))).toMatchObject({ settled: true, blocks: false, signs: [{ tone: "mid", text: "Partly applied" }] });
  });

  it("a settled tool call whose call failed", () => {
    const request = requestFromInteraction(
      interaction({
        kind: "request_confirmation",
        status: "accepted",
        resolvedByUserId: "me",
        payload: { version: 1, prompt: "Merge PR #208?", toolAction: { expiresAt: ahead(H), previewMarkdown: "" } },
        result: { version: 1, outcome: "accepted", toolAction: { status: "failed", errorMessage: "checks failed" } },
      }),
      ctx,
    );
    expect(row(request)).toMatchObject({ settled: true, signs: [{ tone: "bad", text: "Failed" }] });
  });

  it("a budget stop: spend against the limit, and the agent it paused", () => {
    const approval = {
      id: "ap1",
      type: "budget_override_required",
      status: "pending",
      requestedByAgentId: null,
      requestedByUserId: null,
      payload: { scopeType: "agent", scopeId: "a3", scopeName: "Mobile Engineer", budgetAmount: 8000, observedAmount: 8025 },
      createdAt: ago(12 * M),
      updatedAt: ago(12 * M),
    } as unknown as Approval;
    const result = rowModel({ item: item("approval"), request: requestFromApproval(approval, { ...ctx, task: null }), task: null, now: NOW });
    expect(result).toMatchObject({ kind: "approval", type: "Budget stop", signs: [{ tone: "bad", text: "$80.25 of $80" }], who: { kind: "agent", agentId: "a3" }, owner: { kind: "agent", agentId: "a3" } });
    const project = rowModel({ item: item("approval"), request: requestFromApproval({ ...approval, payload: { ...approval.payload, scopeType: "project", scopeId: "p1" } } as Approval, ctx), task: null, now: NOW });
    expect(project.owner).toEqual({ kind: "paperclip" });
  });

  it("a hire names its type", () => {
    const approval = { id: "ap2", type: "hire_agent", status: "pending", requestedByAgentId: "a2", requestedByUserId: null, payload: { name: "Security Reviewer" }, createdAt: ago(D), updatedAt: ago(D) } as unknown as Approval;
    expect(rowModel({ item: item("approval"), request: requestFromApproval(approval, ctx), task: null, now: NOW })).toMatchObject({ type: "Hire", title: "Hire Security Reviewer", signs: [] });
  });

  it("a join request from an outside agent", () => {
    const join = { id: "j1", requestType: "agent", status: "pending_approval", agentName: "Atlas Reviewer", adapterType: "http", createdAt: ago(D), invite: null } as unknown as CompanyJoinRequest;
    expect(rowModel({ item: item("join_request"), request: requestFromJoin(join, ctx), task: null, now: NOW })).toMatchObject({
      type: "Join request",
      signs: [{ tone: "wait", text: "Outside agent" }],
      who: { kind: "outside", name: "Atlas Reviewer" },
      owner: { kind: "people" },
    });
  });

  it("a sign-off takes its task's title and says which step; a stalled one says nobody reviews it", () => {
    const policy = {
      stages: [
        { id: "s1", type: "review", participants: [{ type: "user", userId: "me", agentId: null }] },
        { id: "s2", type: "approval", participants: [{ type: "agent", agentId: "a2", userId: null }] },
      ],
    };
    const state = { status: "pending", currentStageId: "s1", currentParticipant: { type: "user", userId: "me", agentId: null }, returnAssignee: { type: "agent", agentId: "a1", userId: null } };
    const task = { id: "t4", identifier: "HAR-39", title: "Apple Pay on the checkout page", status: "in_review", executionPolicy: policy, executionState: state, updatedAt: ago(H) };
    const request = requestFromReview(task as never, ctx, { since: ago(32 * M) });
    expect(request.title).toBe("Your sign-off is needed: approve, or send back");
    expect(request.next).toBe("Approving moves HAR-39 to its next stage: approval · CEO.");
    const result = rowModel({ item: item("review"), request, task: { ...task, status: "in_review" }, now: NOW });
    expect(result).toMatchObject({ kind: "signoff", type: "Sign-off", title: "Apple Pay on the checkout page", signs: [{ text: "Step 1 of 2" }], who: { kind: "agent", agentId: "a1" } });
    const stalled = requestFromReview({ ...task, executionPolicy: null, executionState: null } as never, ctx, { stalled: true });
    expect(rowModel({ item: item("review"), request: stalled, task, now: NOW })).toMatchObject({ title: "HAR-39 is in review with nobody to review it", signs: [{ tone: "warn", text: "No reviewer" }], who: null });
  });
});

describe("the collapsed row before its request loads", () => {
  it("draws questions from the feed's detail", () => {
    const feed = item("issue_thread_interaction", {
      subject: { kind: "interaction", id: "s1", companyId: "c1", title: "Offline mode: three choices", identifier: null, status: null, href: null, metadata: { kind: "ask_user_questions" } },
      detail: { kind: "questions", questionCount: 3, firstQuestionText: "How long should cached orders stay?", images: [] },
      resolverAudience: { createdByAgentId: "a3", createdByAgentName: "Mobile Engineer" } as AttentionItem["resolverAudience"],
    });
    expect(rowModel({ item: feed, task: open, now: NOW })).toMatchObject({
      kind: "question",
      type: "Questions",
      title: "Offline mode: three choices",
      questions: ["How long should cached orders stay?"],
      moreQuestions: 2,
      signs: [{ text: "3 questions" }],
      who: { kind: "agent", agentId: "a3" },
    });
  });

  it("draws suggested tasks, a stalled sign-off and stuck work from the feed", () => {
    expect(rowModel({ item: item("issue_thread_interaction", { detail: { kind: "suggested_tasks", taskCount: 3, firstTaskTitle: "A", images: [] } }), now: NOW })).toMatchObject({ type: "Suggested tasks", signs: [{ text: "3 tasks" }] });
    const stalled = item("review", { subject: { kind: "issue", id: "t1", companyId: "c1", title: "Review the onboarding copy", identifier: "TES-3", status: "in_review", href: null, metadata: { reviewAttentionState: "stalled" } } });
    expect(rowModel({ item: stalled, now: NOW })).toMatchObject({ kind: "signoff", type: "Sign-off", title: "TES-3 is in review with nobody to review it", signs: [{ text: "No reviewer" }] });
    const stuck = item("recovery_action", { subject: { kind: "recovery_action", id: "r1", companyId: "c1", title: "Choose how HAR-50 continues", identifier: null, status: "active", href: null } });
    expect(rowModel({ item: stuck, task: blocked, now: NOW })).toMatchObject({ kind: "proposal", type: "Stuck work", signs: [], blocks: false, who: { kind: "paperclip" } });
  });

  it("names an approval's type and shows a feed expiry", () => {
    const feed = item("approval", { detail: { kind: "approval", approvalType: "budget_override_required", summaryExcerpt: null, images: [] }, expiresAt: ahead(30 * M) });
    expect(rowModel({ item: feed, now: NOW })).toMatchObject({ kind: "approval", type: "Budget stop", signs: [{ tone: "soon", text: "30m left" }], who: { kind: "paperclip" } });
  });
});
