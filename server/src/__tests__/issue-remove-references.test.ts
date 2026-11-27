import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  approvals,
  companies,
  completionContracts,
  costEvents,
  createDb,
  documents,
  heartbeatRuns,
  issueApprovals,
  issueComments,
  issueDocuments,
  issueInboxArchives,
  issueReadStates,
  issueWorkProducts,
  issues,
  nativeRunFinalizations,
  nativeRunResults,
  statusDecisionEffects,
  statusDecisions,
  workAssessments,
  workspaceOperations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

// Deleting an ordinary finished task failed with "Issue cannot be deleted because
// another record still references it" (bug 101). Every run on the native runtime
// (claude_local's default) leaves a completion contract, a result, an assessment, a
// status decision, its effects and a finalization row, each with a NOT NULL issue_id
// and a foreign key to issues without a delete rule. The delete path now removes them.
describeEmbeddedPostgres("issueService.remove with an ordinary task's references", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-remove-references-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 60_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // A finished top-level task as a claude_local agent leaves it: one native run
  // with its outcome records, comments from the agent and the user, a document,
  // a work product, an approval, read and inbox state, cost and activity rows.
  async function seedFinishedTask(finalizationPhase = "committed") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const contractId = randomUUID();
    const resultId = randomUUID();
    const assessmentId = randomUUID();
    const decisionId = randomUUID();
    const approvalId = randomUUID();
    const documentId = randomUUID();
    const costEventId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "M7 test delete",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Worker",
      adapterType: "claude_local",
      status: "idle",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Finished task",
      status: "done",
      assigneeAgentId: agentId,
    });
    await db.insert(completionContracts).values({
      id: contractId, companyId, issueId, revision: 1,
      schemaVersion: "paperclip.completion-contract.v1", policyVersion: "fixture", risk: "standard",
      completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: {}, canonicalSha256: contractId, createdByActorType: "system", createdByActorId: "fixture",
    });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, issueId, nativeIssueId: issueId,
      completionContractId: contractId, runtimeMode: "native", nativePhase: "committed",
      status: "succeeded", finishedAt: now, resultJson: { finalizationPhase: "committed" },
    });
    await db.insert(nativeRunResults).values({
      id: resultId, companyId, issueId, runId, completionContractId: contractId,
      serverFingerprint: resultId, schemaStatus: "accepted",
      resultJson: { terminal: { runTerminalState: "succeeded" } }, canonicalSha256: resultId,
    });
    await db.insert(workAssessments).values({
      id: assessmentId, companyId, issueId, runId, contractId, resultId,
      triggerKind: "native_result", triggerActorCompanyId: companyId, priorIssueStatus: "in_progress",
      priorStatusVersion: 0, policyVersion: "fixture", assessmentJson: {}, inputDigest: assessmentId,
    });
    await db.insert(statusDecisions).values({
      id: decisionId, companyId, issueId, runId, assessmentId,
      decisionVersion: 1, policyVersion: "fixture", fromStatus: "in_progress", toStatus: "done",
      reasonCode: "fixture", decisionJson: {}, decisionDigest: decisionId,
      applicationState: "applied", appliedAt: now,
    });
    await db.insert(statusDecisionEffects).values({
      companyId, issueId, decisionId, ordinal: 0, effectKind: "release_checkout", targetType: "issue",
      idempotencyKey: randomUUID(), payload: {}, deliveryState: "delivered", deliveredAt: now,
    });
    await db.insert(nativeRunFinalizations).values({
      companyId, issueId, runId, resultId, assessmentId, decisionId, phase: finalizationPhase,
    });
    await db.insert(workspaceOperations).values({
      id: operationId, companyId, issueId, heartbeatRunId: runId,
      phase: "workspace_finalize", status: "succeeded", startedAt: now, finishedAt: now,
    });
    await db.insert(issueComments).values([
      { companyId, issueId, authorAgentId: agentId, body: "Done." },
      { companyId, issueId, authorUserId: "local-board", body: "Thanks." },
    ]);
    await db.insert(documents).values({ id: documentId, companyId, latestBody: "# Plan" });
    await db.insert(issueDocuments).values({ companyId, issueId, documentId, key: "plan" });
    await db.insert(issueWorkProducts).values({
      companyId, issueId, type: "pull_request", provider: "github", title: "PR", status: "open",
    });
    await db.insert(approvals).values({ id: approvalId, companyId, type: "permission_request", payload: {} });
    await db.insert(issueApprovals).values({ companyId, issueId, approvalId });
    await db.insert(issueReadStates).values({ companyId, issueId, userId: "local-board" });
    await db.insert(issueInboxArchives).values({ companyId, issueId, userId: "local-board" });
    await db.insert(costEvents).values({
      id: costEventId, companyId, agentId, issueId, heartbeatRunId: runId,
      provider: "anthropic", model: "claude-opus-4-8", costCents: 12, occurredAt: now,
    });
    await db.insert(activityLog).values({
      companyId, actorType: "agent", actorId: agentId, action: "issue.updated",
      entityType: "issue", entityId: issueId, runId,
    });

    return { companyId, issueId, runId, approvalId, documentId, costEventId, operationId };
  }

  async function countWhere(table: string, column: string, id: string) {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${id}`,
    );
    return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  }

  it("deletes a finished task with a native run, comments, documents and approvals", async () => {
    const f = await seedFinishedTask();

    const removed = await svc.remove(f.issueId);
    expect(removed?.id).toBe(f.issueId);
    expect(await countWhere("issues", "id", f.issueId)).toBe(0);

    // The run's outcome records belong to the task and go with it.
    for (const table of [
      "completion_contracts",
      "native_run_results",
      "work_assessments",
      "status_decisions",
      "status_decision_effects",
      "native_run_finalizations",
    ]) {
      expect(await countWhere(table, "issue_id", f.issueId), table).toBe(0);
    }

    // Task-owned rows cascade.
    for (const table of [
      "issue_comments",
      "issue_documents",
      "issue_work_products",
      "issue_approvals",
      "issue_read_states",
      "issue_inbox_archives",
    ]) {
      expect(await countWhere(table, "issue_id", f.issueId), table).toBe(0);
    }
    expect(await db.select().from(documents).where(eq(documents.id, f.documentId))).toHaveLength(0);

    // History other things need stays, detached from the task.
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(run?.issueId).toBeNull();
    const [cost] = await db.select().from(costEvents).where(eq(costEvents.id, f.costEventId));
    expect(cost?.issueId).toBeNull();
    const [operation] = await db.select().from(workspaceOperations).where(eq(workspaceOperations.id, f.operationId));
    expect(operation?.issueId).toBeNull();
    expect(await db.select().from(approvals).where(eq(approvals.id, f.approvalId))).toHaveLength(1);
    expect(await countWhere("activity_log", "entity_id", f.issueId)).toBe(1);
  });

  it("refuses with a 409 while a run on the task is still finishing", async () => {
    const f = await seedFinishedTask("observed");

    await expect(svc.remove(f.issueId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("still finishing"),
    });
    expect(await countWhere("issues", "id", f.issueId)).toBe(1);
    expect(await countWhere("native_run_finalizations", "issue_id", f.issueId)).toBe(1);
  });

  it("names the table that blocks a delete it does not handle", async () => {
    const f = await seedFinishedTask();
    const child = randomUUID();
    await db.insert(issues).values({ id: child, companyId: f.companyId, parentId: f.issueId, title: "Child" });

    await expect(svc.remove(f.issueId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("(issues)"),
    });
    // The transaction rolled back: nothing of the task was removed.
    expect(await countWhere("issues", "id", f.issueId)).toBe(1);
    expect(await countWhere("completion_contracts", "issue_id", f.issueId)).toBe(1);
  });

  // Guard: a new foreign key to issues without ON DELETE CASCADE or SET NULL
  // blocks every delete of a task that has such a row. Give it a delete rule in
  // its migration, remove its rows in issueService.remove, or list it below with
  // the reason it should block the delete.
  it("has a delete rule or a known handling for every foreign key to issues", async () => {
    const handledByRemove = new Set([
      "completion_contracts.issue_id",
      "native_run_results.issue_id",
      "work_assessments.issue_id",
      "status_decisions.issue_id",
      "status_decision_effects.issue_id",
      "native_run_finalizations.issue_id",
    ]);
    const blocksOnPurpose = new Set([
      // Subtasks: delete or move them first.
      "issues.parent_id",
      "issues.privacy_root_issue_id",
      // Decisions (requests) are a signed ledger and stay restricted (upstream's choice).
      "decision_bundles.origin_issue_id",
      "decisions.origin_issue_id",
      "decision_effect_executions.target_issue_id",
      // A case's work task, and its hand-offs.
      "cases.work_issue_id",
      "case_handoffs.issue_id",
      // A skill test run's task.
      "company_skill_test_runs.issue_id",
      // Dormant: chat channels and browser sessions.
      "chat_conversations.issue_id",
      "chat_publications.issue_id",
      "chat_teams_file_transfers.issue_id",
      "chat_github_reviews.issue_id",
      "chat_voice_sessions.issue_id",
      "chat_voice_inbound_calls.requested_issue_id",
      "chat_voice_inbound_calls.intake_issue_id",
      "browser_use_sessions.issue_id",
    ]);

    const rows = (await db.execute(sql`
      SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid
        AND fa.attnum = c.confkey[array_position(c.conkey, a.attnum)]
      WHERE c.contype = 'f' AND c.confrelid = 'issues'::regclass
        AND fa.attname = 'id' AND c.confdeltype IN ('a', 'r')
    `)) as unknown as Array<{ tbl: string; col: string }>;
    const unhandled = rows
      .map((row) => `${row.tbl.replace(/^public\./, "")}.${row.col}`)
      .filter((ref) => !handledByRemove.has(ref) && !blocksOnPurpose.has(ref))
      .sort();
    expect(unhandled).toEqual([]);
  });
});
