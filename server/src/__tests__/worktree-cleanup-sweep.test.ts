import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { companies, issues, executionWorkspaces, instanceSettings, createDb, applyPendingMigrations, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { getStorageService } from "../storage/index.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { materializeIsolatedRemoteWorkspaceSource } from "../services/isolated-remote-workspace-source.js";
import { realizeExecutionWorkspace } from "../services/workspace-runtime.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  WORKTREE_KEPT_METADATA_KEY,
  resolveWorktreeCleanup,
  worktreeSweepRules,
  type SavedWorktreeCleanup,
  type WorktreeCleanupConfig,
} from "../services/worktree-cleanup.js";

/*
 * Step 4b part 3: the worktree cleanup setting governs what the terminal workspace reaper does to
 * task worktrees: the merged-and-clean archive, compaction and git workspace expiration. The reaper
 * reads it each pass (`resolveWorktreeCleanup`), a chosen level runs for real, a kept finished
 * worktree records why (shown only while expiration runs), and a setting never saved keeps the
 * environment's rules.
 */

/** The environment's defaults, as `server/src/config.ts` reads them with no variables set. */
const cleanupConfig = (patch: Partial<WorktreeCleanupConfig> = {}): WorktreeCleanupConfig => ({
  gitCacheExpirationEnabled: false, gitCacheExpirationDryRun: true, gitRestorePointsEnabled: false, storageProvider: "local_disk",
  gitRestorePointTerminalDelayDays: 3, gitRestorePointIdleDays: 7, gitRestorePointRetentionDays: 90,
  workspaceReaperCooldownDays: 1, workspaceCompactionDelayHours: 1, ...patch,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const exists = (target: string) => fs.lstat(target).then(() => true, () => false);

const external = resolveExternalTestDatabaseUrl("PAPERCLIP_GIT_EXPIRATION_TEST_DATABASE_URL");
const support = external ? { supported: true } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("worktree cleanup setting drives the terminal workspace reaper", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let root: string;
  const previousHome = process.env.PAPERCLIP_HOME;
  const previousInstance = process.env.PAPERCLIP_INSTANCE_ID;
  beforeAll(async () => {
    if (external) await applyPendingMigrations(external);
    else database = await startEmbeddedPostgresTestDatabase("worktree-cleanup-sweep-");
    db = createDb(external ?? database.connectionString);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-worktree-cleanup-"));
    process.env.PAPERCLIP_HOME = path.join(root, "home");
    process.env.PAPERCLIP_INSTANCE_ID = "default";
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
    await db.delete(instanceSettings);
  });
  afterAll(async () => {
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = previousHome;
    if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID; else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
    await db.$client.end({ timeout: 1 }); await database?.cleanup(); await fs.rm(root, { recursive: true, force: true });
  });

  /** A finished task (closed two days ago) whose isolated worktree is clean and merged (it has no commits of its own). */
  async function fixture(options: { providerType?: "local_fs" | "git_worktree" } = {}) {
    const companyId = randomUUID(), issueId = randomUUID(), workspaceId = randomUUID();
    const location = path.join(root, companyId), source = path.join(location, "author"), remote = path.join(location, "remote.git");
    await fs.mkdir(source, { recursive: true });
    git(source, "init", "--initial-branch=main");
    await fs.writeFile(path.join(source, "marker.txt"), "commit A\n");
    // Ignored, so compaction may remove it.
    await fs.writeFile(path.join(source, ".gitignore"), "node_modules/\n");
    git(source, "add", "."); git(source, "commit", "-m", "A");
    git(location, "clone", "--bare", source, remote); git(source, "remote", "add", "origin", remote);
    await db.insert(companies).values({ id: companyId, name: "Worktree cleanup fixture", issuePrefix: `WC${companyId.slice(0, 6)}` });
    await db.insert(issues).values({ id: issueId, companyId, title: "Finished task", status: "done", completedAt: new Date(Date.now() - 2 * DAY_MS) });
    const repoUrl = pathToFileURL(remote).href;
    const baseCwd = await materializeIsolatedRemoteWorkspaceSource({ companyId, issueId, repoUrl, resolveGitAuth: async () => null });
    const workspace = await realizeExecutionWorkspace({
      base: { baseCwd, source: "task_session", projectId: null, workspaceId: null, repoUrl, repoRef: "origin/main" },
      issue: { id: issueId, identifier: "WC-1", title: "Fixture" }, agent: { id: null, name: "Fixture", companyId },
      config: { workspaceStrategy: { type: "git_worktree", branchTemplate: "fixture-task", worktreeParentDir: path.join(location, "worktrees"), baseRef: "origin/main" } },
      skipHostProvision: true,
    });
    await db.insert(executionWorkspaces).values({ id: workspaceId, companyId, sourceIssueId: issueId, mode: "isolated_workspace", strategyType: "git_worktree", name: "Fixture", status: "active",
      providerType: options.providerType ?? "local_fs", cwd: workspace.cwd, providerRef: workspace.cwd, repoUrl, baseRef: "origin/main", branchName: workspace.branchName,
      metadata: { createdByRuntime: workspace.branchCreatedByRuntime, gitBranchOwnershipVersion: 1, baseRefSha: workspace.baseRefSha,
        isolatedRemoteSource: { schema: "paperclip.isolated-remote-source.v1", companyId, issueId, repoUrl } } });
    await db.update(issues).set({ executionWorkspaceId: workspaceId }).where(eq(issues.id, issueId));
    const row = () => db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)).then(rows => rows[0]!);
    const commitUnpushed = async () => {
      await fs.writeFile(path.join(workspace.cwd, "work.txt"), "unpushed\n");
      git(workspace.cwd, "add", "."); git(workspace.cwd, "commit", "-m", "Unpushed work");
    };
    // Pushed to its own branch but not merged: the remote can rebuild it, yet the archive (which
    // needs the work merged) leaves it.
    const commitPushed = async () => {
      await commitUnpushed();
      git(workspace.cwd, "push", "origin", `HEAD:refs/heads/${workspace.branchName}`);
    };
    return { companyId, workspaceId, cwd: workspace.cwd, row, commitUnpushed, commitPushed };
  }

  /** The rules the server builds from the setting each pass (index.ts), from a mutable saved setting. */
  function settingDriven(state: { saved: SavedWorktreeCleanup | null }, env: Partial<WorktreeCleanupConfig> = {}) {
    return async () => worktreeSweepRules(resolveWorktreeCleanup(state.saved, cleanupConfig(env)),
      { storage: getStorageService(), keyDurable: true });
  }
  const level = (mode: SavedWorktreeCleanup["worktreeCleanup"], patch: Partial<SavedWorktreeCleanup> = {}) => ({ worktreeCleanup: mode, ...patch });
  const nodeModules = (cwd: string) => path.join(cwd, "node_modules");
  async function addBuildOutput(cwd: string) {
    await fs.mkdir(nodeModules(cwd), { recursive: true });
    await fs.writeFile(path.join(nodeModules(cwd), "dep.js"), "regenerable\n");
  }

  it("off leaves every task worktree alone: merged and clean, pushed, and compactable", async () => {
    const merged = await fixture();
    const pushed = await fixture();
    await pushed.commitPushed();
    const compactable = await fixture({ providerType: "git_worktree" });
    await compactable.commitPushed();
    await addBuildOutput(compactable.cwd);
    const worker = executionWorkspaceService(db, { resolveWorktreeCleanup: settingDriven({ saved: level("off") }) });
    const outcome = await worker.sweepTerminalWorkspaces();
    expect(outcome).toMatchObject({ archived: 0, compacted: 0 });
    for (const f of [merged, pushed, compactable]) expect(await exists(f.cwd)).toBe(true);
    expect(await exists(nodeModules(compactable.cwd))).toBe(true);
    expect((await merged.row()).status).toBe("active");
  });

  it("merged work only archives a merged, clean worktree and compacts, but expires nothing", async () => {
    const merged = await fixture();
    const pushed = await fixture({ providerType: "git_worktree" });
    await pushed.commitPushed();
    await addBuildOutput(pushed.cwd);
    const worker = executionWorkspaceService(db, { resolveWorktreeCleanup: settingDriven({ saved: level("merged") }) });
    const outcome = await worker.sweepTerminalWorkspaces();
    expect(outcome.compacted).toBe(1);
    expect(await exists(merged.cwd)).toBe(false);
    expect(await exists(pushed.cwd)).toBe(true);
    expect(await exists(nodeModules(pushed.cwd))).toBe(false);
    expect((await pushed.row()).metadata?.gitCacheRestoration).toBeUndefined();
  });

  it("merged or pushed removes a pushed worktree, keeps an unpushed one and says why", async () => {
    const pushed = await fixture();
    await pushed.commitPushed();
    const unpushed = await fixture();
    await unpushed.commitUnpushed();
    const worker = executionWorkspaceService(db, { resolveWorktreeCleanup: settingDriven({ saved: level("strict") }) });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(pushed.cwd)).toBe(false);
    expect((await pushed.row()).metadata?.gitCacheRestoration).toBeDefined();
    expect(await exists(unpushed.cwd)).toBe(true);
    expect((await unpushed.row()).metadata?.[WORKTREE_KEPT_METADATA_KEY]).toMatchObject({ reason: "upstream_commit_unverified", mode: "strict" });

    const settings = instanceSettingsService(db);
    await settings.updateExperimental({ worktreeCleanup: "strict" });
    expect((await executionWorkspaceService(db).getCloseReadiness(unpushed.workspaceId))?.worktreeKept)
      .toMatchObject({ reason: "upstream_commit_unverified", label: "branch not pushed", mode: "strict" });
    for (const hidden of ["merged", "off"] as const) {
      await settings.updateExperimental({ worktreeCleanup: hidden });
      expect((await executionWorkspaceService(db).getCloseReadiness(unpushed.workspaceId))?.worktreeKept ?? null).toBeNull();
    }
  });

  it("everything, with restore points, removes an unpushed worktree after saving a restore point", async () => {
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "31".repeat(32));
    const f = await fixture();
    await f.commitUnpushed();
    const worker = executionWorkspaceService(db, { resolveWorktreeCleanup: settingDriven({ saved: level("restore_points", { worktreeRestorePointAfterDays: 1 }) }) });
    expect((await worker.sweepTerminalWorkspaces()).archived).toBe(1);
    expect(await exists(f.cwd)).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ restorePoint: expect.any(Object) });
  });

  it("the wait and compaction settings take effect on the next pass, without a restart", async () => {
    // Each fixture's task closed two days ago.
    const merged = await fixture();
    const pushed = await fixture({ providerType: "git_worktree" });
    await pushed.commitPushed();
    await addBuildOutput(pushed.cwd);
    const state: { saved: SavedWorktreeCleanup | null } = {
      saved: level("strict", { worktreeCleanupWaitDays: 3, worktreeCleanupRemoveBuildOutput: false }),
    };
    const worker = executionWorkspaceService(db, { resolveWorktreeCleanup: settingDriven(state) });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(merged.cwd)).toBe(true);
    expect(await exists(pushed.cwd)).toBe(true);
    expect(await exists(nodeModules(pushed.cwd))).toBe(true);
    // Compaction on, still inside the 3-day wait: build output goes, the worktrees stay.
    state.saved = level("strict", { worktreeCleanupWaitDays: 3, worktreeCleanupRemoveBuildOutput: true });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(nodeModules(pushed.cwd))).toBe(false);
    expect(await exists(merged.cwd)).toBe(true);
    expect(await exists(pushed.cwd)).toBe(true);
    // A 1-day wait: the archive and strict expiration (which follows the wait) both run.
    state.saved = level("strict", { worktreeCleanupWaitDays: 1 });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(merged.cwd)).toBe(false);
    expect(await exists(pushed.cwd)).toBe(false);
  });

  it("never saved, it keeps the environment's rules: the archive and compaction run as upstream's do", async () => {
    const merged = await fixture();
    const pushed = await fixture({ providerType: "git_worktree" });
    await pushed.commitPushed();
    await addBuildOutput(pushed.cwd);
    const worker = executionWorkspaceService(db, { resolveWorktreeCleanup: settingDriven({ saved: null }) });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(merged.cwd)).toBe(false);
    expect(await exists(nodeModules(pushed.cwd))).toBe(false);
    // Expiration stays off unless PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED says otherwise.
    expect(await exists(pushed.cwd)).toBe(true);
    expect((await pushed.row()).metadata?.gitCacheRestoration).toBeUndefined();
  });

  it("never saved with expiration enabled in the environment, it keeps the environment's dry run", async () => {
    const f = await fixture();
    await f.commitPushed();
    const worker = executionWorkspaceService(db, {
      resolveWorktreeCleanup: settingDriven({ saved: null }, { gitCacheExpirationEnabled: true, gitCacheExpirationDryRun: true }),
    });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(f.cwd)).toBe(true);
    expect((await f.row()).metadata?.[WORKTREE_KEPT_METADATA_KEY]).toBeUndefined();
  });

  it("falls back to the static options when no resolver is given (upstream's env wiring)", async () => {
    const f = await fixture();
    await f.commitPushed();
    const dry = executionWorkspaceService(db, { gitCacheExpirationEnabled: true, gitCacheExpirationDryRun: true });
    await dry.sweepTerminalWorkspaces();
    expect(await exists(f.cwd)).toBe(true);
  });
});
