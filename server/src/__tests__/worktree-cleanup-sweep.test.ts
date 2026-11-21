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
import { executionWorkspaceService, type GitExpirationPass } from "../services/execution-workspaces.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { WORKTREE_KEPT_METADATA_KEY } from "../services/worktree-cleanup.js";

/*
 * Step 4b part 3: upstream's git workspace expiration behind the worktree cleanup setting. The
 * sweep reads the setting each pass (`resolveGitExpiration`), a chosen mode removes for real, and a
 * kept finished worktree records why, which close readiness shows only while cleanup is on.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const exists = (target: string) => fs.lstat(target).then(() => true, () => false);

const external = resolveExternalTestDatabaseUrl("PAPERCLIP_GIT_EXPIRATION_TEST_DATABASE_URL");
const support = external ? { supported: true } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("worktree cleanup setting drives the git expiration sweep", () => {
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

  /** A finished task (closed two days ago) whose isolated worktree is clean and pushed. */
  async function fixture() {
    const companyId = randomUUID(), issueId = randomUUID(), workspaceId = randomUUID();
    const location = path.join(root, companyId), source = path.join(location, "author"), remote = path.join(location, "remote.git");
    await fs.mkdir(source, { recursive: true });
    git(source, "init", "--initial-branch=main");
    await fs.writeFile(path.join(source, "marker.txt"), "commit A\n");
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
      providerType: "local_fs", cwd: workspace.cwd, providerRef: workspace.cwd, repoUrl, baseRef: "origin/main", branchName: workspace.branchName,
      metadata: { createdByRuntime: workspace.branchCreatedByRuntime, gitBranchOwnershipVersion: 1, baseRefSha: workspace.baseRefSha,
        isolatedRemoteSource: { schema: "paperclip.isolated-remote-source.v1", companyId, issueId, repoUrl } } });
    await db.update(issues).set({ executionWorkspaceId: workspaceId }).where(eq(issues.id, issueId));
    const row = () => db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)).then(rows => rows[0]!);
    const commitUnpushed = async () => {
      await fs.writeFile(path.join(workspace.cwd, "work.txt"), "unpushed\n");
      git(workspace.cwd, "add", "."); git(workspace.cwd, "commit", "-m", "Unpushed work");
    };
    // Pushed to its own branch but not merged: the remote can rebuild it, yet the ordinary
    // reaper (which removes merged, clean worktrees whatever the setting) leaves it.
    const commitPushed = async () => {
      await commitUnpushed();
      git(workspace.cwd, "push", "origin", `HEAD:refs/heads/${workspace.branchName}`);
    };
    return { companyId, workspaceId, cwd: workspace.cwd, row, commitUnpushed, commitPushed };
  }

  /** The pass the server builds from the setting (index.ts), with a mutable mode for the test. */
  function settingDriven(state: { mode: "off" | "strict" | "restore_points" }) {
    return async (): Promise<GitExpirationPass> => ({
      enabled: state.mode !== "off",
      dryRun: false,
      mode: state.mode === "off" ? null : state.mode,
      restorePoints: state.mode === "restore_points"
        ? { storage: getStorageService(), terminalDelayMs: DAY_MS, keyDurable: true, idleMs: null }
        : undefined,
    });
  }

  it("runs no expiration while off, then removes for real once strict is chosen, without a restart", async () => {
    const f = await fixture();
    await f.commitPushed();
    const state: { mode: "off" | "strict" | "restore_points" } = { mode: "off" };
    const worker = executionWorkspaceService(db, { resolveGitExpiration: settingDriven(state) });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(f.cwd)).toBe(true);
    expect((await f.row()).metadata?.gitCacheRestoration).toBeUndefined();
    state.mode = "strict";
    const outcome = await worker.sweepTerminalWorkspaces();
    expect(outcome.archived).toBe(1);
    expect(await exists(f.cwd)).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toBeDefined();
    expect((await f.row()).metadata?.[WORKTREE_KEPT_METADATA_KEY]).toBeUndefined();
  });

  it("keeps an unpushed worktree in strict mode, records why, and shows it only while cleanup is on", async () => {
    const f = await fixture();
    await f.commitUnpushed();
    const worker = executionWorkspaceService(db, { resolveGitExpiration: settingDriven({ mode: "strict" }) });
    expect((await worker.sweepTerminalWorkspaces()).archived).toBe(0);
    expect(await exists(f.cwd)).toBe(true);
    expect((await f.row()).metadata?.[WORKTREE_KEPT_METADATA_KEY]).toMatchObject({ reason: "upstream_commit_unverified", mode: "strict" });

    const settings = instanceSettingsService(db);
    await settings.updateExperimental({ worktreeCleanup: "strict" });
    expect((await executionWorkspaceService(db).getCloseReadiness(f.workspaceId))?.worktreeKept)
      .toMatchObject({ reason: "upstream_commit_unverified", label: "branch not pushed", mode: "strict" });
    await settings.updateExperimental({ worktreeCleanup: "off" });
    expect((await executionWorkspaceService(db).getCloseReadiness(f.workspaceId))?.worktreeKept ?? null).toBeNull();
  });

  it("removes an unpushed worktree in restore point mode, saving a restore point first", async () => {
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "31".repeat(32));
    const f = await fixture();
    await f.commitUnpushed();
    const worker = executionWorkspaceService(db, { resolveGitExpiration: settingDriven({ mode: "restore_points" }) });
    expect((await worker.sweepTerminalWorkspaces()).archived).toBe(1);
    expect(await exists(f.cwd)).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toMatchObject({ restorePoint: expect.any(Object) });
  });

  it("leaves upstream's ordinary reaper alone: with cleanup off it still removes a merged, clean worktree", async () => {
    // Not the setting's business: the terminal workspace reaper archives a worktree whose branch is
    // merged into its base and clean, a day after its task tree closes, as upstream always has.
    const f = await fixture();
    const worker = executionWorkspaceService(db, { resolveGitExpiration: settingDriven({ mode: "off" }) });
    await worker.sweepTerminalWorkspaces();
    expect(await exists(f.cwd)).toBe(false);
    expect((await f.row()).metadata?.gitCacheRestoration).toBeUndefined();
  });

  it("falls back to the static options when no resolver is given (upstream's env wiring)", async () => {
    const f = await fixture();
    await f.commitPushed();
    const dry = executionWorkspaceService(db, { gitCacheExpirationEnabled: true, gitCacheExpirationDryRun: true });
    await dry.sweepTerminalWorkspaces();
    expect(await exists(f.cwd)).toBe(true);
  });
});
