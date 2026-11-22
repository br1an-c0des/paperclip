import fs from "node:fs/promises";
import path from "node:path";
import type { ClaudeRepoSkillsLoad } from "@paperclipai/shared";
import { resolveAgentFolder } from "./agent-config-dir.js";

/**
 * The repo's own skills for a sealed run (fork/step-4b-plan.md, "The repo's own skills"): read
 * from the run's own checkout at launch, when its project allows them, and loaded through a
 * per-run plugin named `project` (Claude sees `project:<skill>`).
 */

export interface RepoSkill {
  name: string;
  /** `<root>/.claude/skills/<name>` */
  dir: string;
}

export const REPO_SKILLS_PLUGIN_NAME = "project";

async function isFile(target: string): Promise<boolean> {
  return fs.stat(target).then((stats) => stats.isFile()).catch(() => false);
}

async function listRepoSkills(skillsDir: string): Promise<RepoSkill[]> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  const skills: RepoSkill[] = [];
  for (const entry of entries) {
    // A symlinked skill folder counts, as in Claude Code; `fs.stat` below follows it.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = path.join(skillsDir, entry.name);
    if (await isFile(path.join(dir, "SKILL.md"))) skills.push({ name: entry.name, dir });
  }
  return skills.sort((left, right) => byName(left.name, right.name));
}

function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * In order: no project → `no_project`; switch off → `project_switch_off`; no repo root →
 * `not_in_repo`; no `<root>/.claude/skills/*\/SKILL.md` → `no_skills`; else loaded, with the
 * skills sorted by name. A subfolder without `SKILL.md` is skipped.
 */
export async function resolveRepoSkills(input: {
  projectId: string | null;
  /** null with a project: an older server, counts as on */
  agentsUseRepoSkills: boolean | null;
  repoRoot: string | null;
  /** The skills' names, when the folder isn't there to list (a preview of a task worktree). */
  skillNames?: string[];
}): Promise<{ load: ClaudeRepoSkillsLoad; skills: RepoSkill[] }> {
  if (!input.projectId) return { load: { enabled: false, reason: "no_project" }, skills: [] };
  if (input.agentsUseRepoSkills === false) {
    return { load: { enabled: false, reason: "project_switch_off" }, skills: [] };
  }
  if (!input.repoRoot) return { load: { enabled: false, reason: "not_in_repo" }, skills: [] };
  const dir = path.join(input.repoRoot, ".claude", "skills");
  const skills = input.skillNames
    ? [...new Set(input.skillNames)].sort(byName).map((name) => ({ name, dir: path.join(dir, name) }))
    : await listRepoSkills(dir);
  if (skills.length === 0) return { load: { enabled: false, reason: "no_skills" }, skills: [] };
  return { load: { enabled: true, dir, count: skills.length }, skills };
}

/** `<instanceRoot>/companies/<companyId>/agents/<agentId>/claude-run-plugins/<runId>` */
export function resolveRunPluginsDir(
  env: NodeJS.ProcessEnv,
  companyId: string,
  agentId: string,
  runId: string,
): string {
  return path.join(resolveAgentFolder(env, companyId, agentId), "claude-run-plugins", runId);
}

/**
 * Writes `<runPluginsDir>/project/.claude-plugin/plugin.json` and `skills/<name>` symlinks to
 * each skill's folder, replacing any `project` folder already there. Returns `runPluginsDir`,
 * the folder the launch passes with `--plugin-dir`.
 */
export async function prepareRepoSkillsPlugin(input: {
  runPluginsDir: string;
  repoRoot: string;
  skills: RepoSkill[];
}): Promise<string> {
  const pluginRoot = path.join(input.runPluginsDir, REPO_SKILLS_PLUGIN_NAME);
  await fs.rm(pluginRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true, mode: 0o700 });
  const manifest = {
    name: REPO_SKILLS_PLUGIN_NAME,
    description: `Skills from this project's repository (${path.join(input.repoRoot, ".claude", "skills")})`,
  };
  await fs.writeFile(
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  const skillsDir = path.join(pluginRoot, "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  for (const skill of input.skills) {
    await fs.symlink(skill.dir, path.join(skillsDir, skill.name));
  }
  return input.runPluginsDir;
}

/** Removes a run's plugins folder (its symlinks, never what they point to). A missing folder is fine. */
export async function removeRunPluginsDir(runPluginsDir: string): Promise<void> {
  await fs.rm(runPluginsDir, { recursive: true, force: true });
}
