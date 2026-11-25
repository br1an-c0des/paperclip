import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  approvals,
  authUsers,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueApprovals,
  issueComments,
  issues,
  issueThreadInteractions,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { DECLINED_INTERACTION_READ_EVENT } from "../services/chat-interaction-outcome-report.js";

// GET /issues/:id/request-history (fork/step-5-handoff-plan.md, Task 4): what paperclip_read_task
// reads with requests: true.
const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;

describePostgres("GET /issues/:id/request-history", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const plannerId = randomUUID();
  const userId = `request-history-user-${randomUUID()}`;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-issue-request-history-routes-");
    db = createDb(database.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "RQH", defaultResponsibleUserId: userId,
      requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values([
      { id: agentId, companyId, name: "Coder", role: "engineer", adapterType: "claude_local", status: "active" },
      { id: plannerId, companyId, name: "Planner", role: "engineer", adapterType: "claude_local", status: "active" },
    ]);
    await db.insert(authUsers).values({ id: userId, name: "Brian", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
  }, 30_000);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  function app(actor: Express.Request["actor"]) {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => { req.actor = actor; next(); });
    instance.use("/api", issueRoutes(db, {} as never));
    instance.use(errorHandler);
    return instance;
  }
  const agentActor = (runId: string, actorCompanyId = companyId, actorAgentId = agentId) => ({ type: "agent", companyId: actorCompanyId,
    agentId: actorAgentId, runId, source: "agent_jwt", onBehalfOfUserId: null, onBehalfOfMemberships: [] }) as Express.Request["actor"];

  let issueNumber = 0;
  async function seed(options: { chat?: boolean; lowTrustRun?: boolean } = {}) {
    issueNumber += 1;
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Add a theme switch", identifier: `RQH-${issueNumber}`, issueNumber,
      status: "in_progress", assigneeAgentId: agentId,
      ...(options.chat ? { conversationAgentId: agentId, conversationUserId: userId, conversationState: "active" } : {}) });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", startedAt: new Date(),
      contextSnapshot: { issueId, ...(options.lowTrustRun ? { executionPolicy: {
        trustPreset: "low_trust_review", authorizationPolicy: { trustPreset: "low_trust_review",
          trustBoundary: { mode: "low_trust_review", companyId, issueIds: [issueId] } } } } : {}) } });
    const own = (await db.insert(issueThreadInteractions).values({ companyId, issueId, kind: "ask_user_questions", status: "answered",
      createdByAgentId: agentId, resolvedByUserId: userId, resolvedAt: new Date("2026-11-24T17:45:00Z"), createdAt: new Date("2026-11-24T17:41:00Z"),
      payload: { version: 1, questions: [{ id: "where", prompt: "Where should the switch go?", selectionMode: "single",
        options: [{ id: "both", label: "Both places" }] }] },
      result: { version: 1, answers: [{ questionId: "where", optionIds: ["both"] }] } }).returning())[0]!;
    const planners = (await db.insert(issueThreadInteractions).values({ companyId, issueId, kind: "request_confirmation", status: "cancelled",
      createdByAgentId: plannerId, createdAt: new Date("2026-11-24T17:50:00Z"), payload: { version: 1, prompt: "Ship it?" } }).returning())[0]!;
    // A declined tool action: GET /interactions records that a chat run read it; this route never does.
    await db.insert(issueThreadInteractions).values({ companyId, issueId, kind: "request_confirmation", status: "rejected",
      createdByAgentId: agentId, resolvedByUserId: userId, resolvedAt: new Date(), createdAt: new Date("2026-11-24T17:30:00Z"),
      payload: { version: 1, prompt: "Run the tool?", toolAction: {
        version: 1, actionRequestId: randomUUID(), invocationId: randomUUID(), toolName: "deploy", toolDisplayName: "Deploy",
        connectionId: null, applicationId: null, appDisplayName: null, risk: "write", previewMarkdown: "Deploy the site",
        argumentsSummaryJson: "{}", argumentsHash: "a".repeat(64), expiresAt: null } } as never,
      result: { version: 1, outcome: "rejected" } });
    const [approval] = await db.insert(approvals).values({ companyId, type: "budget_increase", status: "approved",
      payload: { title: "Build the switch" }, decidedByUserId: userId, decidedAt: new Date("2026-11-24T17:49:00Z"),
      createdAt: new Date("2026-11-24T17:44:00Z") }).returning();
    await db.insert(issueApprovals).values({ companyId, issueId, approvalId: approval!.id });
    await db.insert(issueComments).values({ companyId, issueId, authorType: "user", authorUserId: userId, body: "Go with idea 2." });
    return { issueId, runId, own, planners, approvalId: approval!.id };
  }
  const declinedReads = (runId: string) => db.select().from(heartbeatRunEvents)
    .where(and(eq(heartbeatRunEvents.runId, runId), eq(heartbeatRunEvents.eventType, DECLINED_INTERACTION_READ_EVENT)));

  it("returns requests and names, records no declined read", async () => {
    const f = await seed({ chat: true });
    const res = await request(app(agentActor(f.runId))).get(`/api/issues/${f.issueId}/request-history`);
    expect(res.status).toBe(200);
    expect(res.body.requests.map((row: { id: string }) => row.id)).toEqual([f.planners.id, f.approvalId, f.own.id]);
    expect(res.body.requests[2]).toMatchObject({ kind: "ask_user_questions", status: "answered",
      questions: [{ id: "where", prompt: "Where should the switch go?", options: [{ id: "both", label: "Both places" }] }],
      answers: [{ questionId: "where", optionIds: ["both"], otherText: null }],
      askedBy: { type: "agent", id: agentId }, decidedBy: { type: "user", id: userId } });
    expect(res.body.requests[0]).toMatchObject({ status: "cancelled", askedBy: { type: "agent", id: plannerId } });
    expect(res.body.names).toEqual({ [`agent:${agentId}`]: "Coder", [`agent:${plannerId}`]: "Planner", [`user:${userId}`]: "Brian" });
    expect(await declinedReads(f.runId)).toEqual([]);

    // The interactions route, for the same run, does record the decline: the setup is one that would.
    expect((await request(app(agentActor(f.runId))).get(`/api/issues/${f.issueId}/interactions`)).status).toBe(200);
    expect(await declinedReads(f.runId)).toHaveLength(1);
  });

  it("a low-trust caller gets its own requests and no approvals", async () => {
    const f = await seed({ lowTrustRun: true });
    const res = await request(app(agentActor(f.runId))).get(`/api/issues/${f.issueId}/request-history`);
    expect(res.status).toBe(200);
    expect(res.body.requests.map((row: { id: string }) => row.id)).toEqual([f.own.id]);
  });

  it("another company's task is not found", async () => {
    const f = await seed();
    const otherCompanyId = randomUUID();
    const outsiderId = randomUUID();
    const outsiderRunId = randomUUID();
    await db.insert(companies).values({ id: otherCompanyId, name: "Other", issuePrefix: "OTQ", defaultResponsibleUserId: userId,
      requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: outsiderId, companyId: otherCompanyId, name: "Outsider", role: "engineer",
      adapterType: "claude_local", status: "active" });
    await db.insert(heartbeatRuns).values({ id: outsiderRunId, companyId: otherCompanyId, agentId: outsiderId, status: "running",
      startedAt: new Date(), contextSnapshot: {} });
    const res = await request(app(agentActor(outsiderRunId, otherCompanyId, outsiderId))).get(`/api/issues/${f.issueId}/request-history`);
    expect([403, 404]).toContain(res.status);
    expect(res.body).not.toHaveProperty("requests");
  });
});
