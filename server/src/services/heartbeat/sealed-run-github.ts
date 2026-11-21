import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveClaudeExecutionEngine } from "@paperclipai/adapter-claude-local/server";
import type { ClaudeRunGitHub } from "@paperclipai/shared";

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

/**
 * What the run manifest records about GitHub (`context.paperclipGitHub`, copied into the
 * manifest by the adapter): a connection when one covers the agent, even if it's unavailable
 * right now (the launchers then say why), else the server's login, else none.
 */
export function runGitHubManifest(input: {
  useHostGitHub: boolean;
  selection: {
    configured: boolean;
    identitySource?: "personal" | "dedicated";
    grant?: { providerTenant?: { github?: { login?: string | null } | null } | null };
  };
}): ClaudeRunGitHub {
  if (input.selection.configured) {
    const login = input.selection.grant?.providerTenant?.github?.login?.trim() || null;
    return { mode: "connection", identitySource: input.selection.identitySource ?? "personal", login };
  }
  return input.useHostGitHub ? { mode: "server_login" } : { mode: "none" };
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

/** The reserved domain of agents' commit emails. */
export const AGENT_COMMIT_EMAIL_DOMAIN = "agents.paperclip.invalid";

/**
 * The author of a sealed run's commits: the agent. Name: "<name> (<title>)", or the name alone
 * without a title. Email: `<agent id>@agents.paperclip.invalid`. The id never changes, unlike
 * the name, so one agent keeps one address; `.invalid` is reserved (RFC 2606), so the address
 * never matches a GitHub account and GitHub shows "authored by <agent>, committed by <account>".
 */
export function agentGitAuthor(agent: { id: string; name: string; title?: string | null }): GitIdentity {
  // Git drops <, > and newlines from names anyway; strip them, and other control characters, here.
  const clean = (value: string | null | undefined) => (value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  const name = clean(agent.name) || "Agent";
  const title = clean(agent.title);
  return { name: title ? `${name} (${title})` : name, email: `${agent.id}@${AGENT_COMMIT_EMAIL_DOMAIN}` };
}

/**
 * Variables a sealed run's GitHub mode adds to its environment; nothing for other runs.
 *
 * - Always `PAPERCLIP_GIT_AUTHOR_NAME`/`_EMAIL`, the agent author: the managed `git`/`gh`
 *   launchers make it the author, with the connection's account as the committer, or the agent
 *   too without one (github-launcher.ts). They clear `GIT_AUTHOR_*` themselves, so the author
 *   travels under its own names.
 * - In server-login mode, where no launchers run: `GIT_AUTHOR_*` as the agent and
 *   `GIT_COMMITTER_*` as the server's git identity, or the agent when it has none.
 */
export async function sealedRunGitHubEnv(input: {
  access: { sealed: boolean; useHostGitHub: boolean };
  agent: { id: string; name: string; title?: string | null };
  readServerIdentity?: () => Promise<GitIdentity | null>;
}): Promise<Record<string, string>> {
  if (!input.access.sealed) return {};
  const author = agentGitAuthor(input.agent);
  const env: Record<string, string> = { PAPERCLIP_GIT_AUTHOR_NAME: author.name, PAPERCLIP_GIT_AUTHOR_EMAIL: author.email };
  if (!input.access.useHostGitHub) return env;
  const committer = await (input.readServerIdentity ?? readServerGitIdentity)() ?? author;
  return {
    ...env,
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  };
}
