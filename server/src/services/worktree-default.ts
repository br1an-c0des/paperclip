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
 * it), or a local folder inside a git work tree. A folder that isn't a git repository keeps sharing
 * the checkout, as it did before worktrees were the default.
 */
export async function checkoutSupportsWorktrees(source: { cwd?: string | null; repoUrl?: string | null } | null | undefined): Promise<boolean> {
  if (!source) return false;
  if (nonBlank(source.repoUrl)) return true;
  const cwd = nonBlank(source.cwd);
  if (!cwd) return false;
  const cached = probeCache.get(cwd);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  const value = await execFile("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], { timeout: 10_000, env: GIT_ENV })
    .then((result) => result.stdout.trim() === "true")
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
 * Whether the lines Paperclip appended to a stock `.git/info/exclude` are only its own: the given
 * fixed lines (such as `/.paperclip-repositories/`) and task worktree folder entries, each the
 * line after the comment `ensureWorktreeParentExcluded` writes. Git workspace expiration uses it to
 * tell a reproducible base from one with custom metadata.
 */
export function isPaperclipManagedExcludeTail(tail: string, fixedLines: readonly string[]): boolean {
  const lines = tail.split(/\r?\n/).filter((line) => line.length > 0);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fixedLines.includes(line)) continue;
    if (line !== WORKTREE_EXCLUDE_COMMENT) return false;
    const pattern = lines[index + 1];
    if (!pattern || !pattern.startsWith("/") || !pattern.endsWith("/")) return false;
    index += 1;
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
