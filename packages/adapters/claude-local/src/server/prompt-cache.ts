import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, type Hash } from "node:crypto";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import {
  ensurePaperclipSkillSymlink,
  resolvePaperclipInstanceRootForAdapter,
  type PaperclipSkillEntry,
} from "@paperclipai/adapter-utils/server-utils";

type SkillEntry = PaperclipSkillEntry;

export interface ClaudePromptBundle {
  bundleKey: string;
  rootDir: string;
  /** The bundle root, holding `.claude/skills/`: the dormant remote path still passes it with `--add-dir`. */
  addDir: string;
  /**
   * `<bundle>/plugins`, a folder of plugins (`paperclip`, `company`, each only when it has
   * skills). A sealed local launch passes it with `--plugin-dir`; Claude sees `<plugin>:<skill>`.
   */
  pluginDir: string;
  instructionsFilePath: string | null;
}

/**
 * Bundle layouts: 1 had only `.claude/skills/` and `agent-instructions.md`; 2 adds `plugins/`.
 * The layout is part of the bundle key, so bundles cached under an older layout aren't reused.
 */
export const CLAUDE_PROMPT_BUNDLE_LAYOUT = 2;

export type ClaudeSkillPlugin = "paperclip" | "company";

const PAPERCLIP_SKILL_KEY_PREFIX = "paperclipai/paperclip/";

const CLAUDE_SKILL_PLUGIN_DESCRIPTIONS: Record<ClaudeSkillPlugin, string> = {
  paperclip: "Paperclip's own skills: working in Paperclip, feedback, hiring, memory",
  company: "Skills from this company's skill library",
};

/**
 * The plugin a skill loads from, by where it comes from: `paperclip` for Paperclip's own skills
 * (keys starting `paperclipai/paperclip/`), `company` for everything from the company library.
 */
export function claudeSkillPlugin(key: string): ClaudeSkillPlugin {
  return key.startsWith(PAPERCLIP_SKILL_KEY_PREFIX) ? "paperclip" : "company";
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveManagedClaudePromptCacheRoot(
  env: NodeJS.ProcessEnv,
  companyId: string,
): string {
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return path.resolve(
    instanceRoot,
    "companies",
    companyId,
    "claude-prompt-cache",
  );
}

async function hashPathContents(
  candidate: string,
  hash: Hash,
  relativePath: string,
  seenDirectories: Set<string>,
): Promise<void> {
  const stat = await fs.lstat(candidate);

  if (stat.isSymbolicLink()) {
    hash.update(`symlink:${relativePath}\n`);
    const resolved = await fs.realpath(candidate).catch(() => null);
    if (!resolved) {
      hash.update("missing\n");
      return;
    }
    await hashPathContents(resolved, hash, relativePath, seenDirectories);
    return;
  }

  if (stat.isDirectory()) {
    const realDir = await fs.realpath(candidate).catch(() => candidate);
    hash.update(`dir:${relativePath}\n`);
    if (seenDirectories.has(realDir)) {
      hash.update("loop\n");
      return;
    }
    seenDirectories.add(realDir);
    const entries = await fs.readdir(candidate, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelativePath = relativePath.length > 0 ? `${relativePath}/${entry.name}` : entry.name;
      await hashPathContents(path.join(candidate, entry.name), hash, childRelativePath, seenDirectories);
    }
    return;
  }

  if (stat.isFile()) {
    hash.update(`file:${relativePath}\n`);
    hash.update(await fs.readFile(candidate));
    hash.update("\n");
    return;
  }

  hash.update(`other:${relativePath}:${stat.mode}\n`);
}

export async function buildClaudePromptBundleKey(input: {
  skills: SkillEntry[];
  instructionsContents: string | null;
  /** Defaults to `CLAUDE_PROMPT_BUNDLE_LAYOUT`. Layout 1 gives the keys bundles had before layouts. */
  layout?: number;
}): Promise<string> {
  const layout = input.layout ?? CLAUDE_PROMPT_BUNDLE_LAYOUT;
  const hash = createHash("sha256");
  hash.update("paperclip-claude-prompt-bundle:v1\n");
  if (layout !== 1) hash.update(`layout:${layout}\n`);
  if (input.instructionsContents) {
    hash.update("instructions\n");
    hash.update(input.instructionsContents);
    hash.update("\n");
  } else {
    hash.update("instructions:none\n");
  }

  const sortedSkills = [...input.skills].sort((left, right) => left.runtimeName.localeCompare(right.runtimeName));
  for (const entry of sortedSkills) {
    hash.update(`skill:${entry.key}:${entry.runtimeName}\n`);
    await hashPathContents(entry.source, hash, entry.runtimeName, new Set<string>());
  }

  return hash.digest("hex");
}

async function ensureReadableFile(targetPath: string, contents: string): Promise<void> {
  try {
    await fs.access(targetPath, fsConstants.R_OK);
    return;
  } catch {
    // Fall through and materialize the file.
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    const targetReadable = await fs.access(targetPath, fsConstants.R_OK).then(() => true).catch(() => false);
    if (!targetReadable) {
      throw err;
    }
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function prepareClaudePromptBundle(input: {
  companyId: string;
  skills: SkillEntry[];
  instructionsContents: string | null;
  onLog: AdapterExecutionContext["onLog"];
}): Promise<ClaudePromptBundle> {
  const { companyId, skills, instructionsContents, onLog } = input;
  const bundleKey = await buildClaudePromptBundleKey({
    skills,
    instructionsContents,
  });
  const rootDir = path.join(resolveManagedClaudePromptCacheRoot(process.env, companyId), bundleKey);
  const skillsHome = path.join(rootDir, ".claude", "skills");
  await linkSkills(skillsHome, skills, onLog);

  const pluginDir = path.join(rootDir, "plugins");
  await fs.mkdir(pluginDir, { recursive: true });
  for (const plugin of ["paperclip", "company"] as const) {
    const pluginSkills = skills.filter((entry) => claudeSkillPlugin(entry.key) === plugin);
    if (pluginSkills.length === 0) continue;
    const pluginRoot = path.join(pluginDir, plugin);
    await ensureReadableFile(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: plugin, description: CLAUDE_SKILL_PLUGIN_DESCRIPTIONS[plugin] }, null, 2) + "\n",
    );
    await linkSkills(path.join(pluginRoot, "skills"), pluginSkills, onLog);
  }

  const instructionsFilePath = instructionsContents
    ? path.join(rootDir, "agent-instructions.md")
    : null;
  if (instructionsFilePath && instructionsContents) {
    await ensureReadableFile(instructionsFilePath, instructionsContents);
  }

  return {
    bundleKey,
    rootDir,
    addDir: rootDir,
    pluginDir,
    instructionsFilePath,
  };
}

/**
 * Symlinks each skill into `skillsHome/<runtimeName>`. A link a concurrent preparation of the
 * same bundle made first (`EEXIST`) is fine; other failures are logged and the skill is left out.
 */
async function linkSkills(
  skillsHome: string,
  skills: SkillEntry[],
  onLog: AdapterExecutionContext["onLog"],
): Promise<void> {
  await fs.mkdir(skillsHome, { recursive: true });
  for (const entry of skills) {
    const target = path.join(skillsHome, entry.runtimeName);
    try {
      await ensurePaperclipSkillSymlink(entry.source, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code === "EEXIST") continue;
      await onLog(
        "stderr",
        `[paperclip] Failed to materialize Claude skill "${entry.key}" into ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
