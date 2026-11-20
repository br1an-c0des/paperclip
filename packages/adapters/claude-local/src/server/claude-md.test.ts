import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepoRoot, resolveClaudeMdLoad } from "./claude-md.js";

describe("the repo CLAUDE.md a run may load", () => {
  let root: string;
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-md-")));
    repo = path.join(root, "repo");
    worktree = path.join(repo, ".paperclip", "worktrees", "b");
    await fs.mkdir(path.join(repo, ".git"), { recursive: true });
    await fs.mkdir(path.join(repo, "src", "deep"), { recursive: true });
    await fs.writeFile(path.join(repo, "CLAUDE.md"), "# main checkout\n");
    await fs.mkdir(path.join(worktree, "packages", "x"), { recursive: true });
    await fs.writeFile(path.join(worktree, ".git"), `gitdir: ${path.join(repo, ".git", "worktrees", "b")}\n`);
    await fs.writeFile(path.join(worktree, "CLAUDE.md"), "# worktree\n");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("findRepoRoot stops at the first .git folder", async () => {
    expect(await findRepoRoot(path.join(repo, "src", "deep"))).toBe(repo);
    expect(await findRepoRoot(repo)).toBe(repo);
  });

  it("findRepoRoot stops at a worktree's .git file, not the main checkout's", async () => {
    expect(await findRepoRoot(path.join(worktree, "packages", "x"))).toBe(worktree);
  });

  it("findRepoRoot is null outside a checkout", async () => {
    const outside = path.join(root, "loose");
    await fs.mkdir(outside);
    // The temp folder is normally in no checkout; where it is, the walk still ends above `root`.
    const found = await findRepoRoot(outside);
    expect(found).toBe(await findRepoRoot(root));
    expect(found === null || !found.startsWith(root)).toBe(true);
  });

  it("no project", async () => {
    expect(await resolveClaudeMdLoad({ projectId: null, agentsReadClaudeMd: true, repoRoot: repo })).toEqual({
      load: { enabled: false, reason: "no_project" },
      addDir: null,
    });
  });

  it("the project switch is off", async () => {
    expect(await resolveClaudeMdLoad({ projectId: "p1", agentsReadClaudeMd: false, repoRoot: repo })).toEqual({
      load: { enabled: false, reason: "project_switch_off" },
      addDir: null,
    });
  });

  it("not in a repo", async () => {
    expect(await resolveClaudeMdLoad({ projectId: "p1", agentsReadClaudeMd: true, repoRoot: null })).toEqual({
      load: { enabled: false, reason: "not_in_repo" },
      addDir: null,
    });
  });

  it("no CLAUDE.md at the root", async () => {
    await fs.rm(path.join(repo, "CLAUDE.md"));
    await fs.mkdir(path.join(repo, "src", "CLAUDE.md-not-here"), { recursive: true });
    expect(await resolveClaudeMdLoad({ projectId: "p1", agentsReadClaudeMd: true, repoRoot: repo })).toEqual({
      load: { enabled: false, reason: "no_file" },
      addDir: null,
    });
  });

  it("loads the root CLAUDE.md; a null switch counts as on", async () => {
    for (const agentsReadClaudeMd of [true, null]) {
      expect(await resolveClaudeMdLoad({ projectId: "p1", agentsReadClaudeMd, repoRoot: repo })).toEqual({
        load: { enabled: true, path: path.join(repo, "CLAUDE.md") },
        addDir: repo,
      });
    }
  });

  it("a run in a per-task worktree loads the worktree's CLAUDE.md", async () => {
    const repoRoot = await findRepoRoot(path.join(worktree, "packages", "x"));
    const result = await resolveClaudeMdLoad({ projectId: "p1", agentsReadClaudeMd: true, repoRoot });
    expect(result).toEqual({ load: { enabled: true, path: path.join(worktree, "CLAUDE.md") }, addDir: worktree });
  });
});
