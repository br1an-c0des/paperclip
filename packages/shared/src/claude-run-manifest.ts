import type { AgentAccessLevel, AgentAccessOverrides } from "./agent-access.js";

/**
 * The run manifest: what a sealed `claude_local` CLI run got from Paperclip (credential, config
 * folder, skills, MCP servers, instructions, the repo's `CLAUDE.md` and skills, environment,
 * session). The adapter records it on the run; the run's details show it.
 * See fork/step-4b-sealed-runs.md, section 8.
 */

export type ClaudeCredentialMethod =
  | "subscription"
  | "api_key"
  | "auth_token"
  | "bedrock"
  | "vertex"
  | "foundry"
  | "routed";

export interface ClaudeRunCredential {
  kind: "managed_connection" | "agent_env";
  method: ClaudeCredentialMethod;
  connectionId: string | null;
  connectionName: string | null;
}

export type ClaudeMdSkipReason = "project_switch_off" | "not_in_repo" | "no_project" | "no_file";

export type ClaudeMdLoad = { enabled: true; path: string } | { enabled: false; reason: ClaudeMdSkipReason };

export type ClaudeRepoSkillsSkipReason = "project_switch_off" | "not_in_repo" | "no_project" | "no_skills";

export type ClaudeRepoSkillsLoad =
  /** dir: `<root>/.claude/skills` */
  | { enabled: true; dir: string; count: number }
  | { enabled: false; reason: ClaudeRepoSkillsSkipReason };

export type ClaudeFreshSessionReason =
  | "no_saved_session"
  | "invalid_session_id"
  | "cwd_changed"
  | "prompt_bundle_changed"
  | "target_changed"
  | "session_unavailable";

/**
 * How a sealed run got GitHub, as the server decided it at launch: through a Paperclip GitHub
 * connection (login: the account's, when the selected grant records one), the server's own
 * GitHub login (the agent's "Use this server's GitHub login"), or not at all (git and gh run
 * without credentials).
 */
export type ClaudeRunGitHub =
  | { mode: "connection"; identitySource: "personal" | "dedicated"; login: string | null }
  | { mode: "server_login" }
  | { mode: "none" };

export interface ClaudeRunManifest {
  version: 1;
  engine: "cli";
  configDir: string;
  settingSources: ["user"];
  credential: ClaudeRunCredential;
  setAside: { dir: string; entries: string[] } | null;
  overriddenEnv: string[];
  /**
   * name: the plain name the Skills page shows; plugin: which plugin loaded it (Claude sees
   * `<plugin>:<name>`); key: the library key, or `repo:.claude/skills/<name>` for a repo skill.
   */
  skills: Array<{
    name: string;
    key: string;
    origin: "always_on" | "assigned" | "repo";
    plugin: "paperclip" | "company" | "project";
  }>;
  /** Plain names that more than one plugin supplied. */
  skillNameClashes: string[];
  builtInSkills: true;
  mcpServers: Array<{ name: string; url: string }>;
  strictMcpConfig: true;
  access: { level: AgentAccessLevel; overrides: AgentAccessOverrides } | null;
  instructions: { entryFile: string | null; sent: boolean };
  claudeMd: ClaudeMdLoad;
  repoSkills: ClaudeRepoSkillsLoad;
  autoMemory: false;
  envKeys: string[];
  extraArgs: string[];
  session: { mode: "fresh"; reason: ClaudeFreshSessionReason } | { mode: "resumed"; sessionId: string };
  /** Added after version 1 shipped, so optional: older manifests don't have it. */
  github?: ClaudeRunGitHub;
}

/** A light guard: a non-null object with `version === 1` and `engine === "cli"`. Not a full schema check. */
export function isClaudeRunManifest(value: unknown): value is ClaudeRunManifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { version?: unknown; engine?: unknown };
  return record.version === 1 && record.engine === "cli";
}
