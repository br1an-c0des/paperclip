import type { Db } from "@paperclipai/db";
import { executionWorkspaces } from "@paperclipai/db";
import {
  WORKTREE_CLEANUP_DEFAULTS,
  type ExecutionWorkspaceWorktreeKept,
  type InstanceExperimentalSettings,
  type WorktreeCleanupMode,
  type WorktreeCleanupStatus,
  type WorktreeCleanupValues,
} from "@paperclipai/shared";
import { eq, sql } from "drizzle-orm";
import type { StorageService } from "../storage/types.js";
import { instanceSettingsService } from "./instance-settings.js";

/*
 * Step 4b part 3: one setting (`experimental.worktreeCleanup`) for everything the terminal
 * workspace reaper does to finished tasks' git worktrees: the merged-and-clean archive, compaction
 * (removing dependencies and build output), and upstream's git workspace expiration
 * (doc/recoverable-disk-cleanup.md). It is off until someone chooses a level: an instance that never
 * saved it leaves task worktrees alone, whatever the environment variables say. The reaper reads it
 * on every pass, so a change applies without a restart, and a chosen level runs for real. Other
 * workspaces (shared checkouts, task directories, remote and plugin workspaces) keep upstream's
 * environment-driven rules.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The config fields the cleanup reads; `server/src/config.ts` sets them from the environment. */
export type WorktreeCleanupConfig = {
  storageProvider: string;
  gitRestorePointRetentionDays: number;
  /** The compaction delay when compaction is on; null (`PAPERCLIP_WORKSPACE_COMPACTION_ENABLED=false`) means 1 hour here. */
  workspaceCompactionDelayHours: number | null;
};

/** The saved settings, as instance settings store them. */
export type SavedWorktreeCleanup = Pick<InstanceExperimentalSettings,
  "worktreeCleanup" | "worktreeCleanupWaitDays" | "worktreeCleanupRemoveBuildOutput"
  | "worktreeRestorePointAfterDays" | "worktreeRestorePointIdleDays">;

/** What the reaper applies to task worktrees on one pass. */
export type ResolvedWorktreeCleanup = {
  mode: WorktreeCleanupMode;
  source: "setting" | "default";
  values: WorktreeCleanupValues;
  /** Archive a worktree whose work is merged and that is clean, after `archiveCooldownMs`. */
  archive: boolean;
  archiveCooldownMs: number;
  /** null: no compaction. */
  compactionDelayMs: number | null;
  /** Git workspace expiration, or null when off. */
  expiration: {
    restorePoints: boolean;
    /** How long the tree must have been closed. */
    terminalDelayMs: number;
    restorePointDelayMs: number;
    idleMs: number | null;
  } | null;
};

/** The level in force: the saved one, or Off. */
export function worktreeCleanupMode(saved: SavedWorktreeCleanup | null | undefined): WorktreeCleanupMode {
  return saved?.worktreeCleanup ?? "off";
}

export function resolveWorktreeCleanup(saved: SavedWorktreeCleanup | null | undefined, config: Pick<WorktreeCleanupConfig, "workspaceCompactionDelayHours">): ResolvedWorktreeCleanup {
  const mode = worktreeCleanupMode(saved);
  // Values saved without a level stay put but do nothing: the level is Off until chosen.
  const values: WorktreeCleanupValues = {
    waitDays: saved?.worktreeCleanupWaitDays ?? WORKTREE_CLEANUP_DEFAULTS.waitDays,
    removeBuildOutput: saved?.worktreeCleanupRemoveBuildOutput ?? WORKTREE_CLEANUP_DEFAULTS.removeBuildOutput,
    restorePointAfterDays: saved?.worktreeRestorePointAfterDays ?? WORKTREE_CLEANUP_DEFAULTS.restorePointAfterDays,
    restorePointIdleDays: saved?.worktreeRestorePointIdleDays ?? WORKTREE_CLEANUP_DEFAULTS.restorePointIdleDays,
  };
  const on = mode !== "off";
  return {
    mode, source: saved?.worktreeCleanup ? "setting" : "default", values,
    archive: on,
    archiveCooldownMs: values.waitDays * DAY_MS,
    // The delay stays the environment's (1 hour by default), even where it turned compaction off.
    compactionDelayMs: on && values.removeBuildOutput ? Math.max(0, config.workspaceCompactionDelayHours ?? 1) * HOUR_MS : null,
    expiration: mode === "strict" || mode === "restore_points" ? {
      restorePoints: mode === "restore_points",
      terminalDelayMs: values.waitDays * DAY_MS,
      restorePointDelayMs: values.restorePointAfterDays * DAY_MS,
      idleMs: values.restorePointIdleDays > 0 ? values.restorePointIdleDays * DAY_MS : null,
    } : null,
  };
}

/** One pass of git workspace expiration, as the terminal workspace reaper takes it. */
export type GitExpirationPass = {
  enabled: boolean;
  dryRun: boolean;
  /** The mode kept-reason records name; null records none. */
  mode: "strict" | "restore_points" | null;
  /** How long the tree must have been closed; undefined keeps upstream's fixed 1 day. */
  terminalDelayMs?: number;
  restorePoints?: { storage: StorageService; terminalDelayMs: number; keyDurable: boolean; idleMs?: number | null };
};

/** What the terminal workspace reaper does to task worktrees on one pass. */
export type WorktreeSweepRules = {
  /** Archive a worktree whose work is merged and that is clean. */
  archive: boolean;
  archiveCooldownMs: number;
  /** null: no compaction. */
  compactionDelayMs: number | null;
  expiration: GitExpirationPass;
};

/** The reaper's rules for a resolved cleanup; `storage` and `keyDurable` serve restore points. */
export function worktreeSweepRules(cleanup: ResolvedWorktreeCleanup, restorePoints: { storage: StorageService; keyDurable: boolean }): WorktreeSweepRules {
  const expiration = cleanup.expiration;
  return {
    archive: cleanup.archive,
    archiveCooldownMs: cleanup.archiveCooldownMs,
    compactionDelayMs: cleanup.compactionDelayMs,
    expiration: expiration ? {
      enabled: true,
      // A chosen level runs for real.
      dryRun: false,
      mode: cleanup.mode === "strict" || cleanup.mode === "restore_points" ? cleanup.mode : null,
      terminalDelayMs: expiration.terminalDelayMs,
      restorePoints: expiration.restorePoints ? {
        storage: restorePoints.storage,
        terminalDelayMs: expiration.restorePointDelayMs,
        idleMs: expiration.idleMs,
        keyDurable: restorePoints.keyDurable,
      } : undefined,
    } : { enabled: false, dryRun: false, mode: null },
  };
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

/** The five saved cleanup keys of the experimental settings, null where never saved. */
export function savedWorktreeCleanup(experimental: SavedWorktreeCleanup): SavedWorktreeCleanup {
  return {
    worktreeCleanup: experimental.worktreeCleanup ?? null,
    worktreeCleanupWaitDays: experimental.worktreeCleanupWaitDays ?? null,
    worktreeCleanupRemoveBuildOutput: experimental.worktreeCleanupRemoveBuildOutput ?? null,
    worktreeRestorePointAfterDays: experimental.worktreeRestorePointAfterDays ?? null,
    worktreeRestorePointIdleDays: experimental.worktreeRestorePointIdleDays ?? null,
  };
}

export async function readSavedWorktreeCleanup(db: Db): Promise<SavedWorktreeCleanup> {
  return savedWorktreeCleanup(await instanceSettingsService(db).getExperimental());
}

export async function readWorktreeCleanup(db: Db, config: WorktreeCleanupConfig): Promise<ResolvedWorktreeCleanup> {
  return resolveWorktreeCleanup(await readSavedWorktreeCleanup(db), config);
}

export function worktreeCleanupStatus(saved: SavedWorktreeCleanup | null, config: WorktreeCleanupConfig, env: Record<string, string | undefined> = process.env): WorktreeCleanupStatus {
  const resolved = resolveWorktreeCleanup(saved, config);
  const restorePoints = restorePointAvailability(config, env);
  return {
    saved: Boolean(saved?.worktreeCleanup),
    mode: resolved.mode,
    source: resolved.source,
    restorePoints: { available: restorePoints.available, reason: restorePoints.reason },
    values: resolved.values,
    retentionDays: config.gitRestorePointRetentionDays,
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

/** What the task shows: the recorded reason, only while expiration (strict or restore points) runs. */
export function visibleWorktreeKept(metadata: Record<string, unknown> | null | undefined, mode: WorktreeCleanupMode): ExecutionWorkspaceWorktreeKept | null {
  if (mode !== "strict" && mode !== "restore_points") return null;
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
  mode: "strict" | "restore_points";
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
