import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { agents, authUsers, companies, companyMemberships, createDb, issueComments, issues, projectWorkspaces, projects } from "@paperclipai/db";
import type { AdapterExecutionContext, ServerAdapterModule } from "@paperclipai/adapter-utils";
import {
  execute as claudeExecute,
  previewClaudeRun,
  sessionCodec as claudeSessionCodec,
} from "@paperclipai/adapter-claude-local/server";
import {
  CLAUDE_RUN_PREVIEW_TASK_BRANCH,
  joinRunPromptSections,
  type ClaudeRunManifest,
  type ClaudeRunPreview,
  type RunPromptPreviewKind,
} from "@paperclipai/shared";
import { heartbeatService } from "../services/heartbeat.js";
import { runPreviewService } from "../services/run-preview.js";
import { companySkillService } from "../services/company-skills.js";
import { recoveryPostgresSupport, startRecoveryPostgres } from "./helpers/recovery-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

// Step 4b part 2 (fork/step-4b-parts-2-3.md): GET /api/agents/:id/run-preview's service. The
// preview of an agent's next run equals what a real run of the same agent gets (the real
// claude_local adapter, with a fake `claude`), and reading it starts, writes and mints nothing.
// Step 4b part 3 made a task worktree the default for a project whose checkout is a git
// repository; the preview reads that worktree's CLAUDE.md and skills from its base commit.
// Step 5 Task 8 added the prompt draft: for a task and kind of wake, the first message a run sends.

const captured = vi.hoisted(() => ({
  manifest: null as Record<string, unknown> | null,
  prompt: null as string | null,
  systemPrompt: null as unknown[] | null,
}));
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
      if (typeof meta.prompt === "string") captured.prompt = meta.prompt;
      if (meta.promptRecord) captured.systemPrompt = meta.promptRecord.systemPrompt;
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

/**
 * Runs `fn` with the system temp folder pointed at a fresh folder of its own, and returns what `fn`
 * left there. A run makes its temporary `HOME` (`paperclip-claude-home-*`) and a managed
 * connection's credential home (`paperclip-ai-*`) under `os.tmpdir()`, which reads `TMPDIR` on
 * each call. The shared temp folder is no use for this: `scripts/test.mjs` gives every file and
 * worker of a test run the same one, and other files create and remove their own `paperclip-ai-*`
 * folders there meanwhile (bug 79).
 */
async function inPrivateTmpdir<T>(parent: string, fn: () => Promise<T>): Promise<{ result: T; left: string[] }> {
  const dir = await mkdtemp(path.join(parent, "tmpdir-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    expect(tmpdir()).toBe(dir);
    const result = await fn();
    return { result, left: await listTree(dir) };
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
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
    captured.prompt = null;
    captured.systemPrompt = null;
  });

  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", [
    "-C", cwd, "-c", "user.name=M7 test", "-c", "user.email=m7@example.test", "-c", "commit.gpgsign=false", ...args,
  ]);

  /**
   * A repo whose commit holds CLAUDE.md and the `release` skill, and whose working files also
   * hold an uncommitted `draft` skill: a task worktree gets only the first, the checkout both.
   */
  async function makeRepo(name: string): Promise<string> {
    const repo = path.join(root, name);
    await mkdir(path.join(repo, ".claude", "skills", "release"), { recursive: true });
    await writeFile(path.join(repo, "CLAUDE.md"), "# Repo rules\n", "utf8");
    await writeFile(path.join(repo, ".claude", "skills", "release", "SKILL.md"), "---\nname: release\n---\n", "utf8");
    await promisify(execFile)("git", ["init", "-q", "-b", "main", repo]);
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "M7 test initial commit");
    await mkdir(path.join(repo, ".claude", "skills", "draft"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "skills", "draft", "SKILL.md"), "---\nname: draft\n---\n", "utf8");
    return repo;
  }

  /** A project that chose the shared checkout (ui-new's Task checkouts card, turned off). */
  const SHARED_CHECKOUT = { enabled: false, defaultMode: "shared_workspace" };

  async function seed(input: {
    adapterType?: string;
    adapterConfig?: Record<string, unknown>;
    env?: Record<string, unknown>;
    project?: {
      agentsReadClaudeMd?: boolean;
      agentsUseRepoSkills?: boolean;
      executionWorkspacePolicy?: Record<string, unknown>;
      workspace?: { cwd?: string | null; repoUrl?: string | null };
    };
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
    let repo: string | null = null;
    if (input.project) {
      projectId = randomUUID();
      const { workspace, ...switches } = input.project;
      await db.insert(projects).values({ id: projectId, companyId, name: "M7 test repo project", status: "in_progress", ...switches });
      projectWorkspaceId = randomUUID();
      repo = workspace?.cwd === undefined ? await makeRepo(`repo-${projectId}`) : workspace.cwd;
      await db.insert(projectWorkspaces).values({
        id: projectWorkspaceId, companyId, projectId, name: "Primary", isPrimary: true,
        cwd: repo,
        repoUrl: workspace?.repoUrl ?? null,
      });
    }
    return { companyId, userId, agentId, projectId, projectWorkspaceId, repo };
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

  async function preview(
    seeded: Awaited<ReturnType<typeof seed>>,
    prompt: { issueId?: string; kind?: RunPromptPreviewKind } = {},
  ): Promise<ClaudeRunPreview> {
    return runPreviewService(db).previewAgentRun(await readAgent(seeded.agentId), {
      projectId: seeded.projectId, responsibleUserId: seeded.userId, issueId: prompt.issueId ?? null, kind: prompt.kind ?? null,
    });
  }

  /** A task of the agent's in the seeded project, with a comment, and one of the agent's chats with a message. */
  async function promptTargets(seeded: Awaited<ReturnType<typeof seed>>) {
    const taskId = randomUUID(), chatId = randomUUID();
    await db.insert(issues).values({
      id: taskId, companyId: seeded.companyId, projectId: seeded.projectId, projectWorkspaceId: seeded.projectWorkspaceId,
      title: "M7 test commented task", description: "Count the ledger.", status: "todo", assigneeAgentId: seeded.agentId,
      responsibleUserId: seeded.userId,
    });
    await db.insert(issues).values({
      id: chatId, companyId: seeded.companyId, title: "M7 test chat", status: "in_progress", assigneeAgentId: seeded.agentId,
      conversationAgentId: seeded.agentId, conversationUserId: seeded.userId, conversationState: "active",
    });
    await db.insert(issueComments).values([
      { companyId: seeded.companyId, issueId: taskId, body: "M7 test: add March", authorUserId: seeded.userId },
      { companyId: seeded.companyId, issueId: chatId, body: "M7 test: what's left?", authorUserId: seeded.userId },
    ]);
    return { taskId, chatId };
  }

  /**
   * A worktree run's manifest with its worktree folder (`<dir>/<the task's branch>`) written as the
   * preview writes it, `<dir>/<task branch>`: the branch is named after the task.
   */
  function withPreviewWorktreePath(ran: ClaudeRunManifest, worktreeDir: string): ClaudeRunManifest {
    expect(ran.claudeMd.enabled).toBe(true);
    if (!ran.claudeMd.enabled) return ran;
    const worktree = path.dirname(ran.claudeMd.path);
    expect(path.dirname(worktree)).toBe(worktreeDir);
    return JSON.parse(JSON.stringify(ran).split(worktree).join(path.join(worktreeDir, CLAUDE_RUN_PREVIEW_TASK_BRANCH)));
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

  it("matches a real run on a task in a project on the default: the task's own worktree", async () => {
    const seeded = await seed({ project: {} });
    // The run first: it brings the company's skill library up to date, which a preview reads as is.
    const ran = await runTask(seeded);
    const previewed = await preview(seeded);
    const worktreeDir = path.join(seeded.repo!, ".paperclip", "worktrees");
    expect(previewed.supported && previewed.project).toMatchObject({
      id: seeded.projectId,
      checkout: { kind: "local", path: seeded.repo, worktree: { dir: worktreeDir, baseRef: "main" } },
    });
    expectPreviewMatchesRun(previewed, withPreviewWorktreePath(ran, worktreeDir));
    // The worktree holds the commit: CLAUDE.md and `release`, not the checkout's uncommitted `draft`.
    expect(ran.claudeMd).toEqual({ enabled: true, path: path.join(worktreeDir, "m7-test-task", "CLAUDE.md") });
    expect(ran.repoSkills).toEqual({ enabled: true, dir: path.join(worktreeDir, "m7-test-task", ".claude", "skills"), count: 1 });
    expect(ran.skills.filter((skill) => skill.origin === "repo").map((skill) => skill.name)).toEqual(["release"]);
  }, 90_000);

  it("matches a real run on a task in a project that chose the shared checkout", async () => {
    const seeded = await seed({ project: { executionWorkspacePolicy: SHARED_CHECKOUT } });
    const ran = await runTask(seeded);
    const previewed = await preview(seeded);
    expectPreviewMatchesRun(previewed, ran);
    expect(previewed.supported && previewed.project?.checkout).toEqual({ kind: "local", path: seeded.repo });
    // The checkout's working files, uncommitted `draft` included.
    expect(ran.claudeMd).toEqual({ enabled: true, path: path.join(seeded.repo!, "CLAUDE.md") });
    expect(ran.repoSkills).toMatchObject({ enabled: true, count: 2 });
    expect(ran.skills.filter((skill) => skill.origin === "repo").map((skill) => skill.name)).toEqual(["draft", "release"]);
  }, 90_000);

  it("matches a real run in a task worktree with the project's CLAUDE.md and skills switches off", async () => {
    const seeded = await seed({ project: { agentsReadClaudeMd: false, agentsUseRepoSkills: false } });
    const ran = await runTask(seeded);
    const previewed = await preview(seeded);
    expectPreviewMatchesRun(previewed, ran);
    expect(previewed.supported && previewed.project?.checkout).toMatchObject({ kind: "local", worktree: { baseRef: "main" } });
    expect(ran.claudeMd).toEqual({ enabled: false, reason: "project_switch_off" });
    expect(ran.repoSkills).toEqual({ enabled: false, reason: "project_switch_off" });
  }, 90_000);

  it("says a task worktree's base isn't fetched yet rather than fetching it", async () => {
    const seeded = await seed({ project: { executionWorkspacePolicy: {
      enabled: true, defaultMode: "isolated_workspace", workspaceStrategy: { type: "git_worktree", baseRef: "origin/m7-not-fetched" },
    } } });
    await git(seeded.repo!, "remote", "add", "origin", "https://example.test/m7/not-fetched.git");
    const repoBefore = await listTree(seeded.repo!);
    const previewed = await preview(seeded);
    expect(previewed.supported).toBe(true);
    if (!previewed.supported) return;
    expect(previewed.project?.checkout).toEqual({
      kind: "local", path: seeded.repo, worktree: { dir: path.join(seeded.repo!, ".paperclip", "worktrees"), baseRef: null },
    });
    expect(previewed.manifest.claudeMd).toEqual({ enabled: false, reason: "base_not_fetched" });
    expect(previewed.manifest.repoSkills).toEqual({ enabled: false, reason: "base_not_fetched" });
    // Not the checkout's working files either.
    expect(previewed.manifest.skills.filter((skill) => skill.origin === "repo")).toEqual([]);
    expect(await listTree(seeded.repo!)).toEqual(repoBefore);
  }, 60_000);

  it("writes no files, mints no tokens and writes nothing to the database", async () => {
    const seeded = await seed({ project: {} });
    // The company's skill library, brought up to date as a run (or the Skills page) would.
    await companySkillService(db).listRuntimeSkillEntries(seeded.companyId);
    const instanceRoot = path.join(root, "home");
    const filesBefore = await listTree(instanceRoot);
    // The repo too, `.git` included: no worktree, no `.paperclip` folder, no exclude line.
    const repoBefore = await listTree(seeded.repo!);
    const excludeBefore = await readFile(path.join(seeded.repo!, ".git", "info", "exclude"), "utf8").catch(() => null);
    // A prompt draft for every kind of wake: a task with a comment, and a chat with a message.
    const { taskId, chatId } = await promptTargets(seeded);
    const tokensBefore = { ...minted };
    const [{ xmax: xmaxBefore }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;

    // Nothing in the temp folder either: no temporary HOME, no credential home.
    const { result: previews, left: tempLeft } = await inPrivateTmpdir(root, () => Promise.all([
      preview(seeded),
      preview(seeded, { issueId: taskId, kind: "assignment" }),
      preview(seeded, { issueId: taskId, kind: "comment" }),
      preview(seeded, { issueId: chatId, kind: "chat_turn" }),
    ]));
    const [previewed] = previews;
    expect(previewed.supported).toBe(true);
    if (previewed.supported) {
      expect(previewed.project?.checkout).toMatchObject({ kind: "local", worktree: { baseRef: "main" } });
      expect(previewed.manifest.claudeMd.enabled).toBe(true);
      expect(previewed.manifest.skills.length).toBeGreaterThan(1);
    }
    expect(previews.map((each) => each.supported && each.prompt?.kind)).toEqual(["no_task", "assignment", "comment", "chat_turn"]);

    const [{ xmax: xmaxAfter }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;
    // No transaction id was handed out: nothing was inserted, updated or deleted.
    expect(xmaxAfter).toBe(xmaxBefore);
    expect(await listTree(instanceRoot)).toEqual(filesBefore);
    expect(await listTree(seeded.repo!)).toEqual(repoBefore);
    expect(repoBefore).not.toContain(".paperclip");
    expect(await readFile(path.join(seeded.repo!, ".git", "info", "exclude"), "utf8").catch(() => null)).toBe(excludeBefore);
    expect(tempLeft).toEqual([]);
    expect(minted).toEqual(tokensBefore);

    // The check itself sees a write.
    await db.update(agents).set({ updatedAt: new Date() }).where(sql`${agents.id} = ${seeded.agentId}`);
    const [{ xmax: xmaxWritten }] = (await db.execute(sql`select pg_snapshot_xmax(pg_current_snapshot())::text as xmax`)) as unknown as Array<{ xmax: string }>;
    expect(xmaxWritten).not.toBe(xmaxAfter);
  }, 60_000);

  it("drafts a fresh assignment as the prompt a real run on it sends: system prompt and first message", async () => {
    const seeded = await seed();
    // The company's library, brought up to date as the Skills page would: it holds skills this
    // agent doesn't have, which a run's skill list leaves out.
    const library = await companySkillService(db).listRuntimeSkillEntries(seeded.companyId);
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId: seeded.companyId, title: "M7 test drafted task", description: "Total the March ledger.",
      status: "todo", assigneeAgentId: seeded.agentId, responsibleUserId: seeded.userId,
    });
    // The draft first: the run changes the task (its status, its history).
    const previewed = await preview(seeded, { issueId });
    expect(previewed.supported).toBe(true);
    if (!previewed.supported) return;
    expect(previewed.prompt).toMatchObject({ kind: "assignment", issueId });

    // Assigning the task wakes the agent this way (issue-assignment-wakeup.ts).
    const run = await heartbeat.wakeup(seeded.agentId, {
      source: "assignment", triggerDetail: "system", reason: "issue_assigned",
      payload: { issueId, mutation: "update" }, contextSnapshot: { issueId, source: "issue.update" },
    });
    expect(run).not.toBeNull();
    await vi.waitFor(async () => {
      expect((await heartbeat.getRun(run!.id))?.status).toMatch(/^(succeeded|failed|cancelled|timed_out)$/);
    }, { timeout: 30_000 });
    expect((await heartbeat.getRun(run!.id))?.status).toBe("succeeded");
    expect(captured.prompt).not.toBeNull();
    expect(joinRunPromptSections(previewed.prompt!.firstMessage)).toBe(captured.prompt);

    // The system prompt too: the skill list names what the run's skills are, not the whole library.
    expect(captured.systemPrompt).not.toBeNull();
    expect(previewed.prompt!.systemPrompt).toEqual(captured.systemPrompt);
    const listed = previewed.prompt!.systemPrompt.find((section) => section.id === "skill_library");
    expect(listed).toBeDefined();
    const notTheAgents = library.filter((entry) => !previewed.manifest.skills.some((skill) => skill.key === entry.key));
    expect(notTheAgents.length).toBeGreaterThan(0);
    for (const entry of notTheAgents) expect(listed!.text).not.toContain(`- ${entry.key} —`);
    // The manifest's skills agree with the run's.
    const ran = captured.manifest as unknown as ClaudeRunManifest;
    expect(previewed.manifest.skills).toEqual(ran.skills);
  }, 90_000);

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
