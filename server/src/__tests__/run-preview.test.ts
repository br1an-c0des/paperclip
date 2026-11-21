import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { agents, authUsers, companies, companyMemberships, createDb, issues, projectWorkspaces, projects } from "@paperclipai/db";
import type { AdapterExecutionContext, ServerAdapterModule } from "@paperclipai/adapter-utils";
import {
  execute as claudeExecute,
  previewClaudeRun,
  sessionCodec as claudeSessionCodec,
} from "@paperclipai/adapter-claude-local/server";
import type { ClaudeRunManifest, ClaudeRunPreview } from "@paperclipai/shared";
import { heartbeatService } from "../services/heartbeat.js";
import { runPreviewService } from "../services/run-preview.js";
import { companySkillService } from "../services/company-skills.js";
import { recoveryPostgresSupport, startRecoveryPostgres } from "./helpers/recovery-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

// Step 4b part 2 (fork/step-4b-parts-2-3.md): GET /api/agents/:id/run-preview's service. The
// preview of an agent's next run equals what a real run of the same agent gets (the real
// claude_local adapter, with a fake `claude`), and reading it starts, writes and mints nothing.

const captured = vi.hoisted(() => ({ manifest: null as Record<string, unknown> | null }));
const minted = vi.hoisted(() => ({ runTokens: 0, runtimeToolTokens: 0 }));

vi.mock("../agent-auth-jwt.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../agent-auth-jwt.js")>();
  return {
    ...original,
    createLocalAgentJwt: (...args: Parameters<typeof original.createLocalAgentJwt>) => {
      minted.runTokens += 1;
      return original.createLocalAgentJwt(...args);
    },
  };
});
vi.mock("../runtime-tools-token.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../runtime-tools-token.js")>();
  return {
    ...original,
    createRuntimeToolsToken: (...args: Parameters<typeof original.createRuntimeToolsToken>) => {
      minted.runtimeToolTokens += 1;
      return original.createRuntimeToolsToken(...args);
    },
  };
});

const adapter = vi.hoisted(() => ({ module: null as unknown }));
vi.mock("../adapters/index.js", () => ({
  getServerAdapter: () => adapter.module,
  findActiveServerAdapter: (type: string) => (type === "claude_local" ? adapter.module : null),
  runningProcesses: new Map(),
}));

const claudeAdapter: Partial<ServerAdapterModule> = {
  type: "claude_local",
  runtimeToolDelivery: "native_mcp",
  supportsLocalAgentJwt: true,
  sessionCodec: claudeSessionCodec,
  previewRun: previewClaudeRun,
  execute: (ctx: AdapterExecutionContext) => claudeExecute({
    ...ctx,
    onMeta: async (meta) => {
      if (meta.runManifest) captured.manifest = meta.runManifest;
      await ctx.onMeta?.(meta);
    },
  }),
};
adapter.module = claudeAdapter;

const FAKE_CLAUDE = `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("2.1.325 (Claude Code)"); process.exit(0); }
require("node:fs").readFileSync(0, "utf8");
const sessionId = "11111111-1111-4111-8111-111111111111";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "claude-sonnet" }));
console.log(JSON.stringify({ type: "result", subtype: "success", session_id: sessionId, result: "done", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
`;

/**
 * Variables a run gets at launch that a preview doesn't list (the manifest's `envKeys` is the one
 * field that differs): the wake's and task's own, the run's workspace and scratch folders, the
 * managed git/gh launchers, telemetry export, and the agent's signing identity. The card doesn't
 * show `envKeys`.
 */
const LAUNCH_ENV_KEYS = [
  /^PAPERCLIP_(TASK_ID|ISSUE_WORK_MODE|LINKED_ISSUE_IDS|APPROVAL_ID|APPROVAL_STATUS)$/,
  /^PAPERCLIP_WAKE_/,
  /^PAPERCLIP_WORKSPACES?_/,
  /^PAPERCLIP_RUNTIME_(SERVICE_INTENTS_JSON|SERVICES_JSON|PRIMARY_URL)$/,
  /^PAPERCLIP_(RUN_|TASK_)?SCRATCH_DIR$/,
  /^(PAPERCLIP_)?TMPDIR$/,
  /^(TEMP|TMP)$/,
  /^PAPERCLIP_RUNNER_NETWORK_/,
  /^(BASH_ENV|ZDOTDIR|GH_CONFIG_DIR|GIT_CONFIG_GLOBAL|GIT_CONFIG_NOSYSTEM|GIT_CONFIG_SYSTEM|GIT_SSH_COMMAND|GIT_TERMINAL_PROMPT)$/,
  /^PAPERCLIP_GITHUB_/,
  /^PAPERCLIP_GIT_METADATA_ROOTS$/,
  /^OTEL_/,
  /^CLAUDE_CODE_(ENABLE_TELEMETRY|ENHANCED_TELEMETRY_BETA)$/,
  /^PAPERCLIP_AGENT_(KEY_ID|PRIVATE_KEY|PUBLIC_KEY)$/,
];
const isLaunchEnvKey = (key: string) => LAUNCH_ENV_KEYS.some((pattern) => pattern.test(key));

async function listTree(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      out.push(path.relative(root, full));
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(root);
  return out.sort();
}

async function tempHomes(): Promise<string[]> {
  return (await readdir(tmpdir()).catch(() => [] as string[]))
    .filter((name) => name.startsWith("paperclip-claude-home-") || name.startsWith("paperclip-ai-"))
    .sort();
}

describe.skipIf(!recoveryPostgresSupport.supported)("run preview: what an agent's runs get", () => {
  let temporary: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  let root: string;
  let fakeClaude: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "run-preview-")));
    vi.stubEnv("PAPERCLIP_HOME", path.join(root, "home"));
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "run-preview-test");
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "01234567890123456789012345678901");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "run-preview-jwt-secret");
    vi.stubEnv("PAPERCLIP_API_URL", "http://127.0.0.1:3999");
    fakeClaude = path.join(root, "bin", "claude");
    await mkdir(path.dirname(fakeClaude), { recursive: true });
    await writeFile(fakeClaude, FAKE_CLAUDE, "utf8");
    await chmod(fakeClaude, 0o755);
    temporary = await startRecoveryPostgres("run-preview-");
    db = createDb(temporary.connectionString);
    heartbeat = heartbeatService(db);
  }, 60_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    captured.manifest = null;
  });

  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function makeRepo(name: string): Promise<string> {
    const repo = path.join(root, name);
    await mkdir(path.join(repo, ".claude", "skills", "release"), { recursive: true });
    await writeFile(path.join(repo, "CLAUDE.md"), "# Repo rules\n", "utf8");
    await writeFile(path.join(repo, ".claude", "skills", "release", "SKILL.md"), "---\nname: release\n---\n", "utf8");
    await promisify(execFile)("git", ["init", "-q", repo]);
    return repo;
  }

  async function seed(input: {
    adapterType?: string;
    adapterConfig?: Record<string, unknown>;
    env?: Record<string, unknown>;
    project?: { agentsReadClaudeMd?: boolean; agentsUseRepoSkills?: boolean; workspace?: { cwd?: string | null; repoUrl?: string | null } };
  } = {}) {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companies).values({ id: companyId, name: "M7 test run preview", issuePrefix: `P${companyId.slice(0, 6)}`,
      defaultResponsibleUserId: userId, requireBoardApprovalForNewAgents: false });
    await db.insert(companyMemberships).values({ companyId, principalId: userId, principalType: "user", membershipRole: "owner", status: "active" });
    await db.insert(agents).values({
      id: agentId, companyId, name: "M7 test previewed agent", status: "idle", adapterType: input.adapterType ?? "claude_local",
      adapterConfig: {
        engine: "cli",
        command: fakeClaude,
        promptTemplate: "Do the work.",
        ...input.adapterConfig,
        env: input.env ?? { CLAUDE_CODE_OAUTH_TOKEN: "test-oauth-token" },
      },
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 2 } },
      permissions: { access: { level: "worker", overrides: { "agents:create": true } } },
    });
    let projectId: string | null = null;
    let projectWorkspaceId: string | null = null;
    if (input.project) {
      projectId = randomUUID();
      const { workspace, ...switches } = input.project;
      await db.insert(projects).values({ id: projectId, companyId, name: "M7 test repo project", status: "in_progress", ...switches });
      projectWorkspaceId = randomUUID();
      await db.insert(projectWorkspaces).values({
        id: projectWorkspaceId, companyId, projectId, name: "Primary", isPrimary: true,
        cwd: workspace?.cwd === undefined ? await makeRepo(`repo-${projectId}`) : workspace.cwd,
        repoUrl: workspace?.repoUrl ?? null,
      });
    }
    return { companyId, userId, agentId, projectId, projectWorkspaceId };
  }

  async function readAgent(agentId: string) {
    const [agent] = await db.select().from(agents).where(sql`${agents.id} = ${agentId}`);
    return agent!;
  }

  async function runTask(seeded: Awaited<ReturnType<typeof seed>>): Promise<ClaudeRunManifest> {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId: seeded.companyId, projectId: seeded.projectId, projectWorkspaceId: seeded.projectWorkspaceId,
      title: "M7 test task", status: "todo", assigneeAgentId: seeded.agentId, responsibleUserId: seeded.userId,
    });
    const run = await heartbeat.wakeup(seeded.agentId, { source: "on_demand", triggerDetail: "manual", contextSnapshot: { issueId } });
    expect(run).not.toBeNull();
    await vi.waitFor(async () => {
      expect((await heartbeat.getRun(run!.id))?.status).toMatch(/^(succeeded|failed|cancelled|timed_out)$/);
    }, { timeout: 30_000 });
    const finished = await heartbeat.getRun(run!.id);
    expect({ status: finished?.status, error: finished?.error }).toMatchObject({ status: "succeeded" });
    expect(captured.manifest).not.toBeNull();
    return captured.manifest as unknown as ClaudeRunManifest;
  }

  async function preview(seeded: Awaited<ReturnType<typeof seed>>): Promise<ClaudeRunPreview> {
    return runPreviewService(db).previewAgentRun(await readAgent(seeded.agentId), {
      projectId: seeded.projectId, responsibleUserId: seeded.userId,
    });
  }

  function expectPreviewMatchesRun(previewed: ClaudeRunPreview, ran: ClaudeRunManifest) {
    expect(previewed.supported).toBe(true);
    if (!previewed.supported) return;
    expect(previewed.blockers).toEqual([]);
    const { session: _session, setAside: _setAside, envKeys: runEnvKeys, ...runRest } = ran;
    const { envKeys: previewEnvKeys, ...previewRest } = previewed.manifest;
    expect(previewRest).toEqual(runRest);
    // The preview's variables are the run's, less those that come from the wake and the task.
    expect(runEnvKeys).toEqual(expect.arrayContaining(previewEnvKeys));
    expect(runEnvKeys.filter((key) => !previewEnvKeys.includes(key)).filter((key) => !isLaunchEnvKey(key))).toEqual([]);
  }

  it("matches a real run on a task in no project", async () => {
    const seeded = await seed();
    // The run first: it brings the company's skill library up to date, which a preview reads as is.
    const ran = await runTask(seeded);
    const previewed = await preview(seeded);
    expectPreviewMatchesRun(previewed, ran);
    expect(previewed.supported && previewed.project).toBeNull();
    expect(ran.claudeMd).toEqual({ enabled: false, reason: "no_project" });
  }, 90_000);

  it("matches a real run on a task in a project with both switches on", async () => {
    const seeded = await seed({ project: {} });
    // The run first: it brings the company's skill library up to date, which a preview reads as is.
    const ran = await runTask(seeded);
    const previewed = await preview(seeded);
    expectPreviewMatchesRun(previewed, ran);
    expect(ran.claudeMd.enabled).toBe(true);
    expect(ran.repoSkills).toMatchObject({ enabled: true, count: 1 });
    expect(ran.skills.some((skill) => skill.origin === "repo" && skill.name === "release")).toBe(true);
    expect(previewed.supported && previewed.project).toMatchObject({ id: seeded.projectId, checkout: { kind: "local" } });
  }, 90_000);

  it("matches a real run on a task in a project with both switches off", async () => {
    const seeded = await seed({ project: { agentsReadClaudeMd: false, agentsUseRepoSkills: false } });
    // The run first: it brings the company's skill library up to date, which a preview reads as is.
    const ran = await runTask(seeded);
    const previewed = await preview(seeded);
    expectPreviewMatchesRun(previewed, ran);
    expect(ran.claudeMd).toEqual({ enabled: false, reason: "project_switch_off" });
    expect(ran.repoSkills).toEqual({ enabled: false, reason: "project_switch_off" });
  }, 90_000);

  it("writes no files, mints no tokens and writes nothing to the database", async () => {
    const seeded = await seed({ project: {} });
    // The company's skill library, brought up to date as a run (or the Skills page) would.
    await companySkillService(db).listRuntimeSkillEntries(seeded.companyId);
    const instanceRoot = path.join(root, "home");
    const filesBefore = await listTree(instanceRoot);
    const homesBefore = await tempHomes();
    const tokensBefore = { ...minted };
    const [{ xmax: xmaxBefore }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;

    const previewed = await preview(seeded);
    expect(previewed.supported).toBe(true);
    if (previewed.supported) {
      expect(previewed.manifest.claudeMd.enabled).toBe(true);
      expect(previewed.manifest.skills.length).toBeGreaterThan(1);
    }

    const [{ xmax: xmaxAfter }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;
    // No transaction id was handed out: nothing was inserted, updated or deleted.
    expect(xmaxAfter).toBe(xmaxBefore);
    expect(await listTree(instanceRoot)).toEqual(filesBefore);
    expect(await tempHomes()).toEqual(homesBefore);
    expect(minted).toEqual(tokensBefore);

    // The check itself sees a write.
    await db.update(agents).set({ updatedAt: new Date() }).where(sql`${agents.id} = ${seeded.agentId}`);
    const [{ xmax: xmaxWritten }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;
    expect(xmaxWritten).not.toBe(xmaxAfter);
  }, 60_000);

  it("says so for another adapter, the ACP engine and the Runner", async () => {
    const other = await seed({ adapterType: "codex_local" });
    expect(await preview(other)).toEqual({ supported: false, reason: "not_claude_local" });
    const acp = await seed({ adapterConfig: { engine: "acp" } });
    expect(await preview(acp)).toEqual({ supported: false, reason: "not_cli_engine" });
    const runner = await seed({ adapterType: "paperclip_runner" });
    expect(await preview(runner)).toEqual({ supported: false, reason: "runner" });
  }, 60_000);

  it("warns about a run without a Claude credential", async () => {
    const seeded = await seed({ env: {} });
    const previewed = await preview(seeded);
    expect(previewed.supported).toBe(true);
    if (!previewed.supported) return;
    expect(previewed.manifest.credential).toBeNull();
    expect(previewed.blockers.map((blocker) => blocker.code)).toEqual(["claude_credential_missing"]);
  }, 60_000);

  it("names a credential from the agent's env without reading the secret", async () => {
    const seeded = await seed({ env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: randomUUID() } } });
    const previewed = await preview(seeded);
    expect(previewed.supported).toBe(true);
    if (!previewed.supported) return;
    // The secret doesn't exist: the run would stop at the missing binding, and the preview says so.
    expect(previewed.blockers.map((blocker) => blocker.code)).toContain("secret_binding_missing");
    expect(previewed.manifest.credential).toEqual({ kind: "agent_env", method: "api_key", connectionId: null, connectionName: null });
  }, 60_000);

  it("says a repo isn't cloned yet rather than cloning it", async () => {
    const seeded = await seed({ project: { workspace: { cwd: null, repoUrl: "https://example.test/m7/not-cloned.git" } } });
    const filesBefore = await listTree(path.join(root, "home"));
    const previewed = await preview(seeded);
    expect(previewed.supported).toBe(true);
    if (!previewed.supported) return;
    expect(previewed.project?.checkout).toEqual({ kind: "not_cloned", repoUrl: "https://example.test/m7/not-cloned.git" });
    expect(previewed.manifest.claudeMd).toEqual({ enabled: false, reason: "not_cloned" });
    expect(previewed.manifest.repoSkills).toEqual({ enabled: false, reason: "not_cloned" });
    expect(await listTree(path.join(root, "home"))).toEqual(filesBefore);
  }, 60_000);
});
