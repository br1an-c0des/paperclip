import type { AgentAccessLevel, AgentAccessOverrides } from "./agent-access.js";
import type { RunPromptPreview } from "./run-prompt.js";

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
  | { mode: "connection"; identitySource: "personal" | "dedicated" | "shared"; login: string | null }
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

/**
 * Why the preview can't read the repo's `CLAUDE.md` or skills yet:
 * - `not_cloned`: the project's primary workspace has a repo URL but no local checkout, and the
 *   preview doesn't clone. A run clones it first, then reads them from the clone.
 * - `base_not_fetched`: tasks get their own worktree, and the branch it would start from isn't
 *   in the checkout yet. The preview doesn't fetch; a run fetches it, then makes the worktree.
 */
export type ClaudeRunPreviewRepoSkipReason = "not_cloned" | "base_not_fetched";

/**
 * Stands in for the task's branch in the paths of a task worktree that doesn't exist yet
 * (`<checkout>/.paperclip/worktrees/<task branch>/CLAUDE.md`): the branch is named after the task
 * (`{{issue.identifier}}-{{slug}}` by default), which a preview has none of.
 */
export const CLAUDE_RUN_PREVIEW_TASK_BRANCH = "<task branch>";

/**
 * Where tasks in the project work (step 4b part 3): each in its own git worktree of the
 * checkout, made at the task's first run under `dir` from `baseRef`. `baseRef` is the branch or
 * commit as the preview resolved it without fetching (a run fetches a remote branch first), or
 * null when the run would have to fetch it before it could start. The preview reads `CLAUDE.md`
 * and the repo's skills from that commit, not from the checkout's working files, since a new
 * worktree holds only what's committed there; their paths use `CLAUDE_RUN_PREVIEW_TASK_BRANCH`.
 */
export interface ClaudeRunPreviewTaskWorktree {
  dir: string;
  baseRef: string | null;
}

/**
 * Where the preview read the repo's `CLAUDE.md` and skills from: the project's primary
 * workspace's checkout (`local`; with `worktree` when tasks each get their own worktree of it,
 * else they work in the checkout itself), nothing yet (`not_cloned`: a repo URL and no
 * checkout), or no workspace at all (`none`: runs work in the agent's own folder).
 */
export type ClaudeRunPreviewCheckout =
  | { kind: "local"; path: string; worktree?: ClaudeRunPreviewTaskWorktree }
  | { kind: "not_cloned"; repoUrl: string }
  | { kind: "none" };

/**
 * The manifest as the next fresh run on a task would get it. Left out: `session` (it depends on
 * the task: each new task starts fresh, later wakes on it resume) and `setAside` (what a run
 * moves out of the config folder is known only when it moves it). `claudeMd` and `repoSkills`
 * can also read `not_cloned` or `base_not_fetched`, and in a task worktree their paths hold
 * `CLAUDE_RUN_PREVIEW_TASK_BRANCH`. `credential` is null when the run would have none (a
 * `claude_credential_missing` blocker says so). `envKeys` are the names from the agent's
 * settings and Paperclip's own; a run adds launch-time ones on top: its wake's and task's
 * (`PAPERCLIP_TASK_ID` and the like), its workspace and scratch folders, the managed git/gh
 * launchers, telemetry export, and the agent's signing identity.
 */
export type ClaudeRunPreviewManifest = Omit<
  ClaudeRunManifest,
  "session" | "setAside" | "claudeMd" | "repoSkills" | "credential"
> & {
  credential: ClaudeRunCredential | null;
  claudeMd: ClaudeMdLoad | { enabled: false; reason: ClaudeRunPreviewRepoSkipReason };
  repoSkills: ClaudeRepoSkillsLoad | { enabled: false; reason: ClaudeRunPreviewRepoSkipReason };
};

/** Why a run would be refused before it started (fork/step-4b-sealed-runs.md, section 7). */
export interface ClaudeRunPreviewBlocker {
  /** e.g. `claude_credential_missing`, `paperclip_mcp_unavailable` */
  code: string;
  message: string;
}

export type ClaudeRunPreviewUnsupportedReason =
  /** Another adapter. */
  | "not_claude_local"
  /** `claude_local` on the ACP engine. */
  | "not_cli_engine"
  /** Runs on the Paperclip Runner. */
  | "runner"
  /** Runs on another remote execution target (SSH, sandbox, cloud), which isn't sealed. */
  | "remote_target";

export interface ClaudeRunPreviewProject {
  id: string;
  name: string;
  checkout: ClaudeRunPreviewCheckout;
}

/**
 * What an agent's runs get, before any run: `GET /api/agents/:id/run-preview?projectId=`
 * (fork/step-4b-parts-2-3.md, part 2). Worked out by the same planning code as a real launch,
 * without starting, writing or minting anything.
 */
export type ClaudeRunPreview =
  | {
      supported: true;
      /** The project chosen with `projectId`, or null for tasks in no project. */
      project: ClaudeRunPreviewProject | null;
      manifest: ClaudeRunPreviewManifest;
      /** Empty when the run would start. */
      blockers: ClaudeRunPreviewBlocker[];
      /** A draft of the next run's prompt, or null when none could be drafted. */
      prompt: RunPromptPreview | null;
    }
  | { supported: false; reason: ClaudeRunPreviewUnsupportedReason };
