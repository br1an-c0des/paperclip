import type { Db } from "@paperclipai/db";
import { executionWorkspaces } from "@paperclipai/db";
import type { ExecutionWorkspaceWorktreeKept, WorktreeCleanupMode, WorktreeCleanupStatus } from "@paperclipai/shared";
import { eq, sql } from "drizzle-orm";
import { instanceSettingsService } from "./instance-settings.js";

/*
 * Step 4b part 3: cleaning up finished tasks' worktrees with upstream's git workspace expiration
 * sweep (doc/recoverable-disk-cleanup.md, "Git workspace restore points"), behind an instance
 * setting (`experimental.worktreeCleanup`) that is off by default. The sweep reads it on every pass,
 * so a change applies without a restart. Never saved, it falls back to the environment variables
 * an operator may have set (`PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED`,
 * `PAPERCLIP_GIT_RESTORE_POINTS_ENABLED`, `PAPERCLIP_GIT_CACHE_EXPIRATION_DRY_RUN`). A saved mode
 * runs for real. The day counts stay environment variables.
 */

/** The config fields the cleanup reads; `server/src/config.ts` sets them from the environment. */
export type WorktreeCleanupConfig = {
  gitCacheExpirationEnabled: boolean;
  gitCacheExpirationDryRun: boolean;
  gitRestorePointsEnabled: boolean;
  storageProvider: string;
  gitRestorePointTerminalDelayDays: number;
  gitRestorePointIdleDays: number;
  gitRestorePointRetentionDays: number;
};

export type ResolvedWorktreeCleanup = {
  mode: WorktreeCleanupMode;
  source: "setting" | "environment";
  dryRun: boolean;
};

/** The mode the environment variables give, for an instance that never saved the setting. */
export function environmentWorktreeCleanupMode(config: Pick<WorktreeCleanupConfig, "gitCacheExpirationEnabled" | "gitRestorePointsEnabled">): WorktreeCleanupMode {
  if (!config.gitCacheExpirationEnabled) return "off";
  return config.gitRestorePointsEnabled ? "restore_points" : "strict";
}

/** The environment's switches, read as `server/src/config.ts` reads them. */
export function environmentWorktreeCleanupFlags(env: Record<string, string | undefined> = process.env) {
  return {
    gitCacheExpirationEnabled: env.PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED === "true",
    gitCacheExpirationDryRun: env.PAPERCLIP_GIT_CACHE_EXPIRATION_DRY_RUN !== "false",
    gitRestorePointsEnabled: env.PAPERCLIP_GIT_RESTORE_POINTS_ENABLED === "true",
  };
}

export function resolveWorktreeCleanup(saved: WorktreeCleanupMode | null | undefined, config: Pick<WorktreeCleanupConfig, "gitCacheExpirationEnabled" | "gitRestorePointsEnabled" | "gitCacheExpirationDryRun">): ResolvedWorktreeCleanup {
  if (saved) return { mode: saved, source: "setting", dryRun: false };
  const mode = environmentWorktreeCleanupMode(config);
  return { mode, source: "environment", dryRun: mode !== "off" && config.gitCacheExpirationDryRun };
}

/**
 * Restore points need a durable key: upstream refuses them when file storage is `s3` and the
 * secrets master key doesn't come from `PAPERCLIP_SECRETS_MASTER_KEY`, since the key would be lost
 * with the instance.
 */
export function restorePointAvailability(config: Pick<WorktreeCleanupConfig, "storageProvider">, env: Record<string, string | undefined> = process.env) {
  const keyDurable = config.storageProvider !== "s3" || Boolean(env.PAPERCLIP_SECRETS_MASTER_KEY?.trim());
  return keyDurable
    ? { available: true, keyDurable, reason: null }
    : {
        available: false,
        keyDurable,
        reason: "File storage is S3 and PAPERCLIP_SECRETS_MASTER_KEY isn't set, so a restore point's key wouldn't outlive this server.",
      };
}

export async function readSavedWorktreeCleanup(db: Db): Promise<WorktreeCleanupMode | null> {
  return (await instanceSettingsService(db).getExperimental()).worktreeCleanup ?? null;
}

export async function readWorktreeCleanup(db: Db, config: WorktreeCleanupConfig): Promise<ResolvedWorktreeCleanup> {
  return resolveWorktreeCleanup(await readSavedWorktreeCleanup(db), config);
}

export function worktreeCleanupStatus(saved: WorktreeCleanupMode | null, config: WorktreeCleanupConfig, env: Record<string, string | undefined> = process.env): WorktreeCleanupStatus {
  const resolved = resolveWorktreeCleanup(saved, config);
  const restorePoints = restorePointAvailability(config, env);
  return {
    saved,
    mode: resolved.mode,
    source: resolved.source,
    dryRun: resolved.dryRun,
    restorePoints: { available: restorePoints.available, reason: restorePoints.reason },
    days: {
      // Fixed in upstream's expiration (`isGitWorkspaceExpirationEligible`).
      strictDelay: 1,
      restorePointDelay: config.gitRestorePointTerminalDelayDays,
      idle: config.gitRestorePointIdleDays,
      retention: config.gitRestorePointRetentionDays,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Why a finished task's worktree was kept

export const WORKTREE_KEPT_METADATA_KEY = "worktreeCleanupKept";

/**
 * The sweep's skip reasons worth showing on the task: lasting facts about the worktree. Transient
 * ones (a live run, a lock, the workspace changing mid-check) aren't recorded.
 */
const KEPT_REASON_LABELS: Record<string, string> = {
  upstream_commit_unverified: "branch not pushed",
  dirty_or_untracked_files: "uncommitted changes",
  unique_reflog_commits: "commits only in this worktree",
  unique_original_head: "commits only in this worktree",
  unique_git_refs: "local branches or tags not pushed",
  unique_worktree_refs: "local branches or tags not pushed",
  unique_ignored_files: "ignored files only in this worktree",
  unpushed_managed_checkout: "a nested checkout has unpushed work",
  unpushed_managed_checkout_branches: "a nested checkout has unpushed work",
  uncommitted_git_message: "a draft commit message",
  unsupported_commit_message: "a draft commit message",
  unsupported_submodules: "it uses submodules",
  restore_point_key_not_durable: "restore points can't be saved on this instance",
  restore_point_not_due: "waiting to save a restore point",
  inspection_failed: "couldn't check it",
};

export function worktreeKeptLabel(reason: string): string | null {
  if (KEPT_REASON_LABELS[reason]) return KEPT_REASON_LABELS[reason]!;
  if (reason.startsWith("unsupported_")) return "its git state can't be saved";
  return null;
}

export function readWorktreeKept(metadata: Record<string, unknown> | null | undefined): ExecutionWorkspaceWorktreeKept | null {
  const raw = metadata?.[WORKTREE_KEPT_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.reason !== "string" || typeof record.at !== "string") return null;
  if (record.mode !== "strict" && record.mode !== "restore_points") return null;
  const label = worktreeKeptLabel(record.reason);
  if (!label) return null;
  return { reason: record.reason, label, at: record.at, mode: record.mode };
}

/** What the task shows: the recorded reason, only while the sweep is on. */
export function visibleWorktreeKept(metadata: Record<string, unknown> | null | undefined, mode: WorktreeCleanupMode): ExecutionWorkspaceWorktreeKept | null {
  if (mode === "off") return null;
  return readWorktreeKept(metadata);
}

/**
 * Record (or clear) why the sweep kept a finished task's worktree, after one expiration attempt.
 * Writes only when the shown reason changes, and merges into the metadata so it never overwrites a
 * concurrent writer's keys. It leaves `updatedAt` alone: the sweep orders and fences on it.
 */
export async function recordWorktreeKept(db: Db, workspace: { id: string; metadata: Record<string, unknown> | null }, outcome: {
  expired: boolean;
  skipReason: string | null;
  mode: Exclude<WorktreeCleanupMode, "off">;
  now: Date;
}) {
  const current = readWorktreeKept(workspace.metadata);
  const reason = !outcome.expired && outcome.skipReason && worktreeKeptLabel(outcome.skipReason) ? outcome.skipReason : null;
  if (!reason) {
    // A transient skip says nothing new; only a removal clears the record.
    if (outcome.expired && workspace.metadata && WORKTREE_KEPT_METADATA_KEY in workspace.metadata) {
      await db.update(executionWorkspaces)
        .set({ metadata: sql`coalesce(${executionWorkspaces.metadata}, '{}'::jsonb) - ${WORKTREE_KEPT_METADATA_KEY}` })
        .where(eq(executionWorkspaces.id, workspace.id));
    }
    return;
  }
  if (current?.reason === reason && current.mode === outcome.mode) return;
  const record = { reason, mode: outcome.mode, at: outcome.now.toISOString() };
  await db.update(executionWorkspaces)
    .set({ metadata: sql`coalesce(${executionWorkspaces.metadata}, '{}'::jsonb) || ${JSON.stringify({ [WORKTREE_KEPT_METADATA_KEY]: record })}::jsonb` })
    .where(eq(executionWorkspaces.id, workspace.id));
}
