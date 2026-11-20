import fs from "node:fs/promises";
import path from "node:path";
import type { ClaudeMdLoad } from "@paperclipai/shared";

/**
 * Whether a sealed run loads the repo's root `CLAUDE.md` (fork/step-4b-sealed-runs.md,
 * section 5): through `--add-dir <root>` with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`,
 * when the run's project allows it and its working folder is in a checkout.
 */

async function isPresent(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true).catch(() => false);
}

async function isFile(target: string): Promise<boolean> {
  return fs.stat(target).then((stats) => stats.isFile()).catch(() => false);
}

/**
 * The first folder at `cwd` or above holding a `.git` file or folder, else null. A per-task
 * worktree (`<repo>/.paperclip/worktrees/<branch>`, whose `.git` is a file) is its own root,
 * not the main checkout's.
 */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  let current = path.resolve(cwd);
  for (;;) {
    if (await isPresent(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * In order: no project → `no_project`; switch off → `project_switch_off`; no repo root →
 * `not_in_repo`; no `<root>/CLAUDE.md` → `no_file`; else loaded, with `addDir` the root.
 */
export async function resolveClaudeMdLoad(input: {
  projectId: string | null;
  /** null with a project: an older server, counts as on */
  agentsReadClaudeMd: boolean | null;
  /** findRepoRoot(cwd) */
  repoRoot: string | null;
}): Promise<{ load: ClaudeMdLoad; addDir: string | null }> {
  if (!input.projectId) return { load: { enabled: false, reason: "no_project" }, addDir: null };
  if (input.agentsReadClaudeMd === false) {
    return { load: { enabled: false, reason: "project_switch_off" }, addDir: null };
  }
  if (!input.repoRoot) return { load: { enabled: false, reason: "not_in_repo" }, addDir: null };
  const claudeMdPath = path.join(input.repoRoot, "CLAUDE.md");
  if (!(await isFile(claudeMdPath))) return { load: { enabled: false, reason: "no_file" }, addDir: null };
  return { load: { enabled: true, path: claudeMdPath }, addDir: input.repoRoot };
}
