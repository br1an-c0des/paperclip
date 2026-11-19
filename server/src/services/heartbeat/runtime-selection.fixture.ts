import { randomUUID } from "node:crypto";
import { agents, companies, heartbeatRuns, issues, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { resolveHeartbeatNativeRuntimeMode } from "../native-runtime/runtime-mode.js";
import type { HeartbeatRuntimeSelectionInput } from "./runtime-selection.js";

// Shared setup for runtime-selection.test.ts and its opt-in sibling runtime-selection.dormant.test.ts:
// a company, agent, issue and running run, and the runtime-selection input for them.

export async function runtimeSelectionFixture(db: Db, adapterType = "paperclip_runner") {
  const [company] = await db.insert(companies).values({ name: "Runtime selection", issuePrefix: "SEL" }).returning();
  const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Selecting agent", status: "running", adapterType, adapterConfig: { provider: "codex", model: "gpt-5.6-luna" } }).returning();
  const [issue] = await db.insert(issues).values({ companyId: company.id, title: "Complete this task", description: "Preserve the requested work", assigneeAgentId: agent.id }).returning();
  const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, issueId: issue.id, scopeKind: "issue", status: "running" }).returning();
  const now = new Date();
  const input: HeartbeatRuntimeSelectionInput = {
    run, agent,
    nativeRuntimeResolution: resolveHeartbeatNativeRuntimeMode({ persisted: run, enabled: true, runtimeConfig: {}, adapterConfig: agent.adapterConfig, agent, issue, target: null, workspaceId: null }),
    task: { issueRef: issue, issueContext: null, context: { paperclipTaskMarkdown: "Complete this task" }, executionContinuation: null, safeWakeComments: [], safeWakeCommentContext: null, paperclipWakePayload: null, acceptedPlanContinuationWake: false },
    session: { persistedNativeExecutionInput: null, persistedRunnerProfile: {}, taskResumeSessionId: null, isFailedChatRunRetry: false, getFreshSessionHandoff: vi.fn(async () => "Earlier context") },
    workspace: { persistedExecutionWorkspace: null, executionWorkspace: { cwd: "/tmp/paperclip-runtime-selection", repoUrl: null, repoRef: null, branchName: null }, executionTarget: null, isDotRun: false, projectRepositoryPaths: [],
      activeEnvironmentLease: { lease: { id: randomUUID(), companyId: company.id, environmentId: null, executionWorkspaceId: null, issueId: issue.id, heartbeatRunId: run.id, status: "active", leasePolicy: "ephemeral", provider: null, providerLeaseId: null, acquiredAt: now, lastUsedAt: now, expiresAt: null, releasedAt: null, failureReason: null, cleanupStatus: null, metadata: null, createdAt: now, updatedAt: now } },
    },
    config: { runtimeConfig: {}, runtimeSkillEntries: [], runScopedMentionedSkillKeys: [], instructionCopy: null, agentIdentity: undefined, issueAssigneeOverrides: null, resolvedConfig: {}, managedAiRuntime: undefined },
    recovery: {}, trace: { providerTraceRequested: false, providerTraceCapture: null },
    issuesSvc: { addComment: vi.fn() }, runtimeEnv: {}, onAdapterEvent: vi.fn(async () => {}),
    onNativeLifecycleSelected: vi.fn(), onProviderResourceDisposition: vi.fn(), onNativeOwnershipHeld: vi.fn(), stopControllerLease: vi.fn(),
  };
  return { input, issue, run, agent };
}

export const readRun = (db: Db, id: string) => db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, id)).then(rows => rows[0]!);
export const runCoordinators = (db: Db, id: string) => db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, id));
