import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "./claude-md.js";
import {
  prepareRepoSkillsPlugin,
  removeRunPluginsDir,
  resolveRepoSkills,
  resolveRunPluginsDir,
} from "./repo-skills.js";

async function writeSkill(skillsDir: string, name: string): Promise<void> {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(path.join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
}

async function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true).catch(() => false);
}

describe("the repo's skills a run may load", () => {
  let root: string;
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-repo-skills-")));
    repo = path.join(root, "repo");
    worktree = path.join(repo, ".paperclip", "worktrees", "b");
    await fs.mkdir(path.join(repo, ".git"), { recursive: true });
    await fs.writeFile(path.join(repo, "CLAUDE.md"), "# main\n");
    await writeSkill(path.join(repo, ".claude", "skills"), "a");
    await fs.mkdir(path.join(worktree, "src"), { recursive: true });
    await fs.writeFile(path.join(worktree, ".git"), "gitdir: ../../../.git/worktrees/b\n");
    await fs.writeFile(path.join(worktree, "CLAUDE.md"), "# worktree\n");
    await writeSkill(path.join(worktree, ".claude", "skills"), "b");
    await writeSkill(path.join(worktree, ".claude", "skills"), "a");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("no project", async () => {
    expect(await resolveRepoSkills({ projectId: null, agentsUseRepoSkills: true, repoRoot: repo })).toEqual({
      load: { enabled: false, reason: "no_project" },
      skills: [],
    });
  });

  it("the project switch is off", async () => {
    expect(await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: false, repoRoot: repo })).toEqual({
      load: { enabled: false, reason: "project_switch_off" },
      skills: [],
    });
  });

  it("not in a repo", async () => {
    expect(await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: true, repoRoot: null })).toEqual({
      load: { enabled: false, reason: "not_in_repo" },
      skills: [],
    });
  });

  it("no skills: no folder, or only subfolders without SKILL.md", async () => {
    const bare = path.join(root, "bare");
    await fs.mkdir(path.join(bare, ".git"), { recursive: true });
    expect((await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: true, repoRoot: bare })).load).toEqual({
      enabled: false,
      reason: "no_skills",
    });
    await fs.mkdir(path.join(bare, ".claude", "skills", "empty"), { recursive: true });
    await fs.writeFile(path.join(bare, ".claude", "skills", "README.md"), "not a skill");
    expect((await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: true, repoRoot: bare })).load).toEqual({
      enabled: false,
      reason: "no_skills",
    });
  });

  it("loads the skills sorted, skipping folders without SKILL.md; a null switch counts as on", async () => {
    const skillsDir = path.join(repo, ".claude", "skills");
    await writeSkill(path.join(root, "elsewhere"), "linked");
    await fs.symlink(path.join(root, "elsewhere", "linked"), path.join(skillsDir, "linked"));
    await fs.mkdir(path.join(skillsDir, "no-skill-file"));
    for (const agentsUseRepoSkills of [true, null]) {
      expect(await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills, repoRoot: repo })).toEqual({
        load: { enabled: true, dir: skillsDir, count: 2 },
        skills: [
          { name: "a", dir: path.join(skillsDir, "a") },
          { name: "linked", dir: path.join(skillsDir, "linked") },
        ],
      });
    }
  });

  it("a run in a per-task worktree gets the worktree's skills; the main checkout only its own", async () => {
    const fromWorktree = await resolveRepoSkills({
      projectId: "p1",
      agentsUseRepoSkills: true,
      repoRoot: await findRepoRoot(path.join(worktree, "src")),
    });
    const worktreeSkills = path.join(worktree, ".claude", "skills");
    expect(fromWorktree.skills).toEqual([
      { name: "a", dir: path.join(worktreeSkills, "a") },
      { name: "b", dir: path.join(worktreeSkills, "b") },
    ]);

    const fromMain = await resolveRepoSkills({
      projectId: "p1",
      agentsUseRepoSkills: true,
      repoRoot: await findRepoRoot(repo),
    });
    expect(fromMain.skills).toEqual([{ name: "a", dir: path.join(repo, ".claude", "skills", "a") }]);
  });

  it("resolveRunPluginsDir is in the agent's folder", () => {
    const env = { PAPERCLIP_HOME: path.join(root, "home"), PAPERCLIP_INSTANCE_ID: "inst" };
    const dir = resolveRunPluginsDir(env, "company-1", "agent-1", "run-1");
    expect(dir.startsWith(path.join(root, "home"))).toBe(true);
    expect(dir.endsWith(path.join("companies", "company-1", "agents", "agent-1", "claude-run-plugins", "run-1"))).toBe(true);
  });

  it("builds one project plugin per run; removing one leaves the other", async () => {
    const env = { PAPERCLIP_HOME: path.join(root, "home"), PAPERCLIP_INSTANCE_ID: "inst" };
    const mainSkills = (await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: true, repoRoot: repo })).skills;
    const worktreeSkills = (await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: true, repoRoot: worktree })).skills;
    const runA = resolveRunPluginsDir(env, "company-1", "agent-1", "run-a");
    const runB = resolveRunPluginsDir(env, "company-1", "agent-1", "run-b");

    const [dirA, dirB] = await Promise.all([
      prepareRepoSkillsPlugin({ runPluginsDir: runA, repoRoot: repo, skills: mainSkills }),
      prepareRepoSkillsPlugin({ runPluginsDir: runB, repoRoot: worktree, skills: worktreeSkills }),
    ]);
    expect(dirA).toBe(runA);
    expect(dirB).toBe(runB);

    const manifest = JSON.parse(await fs.readFile(path.join(runA, "project", ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest).toEqual({
      name: "project",
      description: `Skills from this project's repository (${path.join(repo, ".claude", "skills")})`,
    });
    expect((await fs.readdir(path.join(runA, "project", "skills"))).sort()).toEqual(["a"]);
    expect((await fs.readdir(path.join(runB, "project", "skills"))).sort()).toEqual(["a", "b"]);
    const linkA = path.join(runA, "project", "skills", "a");
    expect((await fs.lstat(linkA)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(linkA)).toBe(path.join(repo, ".claude", "skills", "a"));
    expect(await fs.realpath(path.join(runB, "project", "skills", "a"))).toBe(path.join(worktree, ".claude", "skills", "a"));

    await removeRunPluginsDir(runA);
    expect(await exists(runA)).toBe(false);
    expect((await fs.readdir(path.join(runB, "project", "skills"))).sort()).toEqual(["a", "b"]);
    // Removing the links leaves the repo's skills alone.
    expect(await exists(path.join(repo, ".claude", "skills", "a", "SKILL.md"))).toBe(true);

    await removeRunPluginsDir(runA);
    await removeRunPluginsDir(runB);
    expect(await exists(runB)).toBe(false);
  });

  it("preparing a run's plugin again replaces it", async () => {
    const runPluginsDir = path.join(root, "plugins", "run-1");
    const both = (await resolveRepoSkills({ projectId: "p1", agentsUseRepoSkills: true, repoRoot: worktree })).skills;
    await prepareRepoSkillsPlugin({ runPluginsDir, repoRoot: worktree, skills: both });
    await prepareRepoSkillsPlugin({ runPluginsDir, repoRoot: worktree, skills: both.slice(0, 1) });
    expect(await fs.readdir(path.join(runPluginsDir, "project", "skills"))).toEqual(["a"]);
  });
});
