import { randomUUID } from "node:crypto";
import { eq, or, inArray } from "drizzle-orm";
import { activityLog, agents, agentTaskSessions, agentRuntimeState, agentWakeupRequests, approvals, budgetIncidents, budgetPolicies, chatActions, chatConversations, chatDeliveries, chatEndpoints, chatMessageLinks, chatPublications, companyMemberships, companySecretBindings, companySecrets, companySkills, companies, completionContracts, costEvents, documentAnnotationAnchorSnapshots, documentAnnotationComments, documentAnnotationThreads, createDb, documentRevisions, documents, environmentLeases, environments, executionWorkspaces, heartbeatRunEvents, heartbeatRuns, issueComments, issueApprovals, issueDocuments, issuePlanDecompositions, issueRecoveryActions, issueRelations, issueThreadInteractions, issueTreeHoldMembers, issueTreeHolds, issueWorkProducts, issues, nativeRunFinalizations, nativeRunResults, plugins, projects, projectWorkspaces, statusDecisionEffects, statusDecisions, toolApplications, toolConnections, workAssessments, workspaceOperations } from "@paperclipai/db";
import { runningProcesses } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { PaperclipControlPlanePort } from "../services/native-runtime/paperclip-control-plane-port.js";

// Shared setup for heartbeat-process-recovery.test.ts and its opt-in sibling
// heartbeat-process-recovery.dormant.test.ts: wait and cleanup helpers, the seed and select helpers
// both use (each takes the suite's database first), and the afterEach drain and table cleanup.
// The vi.hoisted mocks and vi.mock calls stay in each test file: vi.mock only applies in the file
// that declares it.

type Db = ReturnType<typeof createDb>;

export async function waitForValue<T>(
  read: () => Promise<T | null | undefined>,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  let latest: T | null | undefined = null;
  while (Date.now() < deadline) {
    latest = await read();
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return latest ?? null;
}

export async function waitForHeartbeatIdle(
  db: ReturnType<typeof createDb>,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await db
      .select({
        status: heartbeatRuns.status,
      })
      .from(heartbeatRuns);
    if (
      !runs.some((run) => run.status === "queued" || run.status === "running")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function stopRegisteredProcessesForCleanup() {
  await Promise.all([...runningProcesses.values()].map(async ({ child, processGroupId }) => {
    if (child.exitCode !== null || child.signalCode !== null || typeof child.kill !== "function") return;
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      try {
        if (processGroupId) process.kill(-processGroupId, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    });
  }));
  runningProcesses.clear();
}

export async function cancelActiveRunsForCleanup(
  db: ReturnType<typeof createDb>,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activeRuns = await db
      .select({
        id: heartbeatRuns.id,
        wakeupRequestId: heartbeatRuns.wakeupRequestId,
      })
      .from(heartbeatRuns)
      .where(
        or(
          eq(heartbeatRuns.status, "queued"),
          eq(heartbeatRuns.status, "running"),
        ),
      );

    if (activeRuns.length === 0) return;

    const now = new Date();
    const runIds = activeRuns.map((run) => run.id);
    const wakeupRequestIds = activeRuns
      .map((run) => run.wakeupRequestId)
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      );

    await db
      .update(heartbeatRuns)
      .set({
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
        errorCode: "test_cleanup",
        error: "Cancelled by heartbeat-process-recovery test cleanup",
        processPid: null,
        processGroupId: null,
      })
      .where(inArray(heartbeatRuns.id, runIds));

    if (wakeupRequestIds.length > 0) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: "cancelled",
          finishedAt: now,
          error: "Cancelled by heartbeat-process-recovery test cleanup",
        })
        .where(inArray(agentWakeupRequests.id, wakeupRequestIds));
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function seedRecoveryCompany(
  db: Db,
  companyId: string,
  issuePrefix: (typeof companies.$inferInsert)["issuePrefix"],
) {
  await db.insert(companies).values({
    id: companyId,
    name: "Paperclip",
    issuePrefix,
    defaultResponsibleUserId: "responsible-user",
    requireBoardApprovalForNewAgents: false,
  });
  // The account created in beforeAll also needs an active membership for
  // admission's current responsible-user authorization intersection.
  await db.insert(companyMemberships).values({
    companyId,
    principalType: "user",
    principalId: "responsible-user",
    status: "active",
    membershipRole: "member",
  });
}

export function recoveryAgentRow(
  rowId: (typeof agents.$inferInsert)["id"],
  companyId: (typeof agents.$inferInsert)["companyId"],
  name: (typeof agents.$inferInsert)["name"],
  role: (typeof agents.$inferInsert)["role"],
  status: (typeof agents.$inferInsert)["status"],
): typeof agents.$inferInsert {
  return {
    id: rowId,
    companyId,
    name,
    role,
    status,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  };
}

export function selectRecoveryRunsByAgent(db: Db, agentId: (typeof heartbeatRuns.$inferSelect)["agentId"]) {
  return db
    .select()
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.agentId, agentId));
}

export function selectRecoveryActionsForIssue(db: Db, issueId: (typeof issueRecoveryActions.$inferSelect)["sourceIssueId"]) {
  return db
    .select()
    .from(issueRecoveryActions)
    .where(eq(issueRecoveryActions.sourceIssueId, issueId));
}

export async function seedStrandedIssueFixture(db: Db, input: {
  status: "todo" | "in_progress";
  runStatus: "failed" | "timed_out" | "cancelled" | "succeeded";
  retryReason?:
    | "assignment_recovery"
    | "issue_continuation_needed"
    | "execution_review_participant_recovery"
    | null;
  runSource?: string | null;
  assignToUser?: boolean;
  activePauseHold?: boolean;
  livenessState?:
    | "completed"
    | "advanced"
    | "plan_only"
    | "empty_response"
    | "blocked"
    | "failed"
    | "needs_followup"
    | null;
  runErrorCode?: string | null;
  runError?: string | null;
  resultJson?: Record<string, unknown> | null;
  monitorNextCheckAt?: Date | null;
}) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const runId = randomUUID();
  const wakeupRequestId = randomUUID();
  const rootIssueId = randomUUID();
  const issueId = randomUUID();
  const now = new Date("2026-03-19T00:00:00.000Z");
  const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

  await seedRecoveryCompany(db, companyId, issuePrefix);

  await db.insert(agents).values(recoveryAgentRow(agentId, companyId, "CodexCoder", "engineer", "idle"));

  await db.insert(agentWakeupRequests).values({
    id: wakeupRequestId,
    companyId,
    agentId,
    source: "assignment",
    triggerDetail: "system",
    reason:
      input.retryReason === "assignment_recovery"
        ? "issue_assignment_recovery"
        : "issue_assigned",
    payload: { issueId },
    status: input.runStatus === "cancelled" ? "cancelled" : "failed",
    runId,
    claimedAt: now,
    finishedAt: new Date("2026-03-19T00:05:00.000Z"),
    error:
      input.runStatus === "succeeded"
        ? null
        : "runError" in input
          ? input.runError
          : "run failed before issue advanced",
  });

  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId,
    agentId,
    invocationSource: "assignment",
    triggerDetail: "system",
    status: input.runStatus,
    wakeupRequestId,
    contextSnapshot: {
      issueId,
      taskId: issueId,
      wakeReason:
        input.retryReason === "assignment_recovery"
          ? "issue_assignment_recovery"
          : (input.retryReason ?? "issue_assigned"),
      ...(input.retryReason ? { retryReason: input.retryReason } : {}),
      ...(input.runSource ? { source: input.runSource } : {}),
    },
    startedAt: now,
    finishedAt: new Date("2026-03-19T00:05:00.000Z"),
    updatedAt: new Date("2026-03-19T00:05:00.000Z"),
    errorCode:
      input.runStatus === "succeeded"
        ? null
        : "runErrorCode" in input
          ? input.runErrorCode
          : "process_lost",
    error:
      input.runStatus === "succeeded"
        ? null
        : "runError" in input
          ? input.runError
          : "run failed before issue advanced",
    livenessState: input.livenessState ?? null,
    // Graph-repair fixtures model failures before any provider work. Unknown
    // execution outcomes are covered by the process-loss and adapter-failure cases.
    resultJson: input.resultJson ?? {
      executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
    },
  });

  await db.insert(issues).values([
    ...(input.activePauseHold
      ? [
          {
            id: rootIssueId,
            companyId,
            title: "Paused recovery root",
            status: "todo",
            priority: "medium",
            responsibleUserId: "responsible-user",
            issueNumber: 1,
            identifier: `${issuePrefix}-1`,
          },
        ]
      : []),
    {
      id: issueId,
      companyId,
      parentId: input.activePauseHold ? rootIssueId : null,
      title: "Recover stranded assigned work",
      status: input.status,
      priority: "medium",
      assigneeAgentId: input.assignToUser ? null : agentId,
      assigneeUserId: input.assignToUser ? "user-1" : null,
      checkoutRunId: input.status === "in_progress" ? runId : null,
      executionRunId: null,
      monitorNextCheckAt: input.monitorNextCheckAt ?? null,
      responsibleUserId: "responsible-user",
      issueNumber: input.activePauseHold ? 2 : 1,
      identifier: `${issuePrefix}-${input.activePauseHold ? 2 : 1}`,
      startedAt: input.status === "in_progress" ? now : null,
    },
  ]);

  if (input.activePauseHold) {
    await db.insert(issueTreeHolds).values({
      companyId,
      rootIssueId,
      mode: "pause",
      status: "active",
      reason: "pause recovery subtree",
      releasePolicy: { strategy: "manual" },
    });
  }

  return { companyId, agentId, runId, wakeupRequestId, issueId, rootIssueId };
}

export async function bindChatConversation(db: Db, input: {
  agentId: string;
  companyId: string;
  issueId: string;
  state: "active" | "waiting" | "completed";
}) {
  const applicationId = randomUUID();
  const connectionId = randomUUID();
  const endpointId = randomUUID();
  await db.insert(toolApplications).values({
    id: applicationId,
    companyId: input.companyId,
    applicationKey: `chat:slack:${endpointId}`,
    name: `Slack ${endpointId}`,
    type: "chat",
    status: "active",
  });
  await db.insert(toolConnections).values({
    id: connectionId,
    companyId: input.companyId,
    applicationId,
    name: "Slack channel",
    uid: `chat-slack-${endpointId}`,
    connectionPurpose: "channel",
    transport: "chat_sdk",
    status: "active",
    enabled: true,
  });
  await db.insert(chatEndpoints).values({
    id: endpointId,
    companyId: input.companyId,
    connectionId,
    provider: "slack",
    publicId: randomUUID(),
    assignedAgentId: input.agentId,
    status: "active",
  });
  const [conversation] = await db
    .insert(chatConversations)
    .values({
      companyId: input.companyId,
      endpointId,
      issueId: input.issueId,
      externalConversationId: `slack-conversation-${input.issueId}`,
      externalThreadId: `slack:CCHATWAIT:${randomUUID()}`,
      externalLabel: "Slack thread",
      state: input.state,
    })
    .returning({ id: chatConversations.id });
  return { endpointId, conversationId: conversation!.id };
}

export async function seedQueuedIssueRunFixture(db: Db) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const runId = randomUUID();
  const wakeupRequestId = randomUUID();
  const issueId = randomUUID();
  const now = new Date("2026-03-19T00:00:00.000Z");
  const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

  await seedRecoveryCompany(db, companyId, issuePrefix);

  await db.insert(agents).values({
    id: agentId,
    companyId,
    name: "CodexCoder",
    role: "engineer",
    status: "idle",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {
      heartbeat: {
        wakeOnDemand: true,
        maxConcurrentRuns: 1,
      },
    },
    permissions: {},
  });

  await db.insert(agentWakeupRequests).values({
    id: wakeupRequestId,
    companyId,
    agentId,
    source: "assignment",
    triggerDetail: "system",
    reason: "issue_assigned",
    payload: { issueId },
    status: "queued",
    runId,
    requestedAt: now,
    updatedAt: now,
  });

  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId,
    agentId,
    invocationSource: "assignment",
    triggerDetail: "system",
    status: "queued",
    wakeupRequestId,
    contextSnapshot: {
      issueId,
      taskId: issueId,
      wakeReason: "issue_assigned",
    },
    updatedAt: now,
    createdAt: now,
  });

  await db.insert(issues).values({
    id: issueId,
    companyId,
    title: "Retry transient Codex failure without blocking",
    description:
      "Verify the successful-run handoff and choose an honest disposition.",
    status: "in_progress",
    priority: "medium",
    assigneeAgentId: agentId,
    checkoutRunId: runId,
    executionRunId: runId,
    responsibleUserId: "responsible-user",
    issueNumber: 1,
    identifier: `${issuePrefix}-1`,
    startedAt: now,
  });

  // Complete the circular issue/run fixture after both FK targets exist.
  await db.update(heartbeatRuns)
    .set({ scopeKind: "issue", issueId })
    .where(eq(heartbeatRuns.id, runId));

  return { companyId, agentId, runId, wakeupRequestId, issueId };
}

export async function seedNativePassiveBoardResponse(
  db: Db,
  continuationKind:
    "response_wake" | "same_agent" | "retry" = "response_wake",
  options: { blockingWork?: boolean; repairUsed?: boolean; assignmentWake?: boolean; objectiveUnsatisfied?: boolean } = {},
) {
  const fixture = await seedStrandedIssueFixture(db, {
    status: "in_progress",
    runStatus: "succeeded",
    livenessState: "advanced",
  });
  const { companyId, agentId, issueId, runId, wakeupRequestId } = fixture;
  const commentId = randomUUID();
  const contractId = randomUUID();
  const runnerInstanceId = randomUUID();
  const request = options.blockingWork ? "Is this done?" :
    "Read only this newly attached TXT. Report Object, Accent color and Count. Keep the task open; no other work.";
  const summary = options.blockingWork ? "Not yet. Icons, screenshots, verification and the PR remain unfinished." :
    "Object: lighthouse. Accent color: amber. Count: 63.";
  // PostgreSQL's default clock retains microseconds; a later JS Date in the
  // same millisecond could otherwise precede this supposedly admitted source.
  const sourceAt = new Date(Date.now() - 1_000);
  await db.insert(issueComments).values({
    id: commentId,
    companyId,
    issueId,
    authorType: "user",
    authorUserId: "responsible-user",
    body: request,
    createdAt: sourceAt,
    updatedAt: sourceAt,
  });
  await db
    .update(agentWakeupRequests)
    .set(options.assignmentWake ? {
      status: "completed",
      requestedByActorType: "system",
      requestedByActorId: "issue-assignment",
      payload: { issueId },
    } : {
      source: "automation",
      reason: "issue_commented",
      status: "completed",
      requestedByActorType: "user",
      requestedByActorId: "responsible-user",
      payload: { issueId, commentId, ...(options.repairUsed ? { continuationIdempotencyKey: "native-completion-incomplete" } : {}) },
    })
    .where(eq(agentWakeupRequests.id, wakeupRequestId));
  await db.insert(completionContracts).values({
    id: contractId,
    companyId,
    issueId,
    revision: 1,
    schemaVersion: "paperclip.completion-contract.v1",
    policyVersion: "phase6-v4",
    risk: "low",
    completionAuthority: "agent_claim_policy",
    incompleteCriteriaPolicy: "preserve_non_terminal",
    contractJson: {
      revision: "1",
      objective: request,
      criteria: [{ id: "objective", requirement: request }],
    },
    canonicalSha256: `passive-board-contract-${runId}`,
    createdByActorType: "system",
    createdByActorId: "test",
  });
  await db
    .update(heartbeatRuns)
    .set({
      runtimeMode: "native",
      nativeIssueId: issueId,
      nativeSessionId: runId,
      completionContractId: contractId,
      completionContractSha256: `passive-board-contract-${runId}`,
      runnerInstanceId,
      startedAt: new Date(),
      finishedAt: new Date(),
      // The old status effect mutates this presentation context. It is not the
      // authority for the original user request; the durable wake above is.
      contextSnapshot: {
        issueId,
        taskId: issueId,
        source: "native_status_decision",
        wakeCommentIds: [commentId],
      },
    })
    .where(eq(heartbeatRuns.id, runId));
  const port = new PaperclipControlPlanePort(db, {
    companyId,
    issueId,
    runId,
    agentId,
    sessionId: runId,
    completionContractId: contractId,
    completionContractSha256: `passive-board-contract-${runId}`,
    sourceInstanceId: runnerInstanceId,
    controlPlaneSourceInstanceId: `board-control-${runId}`,
  });
  await port.completeRun({
    result: {
      schema: "paperclip.run_result.v1",
      reportedWorkDisposition: "yielded",
      summary,
      continuation: {
        kind: continuationKind,
        summary:
          "Task remains open per the latest comment; wait for the next response.",
        idempotencyKey: `board-wait-${runId}`,
      },
      completionClaim: {
        contractRevision: "1",
        objectiveSatisfied: !options.objectiveUnsatisfied,
        criteria: [
          { criterionId: "objective", status: options.objectiveUnsatisfied ? "not_satisfied" : "satisfied",
            evidenceRefs: options.objectiveUnsatisfied ? ["catalog:launch_export:quarantined"] : [] },
        ],
        remainingWork: options.blockingWork ? [{ description: "Finish icons, screenshots, verification and PR", blocksCompletion: true }] : [],
      },
      evidence: options.objectiveUnsatisfied ? [{ ref: "catalog:launch_export:quarantined" }] : [],
      verification: options.objectiveUnsatisfied ? [{ commandOrCheck: "GET /api/tool-connections/{connectionId}/catalog",
        status: "passed", detail: "Catalog shows launch_export with status quarantined." }] : [],
      attentionRequests: [],
      artifacts: [],
    },
    terminal: {
      schema: "paperclip.prp.terminal.v1",
      runTerminalState: "succeeded",
      turnTerminalState: "completed",
      reportedWorkDisposition: "yielded",
    },
  });
  return { ...fixture, commentId, contractId, summary };
}

/** The afterEach drain: cancel what is still active, wait for idle, then empty the tables. */
export async function drainAndCleanRecoveryTables(db: Db) {
  await cancelActiveRunsForCleanup(db, 5_000);
  let idlePolls = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runs = await db
      .select({
        status: heartbeatRuns.status,
        processPid: heartbeatRuns.processPid,
        processGroupId: heartbeatRuns.processGroupId,
      })
      .from(heartbeatRuns);
    const managedExecutionStillActive = runs.some(
      (run) =>
        (run.status === "queued" || run.status === "running") &&
        !run.processPid &&
        !run.processGroupId,
    );
    if (!managedExecutionStillActive) {
      idlePolls += 1;
      if (idlePolls >= 3) break;
    } else {
      idlePolls = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  await waitForHeartbeatIdle(db, 5_000);
  // Terminal rows do not mean their background finalizers have returned.
  // Drain tracked wakeups too: one can still create a run after the row poll.
  await heartbeatService(db).drainActiveRunExecutions();
  await db.delete(activityLog);
  await db.delete(agentRuntimeState);
  await db.delete(companySkills);
  await db.delete(costEvents);
  await db.delete(workspaceOperations);
  await db.delete(environmentLeases);
  await db.delete(environments);
  await db.delete(plugins);
  await db.delete(issuePlanDecompositions);
  await db.delete(issueThreadInteractions);
  await db.delete(chatMessageLinks);
  await db.delete(chatPublications);
  await db.delete(chatActions);
  await db.delete(chatDeliveries);
  await db.delete(chatConversations);
  await db.delete(chatEndpoints);
  await db.delete(toolConnections);
  await db.delete(toolApplications);
  await db.delete(documentAnnotationComments);
  await db.delete(documentAnnotationAnchorSnapshots);
  await db.delete(documentAnnotationThreads);
  await db.delete(issueWorkProducts);
  await db.delete(issueComments);
  await db.delete(issueDocuments);
  await db.delete(documentRevisions);
  await db.delete(documents);
  await db.delete(issueRelations);
  await db.delete(issueRecoveryActions);
  await db.delete(issueTreeHoldMembers);
  await db.delete(issueTreeHolds);
  await db.delete(agentTaskSessions);
  await db.delete(issueApprovals);
  await db.delete(budgetIncidents);
  await db.delete(approvals);
  await db.update(issues).set({ lastStatusDecisionId: null });
  await db.delete(statusDecisionEffects);
  await db.delete(nativeRunFinalizations);
  await db.delete(statusDecisions);
  await db.delete(workAssessments);
  await db.delete(nativeRunResults);
  await db.update(heartbeatRuns).set({ completionContractId: null });
  await db.delete(completionContracts);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    try {
      await db.delete(issues);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await db.delete(activityLog);
    await db.delete(heartbeatRunEvents);
    try {
      await db.delete(heartbeatRuns);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await db.delete(agentWakeupRequests);
  await db.delete(budgetPolicies);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // A still-alive recovery child process can insert a new wakeup request
    // or runtime-state row after the first delete. Re-clear both rows each
    // attempt so a late insert cannot hold the agents foreign key.
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    try {
      await db.delete(agents);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await db.delete(companySkills);
    await db.delete(workspaceOperations);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(issuePlanDecompositions);
    await db.delete(issueThreadInteractions);
    await db.delete(documentAnnotationComments);
    await db.delete(documentAnnotationAnchorSnapshots);
    await db.delete(documentAnnotationThreads);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(companySecretBindings);
    await db.delete(companySecrets);
    try {
      await db.delete(companyMemberships);
      await db.delete(companies);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
