import { randomUUID } from "node:crypto";
import {
  agents,
  approvals,
  authUsers,
  companies,
  createDb,
  documents,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issueApprovals,
  issueComments,
  issueDocuments,
  issues,
  issueThreadInteractions,
} from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { LOW_TRUST_QUARANTINED_BODY } from "./source-trust.js";
import {
  readTaskDocuments,
  readTaskHistory,
  readTaskLastRun,
  readTaskRequestHistory,
  readTaskRequests,
} from "./task-request-history.js";

// Step 5 phase 2: the task's request history (fork/step-5-handoff-plan.md, Task 1).
const LOW_TRUST_POLICY = (companyId: string, issueId: string) => ({
  trustPreset: "low_trust_review",
  authorizationPolicy: { trustPreset: "low_trust_review", trustBoundary: { mode: "low_trust_review", companyId, issueIds: [issueId] } },
});

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("a task's request history", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-task-request-history-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  async function user(name: string) {
    const id = `history-user-${randomUUID()}`;
    await db.insert(authUsers).values({ id, name, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    return id;
  }

  async function seed(issueValues: Partial<typeof issues.$inferInsert> = {}) {
    const [company] = await db.insert(companies)
      .values({ name: "History", issuePrefix: `H${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const [agent] = await db.insert(agents)
      .values({ companyId: company!.id, name: "Coder", adapterType: "process" }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company!.id, title: "Add a theme switch", status: "in_progress", assigneeAgentId: agent!.id, ...issueValues,
    }).returning();
    return { companyId: company!.id, agentId: agent!.id, issueId: issue!.id };
  }

  async function otherAgent(companyId: string, name: string) {
    const [row] = await db.insert(agents).values({ companyId, name, adapterType: "process" }).returning();
    return row!.id;
  }

  type F = Awaited<ReturnType<typeof seed>>;
  async function interaction(f: F, values: Partial<typeof issueThreadInteractions.$inferInsert> & { kind: string }) {
    const [row] = await db.insert(issueThreadInteractions).values({
      companyId: f.companyId, issueId: f.issueId, status: "pending", createdByAgentId: f.agentId,
      payload: { version: 1, prompt: "Go ahead?" } as never, ...values,
    } as typeof issueThreadInteractions.$inferInsert).returning();
    return row!;
  }

  async function run(f: F, values: Partial<typeof heartbeatRuns.$inferInsert> & { summary?: string } = {}) {
    const { summary, ...rest } = values;
    const [row] = await db.insert(heartbeatRuns).values({
      companyId: f.companyId, agentId: f.agentId, status: "succeeded", contextSnapshot: { issueId: f.issueId },
      finishedAt: new Date("2026-11-24T17:52:00Z"),
      ...(summary !== undefined ? { runnerProfileJson: { sessionCheckpoint: { semanticResult: { summary } } } } : {}),
      ...rest,
    }).returning();
    return row!;
  }

  const read = (f: F, extra: Partial<Parameters<typeof readTaskRequests>[1]> = {}) =>
    readTaskRequests(db, { companyId: f.companyId, issueId: f.issueId, viewerAgentId: f.agentId, lowTrust: false,
      statuses: "history", limit: 50, ...extra });

  it("reads an answered question with its text, labels and typed answer", async () => {
    const f = await seed();
    const brian = await user("Brian");
    const row = await interaction(f, {
      kind: "ask_user_questions", status: "answered", title: "Where the switch goes",
      resolvedByUserId: brian, createdAt: new Date("2026-11-24T17:41:00Z"), resolvedAt: new Date("2026-11-24T17:45:00Z"),
      payload: { version: 1, questions: [{ id: "where", prompt: "Where should the switch go?", selectionMode: "single",
        options: [{ id: "header", label: "In the header" }, { id: "both", label: "Both places" }] }] },
      result: { version: 1, answers: [{ questionId: "where", optionIds: ["both"], otherText: "Both, please" }] },
    });
    const [request] = await read(f);
    expect(request).toEqual({
      id: row.id, kind: "ask_user_questions", status: "answered", title: "Where the switch goes", aboutPlan: false,
      questions: [{ id: "where", prompt: "Where should the switch go?",
        options: [{ id: "header", label: "In the header" }, { id: "both", label: "Both places" }] }],
      answers: [{ questionId: "where", optionIds: ["both"], otherText: "Both, please" }],
      outcome: null, note: null, summary: null,
      askedBy: { type: "agent", id: f.agentId }, decidedBy: { type: "user", id: brian },
      askedAt: "2026-11-24T17:41:00.000Z", decidedAt: "2026-11-24T17:45:00.000Z",
    });
  });

  it("reads a plan review as a confirmation about the plan", async () => {
    const f = await seed();
    const brian = await user("Brian");
    await interaction(f, {
      kind: "request_confirmation", status: "rejected", resolvedByUserId: brian, resolvedAt: new Date(),
      payload: { version: 1, prompt: "Approve the plan?", target: { type: "issue_document", key: "plan", revisionId: randomUUID() } },
      result: { version: 1, outcome: "rejected", reason: "Plan only, no code" },
    });
    const [request] = await read(f);
    expect(request).toMatchObject({ kind: "request_confirmation", aboutPlan: true, outcome: "rejected", note: "Plan only, no code",
      title: "Approve the plan?", decidedBy: { type: "user", id: brian } });
    expect(request).not.toHaveProperty("questions");
  });

  it("reads a linked approval", async () => {
    const f = await seed();
    const brian = await user("Brian");
    const [row] = await db.insert(approvals).values({
      companyId: f.companyId, type: "budget_increase", status: "approved", requestedByAgentId: f.agentId,
      payload: { title: "Build the switch\nwith details" }, decisionNote: "Fine, but plan only.", decidedByUserId: brian,
      decidedAt: new Date("2026-11-24T17:49:00Z"), createdAt: new Date("2026-11-24T17:44:00Z"),
    }).returning();
    await db.insert(issueApprovals).values({ companyId: f.companyId, issueId: f.issueId, approvalId: row!.id });
    // An approval not linked to this task is not its history.
    await db.insert(approvals).values({ companyId: f.companyId, type: "budget_increase", status: "approved", payload: { title: "Other" } });
    expect(await read(f)).toEqual([{
      id: row!.id, kind: "approval", status: "approved", title: "Build the switch", aboutPlan: false,
      outcome: "approved", note: "Fine, but plan only.", summary: null,
      askedBy: { type: "agent", id: f.agentId }, decidedBy: { type: "user", id: brian },
      askedAt: "2026-11-24T17:44:00.000Z", decidedAt: "2026-11-24T17:49:00.000Z",
    }]);
  });

  it("leaves out tool actions, secret proposals and connection authorizations", async () => {
    const f = await seed();
    for (const key of ["toolAction", "secretProposal", "connectionAuthorization"]) {
      await interaction(f, { kind: "request_confirmation", status: "accepted", resolvedAt: new Date(),
        payload: { version: 1, prompt: `With ${key}`, [key]: { anything: true } } as never, result: { version: 1, outcome: "accepted" } });
    }
    const kept = await interaction(f, { kind: "request_confirmation", status: "accepted", resolvedAt: new Date(),
      result: { version: 1, outcome: "accepted" } });
    // Kinds outside the history (task suggestions, item verdicts) are left out too.
    await interaction(f, { kind: "suggest_tasks", status: "accepted", resolvedAt: new Date(), payload: { version: 1, tasks: [] } as never });
    expect((await read(f, { statuses: "all" })).map(row => row.id)).toEqual([kept.id]);
  });

  it("history statuses leave out cancelled, expired, failed and superseded; all keeps them", async () => {
    const f = await seed();
    const ids: Record<string, string> = {};
    let minute = 0;
    for (const status of ["pending", "answered", "cancelled", "expired", "failed"]) {
      minute += 1;
      ids[status] = (await interaction(f, { kind: "ask_user_questions", status, createdAt: new Date(Date.UTC(2026, 10, 24, 10, minute)),
        payload: { version: 1, questions: [] } as never,
        ...(status === "expired" ? { result: { version: 1, answers: [], expirationReason: "superseded_by_newer_interaction" } as never } : {}),
      })).id;
    }
    const [cancelledApproval] = await db.insert(approvals).values({ companyId: f.companyId, type: "budget_increase", status: "cancelled",
      payload: { title: "Old" }, createdAt: new Date(Date.UTC(2026, 10, 24, 9, 0)) }).returning();
    await db.insert(issueApprovals).values({ companyId: f.companyId, issueId: f.issueId, approvalId: cancelledApproval!.id });
    expect((await read(f)).map(row => row.status).sort()).toEqual(["answered", "pending"]);
    // "all" keeps every status, newest first.
    expect((await read(f, { statuses: "all" })).map(row => row.id))
      .toEqual([ids.failed, ids.expired, ids.cancelled, ids.answered, ids.pending, cancelledApproval!.id]);
    expect(await read(f, { statuses: "all", limit: 2 })).toHaveLength(2);
  });

  it("a low-trust viewer gets only its own requests and no approvals", async () => {
    const f = await seed();
    const other = await otherAgent(f.companyId, "Planner");
    const own = await interaction(f, { kind: "request_confirmation" });
    await interaction(f, { kind: "request_confirmation", createdByAgentId: other });
    const [linked] = await db.insert(approvals).values({ companyId: f.companyId, type: "budget_increase", status: "pending",
      payload: { title: "Raise" } }).returning();
    await db.insert(issueApprovals).values({ companyId: f.companyId, issueId: f.issueId, approvalId: linked!.id });
    expect(await read(f)).toHaveLength(3);
    expect((await read(f, { lowTrust: true })).map(row => row.id)).toEqual([own.id]);
    expect(await read(f, { lowTrust: true, viewerAgentId: null })).toEqual([]);
  });

  it("quarantines the agent-written text of a request a lower-trust run made", async () => {
    const f = await seed();
    const lowRun = await run(f, { contextSnapshot: { issueId: f.issueId, executionPolicy: LOW_TRUST_POLICY(f.companyId, f.issueId) } });
    await interaction(f, { kind: "ask_user_questions", status: "answered", title: "UNTRUSTED TITLE", sourceRunId: lowRun.id,
      resolvedAt: new Date(), payload: { version: 1, questions: [{ id: "q", prompt: "UNTRUSTED PROMPT", selectionMode: "single",
        options: [{ id: "a", label: "UNTRUSTED LABEL" }] }] } as never,
      result: { version: 1, answers: [{ questionId: "q", optionIds: ["a"] }] } as never });
    const [quarantined] = await read(f);
    expect(JSON.stringify(quarantined)).not.toContain("UNTRUSTED");
    expect(quarantined?.title).toBe(LOW_TRUST_QUARANTINED_BODY);
    // The low-trust viewer itself sees what it wrote.
    expect((await read(f, { lowTrust: true }))[0]?.title).toBe("UNTRUSTED TITLE");
  });

  it("the last run is the agent's own, not a reviewer's later run", async () => {
    const f = await seed();
    const reviewer = await otherAgent(f.companyId, "Reviewer");
    const own = await run(f, { summary: "Posted the plan.", finishedAt: new Date("2026-11-24T17:52:00Z") });
    await run(f, { agentId: reviewer, summary: "Reviewed it.", finishedAt: new Date("2026-11-24T18:10:00Z"),
      contextSnapshot: { issueId: f.issueId, executionStage: { wakeRole: "reviewer" } } });
    expect(await readTaskLastRun(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, previousAssigneeAgentId: null }))
      .toEqual({ runId: own.id, agentId: f.agentId, ownRun: true, status: "succeeded", finishedAt: "2026-11-24T17:52:00.000Z",
        body: "Posted the plan.", bodyTruncated: false });
  });

  it("falls back to the previous assignee's when the agent has none", async () => {
    const f = await seed();
    const coder = await otherAgent(f.companyId, "Coder 2");
    const watchdog = await otherAgent(f.companyId, "Watchdog");
    const previous = await run(f, { agentId: coder, status: "failed", summary: "Got halfway.", finishedAt: new Date("2026-11-24T10:00:00Z") });
    // Watchdog and recovery runs by other agents don't count; nor does an unfinished run.
    await run(f, { agentId: watchdog, summary: "Watched.", finishedAt: new Date("2026-11-24T11:00:00Z"),
      contextSnapshot: { issueId: f.issueId, taskWatchdog: { watchedIssueId: f.issueId } } });
    await run(f, { agentId: watchdog, summary: "Recovered.", finishedAt: new Date("2026-11-24T11:30:00Z"),
      contextSnapshot: { issueId: f.issueId, recoveryActionId: randomUUID() } });
    await run(f, { agentId: coder, status: "running", summary: "Still going.", finishedAt: null });
    expect(await readTaskLastRun(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, previousAssigneeAgentId: null }))
      .toMatchObject({ runId: previous.id, agentId: coder, ownRun: false, status: "failed", body: "Got halfway." });
    // Named explicitly, only that agent's runs stand in.
    expect(await readTaskLastRun(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, previousAssigneeAgentId: watchdog }))
      .toBeNull();
  });

  it("skips runs with an empty summary, and runs on other tasks", async () => {
    const f = await seed();
    const kept = await run(f, { summary: "Did the work.", finishedAt: new Date("2026-11-24T10:00:00Z") });
    await run(f, { summary: "  ", finishedAt: new Date("2026-11-24T11:00:00Z") });
    await run(f, { finishedAt: new Date("2026-11-24T12:00:00Z") });
    await run(f, { summary: "Elsewhere.", contextSnapshot: { issueId: randomUUID() }, finishedAt: new Date("2026-11-24T13:00:00Z") });
    expect((await readTaskLastRun(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, previousAssigneeAgentId: null }))?.runId)
      .toBe(kept.id);
    // The legacy result summary and the next action are the fallbacks, as in the handoff.
    const legacy = await seed();
    await run(legacy, { runtimeMode: "legacy", resultJson: { summary: "Legacy summary." } });
    expect((await readTaskLastRun(db, { companyId: legacy.companyId, issueId: legacy.issueId, agentId: legacy.agentId,
      previousAssigneeAgentId: null }))?.body).toBe("Legacy summary.");
  });

  it("cuts the summary at 2,000 characters", async () => {
    const f = await seed();
    await run(f, { summary: "x".repeat(2_500) });
    const lastRun = await readTaskLastRun(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, previousAssigneeAgentId: null });
    expect(lastRun?.body).toHaveLength(2_000);
    expect(lastRun?.bodyTruncated).toBe(true);
  });

  it("a lower-trust run's summary is quarantined", async () => {
    const f = await seed();
    await run(f, { summary: "UNTRUSTED SUMMARY", contextSnapshot: { issueId: f.issueId, executionPolicy: LOW_TRUST_POLICY(f.companyId, f.issueId) } });
    const lastRun = await readTaskLastRun(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, previousAssigneeAgentId: null });
    expect(lastRun?.body).toBe(LOW_TRUST_QUARANTINED_BODY);
    expect(lastRun?.bodyTruncated).toBe(false);
  });

  it("documents leave out the continuation summary and mark the plan inBrief", async () => {
    const f = await seed();
    const add = async (key: string, title: string | null, extra: Partial<typeof documents.$inferInsert> = {}) => {
      const [doc] = await db.insert(documents).values({ companyId: f.companyId, title, latestBody: `${key} body`, ...extra }).returning();
      await db.insert(issueDocuments).values({ companyId: f.companyId, issueId: f.issueId, documentId: doc!.id, key });
    };
    await add("notes", "Notes", { updatedAt: new Date("2026-11-24T12:00:00Z") });
    await add("continuation-summary", "Continuation Summary");
    await add("workflow", null, { updatedAt: new Date("2026-11-24T13:00:00Z") });
    await add("plan", "Plan", { updatedAt: new Date("2026-11-24T10:00:00Z") });
    await add("scratch", "UNTRUSTED TITLE", { sourceTrust: { preset: "low_trust_review", disposition: "quarantined", sourceIssueId: f.issueId },
      updatedAt: new Date("2026-11-24T09:00:00Z") });
    expect(await readTaskDocuments(db, { companyId: f.companyId, issueId: f.issueId })).toEqual([
      { key: "plan", title: "Plan", inBrief: true },
      { key: "workflow", title: null, inBrief: false },
      { key: "notes", title: "Notes", inBrief: false },
      { key: "scratch", title: null, inBrief: false },
    ]);
  });

  it("the history: answered most recent first, open oldest first, and the omitted count", async () => {
    const f = await seed();
    for (let index = 0; index < 10; index += 1) {
      await interaction(f, { kind: "request_confirmation", status: "accepted", title: `Answered ${index}`,
        createdAt: new Date(Date.UTC(2026, 10, 24, 9, index)), resolvedAt: new Date(Date.UTC(2026, 10, 24, 10, index)),
        result: { version: 1, outcome: "accepted" } as never });
    }
    await interaction(f, { kind: "ask_user_questions", title: "Second open", createdAt: new Date(Date.UTC(2026, 10, 24, 11, 2)),
      payload: { version: 1, questions: [] } as never });
    await interaction(f, { kind: "ask_user_questions", title: "First open", createdAt: new Date(Date.UTC(2026, 10, 24, 11, 1)),
      payload: { version: 1, questions: [] } as never });
    const history = await readTaskHistory(db, { companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, lowTrust: false });
    expect(history?.answered.map(row => row.title)).toEqual([9, 8, 7, 6, 5, 4, 3, 2].map(index => `Answered ${index}`));
    expect(history?.answeredOmitted).toBe(2);
    expect(history?.open.map(row => row.title)).toEqual(["First open", "Second open"]);
    expect(history?.lastRun).toBeNull();
    expect(history?.documents).toEqual([]);
  });

  it("no history on a chat task, or for an agent that isn't the assignee", async () => {
    const chat = await seed();
    const { eq } = await import("drizzle-orm");
    await db.update(issues).set({ conversationAgentId: chat.agentId, conversationUserId: "someone", conversationState: "active" })
      .where(eq(issues.id, chat.issueId));
    expect(await readTaskHistory(db, { companyId: chat.companyId, issueId: chat.issueId, agentId: chat.agentId, lowTrust: false })).toBeNull();
    const f = await seed();
    const other = await otherAgent(f.companyId, "Bystander");
    expect(await readTaskHistory(db, { companyId: f.companyId, issueId: f.issueId, agentId: other, lowTrust: false })).toBeNull();
    // Another company's agent never reads this task's history.
    const foreign = await seed();
    expect(await readTaskHistory(db, { companyId: foreign.companyId, issueId: f.issueId, agentId: f.agentId, lowTrust: false })).toBeNull();
  });

  it("the route's read: requests, and names for their people and the task's comment authors", async () => {
    const f = await seed();
    const brian = await user("Brian");
    const dana = await user("Dana");
    const helper = await otherAgent(f.companyId, "Helper");
    await interaction(f, { kind: "request_confirmation", status: "accepted", resolvedByUserId: brian, resolvedAt: new Date(),
      result: { version: 1, outcome: "accepted" } as never });
    await interaction(f, { kind: "request_confirmation", status: "cancelled" });
    await db.insert(issueComments).values([
      { companyId: f.companyId, issueId: f.issueId, authorType: "user", authorUserId: dana, body: "Hello" },
      { companyId: f.companyId, issueId: f.issueId, authorType: "agent", authorAgentId: helper, body: "Hi" },
    ]);
    const result = await readTaskRequestHistory(db, { companyId: f.companyId, issueId: f.issueId, viewerAgentId: f.agentId, lowTrust: false });
    expect(result.requests.map(row => row.status)).toEqual(["cancelled", "accepted"]);
    expect(result.names).toEqual({
      [`agent:${f.agentId}`]: "Coder", [`user:${brian}`]: "Brian", [`user:${dana}`]: "Dana", [`agent:${helper}`]: "Helper",
    });
  });
});
