import {
  AGENT_ACCESS_LEVELS,
  type AgentAccessLevel,
  type AgentAccessOverrides,
  type ClaudeFreshSessionReason,
  type ClaudeMdLoad,
  type ClaudeRepoSkillsLoad,
  type ClaudeRunCredential,
  type ClaudeRunGitHub,
  type ClaudeRunManifest,
} from "@paperclipai/shared";
import {
  PAPERCLIP_FEEDBACK_SKILL_KEYS,
  PAPERCLIP_OPERATIONAL_SKILL_KEY,
} from "@paperclipai/adapter-utils/server-utils";
import { claudeSkillPlugin } from "./prompt-cache.js";
import { REPO_SKILLS_PLUGIN_NAME, type RepoSkill } from "./repo-skills.js";

/**
 * The run manifest of a sealed local `claude_local` CLI run (fork/step-4b-sealed-runs.md,
 * section 8), and the launch it describes, built as data before anything starts ("Keep the
 * launch portable").
 */

/** A sealed launch: what the local starter spawns, and the files it relies on. */
export interface SealedClaudeLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  files: {
    configDir: string;
    pluginDir: string;
    runPluginsDir: string | null;
    mcpConfigPath: string;
    claudeMdRoot: string | null;
  };
  manifest: ClaudeRunManifest;
}

export type ClaudeRunSessionStart =
  | { mode: "fresh"; reason: ClaudeFreshSessionReason }
  | { mode: "resumed"; sessionId: string };

export interface ClaudeRunManifestInput {
  configDir: string;
  credential: ClaudeRunCredential;
  /** The set-aside folder and what this run moved into it; no entries → `setAside: null`. */
  setAside: { dir: string; entries: string[] };
  overriddenEnv: string[];
  /** The library skills mounted in the prompt bundle. */
  skills: ReadonlyArray<{ key: string; runtimeName: string }>;
  /** The repo's own skills, loaded through the per-run `project` plugin. */
  repoSkills: { load: ClaudeRepoSkillsLoad; skills: readonly RepoSkill[] };
  /** The run's MCP servers; tokens and headers are dropped. */
  mcpServers: ReadonlyArray<{ name: string; url: string }>;
  /** `context.paperclipAgentAccess`, as the server passed it. */
  access: unknown;
  /** `context.paperclipGitHub`, as the server passed it (optional for older callers). */
  github?: unknown;
  instructions: { entryFile: string | null; sent: boolean };
  claudeMd: ClaudeMdLoad;
  /** The launch environment; only its names reach the manifest. */
  env: Record<string, string>;
  extraArgs: readonly string[];
  session: ClaudeRunSessionStart;
}

const ALWAYS_ON_SKILL_KEYS: ReadonlySet<string> = new Set<string>([
  PAPERCLIP_OPERATIONAL_SKILL_KEY,
  ...PAPERCLIP_FEEDBACK_SKILL_KEYS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The access the server resolved for the run, or null when it passed none (or an unknown shape). */
export function parseClaudeRunAccess(
  value: unknown,
): { level: AgentAccessLevel; overrides: AgentAccessOverrides } | null {
  if (!isRecord(value)) return null;
  const level = value.level;
  if (typeof level !== "string" || !(AGENT_ACCESS_LEVELS as readonly string[]).includes(level)) return null;
  const overrides = isRecord(value.overrides) ? (value.overrides as AgentAccessOverrides) : {};
  return { level: level as AgentAccessLevel, overrides };
}

/** How the run got GitHub, as the server decided it, or null when it passed none (or an unknown shape). */
export function parseClaudeRunGitHub(value: unknown): ClaudeRunGitHub | null {
  if (!isRecord(value)) return null;
  if (value.mode === "server_login" || value.mode === "none") return { mode: value.mode };
  if (value.mode !== "connection") return null;
  const identitySource = value.identitySource === "dedicated" ? "dedicated" : "personal";
  const login = typeof value.login === "string" && value.login.trim() ? value.login.trim() : null;
  return { mode: "connection", identitySource, login };
}

function withRunGitHub(value: unknown): { github?: ClaudeRunGitHub } {
  const github = parseClaudeRunGitHub(value);
  return github ? { github } : {};
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Pure: the manifest for one attempt of a sealed run. */
export function buildClaudeRunManifest(input: ClaudeRunManifestInput): ClaudeRunManifest {
  const skills: ClaudeRunManifest["skills"] = input.skills.map((entry) => ({
    name: entry.runtimeName,
    key: entry.key,
    origin: ALWAYS_ON_SKILL_KEYS.has(entry.key.trim().toLowerCase()) ? "always_on" : "assigned",
    plugin: claudeSkillPlugin(entry.key),
  }));
  if (input.repoSkills.load.enabled) {
    for (const skill of input.repoSkills.skills) {
      skills.push({
        name: skill.name,
        key: `repo:.claude/skills/${skill.name}`,
        origin: "repo",
        plugin: REPO_SKILLS_PLUGIN_NAME,
      });
    }
  }

  const pluginsByName = new Map<string, Set<string>>();
  for (const skill of skills) {
    const plugins = pluginsByName.get(skill.name) ?? new Set<string>();
    plugins.add(skill.plugin);
    pluginsByName.set(skill.name, plugins);
  }
  const skillNameClashes = [...pluginsByName.entries()]
    .filter(([, plugins]) => plugins.size > 1)
    .map(([name]) => name)
    .sort();

  return {
    version: 1,
    engine: "cli",
    configDir: input.configDir,
    settingSources: ["user"],
    credential: { ...input.credential },
    setAside: input.setAside.entries.length > 0
      ? { dir: input.setAside.dir, entries: [...input.setAside.entries].sort() }
      : null,
    overriddenEnv: sortedUnique(input.overriddenEnv),
    skills,
    skillNameClashes,
    builtInSkills: true,
    mcpServers: input.mcpServers.map(({ name, url }) => ({ name, url })),
    strictMcpConfig: true,
    access: parseClaudeRunAccess(input.access),
    instructions: { entryFile: input.instructions.entryFile, sent: input.instructions.sent },
    claudeMd: input.claudeMd,
    repoSkills: input.repoSkills.load,
    autoMemory: false,
    envKeys: sortedUnique(Object.keys(input.env)),
    extraArgs: [...input.extraArgs],
    session: input.session,
    ...withRunGitHub(input.github),
  };
}

/** One `commandNotes` line for the run's details. */
export function summarizeClaudeRunManifest(manifest: ClaudeRunManifest): string {
  const librarySkills = manifest.skills.filter((skill) => skill.origin !== "repo").length;
  const claudeMd = manifest.claudeMd.enabled ? "loaded" : `skipped: ${manifest.claudeMd.reason}`;
  const repoSkills = manifest.repoSkills.enabled
    ? String(manifest.repoSkills.count)
    : `skipped: ${manifest.repoSkills.reason}`;
  return (
    `Sealed run: ${librarySkills} skills, ${manifest.mcpServers.length} MCP servers, ` +
    `CLAUDE.md ${claudeMd}, repo skills ${repoSkills}.`
  );
}
