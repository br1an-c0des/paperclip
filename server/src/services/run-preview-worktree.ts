import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Db } from "@paperclipai/db";
import { CLAUDE_RUN_PREVIEW_TASK_BRANCH, type ClaudeRunPreviewTaskWorktree } from "@paperclipai/shared";
import type { AdapterRunPreviewRepoView } from "@paperclipai/adapter-utils";
import { asString, parseObject } from "../adapters/utils.js";
import { resolveHomeAwarePath } from "../home-paths.js";
import {
  applyDefaultIsolatedExecutionWorkspacePolicy,
  buildExecutionWorkspaceAdapterConfig,
  resolveEffectiveWorkspaceStrategyType,
  resolveExecutionWorkspaceMode,
} from "./execution-workspace-policy.js";
import { effectiveProjectWorkspacePolicy } from "./project-workspace-provider.js";
import { checkoutSupportsWorktrees } from "./worktree-default.js";

/*
 * The run preview's view of a task worktree (step 4b part 3 made one the default for a project
 * whose checkout is a git repository). A new task's first run makes the worktree with
 * `git worktree add` from a base commit, so it holds what's committed there, not the checkout's
 * working files. The preview works out the same policy, folder and base as the run does, and
 * reads `CLAUDE.md` and `.claude/skills/<name>/SKILL.md` from that commit with read-only git
 * commands. It never fetches, makes a folder, or touches `.git/info/exclude`.
 *
 * Mirrors, without their side effects: the heartbeat's policy chain (`effectiveProjectWorkspacePolicy`,
 * `applyDefaultIsolatedExecutionWorkspacePolicy`, `resolveExecutionWorkspaceMode`,
 * `buildExecutionWorkspaceAdapterConfig`), and workspace-runtime.ts's `resolveGitOwnerRepoRoot`,
 * worktree folder (`worktreeParentDir`, else `<repo>/.paperclip/worktrees`) and
 * `resolveAuthoritativeBaseRef` with every fetch left out.
 */

const execFile = promisify(execFileCallback);
const GIT_ENV = { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };

async function git(cwd: string, args: string[]): Promise<string | null> {
  return execFile("git", ["-C", cwd, ...args], { timeout: 10_000, env: GIT_ENV, maxBuffer: 8 * 1024 * 1024 })
    .then((result) => result.stdout)
    .catch(() => null);
}

async function resolvesToCommit(repoRoot: string, ref: string): Promise<boolean> {
  return (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) !== null;
}

/** workspace-runtime.ts `parseRemoteTrackingRef`: the `remote/branch` shape only. */
function remoteTrackingShape(ref: string): { remote: string } | null {
  const normalized = ref.startsWith("refs/remotes/") ? ref.slice("refs/remotes/".length) : ref;
  const slash = normalized.indexOf("/");
  if (slash <= 0 || slash === normalized.length - 1) return null;
  const remote = normalized.slice(0, slash);
  return /^[A-Za-z0-9._-]+$/.test(remote) ? { remote } : null;
}

/** workspace-runtime.ts `resolveGitOwnerRepoRoot`: the main checkout, also from inside one of its worktrees. */
async function ownerRepoRoot(cwd: string): Promise<string | null> {
  const top = (await git(cwd, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top) return null;
  const checkoutRoot = await fs.realpath(path.resolve(top)).catch(() => null);
  if (!checkoutRoot) return null;
  const commonDirRaw = (await git(checkoutRoot, ["rev-parse", "--git-common-dir"]))?.trim();
  if (!commonDirRaw) return checkoutRoot;
  const commonDir = await fs.realpath(path.resolve(checkoutRoot, commonDirRaw)).catch(() => null);
  if (!commonDir) return checkoutRoot;
  const candidate = path.dirname(commonDir);
  const [candidateTop, candidateGitDir, candidateCommonDir] = await Promise.all([
    git(candidate, ["rev-parse", "--show-toplevel"]),
    git(candidate, ["rev-parse", "--absolute-git-dir"]),
    git(candidate, ["rev-parse", "--git-common-dir"]),
  ]);
  if (!candidateTop || !candidateGitDir || !candidateCommonDir) return checkoutRoot;
  const [candidateRoot, gitDir, common] = await Promise.all([
    fs.realpath(path.resolve(candidateTop.trim())).catch(() => null),
    fs.realpath(path.resolve(candidate, candidateGitDir.trim())).catch(() => null),
    fs.realpath(path.resolve(candidate, candidateCommonDir.trim())).catch(() => null),
  ]);
  return candidateRoot === candidate && gitDir === commonDir && common === commonDir ? candidateRoot : checkoutRoot;
}

/**
 * workspace-runtime.ts `resolveAuthoritativeBaseRef`, with nothing fetched: the ref the run
 * would base the worktree on, as of the checkout's last fetch, or null when the run would have
 * to fetch it first.
 */
async function previewBaseRef(repoRoot: string, configuredBaseRef: string | null): Promise<string | null> {
  const configured = configuredBaseRef?.trim();
  if (!configured || configured === "HEAD") {
    if (await resolvesToCommit(repoRoot, "origin/master")) return "origin/master";
    const remoteHead = (await git(repoRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]))?.trim();
    if (remoteHead && await resolvesToCommit(repoRoot, remoteHead)) return remoteHead;
    for (const candidate of ["origin/master", "origin/main", "main", "master"]) {
      if (await resolvesToCommit(repoRoot, candidate)) return candidate;
    }
    return await resolvesToCommit(repoRoot, "HEAD") ? "HEAD" : null;
  }
  const remoteTracking = remoteTrackingShape(configured);
  if (remoteTracking && await resolvesToCommit(repoRoot, configured)) return configured;
  if (remoteTracking && (await git(repoRoot, ["remote", "get-url", remoteTracking.remote])) !== null) return null;
  if ((await git(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${configured}`])) !== null) {
    return await resolvesToCommit(repoRoot, `origin/${configured}`) ? `origin/${configured}` : configured;
  }
  if (await resolvesToCommit(repoRoot, configured)) return configured;
  return await resolvesToCommit(repoRoot, `origin/${configured}`) ? `origin/${configured}` : null;
}

/**
 * What a commit holds of what a sealed run reads: a root `CLAUDE.md` and
 * `.claude/skills/<name>/SKILL.md`. A symlinked skill folder isn't followed (the run's folder
 * listing would follow it), and a symlinked `CLAUDE.md` counts as a file.
 */
async function repoFilesAt(repoRoot: string, ref: string): Promise<{ claudeMd: boolean; skillNames: string[] }> {
  const rootEntry = await git(repoRoot, ["ls-tree", "-z", ref, "--", "CLAUDE.md"]);
  const claudeMd = Boolean(rootEntry && /^\d+ blob /.test(rootEntry));
  const listed = (await git(repoRoot, ["ls-tree", "-r", "-z", "--name-only", ref, "--", ".claude/skills"])) ?? "";
  const skillNames = listed
    .split("\0")
    .map((entry) => /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(entry)?.[1])
    .filter((name): name is string => Boolean(name));
  return { claudeMd, skillNames };
}

export interface PreviewedTaskWorktree {
  /** For the preview's `checkout.worktree`. */
  worktree: ClaudeRunPreviewTaskWorktree;
  /** Where the worktree will be, with `CLAUDE_RUN_PREVIEW_TASK_BRANCH` for the task's branch. */
  path: string;
  branchName: string;
  /** What the base commit holds, for the adapter; nothing when the base isn't fetched yet (`worktree.baseRef` null). */
  repoView: AdapterRunPreviewRepoView;
}

/**
 * Whether a new task in this project would get its own worktree of the checkout at `checkoutPath`,
 * and if so where and with what. Null when tasks work in the checkout itself: a project that
 * chose the shared checkout, or a checkout that isn't a git repository.
 */
export async function previewTaskWorktree(db: Db, input: {
  companyId: string;
  agentConfig: Record<string, unknown>;
  projectPolicy: unknown;
  checkoutPath: string;
  workspace: { cwd: string | null; repoUrl: string | null; repoRef: string | null };
  /** Whether any of the project's workspaces has a repo URL (the heartbeat's `hasGitSource`). */
  hasGitSource: boolean;
}): Promise<PreviewedTaskWorktree | null> {
  const projectPolicy = applyDefaultIsolatedExecutionWorkspacePolicy({
    projectPolicy: await effectiveProjectWorkspacePolicy(db, input.companyId, input.projectPolicy, input.hasGitSource),
    defaultIsolatedWorkspacesEnabled: await checkoutSupportsWorktrees(input.workspace),
    hasProjectWorkspace: true,
  });
  const mode = resolveExecutionWorkspaceMode({ projectPolicy, issueSettings: null, legacyUseProjectWorkspace: null });
  const config = buildExecutionWorkspaceAdapterConfig({
    agentConfig: input.agentConfig, projectPolicy, issueSettings: null, mode, legacyUseProjectWorkspace: null,
  });
  if (resolveEffectiveWorkspaceStrategyType(mode, config) !== "git_worktree") return null;

  const repoRoot = await ownerRepoRoot(input.checkoutPath);
  if (!repoRoot) return null;
  const strategy = parseObject(config.workspaceStrategy);
  const configuredParentDir = asString(strategy.worktreeParentDir, "");
  const dir = !configuredParentDir
    ? path.join(repoRoot, ".paperclip", "worktrees")
    : path.isAbsolute(configuredParentDir) || configuredParentDir.startsWith("~")
      ? resolveHomeAwarePath(configuredParentDir)
      : path.resolve(repoRoot, configuredParentDir);
  // An exact-branch worktree is named after its branch, and starts from that branch's tip.
  const existingBranch = asString(strategy.existingBranch, "").trim() || null;
  const branchName = existingBranch ?? CLAUDE_RUN_PREVIEW_TASK_BRANCH;
  const baseRef = existingBranch
    ? (await resolvesToCommit(repoRoot, `refs/heads/${existingBranch}`) ? existingBranch : null)
    : await previewBaseRef(repoRoot, asString(strategy.baseRef, "") || input.workspace.repoRef);
  const worktreePath = path.join(dir, branchName);
  return {
    worktree: { dir, baseRef },
    path: worktreePath,
    branchName,
    repoView: { root: worktreePath, ...(baseRef ? await repoFilesAt(repoRoot, baseRef) : { claudeMd: false, skillNames: [] }) },
  };
}
