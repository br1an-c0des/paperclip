import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveClaudeExecutionEngine } from "@paperclipai/adapter-claude-local/server";

/**
 * Step 4b: GitHub for sealed runs (fork/step-4b-plan.md, "Added after the real-run check",
 * agent F). A sealed run is a `claude_local` run on the CLI engine on a local target: it gets
 * exactly what Paperclip gives it, so it gets GitHub only through a Paperclip GitHub
 * connection. Without one it runs `git` and `gh` through the managed launchers with no
 * credential, never with the server's own GitHub setup (`GH_*`, `GIT_*`, `SSH_*`, the server
 * user's `~/.config/gh`), unless the agent opted in with `runtimeConfig.github.useServerLogin`
 * ("Use this server's GitHub login"). Every other adapter and runner keeps the host fallback.
 */

/** `runtimeConfig.github.useServerLogin`, off unless it's exactly `true`. */
export function readUseServerGitHubLogin(runtimeConfig: unknown): boolean {
  const github = runtimeConfig && typeof runtimeConfig === "object" && !Array.isArray(runtimeConfig)
    ? (runtimeConfig as Record<string, unknown>).github
    : undefined;
  return Boolean(github && typeof github === "object" && (github as Record<string, unknown>).useServerLogin === true);
}

/** True for a `claude_local` CLI run on a local target, the runs the adapter seals. */
export function isSealedClaudeRun(input: {
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  environmentDriver: string | null | undefined;
}): boolean {
  return input.adapterType === "claude_local"
    && (input.environmentDriver ?? "local") === "local"
    && resolveClaudeExecutionEngine(input.adapterConfig).engine === "cli";
}

/**
 * Whether the run uses the execution host's own Git and GitHub CLI login ("host" mode in
 * `prepareGitHubExecutionEnvironment`) instead of the managed launchers. Host mode is the
 * fallback when no GitHub connection covers the agent, on standard trust and a local or SSH
 * target; a sealed run takes it only when the agent opted in (`useServerLogin`).
 */
export function decideRunGitHubAccess(input: {
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  environmentDriver: string | null | undefined;
  trustKind: string;
  githubConfigured: boolean;
  /** `readUseServerGitHubLogin(agent.runtimeConfig)` */
  useServerLogin: boolean;
}): { sealed: boolean; useHostGitHub: boolean } {
  const sealed = isSealedClaudeRun(input);
  const hostFallback = !input.githubConfigured
    && input.trustKind === "standard"
    && ["local", "ssh"].includes(input.environmentDriver ?? "local");
  return { sealed, useHostGitHub: hostFallback && (!sealed || input.useServerLogin) };
}

export type GitIdentity = { name: string; email: string };

async function readGlobalGitConfig(key: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)("git", ["config", "--global", "--get", key], { env, timeout: 5_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * The server's own git identity, for the committer of a sealed run in server-login mode: the
 * sealed `HOME` hides the server user's `~/.gitconfig`, so the run can't read it itself. The
 * server's `GIT_COMMITTER_*` first, else its global `user.name`/`user.email`; null unless both
 * a name and an email are set.
 */
export async function readServerGitIdentity(env: NodeJS.ProcessEnv = process.env): Promise<GitIdentity | null> {
  const name = env.GIT_COMMITTER_NAME?.trim() || await readGlobalGitConfig("user.name", env);
  const email = env.GIT_COMMITTER_EMAIL?.trim() || await readGlobalGitConfig("user.email", env);
  return name && email ? { name, email } : null;
}

/**
 * Variables a sealed run's GitHub mode adds to its environment. In server-login mode: the
 * server's git identity as the committer, when it has one. Nothing for other runs.
 */
export async function sealedRunGitHubEnv(input: {
  access: { sealed: boolean; useHostGitHub: boolean };
  readServerIdentity?: () => Promise<GitIdentity | null>;
}): Promise<Record<string, string>> {
  if (!input.access.sealed || !input.access.useHostGitHub) return {};
  const server = await (input.readServerIdentity ?? readServerGitIdentity)();
  return server ? { GIT_COMMITTER_NAME: server.name, GIT_COMMITTER_EMAIL: server.email } : {};
}
