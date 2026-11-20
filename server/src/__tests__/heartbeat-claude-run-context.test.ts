import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, issues, projectWorkspaces, projects } from "@paperclipai/db";
import { heartbeatService } from "../services/heartbeat.js";
import { readRunAgentAccess } from "../services/heartbeat/claude-run-context.js";
import { recoveryPostgresSupport, startRecoveryPostgres } from "./helpers/recovery-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

// Step 4b, Task 10: the context a run gets for a sealed claude_local launch: the project's two
// repo switches on `paperclipWorkspace`, the agent's stored access level, and the AI connection's
// name. The adapter reads them (Tasks 7 and 8) and records them in the run manifest.

const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", () => ({
  getServerAdapter: () => ({ type: "codex_local", execute, supportsLocalAgentJwt: false }),
  findActiveServerAdapter: () => ({ type: "codex_local", execute, supportsLocalAgentJwt: false }),
  runningProcesses: new Map(),
}));

type CapturedContext = {
  paperclipWorkspace?: { projectId?: string | null; agentsReadClaudeMd?: boolean | null; agentsUseRepoSkills?: boolean | null };
  paperclipAgentAccess?: unknown;
  paperclipAiConnectionName?: unknown;
};

describe("readRunAgentAccess", () => {
  it("returns the stored level with its overrides", () => {
    expect(readRunAgentAccess({ access: { level: "manager", overrides: { "tasks:assign": false } } }))
      .toEqual({ level: "manager", overrides: { "tasks:assign": false } });
  });

  it("defaults the overrides to an empty object", () => {
    expect(readRunAgentAccess({ access: { level: "read_only" } })).toEqual({ level: "read_only", overrides: {} });
  });

  it.each([
    ["no permissions", null],
    ["no stored access", {}],
    ["an unknown level", { access: { level: "owner" } }],
    ["an unknown override", { access: { level: "worker", overrides: { "agents:fly": true } } }],
  ])("is null for %s", (_label, permissions) => {
    expect(readRunAgentAccess(permissions)).toBeNull();
  });
});

describe.skipIf(!recoveryPostgresSupport.supported)("heartbeat: the claude_local run context", () => {
  let temporary: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  let root: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "heartbeat-claude-run-context-")));
    vi.stubEnv("PAPERCLIP_HOME", path.join(root, "home"));
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "01234567890123456789012345678901");
    temporary = await startRecoveryPostgres("heartbeat-claude-run-context-");
    db = createDb(temporary.connectionString);
    heartbeat = heartbeatService(db);
  }, 60_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    execute.mockReset();
  });

  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function seed(input: {
    project?: { agentsReadClaudeMd?: boolean; agentsUseRepoSkills?: boolean };
    permissions?: Record<string, unknown>;
  }) {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companies).values({ id: companyId, name: "Run context", issuePrefix: `R${companyId.slice(0, 6)}`,
      defaultResponsibleUserId: userId, requireBoardApprovalForNewAgents: false });
    await db.insert(companyMemberships).values({ companyId, principalId: userId, principalType: "user", membershipRole: "owner", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", status: "idle", adapterType: "codex_local",
      adapterConfig: {}, runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 2 } },
      permissions: input.permissions ?? { access: { level: "worker" } } });
    let issueId: string | null = null;
    let projectId: string | null = null;
    if (input.project) {
      projectId = randomUUID();
      await db.insert(projects).values({ id: projectId, companyId, name: "Repo project", status: "in_progress", ...input.project });
      // The run works in the project's primary workspace, so `paperclipWorkspace.projectId` is set.
      const projectWorkspaceId = randomUUID();
      const cwd = path.join(root, `project-${projectId}`);
      await mkdir(cwd, { recursive: true });
      await db.insert(projectWorkspaces).values({ id: projectWorkspaceId, companyId, projectId, name: "Primary", cwd, isPrimary: true });
      issueId = randomUUID();
      await db.insert(issues).values({ id: issueId, companyId, projectId, projectWorkspaceId, title: "Task", status: "todo",
        assigneeAgentId: agentId, responsibleUserId: userId });
    }
    return { agentId, issueId, projectId };
  }

  async function runAndCapture(agentId: string, issueId: string | null): Promise<CapturedContext> {
    let captured: CapturedContext | null = null;
    execute.mockImplementation(async (input: { context: CapturedContext }) => {
      captured = input.context;
      return { exitCode: 0, signal: null, timedOut: false };
    });
    const run = await heartbeat.wakeup(agentId, { source: "on_demand", triggerDetail: "manual",
      contextSnapshot: issueId ? { issueId } : {} });
    expect(run).not.toBeNull();
    await vi.waitFor(async () => {
      expect((await heartbeat.getRun(run!.id))?.status).toMatch(/^(succeeded|failed|cancelled|timed_out)$/);
    }, { timeout: 30_000 });
    const finished = await heartbeat.getRun(run!.id);
    expect({ status: finished?.status, error: finished?.error }).toMatchObject({ status: "succeeded" });
    expect(captured).not.toBeNull();
    return captured!;
  }

  it("gives a project task with the CLAUDE.md switch off agentsReadClaudeMd: false and agentsUseRepoSkills: true", async () => {
    const { agentId, issueId, projectId } = await seed({ project: { agentsReadClaudeMd: false } });
    const context = await runAndCapture(agentId, issueId);
    expect(context.paperclipWorkspace).toMatchObject({ projectId, agentsReadClaudeMd: false, agentsUseRepoSkills: true });
  }, 60_000);

  it("gives a project task with the skills switch off agentsReadClaudeMd: true and agentsUseRepoSkills: false", async () => {
    const { agentId, issueId, projectId } = await seed({ project: { agentsUseRepoSkills: false } });
    const context = await runAndCapture(agentId, issueId);
    expect(context.paperclipWorkspace).toMatchObject({ projectId, agentsReadClaudeMd: true, agentsUseRepoSkills: false });
  }, 60_000);

  it("gives a task-less run null for both switches", async () => {
    const { agentId } = await seed({});
    const context = await runAndCapture(agentId, null);
    expect(context.paperclipWorkspace?.projectId ?? null).toBeNull();
    expect(context.paperclipWorkspace).toMatchObject({ agentsReadClaudeMd: null, agentsUseRepoSkills: null });
  }, 60_000);

  it("passes the agent's stored access level and overrides, and no connection name without one", async () => {
    const { agentId } = await seed({ permissions: { access: { level: "worker", overrides: { "agents:create": true } } } });
    const context = await runAndCapture(agentId, null);
    expect(context.paperclipAgentAccess).toEqual({ level: "worker", overrides: { "agents:create": true } });
    expect(context.paperclipAiConnectionName).toBeNull();
  }, 60_000);

  it("passes null access when the stored access doesn't parse", async () => {
    const { agentId } = await seed({ permissions: { access: { level: "superuser" } } });
    const context = await runAndCapture(agentId, null);
    expect(context.paperclipAgentAccess).toBeNull();
  }, 60_000);
});
