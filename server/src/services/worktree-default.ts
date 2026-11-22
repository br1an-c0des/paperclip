import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq } from "drizzle-orm";
import { projectWorkspaces, type Db } from "@paperclipai/db";

/*
 * Step 4b part 3: per-task worktrees are the default for projects with a git checkout
 * (`applyDefaultIsolatedExecutionWorkspacePolicy`), and a worktree's folder is kept out of the
 * repository's `git status`.
 */

const execFile = promisify(execFileCallback);
const GIT_ENV = { ...process.env, LC_ALL: "C" };
const PROBE_TTL_MS = 30_000;
const probeCache = new Map<string, { value: boolean; at: number }>();

function nonBlank(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Test hook: forget cached git probes. */
export function clearWorktreeDefaultProbeCache() {
  probeCache.clear();
}

/**
 * Whether a project checkout can give tasks their own worktree: a repository URL (Paperclip clones
 * it), or a local folder inside a git work tree whose HEAD is a commit (`git worktree add` needs
 * one). A folder that isn't a git repository, or a repository with no commit yet, keeps sharing the
 * checkout, as it did before worktrees were the default.
 */
export async function checkoutSupportsWorktrees(source: { cwd?: string | null; repoUrl?: string | null } | null | undefined): Promise<boolean> {
  if (!source) return false;
  if (nonBlank(source.repoUrl)) return true;
  const cwd = nonBlank(source.cwd);
  if (!cwd) return false;
  const cached = probeCache.get(cwd);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  const git = (...args: string[]) => execFile("git", ["-C", cwd, ...args], { timeout: 10_000, env: GIT_ENV });
  const value = await git("rev-parse", "--is-inside-work-tree")
    .then(async (result) => result.stdout.trim() === "true"
      && Boolean((await git("rev-parse", "--verify", "--quiet", "HEAD^{commit}")).stdout.trim()))
    .catch(() => false);
  if (probeCache.size >= 512) probeCache.delete(probeCache.keys().next().value!);
  probeCache.set(cwd, { value, at: Date.now() });
  return value;
}

/**
 * The checkout a task in this project starts from: the selected project workspace, else the
 * project's primary one (the order the workspace resolvers use), and whether it supports worktrees.
 */
export async function taskCheckoutSupportsWorktrees(db: Db, input: {
  companyId: string;
  projectId?: string | null;
  projectWorkspaceId?: string | null;
}): Promise<boolean> {
  if (!input.projectWorkspaceId && !input.projectId) return false;
  const [source] = await db
    .select({ cwd: projectWorkspaces.cwd, repoUrl: projectWorkspaces.repoUrl })
    .from(projectWorkspaces)
    .where(and(
      eq(projectWorkspaces.companyId, input.companyId),
      input.projectWorkspaceId
        ? eq(projectWorkspaces.id, input.projectWorkspaceId)
        : eq(projectWorkspaces.projectId, input.projectId!),
    ))
    .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
    .limit(1);
  return checkoutSupportsWorktrees(source);
}

/** A gitignore pattern that matches exactly this repository-relative folder. */
function excludePattern(relative: string) {
  const escaped = relative
    .split(path.sep)
    .join("/")
    .replace(/[\\*?[\]!#]/g, (char) => `\\${char}`)
    .replace(/ $/, "\\ ");
  return `/${escaped}/`;
}

const WORKTREE_EXCLUDE_COMMENT = "# Paperclip task worktrees";

/**
 * Whether what follows a stock `.git/info/exclude` is exactly what Paperclip appended to it: the
 * given fixed blocks, byte for byte and each at most once (such as `\n/.paperclip-repositories/\n`),
 * and the task worktree blocks `ensureWorktreeParentExcluded` writes, each folder at most once.
 * Anything else, a duplicate or a blank line included, is custom. Git workspace expiration uses it
 * to tell a reproducible base from one with custom metadata.
 */
export function isPaperclipManagedExcludeTail(tail: string, fixedBlocks: readonly string[]): boolean {
  const usedFixed = new Set<string>();
  const usedFolders = new Set<string>();
  const worktreeBlock = new RegExp(`^${WORKTREE_EXCLUDE_COMMENT}\\n(/[^\\n]+/)\\n`);
  let rest = tail;
  while (rest.length > 0) {
    const fixed = fixedBlocks.find((block) => !usedFixed.has(block) && rest.startsWith(block));
    if (fixed) {
      usedFixed.add(fixed);
      rest = rest.slice(fixed.length);
      continue;
    }
    const match = worktreeBlock.exec(rest);
    if (!match || usedFolders.has(match[1]!)) return false;
    usedFolders.add(match[1]!);
    rest = rest.slice(match[0].length);
  }
  return true;
}

const excludeLocks = new Map<string, Promise<void>>();

/**
 * Keep a worktree parent folder that sits inside the repository out of `git status`, by adding it
 * to the repository's `.git/info/exclude` once. Never the repository's `.gitignore`, never a commit.
 * A parent outside the repository, or one already ignored, needs nothing. Best effort: a failure
 * leaves the folder showing as untracked, nothing worse.
 */
export async function ensureWorktreeParentExcluded(repoRoot: string, worktreeParentDir: string): Promise<boolean> {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(worktreeParentDir));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const previous = excludeLocks.get(repoRoot) ?? Promise.resolve();
  let added = false;
  const turn = previous.then(async () => {
    try {
      const ignored = await execFile("git", ["-C", repoRoot, "check-ignore", "-q", "--no-index", `${relative.split(path.sep).join("/")}/`], { timeout: 10_000, env: GIT_ENV })
        .then(() => true)
        .catch(() => false);
      if (ignored) return;
      const result = await execFile("git", ["-C", repoRoot, "rev-parse", "--git-path", "info/exclude"], { timeout: 10_000, env: GIT_ENV });
      const excludePath = path.resolve(repoRoot, result.stdout.trim());
      const pattern = excludePattern(relative);
      const current = await fs.readFile(excludePath, "utf8").catch(() => "");
      if (current.split(/\r?\n/).includes(pattern)) return;
      await fs.mkdir(path.dirname(excludePath), { recursive: true });
      const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
      await fs.appendFile(excludePath, `${separator}${WORKTREE_EXCLUDE_COMMENT}\n${pattern}\n`);
      added = true;
    } catch {
      // Best effort.
    }
  });
  const settled = turn.finally(() => {
    if (excludeLocks.get(repoRoot) === settled) excludeLocks.delete(repoRoot);
  });
  excludeLocks.set(repoRoot, settled);
  await settled;
  return added;
}
