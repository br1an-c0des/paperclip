import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkoutSupportsWorktrees, clearWorktreeDefaultProbeCache, ensureWorktreeParentExcluded, isPaperclipManagedExcludeTail } from "./worktree-default.js";

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let root: string;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-worktree-default-")); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
beforeEach(() => clearWorktreeDefaultProbeCache());

async function repo(name: string) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  git(dir, "init", "--initial-branch=main");
  await fs.writeFile(path.join(dir, "README.md"), "x\n");
  git(dir, "add", "."); git(dir, "commit", "-m", "init");
  return dir;
}

describe("checkoutSupportsWorktrees (step 4b part 3)", () => {
  it("is true for a repository URL and a local git checkout", async () => {
    expect(await checkoutSupportsWorktrees({ repoUrl: "https://github.com/org/repo", cwd: null })).toBe(true);
    expect(await checkoutSupportsWorktrees({ cwd: await repo("probe-git") })).toBe(true);
  });

  it("keeps a folder that isn't a git repository, a missing folder, and no checkout shared", async () => {
    const plain = path.join(root, "plain-folder");
    await fs.mkdir(plain, { recursive: true });
    expect(await checkoutSupportsWorktrees({ cwd: plain, repoUrl: "  " })).toBe(false);
    expect(await checkoutSupportsWorktrees({ cwd: path.join(root, "missing") })).toBe(false);
    expect(await checkoutSupportsWorktrees({ cwd: null, repoUrl: null })).toBe(false);
    expect(await checkoutSupportsWorktrees(null)).toBe(false);
  });

  it("keeps a git repository with no commit yet shared (git worktree add needs a HEAD commit)", async () => {
    const empty = path.join(root, "probe-no-commit");
    await fs.mkdir(empty, { recursive: true });
    git(empty, "init", "--initial-branch=main");
    expect(await checkoutSupportsWorktrees({ cwd: empty })).toBe(false);
    // A subfolder of it too, and once it has a commit (after the probe cache is cleared) it qualifies.
    await fs.mkdir(path.join(empty, "sub"));
    expect(await checkoutSupportsWorktrees({ cwd: path.join(empty, "sub") })).toBe(false);
    await fs.writeFile(path.join(empty, "README.md"), "x\n");
    git(empty, "add", "."); git(empty, "commit", "-m", "first");
    clearWorktreeDefaultProbeCache();
    expect(await checkoutSupportsWorktrees({ cwd: empty })).toBe(true);
  });
});

describe("ensureWorktreeParentExcluded (step 4b part 3)", () => {
  const exclude = (dir: string) => fs.readFile(path.join(dir, ".git", "info", "exclude"), "utf8").catch(() => "");
  const status = (dir: string) => git(dir, "status", "--porcelain", "--untracked-files=all");

  it("adds a parent inside the repository to .git/info/exclude once, never to .gitignore", async () => {
    const dir = await repo("exclude-once");
    const parent = path.join(dir, ".paperclip", "worktrees");
    await fs.mkdir(path.join(parent, "TES-1"), { recursive: true });
    await fs.writeFile(path.join(parent, "TES-1", "file.txt"), "work\n");
    expect(status(dir)).not.toBe("");
    expect(await Promise.all([ensureWorktreeParentExcluded(dir, parent), ensureWorktreeParentExcluded(dir, parent)])).toEqual([true, false]);
    expect(await ensureWorktreeParentExcluded(dir, parent)).toBe(false);
    const lines = (await exclude(dir)).split("\n").filter((line) => line === "/.paperclip/worktrees/");
    expect(lines).toHaveLength(1);
    expect(status(dir)).toBe("");
    await expect(fs.access(path.join(dir, ".gitignore"))).rejects.toThrow();
    // No commit either.
    expect(git(dir, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("needs nothing for a parent outside the repository", async () => {
    const dir = await repo("exclude-outside");
    expect(await ensureWorktreeParentExcluded(dir, path.join(root, "elsewhere", "worktrees"))).toBe(false);
    expect(await exclude(dir)).not.toContain("elsewhere");
  });

  it("leaves a parent that is already ignored alone", async () => {
    const dir = await repo("exclude-ignored");
    await fs.writeFile(path.join(dir, ".gitignore"), ".paperclip/\n");
    const before = await exclude(dir);
    expect(await ensureWorktreeParentExcluded(dir, path.join(dir, ".paperclip", "worktrees"))).toBe(false);
    expect(await exclude(dir)).toBe(before);
  });
});

describe("isPaperclipManagedExcludeTail", () => {
  const fixed = ["\n/.paperclip-repositories/\n"];
  const block = (folder: string) => `# Paperclip task worktrees\n/${folder}/\n`;
  it("accepts nothing, the fixed block and worktree blocks in either order", () => {
    expect(isPaperclipManagedExcludeTail("", fixed)).toBe(true);
    expect(isPaperclipManagedExcludeTail(fixed[0]!, fixed)).toBe(true);
    expect(isPaperclipManagedExcludeTail(block(".paperclip/worktrees") + fixed[0], fixed)).toBe(true);
    expect(isPaperclipManagedExcludeTail(fixed[0] + block("a") + block("b"), fixed)).toBe(true);
  });
  it("rejects custom lines, duplicates and blank lines", () => {
    expect(isPaperclipManagedExcludeTail("private-output/\n", fixed)).toBe(false);
    expect(isPaperclipManagedExcludeTail(fixed[0]! + fixed[0], fixed)).toBe(false);
    expect(isPaperclipManagedExcludeTail(block("a") + block("a"), fixed)).toBe(false);
    expect(isPaperclipManagedExcludeTail(block("a") + "\n", fixed)).toBe(false);
    expect(isPaperclipManagedExcludeTail("# Paperclip task worktrees\nnot-a-folder\n", fixed)).toBe(false);
  });
});
