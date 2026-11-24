import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  approvals,
  authUsers,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issueComments,
  issues,
  routines,
  userWorkspacePreferences,
} from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import { buildPaperclipWakePayload } from "./run-preparation.js";

// The step 5 wake's new payload fields (fork/step-5-wake-plan.md, "The contract").
const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("wake payload: the fields the new wake reads", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-wake-fields-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  async function user(name: string) {
    const id = `wake-user-${randomUUID()}`;
    await db.insert(authUsers).values({ id, name, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    return id;
  }

  async function seed(issueValues: Partial<typeof issues.$inferInsert> = {}) {
    const [company] = await db.insert(companies)
      .values({ name: "Wake fields", issuePrefix: `W${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const [agent] = await db.insert(agents)
      .values({ companyId: company!.id, name: "Coder", adapterType: "process" }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company!.id, title: "Add a dark mode toggle", status: "in_progress",
      assigneeAgentId: agent!.id, ...issueValues,
    }).returning();
    return { companyId: company!.id, agentId: agent!.id, issueId: issue!.id };
  }

  async function approval(companyId: string, values: Partial<typeof approvals.$inferInsert> = {}) {
    const [row] = await db.insert(approvals).values({
      companyId, type: "budget_increase", status: "approved", payload: { title: "Raise the budget to $50" },
      decisionNote: "Keep it under 10 kB", ...values,
    }).returning();
    return row!;
  }

  it("adds the approval to an approval wake", async () => {
    const f = await seed();
    const decider = await user("Brian");
    const row = await approval(f.companyId, { decidedByUserId: decider });
    const payload = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: { wakeReason: "approval_approved", approvalId: row.id, issueId: f.issueId },
    });
    expect(payload?.approval).toEqual({
      id: row.id, type: "budget_increase", summary: "Raise the budget to $50", status: "approved",
      decisionNote: "Keep it under 10 kB", decidedByUserId: decider,
    });
    expect(payload?.names).toMatchObject({ [`user:${decider}`]: "Brian" });
  });

  it("gives an approval with no task a payload", async () => {
    const f = await seed();
    const row = await approval(f.companyId, { status: "cancelled", payload: { summary: "Hire a designer" }, decisionNote: null });
    const payload = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: { wakeReason: "approval_cancelled", approvalId: row.id },
    });
    expect(payload).not.toBeNull();
    expect(payload?.issue).toBeNull();
    expect(payload?.approval).toMatchObject({ id: row.id, summary: "Hire a designer", status: "cancelled", decisionNote: null });
  });

  it("still returns null for an empty wake", async () => {
    const f = await seed();
    expect(await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId, contextSnapshot: { wakeReason: "heartbeat_timer" } }))
      .toBeNull();
    // An approval from another company is not this wake's approval.
    const other = await seed();
    const foreign = await approval(other.companyId);
    expect(await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: { wakeReason: "approval_approved", approvalId: foreign.id } })).toBeNull();
  });

  it("names the people in the wake", async () => {
    const f = await seed();
    const commenter = await user("Brian");
    const earlier = await user("Dana");
    const [helper] = await db.insert(agents).values({ companyId: f.companyId, name: "Reviewer", adapterType: "process" }).returning();
    const [byUser] = await db.insert(issueComments)
      .values({ companyId: f.companyId, issueId: f.issueId, authorType: "user", authorUserId: commenter, body: "Please add tests" }).returning();
    const [byAgent] = await db.insert(issueComments)
      .values({ companyId: f.companyId, issueId: f.issueId, authorType: "agent", authorAgentId: helper!.id, body: "Done reviewing" }).returning();
    const payload = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: {
        wakeReason: "issue_commented", issueId: f.issueId, wakeCommentIds: [byUser!.id, byAgent!.id],
        executionContinuation: { messages: [{ id: randomUUID(), authorType: "user", authorId: earlier, body: "Original request" }] },
      },
    });
    expect(payload?.names).toEqual({
      [`user:${commenter}`]: "Brian",
      [`agent:${helper!.id}`]: "Reviewer",
      [`user:${earlier}`]: "Dana",
      [`agent:${f.agentId}`]: "Coder",
    });
  });

  it("adds the actor from the wakeup request", async () => {
    const f = await seed();
    const requester = await user("Brian");
    const later = await user("Dana");
    const [first] = await db.insert(agentWakeupRequests).values({
      companyId: f.companyId, agentId: f.agentId, source: "on_demand", reason: "issue_commented",
      requestedByActorType: "user", requestedByActorId: requester, requestedAt: new Date("2026-11-24T10:00:00Z"),
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: f.companyId, agentId: f.agentId, status: "queued", wakeupRequestId: first!.id,
      contextSnapshot: { issueId: f.issueId },
    }).returning();
    const context = { wakeReason: "issue_commented", issueId: f.issueId };
    const payload = await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId, runId: run!.id, contextSnapshot: context });
    expect(payload?.actor).toEqual({ type: "user", id: requester });
    expect(payload?.names).toMatchObject({ [`user:${requester}`]: "Brian" });

    // A wake merged into the run later carries the latest reason, so its requester is the actor.
    await db.insert(agentWakeupRequests).values({
      companyId: f.companyId, agentId: f.agentId, source: "on_demand", reason: "issue_commented", status: "coalesced",
      requestedByActorType: "user", requestedByActorId: later, runId: run!.id, requestedAt: new Date("2026-11-24T10:05:00Z"),
    });
    const merged = await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId, runId: run!.id, contextSnapshot: context });
    expect(merged?.actor).toEqual({ type: "user", id: later });

    // No run, or no wakeup request: no actor.
    expect((await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId, contextSnapshot: context }))?.actor).toBeNull();
  });

  it("adds the task's assignee and routine", async () => {
    const assignee = await user("Brian");
    const f = await seed({ assigneeAgentId: null, assigneeUserId: assignee });
    const [routine] = await db.insert(routines).values({ companyId: f.companyId, title: "Nightly triage" }).returning();
    const [routineTask] = await db.insert(issues).values({
      companyId: f.companyId, title: "Triage", status: "todo", assigneeAgentId: f.agentId,
      originKind: "routine_execution", originId: routine!.id,
    }).returning();

    const userAssigned = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: { wakeReason: "issue_comment_mentioned", issueId: f.issueId },
    });
    expect(userAssigned?.issue).toMatchObject({ assigneeAgentId: null, assigneeUserId: assignee, routineName: null });
    expect(userAssigned?.names).toMatchObject({ [`user:${assignee}`]: "Brian" });

    // The run's own path passes an issue summary: the builder still fills the people fields.
    const fromRoutine = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: { wakeReason: "issue_assigned", issueId: routineTask!.id },
      issueSummary: { id: routineTask!.id, identifier: null, title: "Triage", description: null, status: "todo",
        priority: "medium", workMode: "standard", originKind: "routine_execution" },
    });
    expect(fromRoutine?.issue).toMatchObject({ assigneeAgentId: f.agentId, assigneeUserId: null, routineName: "Nightly triage" });
    expect(fromRoutine?.names).toMatchObject({ [`agent:${f.agentId}`]: "Coder" });
  });

  it("names the execution stage's participant and return assignee", async () => {
    const f = await seed();
    const returnTo = await user("Brian");
    const payload = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: {
        wakeReason: "execution_review_requested", issueId: f.issueId,
        executionStage: { wakeRole: "reviewer", currentParticipant: { type: "agent", agentId: f.agentId },
          returnAssignee: { type: "user", userId: returnTo } },
      },
    });
    expect(payload?.names).toEqual({ [`agent:${f.agentId}`]: "Coder", [`user:${returnTo}`]: "Brian" });
  });

  it("uses the responsible person's time zone", async () => {
    const owner = await user("Brian");
    const f = await seed({ responsibleUserId: owner });
    await db.insert(userWorkspacePreferences).values({ userId: owner, timeZone: "Europe/Berlin" });
    const context = { wakeReason: "issue_assigned", issueId: f.issueId };
    expect((await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId, contextSnapshot: context }))?.timeZone)
      .toBe("Europe/Berlin");

    await db.update(userWorkspacePreferences).set({ timeZone: "Mars/Olympus_Mons" }).where(eq(userWorkspacePreferences.userId, owner));
    expect((await buildPaperclipWakePayload({ db, companyId: f.companyId, agentId: f.agentId, contextSnapshot: context }))?.timeZone)
      .toBeNull();

    const nobody = await seed();
    expect((await buildPaperclipWakePayload({ db, companyId: nobody.companyId, agentId: nobody.agentId,
      contextSnapshot: { wakeReason: "issue_assigned", issueId: nobody.issueId } }))?.timeZone).toBeNull();
  });

  it("redacts a registered secret in the decision note and the routine's name", async () => {
    const f = await seed();
    const secret = "wake-fields-secret-canary";
    const [routine] = await db.insert(routines).values({ companyId: f.companyId, title: `Routine ${secret}` }).returning();
    await db.update(issues).set({ originKind: "routine_execution", originId: routine!.id }).where(eq(issues.id, f.issueId));
    const [previous] = await db.insert(heartbeatRuns).values({
      companyId: f.companyId, agentId: f.agentId, status: "succeeded", contextSnapshot: { issueId: f.issueId },
    }).returning();
    await createRunSecretRedactionRegistry(db).register(f.companyId, previous!.id, secret);
    const row = await approval(f.companyId, { decisionNote: `Approved, token ${secret}` });
    const payload = await buildPaperclipWakePayload({
      db, companyId: f.companyId, agentId: f.agentId,
      contextSnapshot: { wakeReason: "approval_approved", approvalId: row.id, issueId: f.issueId },
    });
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(payload?.approval?.decisionNote).toBe(`Approved, token ${REDACTED_EVENT_VALUE}`);
    expect(payload?.issue?.routineName).toBe(`Routine ${REDACTED_EVENT_VALUE}`);
  });
});
