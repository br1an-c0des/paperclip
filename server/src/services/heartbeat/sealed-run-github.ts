import { resolveClaudeExecutionEngine } from "@paperclipai/adapter-claude-local/server";

/**
 * Step 4b: GitHub for sealed runs (fork/step-4b-plan.md, "Added after the real-run check",
 * agent F). A sealed run is a `claude_local` run on the CLI engine on a local target: it gets
 * exactly what Paperclip gives it, so it gets GitHub only through a Paperclip GitHub
 * connection. Without one it runs `git` and `gh` through the managed launchers with no
 * credential, never with the server's own GitHub setup (`GH_*`, `GIT_*`, `SSH_*`, the server
 * user's `~/.config/gh`). Every other adapter and runner keeps the host fallback.
 */

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
 * target; a sealed run never takes it.
 */
export function decideRunGitHubAccess(input: {
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  environmentDriver: string | null | undefined;
  trustKind: string;
  githubConfigured: boolean;
}): { sealed: boolean; useHostGitHub: boolean } {
  const sealed = isSealedClaudeRun(input);
  const hostFallback = !input.githubConfigured
    && input.trustKind === "standard"
    && ["local", "ssh"].includes(input.environmentDriver ?? "local");
  return { sealed, useHostGitHub: hostFallback && !sealed };
}
