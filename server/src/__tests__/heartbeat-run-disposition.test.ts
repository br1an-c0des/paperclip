import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRunEvents,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import type { RunDisposition } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import * as usageReceipts from "../services/usage-receipts.js";
import { createHeartbeatLifecycle, type HeartbeatLifecycleDependencies } from "../services/heartbeat/run-lifecycle.js";
import { createHeartbeatRunPreparation } from "../services/heartbeat/run-preparation.js";
import { createHeartbeatRunState, getAdapterSessionCodec } from "../services/heartbeat/run-state.js";
import { buildEffectiveRunSessionConfigMetadata } from "../services/heartbeat/workspaces.js";
import {
  createHeartbeatRunCompletion,
  type CompleteHeartbeatRunInput,
  type HeartbeatRunCompletionDependencies,
} from "../services/heartbeat/run-completion.js";
import { readRunDisposition, recordRunDisposition } from "../services/heartbeat/run-disposition.js";
import { recoveryService } from "../services/recovery/service.js";

vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));

type Dependencies = HeartbeatRunCompletionDependencies;

function callbacks(db: Db) {
  const state = createHeartbeatRunState(db);
  const lifecycleDeps = {
    ...state, ...createHeartbeatRunPreparation(db),
    issuesSvc: { addComment: vi.fn(), listReviewAttention: vi.fn() },
    recovery: { escalateStrandedAssignedIssue: vi.fn() },
    companySkills: { completeTestRunForIssue: vi.fn() },
    budgets: { getInvocationBlock: vi.fn(async () => null) },
    treeControlSvc: { getActivePauseHoldGate: vi.fn(async () => null) },
    enqueueWakeup: vi.fn(),
    getCurrentUserRedactionOptions: vi.fn<HeartbeatLifecycleDependencies["getCurrentUserRedactionOptions"]>(async () => ({ enabled: false })),
    getAgentInvokability: vi.fn<HeartbeatLifecycleDependencies["getAgentInvokability"]>(async () => ({ invokable: true })),
    emitTerminalAgentTaskRun: vi.fn(), budgetHooks: {},
  } satisfies HeartbeatLifecycleDependencies;
  const lifecycle = createHeartbeatLifecycle(db, lifecycleDeps);
  return {
    ...state, ...lifecycle,
    classifyAndPersistRunLiveness: vi.fn<Dependencies["classifyAndPersistRunLiveness"]>(async run => run),
    completeSkillTestRunForHeartbeatOutcome: vi.fn<Dependencies["completeSkillTestRunForHeartbeatOutcome"]>(async () => null),
    refreshContinuationSummaryForRun: vi.fn<Dependencies["refreshContinuationSummaryForRun"]>(async () => null),
    findRunIssueComment: vi.fn<Dependencies["findRunIssueComment"]>(async () => null),
    findLatestCompletedFinalAgentMessage: vi.fn<Dependencies["findLatestCompletedFinalAgentMessage"]>(async () => null),
    finalizeIssueCommentPolicy: vi.fn<Dependencies["finalizeIssueCommentPolicy"]>(async () => ({ outcome: "not_applicable", queuedRun: null })),
    handleIssueReviewPathDisposition: vi.fn<Dependencies["handleIssueReviewPathDisposition"]>(async () => undefined),
    handleRunLivenessContinuation: vi.fn<Dependencies["handleRunLivenessContinuation"]>(),
    handleSuccessfulRunHandoff: vi.fn<Dependencies["handleSuccessfulRunHandoff"]>(),
    updateRuntimeState: vi.fn<Dependencies["updateRuntimeState"]>(),
    scheduleBoundedRetryForRun: vi.fn<Dependencies["scheduleBoundedRetryForRun"]>(),
    scheduleInteractionContinuationInfrastructureRetryIfEligible: vi.fn<Dependencies["scheduleInteractionContinuationInfrastructureRetryIfEligible"]>(async () => null),
    timerClaimWasFirstHeartbeat: vi.fn<Dependencies["timerClaimWasFirstHeartbeat"]>(() => undefined),
    releaseIssueExecutionAndPromote: vi.fn<Dependencies["releaseIssueExecutionAndPromote"]>(async () => undefined),
    finalizeAgentStatus: vi.fn<Dependencies["finalizeAgentStatus"]>(async () => undefined),
    enqueueWakeup: vi.fn<Dependencies["enqueueWakeup"]>(),
    issuesSvc: { addComment: vi.fn<Dependencies["issuesSvc"]["addComment"]>() },
    recovery: {
      reconcileLegacyContinuation: vi.fn<Dependencies["recovery"]["reconcileLegacyContinuation"]>(async () => "skipped"),
      reconcileResolvedDependencyWakeBackstop: vi.fn<Dependencies["recovery"]["reconcileResolvedDependencyWakeBackstop"]>(),
    },
    getCurrentUserRedactionOptions: lifecycleDeps.getCurrentUserRedactionOptions,
    budgetHooks: {},
    runLogStore: { finalize: vi.fn<Dependencies["runLogStore"]["finalize"]>(async () => ({ bytes: 1, sha256: "log", compressed: false })) },
    traceStore: { finalize: vi.fn<Dependencies["traceStore"]["finalize"]>() },
    processRunCancellationSettlements: new Map<string, { settled: Promise<void>; failed: boolean }>(),
    failedProcessRunCancellations: new Map<string, { settled: Promise<void>; failed: boolean }>(),
  } satisfies Dependencies;
}

const finishedByTool = (): RunDisposition => ({
  kind: "finished", at: new Date().toISOString(), via: "tool", tool: "paperclip_finish", summary: "Shipped the export.",
});

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported && !process.env.PAPERCLIP_TEST_DATABASE_URL)("run disposition (completion rule)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: Db;
  beforeAll(async () => {
    vi.spyOn(usageReceipts, "indexPendingUsageReceipts").mockResolvedValue(new Map());
    vi.spyOn(usageReceipts, "recoverPendingRunUsageReceipts").mockResolvedValue([]);
    const external = process.env.PAPERCLIP_TEST_DATABASE_URL;
    if (external) db = createDb(external);
    else {
      database = await startEmbeddedPostgresTestDatabase("paperclip-run-disposition");
      db = createDb(database.connectionString);
    }
    await db.execute(sql`set client_min_messages = warning`);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); vi.restoreAllMocks(); });
  beforeEach(async () => { await db.execute(sql`truncate table companies restart identity cascade`); });

  /** A task-bound legacy run that is still running, on an in-progress task. */
  async function completionFixture(options: { contextSnapshot?: Record<string, unknown>; statusAtWake?: string } = {}) {
    const [company] = await db.insert(companies).values({ name: "Disposition", issuePrefix: `D${randomUUID().slice(0, 5)}` }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker", adapterType: "process" }).returning();
    const [issue] = await db.insert(issues).values({ companyId: company.id, title: "Implement export", status: options.statusAtWake ?? "in_progress", assigneeAgentId: agent.id }).returning();
    const [wake] = await db.insert(agentWakeupRequests).values({ companyId: company.id, agentId: agent.id, source: "on_demand", status: "claimed" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, wakeupRequestId: wake.id, status: "running",
      runtimeMode: "legacy", issueId: issue.id, contextSnapshot: { issueId: issue.id, ...options.contextSnapshot } }).returning();
    const deps = callbacks(db);
    const input: CompleteHeartbeatRunInput = {
      run, agent, issueId: issue.id, issueRef: { workMode: issue.workMode, identifier: issue.identifier, title: issue.title },
      signal: new AbortController().signal,
      output: { handle: { store: "local_file", logRef: "test-log" }, outputProgressState: { pending: null }, flushOutputProgress: vi.fn(async () => {}), stdoutExcerpt: "", stderrExcerpt: "" },
      session: { runtimeForAdapter: { sessionId: null, sessionDisplayId: null }, previousSessionParams: null, taskKey: issue.id, configuredModel: "test-model",
        sessionConfigMetadata: await buildEffectiveRunSessionConfigMetadata({ adapterType: agent.adapterType, effectiveAdapterConfig: {}, agentRuntimeConfig: {}, issueOverrides: null, workspaceConfig: null, environment: null, environmentEnv: null, projectEnv: null, routineEnv: null, runtimeSkills: [] }),
      },
      readFailureReportSecrets: () => [],
      adapterResult: { exitCode: 0, signal: null, timedOut: false, sessionId: "provider-session", sessionParams: { sessionId: "provider-session" },
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, usageBasis: "per_run", provider: "test", model: "test-model",
        summary: "Done.", resultJson: { finalResponse: "Done." } },
      sessionCodec: getAdapterSessionCodec(agent.adapterType), taskSessionForRun: null, sessionCompaction: { rotate: false, reason: null },
      configFreshnessResultMetadata: { version: 1 }, runLedgerScope: {}, currentUserRedactionOptions: { enabled: false }, providerTraceCapture: false,
      onProviderTraceFinalized: vi.fn(),
      issueContext: { ...issue, status: options.statusAtWake ?? "in_progress" } as unknown as CompleteHeartbeatRunInput["issueContext"],
      onLog: vi.fn(async () => {}),
    };
    const completion = createHeartbeatRunCompletion(db, deps);
    const readRun = () => db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)).then(rows => rows[0]!);
    const setTaskStatus = (status: string) => db.update(issues).set({ status }).where(eq(issues.id, issue.id));
    const dispositionLog = () => db.select({ message: heartbeatRunEvents.message }).from(heartbeatRunEvents)
      .where(and(eq(heartbeatRunEvents.runId, run.id), eq(heartbeatRunEvents.eventType, "run.disposition")));
    return { company, agent, issue, run, deps, input, completion, readRun, setTaskStatus, dispositionLog };
  }

  it("a disposition recorded during the run survives completion", async () => {
    const f = await completionFixture();
    await recordRunDisposition(db, f.run.id, finishedByTool());
    await f.setTaskStatus("done");
    await f.completion.completeRun(f.input);
    const saved = await f.readRun();
    expect(saved.status).toBe("succeeded");
    expect(saved.resultJson).toMatchObject({ finalResponse: "Done." });
    expect(readRunDisposition(saved)).toMatchObject({ kind: "finished", tool: "paperclip_finish" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("a run that calls finish is covered", async () => {
    const f = await completionFixture();
    await recordRunDisposition(db, f.run.id, finishedByTool());
    await f.setTaskStatus("done");
    await f.completion.completeRun(f.input);
    expect(readRunDisposition(await f.readRun())).toMatchObject({ kind: "finished", via: "tool" });
    expect((await f.dispositionLog()).map(e => e.message)).toEqual([expect.stringContaining("finished (paperclip_finish)")]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it.each(["done", "in_review", "blocked"])("a run that sets %s through REST is covered", async status => {
    const f = await completionFixture();
    await f.setTaskStatus(status);
    await f.completion.completeRun(f.input);
    expect(readRunDisposition(await f.readRun())).toMatchObject({ kind: "task_state", via: "task_status", taskStatus: status });
    expect((await f.dispositionLog()).map(e => e.message)).toEqual([expect.stringContaining(`task set to ${status}`)]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("a run with no disposition goes to missing-disposition recovery", async () => {
    const f = await completionFixture();
    await f.completion.completeRun(f.input);
    expect(readRunDisposition(await f.readRun())).toBeNull();
    expect(f.deps.recovery.reconcileLegacyContinuation).toHaveBeenCalledWith(f.run.id);
    expect((await f.dispositionLog()).map(e => e.message)).toEqual([expect.stringContaining("no disposition")]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("a chat turn is exempt", async () => {
    const f = await completionFixture({ contextSnapshot: { conversationMode: true } });
    await f.setTaskStatus("done");
    await f.completion.completeRun(f.input);
    expect(readRunDisposition(await f.readRun())).toBeNull();
    expect(await f.dispositionLog()).toEqual([]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("a wake on a cancelled task is exempt", async () => {
    const f = await completionFixture({ statusAtWake: "cancelled" });
    await f.completion.completeRun(f.input);
    expect(readRunDisposition(await f.readRun())).toBeNull();
    expect(await f.dispositionLog()).toEqual([]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  /** A succeeded legacy run on a task still in progress, as completion leaves it for recovery. */
  async function recoveryFixture(resultJson: Record<string, unknown> = { summary: "Worked on it." }, context: Record<string, unknown> = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Recovery fixture", issuePrefix: `R${companyId.slice(0, 6)}`, defaultResponsibleUserId: "fixture-owner" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", role: "engineer", status: "idle", adapterType: "claude_local", runtimeConfig: { heartbeat: { wakeOnDemand: true } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "Implement export", status: "in_progress", assigneeAgentId: agentId, responsibleUserId: "fixture-owner" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, invocationSource: "on_demand", status: "succeeded", runtimeMode: "legacy",
      finishedAt: new Date(), contextSnapshot: { issueId, ...context }, resultJson });
    const enqueueWakeup = vi.fn(async (targetAgentId: string, opts?: { reason?: string | null; payload?: Record<string, unknown> | null; idempotencyKey?: string | null; contextSnapshot?: Record<string, unknown> }) =>
      db.transaction(async tx => {
        const [wake] = await tx.insert(agentWakeupRequests).values({ companyId, agentId: targetAgentId, source: "automation", reason: opts?.reason, payload: opts?.payload, idempotencyKey: opts?.idempotencyKey, status: "queued" }).returning();
        const [run] = await tx.insert(heartbeatRuns).values({ companyId, agentId: targetAgentId, invocationSource: "automation", status: "queued", runtimeMode: "legacy", wakeupRequestId: wake.id, contextSnapshot: opts?.contextSnapshot }).returning();
        await tx.update(agentWakeupRequests).set({ runId: run.id }).where(eq(agentWakeupRequests.id, wake.id));
        return run;
      }));
    const recovery = recoveryService(db, { enqueueWakeup });
    const runs = () => db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
    const actions = () => db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.companyId, companyId));
    return { companyId, agentId, issueId, runId, recovery, enqueueWakeup, runs, actions };
  }

  it("recovery: a run with no disposition gets a disposition repair", async () => {
    const f = await recoveryFixture();
    expect(await f.recovery.reconcileLegacyContinuation(f.runId)).toBe("queued");
    const repair = (await f.runs()).find(r => r.id !== f.runId)!;
    expect(repair.contextSnapshot).toMatchObject({ retryReason: "issue_disposition_repair" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("recovery: a recorded finish or block is covered, and the sweep agrees", async () => {
    for (const kind of ["finished", "blocked", "task_state"] as const) {
      const f = await recoveryFixture({ summary: "Worked on it.", paperclipDisposition: { ...finishedByTool(), kind } });
      expect(await f.recovery.reconcileLegacyContinuation(f.runId)).toBe("skipped");
      await f.recovery.reconcileStrandedAssignedIssues({ companyId: f.companyId });
      expect(await f.runs()).toHaveLength(1);
      expect(await f.actions()).toHaveLength(0);
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("recovery: report_progress with continue schedules a continuation, not a repair", async () => {
    const continuing: RunDisposition = { kind: "continuing", at: new Date().toISOString(), via: "tool", tool: "paperclip_report_progress", summary: "Half done." };
    const f = await recoveryFixture({ summary: "Half done.", paperclipDisposition: continuing });
    await f.recovery.reconcileLegacyContinuation(f.runId);
    await f.recovery.reconcileStrandedAssignedIssues({ companyId: f.companyId });
    const next = (await f.runs()).filter(r => r.id !== f.runId);
    expect(next).toHaveLength(1);
    expect(next[0].contextSnapshot).toMatchObject({ wakeReason: "issue_continuation_needed", paperclipContinuation: 1, previousRunId: f.runId });
    expect(next[0].contextSnapshot).not.toHaveProperty("retryReason", "issue_disposition_repair");
    expect(await f.actions()).toHaveLength(0);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("recovery: continuation stops counting as covered after too many in a row", async () => {
    const continuing: RunDisposition = { kind: "continuing", at: new Date().toISOString(), via: "tool", tool: "paperclip_report_progress" };
    const f = await recoveryFixture({ paperclipDisposition: continuing }, { paperclipContinuation: 10 });
    expect(await f.recovery.reconcileLegacyContinuation(f.runId)).toBe("queued");
    const repair = (await f.runs()).find(r => r.id !== f.runId)!;
    expect(repair.contextSnapshot).toMatchObject({ retryReason: "issue_disposition_repair" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
