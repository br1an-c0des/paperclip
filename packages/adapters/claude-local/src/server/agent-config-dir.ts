import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePaperclipInstanceRootForAdapter } from "@paperclipai/adapter-utils/server-utils";

/**
 * The agent's own Claude config folder for sealed CLI runs (fork/step-4b-sealed-runs.md,
 * section 2): `CLAUDE_CONFIG_DIR` for every local run of the agent, holding only Claude Code's
 * own files. Anything in it that would load as configuration is moved aside before a run.
 */

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveAgentFolder(env: NodeJS.ProcessEnv, companyId: string, agentId: string): string {
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return path.join(instanceRoot, "companies", companyId, "agents", agentId);
}

/**
 * `<instanceRoot>/companies/<companyId>/agents/<agentId>/claude-config`, beside the
 * `claude-runtime` folder of `resolveManagedClaudeRuntimeStateDir` (claude-config.ts).
 */
export function resolveAgentClaudeConfigDir(env: NodeJS.ProcessEnv, companyId: string, agentId: string): string {
  return path.join(resolveAgentFolder(env, companyId, agentId), "claude-config");
}

/** `<same agent folder>/claude-config-set-aside/<runId>` */
export function resolveAgentClaudeSetAsideDir(
  env: NodeJS.ProcessEnv,
  companyId: string,
  agentId: string,
  runId: string,
): string {
  return path.join(resolveAgentFolder(env, companyId, agentId), "claude-config-set-aside", runId);
}

/**
 * Entries that would load as configuration under `--setting-sources user`. Everything else in
 * the folder (`.claude.json`, `projects/`, `sessions/`, `backups/`, `plugins/` data, caches) is
 * Claude Code's own and stays.
 */
export const SET_ASIDE_CONFIG_ENTRIES: readonly string[] = [
  "settings.json",
  "settings.local.json",
  "CLAUDE.md",
  "CLAUDE.local.md",
  "agents",
  "commands",
  "output-styles",
  "skills",
  "rules",
  "hooks",
];

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * Creates `configDir` (0o700) if missing and moves each present `SET_ASIDE_CONFIG_ENTRIES` entry
 * into `setAsideDir`, which is created only when something moves. A rename that hits `ENOENT`
 * (a concurrent run of the same agent moved it first) is skipped. Returns what this call moved,
 * sorted. Nothing is deleted.
 */
export async function prepareAgentClaudeConfigDir(input: {
  configDir: string;
  setAsideDir: string;
}): Promise<{ setAside: string[] }> {
  await fs.mkdir(input.configDir, { recursive: true, mode: 0o700 });

  const present: string[] = [];
  for (const entry of SET_ASIDE_CONFIG_ENTRIES) {
    try {
      await fs.lstat(path.join(input.configDir, entry));
      present.push(entry);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  if (present.length === 0) return { setAside: [] };

  const createdRoot = await fs.mkdir(input.setAsideDir, { recursive: true, mode: 0o700 });
  const setAside: string[] = [];
  for (const entry of present) {
    try {
      await fs.rename(path.join(input.configDir, entry), path.join(input.setAsideDir, entry));
      setAside.push(entry);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  if (setAside.length === 0 && createdRoot) {
    // Every entry went to a concurrent run's folder: leave no empty folder behind.
    await removeEmptyFolders(input.setAsideDir, createdRoot);
  }
  return { setAside: setAside.sort() };
}

/** Removes `from` and its parents up to and including `upTo`, while they're empty. */
async function removeEmptyFolders(from: string, upTo: string): Promise<void> {
  let current = from;
  for (;;) {
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }
    if (current === upTo) return;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/**
 * A temporary `HOME` with `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` under it, for
 * runs without a managed connection (which brings its own), so the server user's home never
 * reaches a run. `cleanup()` removes it and may be called more than once.
 */
export async function createSealedRunHome(
  agentId: string,
): Promise<{ env: Record<string, string>; cleanup(): Promise<void> }> {
  const safeAgentId = agentId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "agent";
  const home = await fs.mkdtemp(path.join(os.tmpdir(), `paperclip-claude-home-${safeAgentId}-`));
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_CACHE_HOME: path.join(home, "cache"),
  };
  try {
    for (const dir of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME]) {
      await fs.mkdir(dir, { mode: 0o700 });
    }
  } catch (error) {
    await fs.rm(home, { recursive: true, force: true });
    throw error;
  }
  return {
    env,
    async cleanup() {
      await fs.rm(home, { recursive: true, force: true });
    },
  };
}
