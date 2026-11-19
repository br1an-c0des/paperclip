// The dormant describe blocks of heartbeat-process-recovery.test.ts (transient sandbox provider
// refusal, paused maintenance over native passive waits, accepted Cursor planning), in the opt-in
// tier (scripts/test-tiers.json). Shared helpers are in heartbeat-process-recovery.fixture.ts.
import { BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS } from "../services/heartbeat/retries.js";
import { enableRunFailureReporting } from "./helpers/run-failure-reporting.js";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { ensureNativeCompletionContract } from "../services/native-runtime/completion-contracts.js";
import { readNativePlanWait, hasCommittedNativePlanWait } from "../services/native-runtime/native-plan-wait.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { buildQuestionResponseDeliveryEnvelope } from "../services/question-response-delivery.js";
import * as environmentOrchestrator from "../services/environment-run-orchestrator.js";
import { randomUUID } from "node:crypto";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { JsonRpcCallError } from "@paperclipai/plugin-sdk";
import { leaseFaultError } from "../services/environment-lease-fault-injection.js";
import { taskInterruptionPresentation } from "../services/task-interruption-presentation.js";
import { requestTaskRetry } from "../services/task-retry.js";
import { type ChildProcess } from "node:child_process";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { agents, agentWakeupRequests, approvals, authUsers, chatConversations, chatDeliveries, chatEndpoints, chatExternalPrincipals, chatMessageLinks, completionContracts, createDb, closeRegisteredClients, heartbeatRunEvents, heartbeatRuns, issueComments, issueQuestionResponseDeliveries, issueApprovals, issueRecoveryActions, issueThreadInteractions, issues, nativeRunFinalizations, nativeRunResults, statusDecisionEffects, statusDecisions } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { type AdapterExecutionContext, type AdapterExecutionResult } from "../adapters/index.ts";
import {
  commitNativeStatusDecision,
  NativeStatusRaceError,
} from "../services/native-runtime/status-decision-committer.js";
const mockTelemetryClient = vi.hoisted(() => ({
  track: vi.fn(),
  hashPrivateRef: vi.fn(() => "test-private-reference"),
}));
const mockTrackAgentFirstHeartbeat = vi.hoisted(() => vi.fn());
const mockTerminateLocalService = vi.hoisted(() => vi.fn());
const mockDetachNativeSessionsForRestart = vi.hoisted(() => vi.fn());
const mockCloseIdleWarmNativeSessionsForRestart = vi.hoisted(() => vi.fn());
const mockRetainedNativeCleanup = vi.hoisted(() =>
  vi.fn<
    typeof import("../services/native-runtime/native-session-executor.js").reconcileRetainedNativeSessionCleanup
  >(),
);
const mockExecutePaperclipNativeSession = vi.hoisted(() =>
  vi.fn<
    typeof import("../services/native-runtime/native-session-executor.js").executePaperclipNativeSession
  >(),
);
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async (_input: AdapterExecutionContext): Promise<AdapterExecutionResult> => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Recovered stranded heartbeat work.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../telemetry.ts", () => ({
  getTelemetryClient: () => mockTelemetryClient,
}));

const mockCaptureRunFailure = vi.hoisted(() => vi.fn());
vi.mock("../sentry.ts", async () => {
  const actual = await vi.importActual<typeof import("../sentry.ts")>("../sentry.ts");
  return {
    ...actual,
    captureRunFailure: mockCaptureRunFailure,
  };
});

vi.mock("../services/native-runtime/native-session-executor.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/native-runtime/native-session-executor.js")
  >("../services/native-runtime/native-session-executor.js");
  mockRetainedNativeCleanup.mockImplementation(
    actual.reconcileRetainedNativeSessionCleanup,
  );
  mockExecutePaperclipNativeSession.mockImplementation(
    actual.executePaperclipNativeSession,
  );
  mockDetachNativeSessionsForRestart.mockImplementation(actual.detachNativeSessionsForRestart);
  mockCloseIdleWarmNativeSessionsForRestart.mockImplementation(actual.closeIdleWarmNativeSessionsForRestart);
  return {
    ...actual,
    reconcileRetainedNativeSessionCleanup: mockRetainedNativeCleanup,
    executePaperclipNativeSession: mockExecutePaperclipNativeSession,
    detachNativeSessionsForRestart: mockDetachNativeSessionsForRestart,
    closeIdleWarmNativeSessionsForRestart: mockCloseIdleWarmNativeSessionsForRestart,
  };
});

vi.mock("../services/local-service-supervisor.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/local-service-supervisor.js")
  >("../services/local-service-supervisor.js");
  mockTerminateLocalService.mockImplementation(actual.terminateLocalService);
  return {
    ...actual,
    terminateLocalService: mockTerminateLocalService,
  };
});

vi.mock("@paperclipai/shared/telemetry", async () => {
  const actual = await vi.importActual<
    typeof import("@paperclipai/shared/telemetry")
  >("@paperclipai/shared/telemetry");
  return {
    ...actual,
    trackAgentFirstHeartbeat: mockTrackAgentFirstHeartbeat,
  };
});

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>(
    "../adapters/index.ts",
  );
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

import { heartbeatService } from "../services/heartbeat.ts";
import { PaperclipControlPlanePort } from "../services/native-runtime/paperclip-control-plane-port.js";
import { finalizeNativeRun } from "../services/native-runtime/native-run-finalizer.js";
import * as paperclipRunner from "../vendor/paperclip-runner/index.js";
import * as recoveryFixture from "./heartbeat-process-recovery.fixture.ts";
import { waitForValue, stopRegisteredProcessesForCleanup, drainAndCleanRecoveryTables } from "./heartbeat-process-recovery.fixture.ts";

const externalTestDatabaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL?.trim();
const embeddedPostgresSupport = externalTestDatabaseUrl
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat recovery tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat orphaned process recovery", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;
  const childProcesses = new Set<ChildProcess>();
  const cleanupPids = new Set<number>();

  const bindDb = <A extends unknown[], R>(helper: (db: ReturnType<typeof createDb>, ...args: A) => R) =>
    (...args: A) => helper(db, ...args);
  const selectRecoveryRunsByAgent = bindDb(recoveryFixture.selectRecoveryRunsByAgent);
  const selectRecoveryActionsForIssue = bindDb(recoveryFixture.selectRecoveryActionsForIssue);
  const seedStrandedIssueFixture = bindDb(recoveryFixture.seedStrandedIssueFixture);
  const bindChatConversation = bindDb(recoveryFixture.bindChatConversation);
  const seedQueuedIssueRunFixture = bindDb(recoveryFixture.seedQueuedIssueRunFixture);
  const seedNativePassiveBoardResponse = bindDb(recoveryFixture.seedNativePassiveBoardResponse);

  beforeAll(async () => {
    if (externalTestDatabaseUrl) {
      db = createDb(externalTestDatabaseUrl);
    } else {
      tempDb = await startEmbeddedPostgresTestDatabase(
        "paperclip-heartbeat-recovery-",
      );
      db = createDb(tempDb.connectionString);
    }
    const now = new Date();
    await db.insert(authUsers).values({
      id: "responsible-user",
      name: "Responsible User",
      email: "responsible-user@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterEach(async () => {
    vi.clearAllMocks();
    // A recovery policy can stop before adapter dispatch; do not leak an
    // unused one-shot failure into the next test's otherwise healthy run.
    mockAdapterExecute.mockReset();
    const nativeExecutor = await vi.importActual<
      typeof import("../services/native-runtime/native-session-executor.js")
    >("../services/native-runtime/native-session-executor.js");
    mockRetainedNativeCleanup
      .mockReset()
      .mockImplementation(nativeExecutor.reconcileRetainedNativeSessionCleanup);
    const localServiceSupervisor = await vi.importActual<
      typeof import("../services/local-service-supervisor.js")
    >("../services/local-service-supervisor.js");
    mockTerminateLocalService.mockImplementation(
      localServiceSupervisor.terminateLocalService,
    );
    mockAdapterExecute.mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      summary: "Recovered stranded heartbeat work.",
      provider: "test",
      model: "test-model",
    }));
    await stopRegisteredProcessesForCleanup();
    for (const child of childProcesses) {
      child.kill("SIGKILL");
    }
    childProcesses.clear();
    for (const pid of cleanupPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore already-dead cleanup targets.
      }
    }
    cleanupPids.clear();
    await drainAndCleanRecoveryTables(db);
  });

  afterAll(async () => {
    for (const child of childProcesses) {
      child.kill("SIGKILL");
    }
    childProcesses.clear();
    for (const pid of cleanupPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore already-dead cleanup targets.
      }
    }
    cleanupPids.clear();
    await stopRegisteredProcessesForCleanup();
    if (externalTestDatabaseUrl) {
      await closeRegisteredClients(externalTestDatabaseUrl);
    }
    await tempDb?.cleanup();
  });

  describe("transient sandbox provider refusal during lease acquisition", () => {
    // Daytona answered sandbox create with HTTP 502 and the provisional
    // allocation's cleanup could not be confirmed, exactly as staging recorded.
    const daytonaCreate502 = () => new JsonRpcCallError({ code: -32000,
      message: "Daytona sandbox creation failed (HTTP 502); cleanup could not be confirmed for paperclip-create-05f81d77",
      data: { schema: "paperclip/environment-acquire-error/v1", providerDiagnostic: { httpStatus: 502 } } });

    // EP1: Daytona's own acquisition deadline expired while the provisional
    // sandbox was still being created, as staging recorded at 14:00-14:45Z when
    // concurrent runs rose from about 8 to about 20. The environment runtime
    // records the validated acquisition diagnostic for this run before rethrowing.
    // The chaos fault EP1 injects these same shapes (environment-lease-fault-injection.ts).
    type LeaseFault = (input: { companyId: string; environment: { id: string }; heartbeatRunId?: string | null }) => Error;
    const daytonaAcquisitionDeadline: LeaseFault = input => leaseFaultError("timeout",
      { companyId: input.companyId, environmentId: input.environment.id, heartbeatRunId: input.heartbeatRunId! });
    // EP1 database: a control-plane query failed while the lease was being
    // recorded (staging: "Database query failed (lease_acquire_failed)").
    const leaseRecordQueryFailure: LeaseFault = input => leaseFaultError("database",
      { companyId: input.companyId, environmentId: input.environment.id, heartbeatRunId: input.heartbeatRunId! });

    function failLeaseAcquisition(times: number, fault: LeaseFault = daytonaCreate502) {
      let remaining = times;
      const acquisitions = { refused: 0, delegated: 0 };
      const originalFactory = environmentOrchestrator.environmentRunOrchestrator;
      const factory = vi.spyOn(environmentOrchestrator, "environmentRunOrchestrator").mockImplementation((database, options = {}) => {
        const runtime = originalFactory(database, options).runtime;
        return originalFactory(database, { ...options, environmentRuntime: { ...runtime, acquireRunLease: async (input) => {
          if (remaining > 0) {
            remaining -= 1;
            acquisitions.refused += 1;
            throw fault(input);
          }
          acquisitions.delegated += 1;
          return runtime.acquireRunLease(input);
        } } });
      });
      return { acquisitions, restore: () => factory.mockRestore() };
    }

    async function runsFor(agentId: string) {
      return (await selectRecoveryRunsByAgent(agentId)).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    }

    async function promoteLatestScheduledRetry(heartbeat: ReturnType<typeof heartbeatService>, agentId: string) {
      const scheduled = (await runsFor(agentId)).filter(run => run.status === "scheduled_retry");
      expect(scheduled).toHaveLength(1);
      // Let the backoff elapse, as it would in real time, before promotion.
      const due = new Date();
      await db.update(heartbeatRuns).set({ scheduledRetryAt: due }).where(eq(heartbeatRuns.id, scheduled[0]!.id));
      await heartbeat.promoteDueScheduledRetries(due);
      await heartbeat.resumeQueuedRuns();
      await heartbeat.drainActiveRunExecutions();
      return scheduled[0]!;
    }

    it("retries automatically and runs exactly one successful successor without user action", async () => {
      const { companyId, agentId, runId, issueId } = await seedQueuedIssueRunFixture();
      const lease = failLeaseAcquisition(1);
      try {
        const heartbeat = heartbeatService(db);
        await heartbeat.resumeQueuedRuns();
        await heartbeat.drainActiveRunExecutions();

        const afterFailure = await runsFor(agentId);
        expect(afterFailure.map(run => run.status)).toEqual(["failed", "scheduled_retry"]);
        expect(afterFailure[0]).toMatchObject({ id: runId, errorCode: "environment_provider_unavailable" });
        expect(afterFailure[0]!.resultJson).toMatchObject({ providerFailure: { provider: "local", httpStatus: 502,
          phase: "startup", retryability: "transient" } });
        expect(afterFailure[1]).toMatchObject({ retryOfRunId: runId, scheduledRetryAttempt: 1 });
        // The task is retrying, not blocked: no hold, and the task explains the wait.
        const [waiting] = await db.select().from(issues).where(eq(issues.id, issueId));
        expect(waiting).toMatchObject({ status: "in_progress", executionRunId: afterFailure[1]!.id });
        expect(await getExecutionBlocker(db, companyId, issueId)).toBeNull();
        expect(await taskInterruptionPresentation(db, waiting!)).toMatchObject({ state: "retry_scheduled", responsibility: "system",
          providerFailure: { httpStatus: 502, phase: "startup", retryability: "transient" } });
        expect(mockAdapterExecute).not.toHaveBeenCalled();

        await promoteLatestScheduledRetry(heartbeat, agentId);
        const settled = await runsFor(agentId);
        // Exactly one successor of the refused run, and it did the work. Later
        // runs (for example disposition repair) are ordinary follow-up wakes.
        const successors = settled.filter(run => run.retryOfRunId === runId);
        expect(successors).toHaveLength(1);
        expect(successors[0]).toMatchObject({ id: afterFailure[1]!.id, status: "succeeded" });
        expect(settled.filter(run => run.errorCode === "environment_provider_unavailable").map(run => run.id)).toEqual([runId]);
        expect(mockAdapterExecute).toHaveBeenCalled();
        expect(lease.acquisitions.refused).toBe(1);
        const [done] = await db.select().from(issues).where(eq(issues.id, issueId));
        expect(done!.status).not.toBe("blocked");
      } finally {
        lease.restore();
        mockAdapterExecute.mockClear();
      }
    }, 60_000);

    it("explains the block with a working Retry once automatic retries are used up", async () => {
      const { companyId, agentId, issueId } = await seedQueuedIssueRunFixture();
      const lease = failLeaseAcquisition(3);
      try {
        const heartbeat = heartbeatService(db);
        await heartbeat.resumeQueuedRuns();
        await heartbeat.drainActiveRunExecutions();
        await promoteLatestScheduledRetry(heartbeat, agentId);
        await promoteLatestScheduledRetry(heartbeat, agentId);

        const exhausted = await runsFor(agentId);
        expect(exhausted.map(run => [run.status, run.errorCode])).toEqual([
          ["failed", "environment_provider_unavailable"],
          ["failed", "environment_provider_unavailable"],
          ["failed", "environment_provider_unavailable"],
        ]);
        expect(lease.acquisitions.refused).toBe(3);
        expect(mockAdapterExecute).not.toHaveBeenCalled();

        const blocked = await waitForValue(async () => {
          const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
          return row?.status === "blocked" ? row : null;
        });
        expect(blocked).not.toBeNull();
        // The blocked task names its cause, its next action, and a Retry.
        const presentation = await taskInterruptionPresentation(db, blocked!);
        expect(presentation).toMatchObject({ state: "failed", responsibility: "system", canRetry: true,
          observedRunId: exhausted[2]!.id,
          providerFailure: { httpStatus: 502, phase: "startup", retryability: "transient" } });
        expect(presentation?.providerFailure?.message).toContain("temporarily unavailable");
        const notices = await db.select().from(issueComments).where(eq(issueComments.issueId, issueId));
        expect(notices.map(comment => (comment.presentation as { title?: string } | null)?.title))
          .toContain("Environment provider was temporarily unavailable");
        // No no-replay hold: provider work never started.
        expect(await getExecutionBlocker(db, companyId, issueId)).toBeNull();

        const receipt = await requestTaskRetry({ db, companyId, issueId, actorId: "responsible-user",
          idempotencyKey: randomUUID(), observedRunId: presentation!.observedRunId });
        expect(receipt.accepted).toBe(true);
        await heartbeat.resumeTaskRetry(companyId, receipt.requestId!);
        await heartbeat.drainActiveRunExecutions();
        const retried = await waitForValue(async () => (await runsFor(agentId)).find(run => run.status === "succeeded") ?? null, 10_000);
        expect(retried).not.toBeNull();
        expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
        expect(lease.acquisitions.delegated).toBe(1);
      } finally {
        lease.restore();
        mockAdapterExecute.mockClear();
      }
    }, 90_000);
    it.each([
      ["a provider acquisition deadline", daytonaAcquisitionDeadline, "timeout"],
      ["a database error while recording the lease", leaseRecordQueryFailure, "overloaded"],
    ] as const)("retries %s before provider work with a bounded, visible backoff", async (_label, fault, category) => {
      const { companyId, agentId, runId, issueId } = await seedQueuedIssueRunFixture();
      const lease = failLeaseAcquisition(1, fault);
      try {
        const heartbeat = heartbeatService(db);
        await heartbeat.resumeQueuedRuns();
        await heartbeat.drainActiveRunExecutions();

        const afterFailure = await runsFor(agentId);
        expect(afterFailure.map(run => [run.status, run.errorCode])).toEqual([
          ["failed", "environment_provider_unavailable"], ["scheduled_retry", null]]);
        expect(afterFailure[0]!.resultJson).toMatchObject({ providerFailure: { phase: "startup", category, retryability: "transient" },
          executionRecovery: { kind: "bootstrap", providerWorkStarted: false } });
        expect(afterFailure[1]).toMatchObject({ retryOfRunId: runId, scheduledRetryAttempt: 1, scheduledRetryReason: "transient_failure" });
        const [waiting] = await db.select().from(issues).where(eq(issues.id, issueId));
        expect(waiting).toMatchObject({ status: "in_progress", executionRunId: afterFailure[1]!.id });
        expect(await taskInterruptionPresentation(db, waiting!)).toMatchObject({ state: "retry_scheduled", responsibility: "system" });
        expect(await getExecutionBlocker(db, companyId, issueId)).toBeNull();

        await promoteLatestScheduledRetry(heartbeat, agentId);
        const successors = (await runsFor(agentId)).filter(run => run.retryOfRunId === runId);
        expect(successors).toHaveLength(1);
        expect(successors[0]).toMatchObject({ status: "succeeded" });
        expect(lease.acquisitions.refused).toBe(1);
        // The mock adapter's later disposition repair is unrelated; no setup failure reached recovery.
        expect((await selectRecoveryActionsForIssue(issueId)).filter(action => action.kind === "stranded_assigned_issue")).toEqual([]);
      } finally {
        lease.restore();
        mockAdapterExecute.mockClear();
      }
    }, 60_000);

    it("rests a provider deadline that never clears on a working Retry, never on a board recovery action", async () => {
      const { companyId, agentId, issueId } = await seedQueuedIssueRunFixture();
      const lease = failLeaseAcquisition(BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS + 1, daytonaAcquisitionDeadline);
      try {
        const heartbeat = heartbeatService(db);
        await heartbeat.resumeQueuedRuns();
        await heartbeat.drainActiveRunExecutions();
        for (let attempt = 0; attempt < BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS; attempt += 1) {
          await promoteLatestScheduledRetry(heartbeat, agentId);
        }
        const exhausted = await runsFor(agentId);
        expect(exhausted.map(run => run.errorCode)).toEqual(
          Array(BOUNDED_TRANSIENT_HEARTBEAT_RETRY_MAX_ATTEMPTS + 1).fill("environment_provider_unavailable"));
        expect(mockAdapterExecute).not.toHaveBeenCalled();

        const blocked = await waitForValue(async () => {
          const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
          return row?.status === "blocked" ? row : null;
        });
        const presentation = await taskInterruptionPresentation(db, blocked!);
        expect(presentation).toMatchObject({ state: "failed", responsibility: "system", canRetry: true,
          observedRunId: exhausted.at(-1)!.id, providerFailure: { category: "timeout", retryability: "transient" } });
        expect(await getExecutionBlocker(db, companyId, issueId)).toBeNull();
        // The task rests on a system-owned action and Retry; nothing waits on the board.
        expect((await selectRecoveryActionsForIssue(issueId)).map(action => [action.ownerType, action.cause]))
          .toEqual([["system", "environment_provider_unavailable"]]);

        const receipt = await requestTaskRetry({ db, companyId, issueId, actorId: "responsible-user",
          idempotencyKey: randomUUID(), observedRunId: presentation!.observedRunId });
        expect(receipt.accepted).toBe(true);
        await heartbeat.resumeTaskRetry(companyId, receipt.requestId!);
        await heartbeat.drainActiveRunExecutions();
        expect(await waitForValue(async () => (await runsFor(agentId)).find(run => run.status === "succeeded") ?? null, 10_000))
          .not.toBeNull();
        expect(lease.acquisitions.delegated).toBe(1);
      } finally {
        lease.restore();
        mockAdapterExecute.mockClear();
      }
    }, 90_000);
  });

  describe("paused maintenance over committed native passive waits", () => {
    async function seedPassive(kind: "board" | "chat") {
      const fixture = await seedNativePassiveBoardResponse();
      let chat: Awaited<ReturnType<typeof bindChatConversation>> | undefined;
      if (kind === "chat") {
        chat = await bindChatConversation({ ...fixture, state: "active" });
        await db
          .update(chatEndpoints)
          .set({ providerAccountId: "test-workspace" })
          .where(eq(chatEndpoints.id, chat.endpointId));
        await db
          .update(chatConversations)
          .set({ isDirectMessage: true })
          .where(eq(chatConversations.id, chat.conversationId));
        const principalId = randomUUID();
        const deliveryId = randomUUID();
        await db
          .insert(chatExternalPrincipals)
          .values({
            id: principalId,
            companyId: fixture.companyId,
            provider: "slack",
            providerAccountId: "test-workspace",
            externalId: randomUUID(),
          });
        await db
          .insert(chatDeliveries)
          .values({
            id: deliveryId,
            companyId: fixture.companyId,
            endpointId: chat.endpointId,
            conversationId: chat.conversationId,
            principalId,
            providerEventId: randomUUID(),
            deduplicationKey: randomUUID(),
            eventKind: "message",
            normalizedEvent: {},
            state: "processed",
            processedAt: new Date(),
          });
        await db
          .insert(chatMessageLinks)
          .values({
            companyId: fixture.companyId,
            endpointId: chat.endpointId,
            conversationId: chat.conversationId,
            deliveryId,
            commentId: fixture.commentId,
            providerMessageId: "passive-message",
            direction: "inbound",
          });
        await db
          .update(agentWakeupRequests)
          .set({
            source: "assignment",
            reason: "External chat message received",
            payload: {
              issueId: fixture.issueId,
              wakeCommentId: fixture.commentId,
            },
          })
          .where(eq(agentWakeupRequests.id, fixture.wakeupRequestId));
        await db
          .update(heartbeatRuns)
          .set({
            status: "running",
            contextSnapshot: {
              issueId: fixture.issueId,
              source: "chat:slack",
              paperclipHarnessCheckedOut: true,
              wakeCommentId: fixture.commentId,
              wakeCommentIds: [fixture.commentId],
              paperclipWake: {
                externalChatProvider: "slack",
                checkedOutByHarness: true,
                issue: { id: fixture.issueId },
                commentIds: [fixture.commentId],
              },
            },
          })
          .where(eq(heartbeatRuns.id, fixture.runId));
        await db
          .update(issues)
          .set({ executionRunId: fixture.runId })
          .where(eq(issues.id, fixture.issueId));
      }
      await finalizeNativeRun({
        db,
        runId: fixture.runId,
        workspaceFinalizeStatus: "succeeded",
        projectRunStatus: true,
      });
      expect(
        await db
          .select({ reason: statusDecisions.reasonCode })
          .from(statusDecisions)
          .where(eq(statusDecisions.runId, fixture.runId)),
      ).toEqual([
        {
          reason:
            kind === "board"
              ? "board_response_waiting"
              : "external_chat_response_waiting",
        },
      ]);
      await db
        .update(agents)
        .set({ status: "paused" })
        .where(eq(agents.id, fixture.agentId));
      return { ...fixture, chat };
    }

    it.each(["board", "chat"] as const)(
      "preserves the exact %s passive receipt across repeated paused restart sweeps",
      async (kind) => {
        const f = await seedPassive(kind);
        const before = await db
          .select()
          .from(issueComments)
          .where(eq(issueComments.issueId, f.issueId));
        const heartbeat = heartbeatService(db);
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await heartbeat.reconcileStrandedAssignedIssues();
          expect(result.escalated).toBe(0);
          expect(result.continuationRequeued).toBe(0);
          expect(result.issueIds).not.toContain(f.issueId);
        }
        expect(
          await db.select().from(issues).where(eq(issues.id, f.issueId)),
        ).toEqual([
          expect.objectContaining({
            status: "in_progress",
            assigneeAgentId: f.agentId,
          }),
        ]);
        expect(
          await db
            .select()
            .from(issueRecoveryActions)
            .where(eq(issueRecoveryActions.sourceIssueId, f.issueId)),
        ).toEqual([]);
        expect(
          await db
            .select()
            .from(issueComments)
            .where(eq(issueComments.issueId, f.issueId)),
        ).toEqual(before);
        expect(
          await db
            .select({ id: heartbeatRuns.id })
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.companyId, f.companyId)),
        ).toEqual([{ id: f.runId }]);
        expect(
          await db
            .select({ id: agentWakeupRequests.id })
            .from(agentWakeupRequests)
            .where(eq(agentWakeupRequests.companyId, f.companyId)),
        ).toEqual([{ id: f.wakeupRequestId }]);
        expect(mockAdapterExecute).not.toHaveBeenCalled();
        expect(mockExecutePaperclipNativeSession).not.toHaveBeenCalled();
      },
    );

    it.each([
      "uncommitted",
      "superseded_decision",
      "newer_request",
      "edited_source",
      "failed_run",
      "terminated_agent",
      "reassigned",
      "revoked_destination",
      "malformed_source",
      "pending_interaction",
      "pending_approval",
    ] as const)(
      "keeps ordinary escalation when a paused chat wait is not current (%s)",
      async (mode) => {
        const f = await seedPassive("chat");
        if (mode === "uncommitted")
          await db
            .update(nativeRunFinalizations)
            .set({ phase: "retryable_failure" })
            .where(eq(nativeRunFinalizations.runId, f.runId));
        if (mode === "superseded_decision")
          await db
            .update(issues)
            .set({ lastStatusDecisionId: null })
            .where(eq(issues.id, f.issueId));
        if (mode === "newer_request")
          await db
            .insert(issueComments)
            .values({
              companyId: f.companyId,
              issueId: f.issueId,
              authorType: "user",
              authorUserId: "responsible-user",
              body: "A new independent request needs attention",
            });
        if (mode === "edited_source")
          await db
            .update(issueComments)
            .set({ body: "Changed source", updatedAt: new Date() })
            .where(eq(issueComments.id, f.commentId));
        if (mode === "failed_run")
          await db
            .update(heartbeatRuns)
            .set({ status: "failed", errorCode: "adapter_failed" })
            .where(eq(heartbeatRuns.id, f.runId));
        if (mode === "terminated_agent")
          await db
            .update(agents)
            .set({ status: "terminated" })
            .where(eq(agents.id, f.agentId));
        if (mode === "reassigned") {
          const next = randomUUID();
          await db
            .insert(agents)
            .values({
              id: next,
              companyId: f.companyId,
              name: "Paused new assignee",
              role: "engineer",
              status: "paused",
              adapterType: "codex_local",
              adapterConfig: {},
              runtimeConfig: {},
              permissions: {},
            });
          await db
            .update(issues)
            .set({ assigneeAgentId: next })
            .where(eq(issues.id, f.issueId));
        }
        if (mode === "revoked_destination")
          await db
            .update(chatEndpoints)
            .set({ allowDirectMessages: false })
            .where(eq(chatEndpoints.id, f.chat!.endpointId));
        if (mode === "malformed_source") {
          const [run] = await db
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, f.runId));
          await db
            .update(heartbeatRuns)
            .set({
              contextSnapshot: {
                ...run!.contextSnapshot,
                wakeCommentIds: ["-".repeat(36)],
              },
            })
            .where(eq(heartbeatRuns.id, f.runId));
        }
        if (mode === "pending_interaction")
          await db
            .insert(issueThreadInteractions)
            .values({
              companyId: f.companyId,
              issueId: f.issueId,
              kind: "request_confirmation",
              status: "pending",
              sourceRunId: f.runId,
              createdByUserId: "responsible-user",
              payload: { version: 1, prompt: "Review before continuing" },
            });
        if (mode === "pending_approval") {
          const approvalId = randomUUID();
          await db
            .insert(approvals)
            .values({
              id: approvalId,
              companyId: f.companyId,
              type: "hire_agent",
              status: "pending",
              requestedByUserId: "responsible-user",
              payload: {},
            });
          await db
            .insert(issueApprovals)
            .values({ companyId: f.companyId, issueId: f.issueId, approvalId });
        }
        const result =
          await heartbeatService(db).reconcileStrandedAssignedIssues();
        expect(result.escalated).toBe(1);
        expect(result.continuationRequeued).toBe(0);
        expect(
          (await db.select().from(issues).where(eq(issues.id, f.issueId)))[0]
            ?.status,
        ).toBe("blocked");
        expect(
          await db
            .select({ id: heartbeatRuns.id })
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.companyId, f.companyId)),
        ).toEqual([{ id: f.runId }]);
        expect(mockAdapterExecute).not.toHaveBeenCalled();
      },
    );

    it("preserves existing error-agent passive wait behavior without treating it as paused", async () => {
      const f = await seedPassive("chat");
      await db
        .update(agents)
        .set({ status: "error" })
        .where(eq(agents.id, f.agentId));
      const result =
        await heartbeatService(db).reconcileStrandedAssignedIssues();
      expect(result.escalated).toBe(0);
      expect(result.continuationRequeued).toBe(0);
      expect(
        (await db.select().from(issues).where(eq(issues.id, f.issueId)))[0]
          ?.status,
      ).toBe("in_progress");
      expect(mockAdapterExecute).not.toHaveBeenCalled();
      expect(mockExecutePaperclipNativeSession).not.toHaveBeenCalled();
    });

    it.each(["edited_source", "newer_request"] as const)(
      "does not use an obsolete Board wait to suppress paused recovery (%s)",
      async (mode) => {
        const f = await seedPassive("board");
        if (mode === "edited_source")
          await db
            .update(issueComments)
            .set({ body: "Changed Board source", updatedAt: new Date() })
            .where(eq(issueComments.id, f.commentId));
        else
          await db
            .insert(issueComments)
            .values({
              companyId: f.companyId,
              issueId: f.issueId,
              authorType: "user",
              authorUserId: "responsible-user",
              body: "New Board request",
            });
        const result =
          await heartbeatService(db).reconcileStrandedAssignedIssues();
        expect(result.escalated).toBe(1);
        expect(result.continuationRequeued).toBe(0);
        expect(
          (await db.select().from(issues).where(eq(issues.id, f.issueId)))[0]
            ?.status,
        ).toBe("blocked");
        expect(mockAdapterExecute).not.toHaveBeenCalled();
        expect(mockExecutePaperclipNativeSession).not.toHaveBeenCalled();
      },
    );
  });

  describe("accepted Cursor planning boundaries", () => {
  const nativeImplementation = mockExecutePaperclipNativeSession.getMockImplementation();
  beforeEach(() => {
    mockExecutePaperclipNativeSession.mockImplementation(async () => { throw new Error("Accepted-plan tests must never execute a provider"); });
  });
  afterEach(() => { mockExecutePaperclipNativeSession.mockImplementation(nativeImplementation!); });

  async function seedAcceptedCursorPlanWait(semanticFinish = false, sourceSequenceOffset = 0) {
    const f = await seedStrandedIssueFixture({ status: "in_progress", runStatus: "succeeded", livenessState: "advanced" });
    const instance = randomUUID(), interactionId = randomUUID();
    const contractInput = { db, companyId: f.companyId,
      issue: { id: f.issueId, title: "Review the plan before further work", description: "Explicit completion required" }, actorId: "test" };
    const { row: persistedContract, contract } = await ensureNativeCompletionContract(contractInput);
    const reused = await ensureNativeCompletionContract(contractInput);
    expect(reused.row.id).toBe(persistedContract.id);
    expect(reused.contract).toEqual(contract);
    const contractId = persistedContract.id, contractSha = persistedContract.canonicalSha256;
    // Production binds policy/schema as well as the body; a body-only hash is not a valid contract receipt.
    expect(contractSha).not.toBe(nativeSha256(contract));
    const model = "gpt-5.6-luna[context=272k,reasoning=medium,fast=false]";
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "cursor", model, acpxSessionMode: "plan", acpxPermissionMode: "approve-all" } }).where(eq(agents.id, f.agentId));
    await db.update(agentWakeupRequests).set({ status: "completed" }).where(eq(agentWakeupRequests.id, f.wakeupRequestId));
    await db.update(heartbeatRuns).set({ runtimeMode: "native", nativeIssueId: f.issueId, nativeSessionId: f.runId,
      completionContractId: contractId, completionContractSha256: contractSha, runnerInstanceId: instance,
      runnerProfileJson: { nativeExecutionInput: { binding: { companyId: f.companyId, issueId: f.issueId, runId: f.runId, agentId: f.agentId }, provider: { kind: "acpx", agent: "cursor", model, mode: "plan", permissionMode: "approve-all",
        profile: paperclipRunner.resolveQualifiedAcpxProfile("cursor", model) }, session: { normalizedSessionId: f.runId },
        completionContract: { id: contractId, sha256: contractSha, contract } } } }).where(eq(heartbeatRuns.id, f.runId));
    const planId = `plan-${"a".repeat(64)}`;
    const questionSet = { schema: "paperclip.question_set.v1", title: "Native plan", description: "Exact accepted revision", questions: [{ id: planId, prompt: "Proceed?", required: true,
      answerMode: "single_select", options: [{ id: "accept", label: "Accept" }, { id: "reject", label: "Reject" }, { id: "cancel", label: "Cancel" }] }] };
    const [interaction] = await db.insert(issueThreadInteractions).values({ id: interactionId, companyId: f.companyId, issueId: f.issueId, sourceRunId: f.runId,
      createdByAgentId: f.agentId, kind: "ask_user_questions", status: "answered", continuationPolicy: "none",
      idempotencyKey: `paperclip-runner-question:${f.runId}:request`, resolvedByUserId: "responsible-user", resolvedAt: new Date(Date.now() - 1000),
      payload: { version: 1, questions: [{ id: planId, prompt: "Proceed?", selectionMode: "single", required: true, allowOther: false, options: [{ id: "accept", label: "Accept" }, { id: "reject", label: "Reject" }, { id: "cancel", label: "Cancel" }] }], runtimeRequestId: "request", questionSet: questionSet as never }, result: { version: 1, answers: [{ questionId: planId, optionIds: ["accept"] }] } }).returning();
    const answer = buildQuestionResponseDeliveryEnvelope(interaction as never);
    const [delivery] = await db.insert(issueQuestionResponseDeliveries).values({ companyId: f.companyId, issueId: f.issueId, interactionId,
      sourceRunId: f.runId, targetRunId: f.runId, correlationId: randomUUID(), status: "delivered", deliveryMode: "steered", acknowledgedAt: new Date(), payloadSha256: nativeSha256(answer) }).returning();
    const port = new PaperclipControlPlanePort(db, { companyId: f.companyId, issueId: f.issueId, runId: f.runId, agentId: f.agentId,
      sessionId: f.runId, completionContractId: contractId, completionContractSha256: contractSha, sourceInstanceId: instance, controlPlaneSourceInstanceId: `control-${f.runId}` });
    const events = [
      { eventType: "runtime_request.created", payload: { request: { schema: "paperclip.runtime_request.v2", requestKind: "runtime", requestId: "request", type: "input", status: "pending", turnId: "turn", itemId: "native-plan-tool", prompt: "Review plan",
        origin: { adapter: "acpx-runtime-sidecar", provider: "cursor", method: "cursor/create_plan" }, input: questionSet } } },
      { eventType: "tool.execution.started", payload: { schema: "paperclip.tool.execution.v1", executionId: "native-plan-tool", transport: "builtin", operation: "execute", status: "running", readOnly: false, namespace: null, name: "Create Plan", target: null, inputUpdated: true, output: null, outputBytes: 0, outputTruncated: false, outputDigest: null, progress: null, exitCode: null, durationMs: null } },
      { eventType: "runtime_request.resolved", payload: { requestId: "request", turnId: "turn", action: "submit", response: answer.response } },
      { eventType: "tool.execution.completed", payload: { schema: "paperclip.tool.execution.v1", executionId: "native-plan-tool", transport: "builtin", operation: "execute", status: "completed", readOnly: false, namespace: null, name: "Create Plan", target: null, inputUpdated: false, output: null, outputBytes: 0, outputTruncated: false, outputDigest: null, progress: null, exitCode: null, durationMs: null } },
      { eventType: "turn.completed", payload: { status: "completed", error: null } },
    ];
    for (const [index, event] of events.entries()) await port.appendEvent({ schema: "paperclip.prp.event.v1", sourceEventId: `${instance}:${sourceSequenceOffset + index + 1}`, sourceSeq: sourceSequenceOffset + index + 1,
      sourceInstanceId: instance, sourceKind: "runner", runId: f.runId, normalizedSessionId: f.runId, turnId: "turn", schemaVersion: 1, priority: 0,
      emittedAt: new Date().toISOString(), ...event } as paperclipRunner.PrpEvent);
    const proof = await readNativePlanWait(db, f);
    expect(proof).not.toBeNull();
    const result = semanticFinish ? { ...proof!.result, reportedWorkDisposition: "done" as const, summary: "Explicit semantic finish wins", continuation: undefined,
      completionClaim: { contractRevision: "1", objectiveSatisfied: true, criteria: [{ criterionId: "objective", status: "satisfied" as const, evidenceRefs: [] }], remainingWork: [] } } : proof!.result;
    await port.completeRun({ result, turnId: "turn", terminal: { schema: "paperclip.prp.terminal.v1", runTerminalState: "succeeded", turnTerminalState: "completed", reportedWorkDisposition: result.reportedWorkDisposition } });
    return { ...f, interactionId, deliveryId: delivery!.id, proof: proof! };
  }

  it("keeps an accepted Cursor plan passive across restart, future configuration changes, and paused recovery", async () => {
    const f = await seedAcceptedCursorPlanWait();
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
    expect(await db.select().from(statusDecisions).where(eq(statusDecisions.runId, f.runId))).toEqual([expect.objectContaining({ reasonCode: "native_plan_accepted_waiting_for_continuation", toStatus: "in_progress" })]);
    expect(await db.select().from(statusDecisionEffects).where(eq(statusDecisionEffects.issueId, f.issueId))).toEqual([expect.objectContaining({ effectKind: "issue_status_projection", targetType: "issue", deliveryState: "delivered" })]);
    expect(await db.select().from(issueComments).where(eq(issueComments.createdByRunId, f.runId))).toEqual([expect.objectContaining({ body: expect.stringContaining("next message") })]);
    const current = paperclipRunner.resolveQualifiedAcpxProfile("cursor", "gpt-5.6-luna[context=272k,reasoning=medium,fast=false]");
    const resolver = vi.spyOn(paperclipRunner, "resolveQualifiedAcpxProfile").mockReturnValue({ ...current,
      agentProfileVersion: current.agentProfileVersion + 1, commandDigest: `sha256:${"b".repeat(64)}` });
    try {
      expect(await readNativePlanWait(db, f)).toBeNull(); // Old profile cannot create a new wait.
      for (const status of ["idle", "paused"] as const) {
        await db.update(agents).set({ status, adapterConfig: { provider: "acpx", acpxAgent: "cursor",
          model: "future-model", acpxSessionMode: "agent", acpxPermissionMode: "approve-reads" } }).where(eq(agents.id, f.agentId));
        expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
        const recovered = await heartbeatService(db).reconcileStrandedAssignedIssues();
        expect(recovered.continuationRequeued).toBe(0); expect(recovered.escalated).toBe(0);
      }
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
      const changed = structuredClone(run!.runnerProfileJson!);
      (changed.nativeExecutionInput as { provider: { profile: { commandDigest: string } } }).provider.profile.commandDigest = "tampered-original-profile";
      await db.update(heartbeatRuns).set({ runnerProfileJson: changed }).where(eq(heartbeatRuns.id, f.runId));
      expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
      await db.update(heartbeatRuns).set({ runnerProfileJson: run!.runnerProfileJson }).where(eq(heartbeatRuns.id, f.runId));
      expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
      const [tool] = await db.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, f.runId), eq(heartbeatRunEvents.eventType, "tool.execution.completed")));
      const changedTool = structuredClone(tool!.payload!) as { prpEvent: { payload: { name: string } } };
      changedTool.prpEvent.payload.name = "mutated committed tool evidence";
      await db.update(heartbeatRunEvents).set({ payload: changedTool, sourcePayloadSha256: nativeSha256(changedTool.prpEvent) }).where(eq(heartbeatRunEvents.id, tool!.id));
      expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
      await db.update(heartbeatRunEvents).set({ payload: tool!.payload, sourcePayloadSha256: tool!.sourcePayloadSha256 }).where(eq(heartbeatRunEvents.id, tool!.id));
      expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
    } finally { resolver.mockRestore(); }
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, f.companyId))).toHaveLength(1);
    expect(mockAdapterExecute).not.toHaveBeenCalled(); expect(mockExecutePaperclipNativeSession).not.toHaveBeenCalled();
  });

  it("retains an exact historical Cursor6 committed wait across more than 1000 ignored progress rows without allowing new unbound admission", async () => {
    const progressCount = 1002;
    const f = await seedAcceptedCursorPlanWait(false, progressCount);
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    const profile = structuredClone(run!.runnerProfileJson!) as any;
    Object.assign(profile.nativeExecutionInput.provider.profile, { agentProfileVersion: 6, commandDigest: "sha256:377dcea64a727ce799cc112458d4b40ba4bc6574cd6c6f7233b6efd5917a6c4b" });
    await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, f.runId));
    await db.delete(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, f.runId), inArray(heartbeatRunEvents.eventType, ["tool.execution.started", "tool.execution.completed"])));
    // Reconstruct the persisted Cursor6 receipt format using its unchanged
    // source facts. This historical format had no tool lifecycle binding.
    const rows = await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, f.runId));
    const event = (kind: string) => (rows.find(r => r.eventType === kind)!.payload as any).prpEvent;
    const [contract] = await db.select().from(completionContracts).where(eq(completionContracts.id, run!.completionContractId!));
    const [interaction] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, f.interactionId));
    const [delivery] = await db.select().from(issueQuestionResponseDeliveries).where(eq(issueQuestionResponseDeliveries.id, f.deliveryId));
    profile.nativeExecutionInput.provider.cursorMode = profile.nativeExecutionInput.provider.mode;
    delete profile.nativeExecutionInput.provider.mode;
    await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, f.runId));
    const legacy = { ...f.proof.source, schema: "paperclip.native_cursor_plan_wait.v1" }; delete legacy.toolExecutionId; delete legacy.toolLifecycleSha256;
    legacy.authoritySha256 = nativeSha256({ admission: profile.nativeExecutionInput, contract, created: event("runtime_request.created"), resolved: event("runtime_request.resolved"), terminal: event("turn.completed"), interaction, delivery, resolvedAt: interaction!.resolvedAt!.toISOString(), acknowledgedAt: delivery!.acknowledgedAt!.toISOString() });
    const [decision] = await db.select().from(statusDecisions).where(eq(statusDecisions.runId, f.runId));
    const [savedResult] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, f.runId));
    const resultJson = structuredClone(savedResult!.resultJson!) as any;
    resultJson.result.continuation.idempotencyKey = resultJson.result.continuation.idempotencyKey.replace("native-plan-wait:", "cursor-plan-wait:");
    const canonicalSha256 = nativeSha256(resultJson);
    await db.update(nativeRunResults).set({ resultJson, canonicalSha256 }).where(eq(nativeRunResults.id, savedResult!.id));
    const decisionJson = { ...decision!.decisionJson } as any;
    delete decisionJson.planWait; delete decisionJson.planWaitResult;
    decisionJson.cursorPlanWait = legacy;
    decisionJson.cursorPlanWaitResult = { resultId: savedResult!.id, resultSha256: canonicalSha256 };
    await db.update(statusDecisions).set({ decisionJson }).where(eq(statusDecisions.id, decision!.id));
    expect(await readNativePlanWait(db, f)).toBeNull();
    expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
    // Fill the reserved source prefix with genuine durable progress rows. Shift
    // only DB ordering keys; the original PRP facts and committed receipt stay
    // byte-identical. Cursor6 never queried these rows, even above its budget.
    await db.update(heartbeatRunEvents).set({ seq: sql`${heartbeatRunEvents.seq} + ${progressCount}` }).where(eq(heartbeatRunEvents.runId, f.runId));
    const progress = Array.from({ length: progressCount }, (_, index) => {
      const seq = index + 1;
      const prpEvent = { ...event("runtime_request.created"), sourceEventId: `${run!.runnerInstanceId}:${seq}`, sourceSeq: seq, eventType: "tool.execution.progressed",
        payload: { schema: "paperclip.tool.execution.v1", executionId: "earlier-tool", transport: "builtin", operation: "read", status: "running" } };
      return { companyId: f.companyId, runId: f.runId, agentId: f.agentId, seq, eventType: prpEvent.eventType, payload: { prpEvent }, sourceInstanceId: run!.runnerInstanceId,
        sourceEventId: prpEvent.sourceEventId, sourceSeq: seq, sourcePayloadSha256: nativeSha256(prpEvent), protocolSchemaVersion: 1 };
    });
    await db.insert(heartbeatRunEvents).values(progress);
    expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
    const [unchangedDecision] = await db.select().from(statusDecisions).where(eq(statusDecisions.id, decision!.id));
    expect(unchangedDecision!.decisionJson!.cursorPlanWait).toEqual(legacy);
    // Completed rows belonged to the old query. A later completion must still
    // invalidate the normal-terminal boundary rather than being filtered away.
    const completion = { ...event("turn.completed"), sourceEventId: `${run!.runnerInstanceId}:99999`, sourceSeq: 99999, eventType: "tool.execution.completed", payload: { ...progress[0]!.payload.prpEvent.payload, status: "completed" } };
    const [extra] = await db.insert(heartbeatRunEvents).values({ ...progress[0]!, seq: 99999, eventType: completion.eventType, payload: { prpEvent: completion }, sourceEventId: completion.sourceEventId, sourceSeq: 99999, sourcePayloadSha256: nativeSha256(completion) }).returning();
    expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
    await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.id, extra!.id));
    expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
    profile.nativeExecutionInput.provider.profile.commandDigest = "tampered-history";
    await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, f.runId));
    expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
  });

  it("admits a later ordinary user message after an accepted Cursor plan without changing Plan mode or replaying its run", async () => {
    const f = await seedAcceptedCursorPlanWait();
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    // Occupy the single dispatch slot: this checks actual user-wake admission
    // without executing any provider or fabricating a second semantic result.
    const occupied = randomUUID();
    await db.update(agents).set({ runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, f.agentId));
    await db.insert(heartbeatRuns).values({ id: occupied, companyId: f.companyId, agentId: f.agentId, status: "running", startedAt: new Date(), contextSnapshot: {} });
    const [comment] = await db.insert(issueComments).values({ companyId: f.companyId, issueId: f.issueId, authorType: "user", authorUserId: "responsible-user", body: "Continue reviewing the accepted plan in Plan mode." }).returning();
    try {
      const heartbeat = heartbeatService(db);
      const next = await heartbeat.wakeup(f.agentId, { source: "automation", triggerDetail: "system", reason: "issue_commented", requestedByActorType: "user", requestedByActorId: "responsible-user",
        payload: { issueId: f.issueId, commentId: comment!.id }, contextSnapshot: { issueId: f.issueId, taskId: f.issueId, wakeCommentId: comment!.id, wakeCommentIds: [comment!.id] } });
      expect(next).not.toBeNull(); expect(next!.id).not.toBe(f.runId);
      const [admitted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, next!.id));
      expect(admitted).toMatchObject({ status: "queued", retryOfRunId: null });
      expect(admitted!.contextSnapshot?.wakeCommentIds).toContain(comment!.id);
      const [agent] = await db.select().from(agents).where(eq(agents.id, f.agentId));
      expect(agent!.adapterConfig.acpxSessionMode).toBe("plan");
      expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
      expect(mockExecutePaperclipNativeSession).not.toHaveBeenCalled();
    } finally {
      await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(heartbeatRuns.companyId, f.companyId), inArray(heartbeatRuns.status, ["running", "queued"])));
      await db.update(agentWakeupRequests).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(agentWakeupRequests.companyId, f.companyId), inArray(agentWakeupRequests.status, ["queued", "claimed"])));
    }
  });

  it.each(["delivery", "assignment", "admission", "user_request", "result_or_decision"] as const)("revokes an accepted Cursor plan passive wait after %s changes", async change => {
    const f = await seedAcceptedCursorPlanWait();
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    if (change === "delivery") await db.update(issueQuestionResponseDeliveries).set({ acknowledgedAt: null }).where(eq(issueQuestionResponseDeliveries.id, f.deliveryId));
    if (change === "assignment") await db.update(issues).set({ assigneeAgentId: null }).where(eq(issues.id, f.issueId));
    if (change === "admission") {
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
      const profile = structuredClone(run!.runnerProfileJson!);
      (profile.nativeExecutionInput as { provider: { cursorMode: string } }).provider.cursorMode = "agent";
      await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, f.runId));
    }
    if (change === "user_request") await db.insert(issueComments).values({ companyId: f.companyId, issueId: f.issueId, authorType: "user", authorUserId: "responsible-user", body: "Continue reviewing this plan in Plan mode." });
    if (change === "result_or_decision") {
      const [accepted] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, f.runId));
      await db.update(nativeRunResults).set({ canonicalSha256: "changed" }).where(eq(nativeRunResults.id, accepted!.id));
      expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
      await db.update(nativeRunResults).set({ canonicalSha256: accepted!.canonicalSha256 }).where(eq(nativeRunResults.id, accepted!.id));
      expect(await hasCommittedNativePlanWait(db, f)).toBe(true);
      await db.update(issues).set({ lastStatusDecisionId: null }).where(eq(issues.id, f.issueId));
    }
    expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
  });

  it("rechecks accepted Cursor plan delivery under the status transaction before presentation or effects", async () => {
    const f = await seedAcceptedCursorPlanWait();
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", failpoint: "status_projection" });
    const [coordinator] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId));
    const [issue] = await db.select().from(issues).where(eq(issues.id, f.issueId));
    await db.update(issueQuestionResponseDeliveries).set({ payloadSha256: "changed" }).where(eq(issueQuestionResponseDeliveries.id, f.deliveryId));
    await expect(commitNativeStatusDecision({ db, companyId: f.companyId, issueId: f.issueId, runId: f.runId, assessmentId: coordinator!.assessmentId!,
      priorStatus: issue!.status, priorStatusVersion: issue!.statusVersion, priorDecisionId: issue!.lastStatusDecisionId,
      decision: { policyVersion: "phase6-v14", statusAction: "in_progress", toStatus: "in_progress", reasonCode: "native_plan_accepted_waiting_for_continuation", unblockDescriptor: null, effects: [] },
      requirePlanWaitSource: f.proof.source })).rejects.toBeInstanceOf(NativeStatusRaceError);
    expect(await db.select().from(statusDecisions).where(eq(statusDecisions.runId, f.runId))).toHaveLength(0);
    expect(await db.select().from(issueComments).where(eq(issueComments.createdByRunId, f.runId))).toHaveLength(0);
  });

  it("preserves explicit semantic finish priority over accepted Cursor plan evidence", async () => {
    const f = await seedAcceptedCursorPlanWait(true);
    await finalizeNativeRun({ db, runId: f.runId, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    expect(await hasCommittedNativePlanWait(db, f)).toBe(false);
    const decisions = await db.select().from(statusDecisions).where(eq(statusDecisions.runId, f.runId));
    expect(decisions).toHaveLength(1); expect(decisions[0]!.reasonCode).not.toBe("native_plan_accepted_waiting_for_continuation");
  });

  });
});

enableRunFailureReporting();
