import { describe, expect, it } from "vitest";
import {
  WORKTREE_KEPT_METADATA_KEY,
  environmentWorktreeCleanupFlags,
  readWorktreeKept,
  resolveWorktreeCleanup,
  restorePointAvailability,
  visibleWorktreeKept,
  worktreeCleanupStatus,
  worktreeKeptLabel,
  type SavedWorktreeCleanup,
  type WorktreeCleanupConfig,
} from "./worktree-cleanup.js";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const config = (patch: Partial<WorktreeCleanupConfig> = {}): WorktreeCleanupConfig => ({
  gitCacheExpirationEnabled: false,
  gitCacheExpirationDryRun: true,
  gitRestorePointsEnabled: false,
  storageProvider: "local_disk",
  gitRestorePointTerminalDelayDays: 3,
  gitRestorePointIdleDays: 7,
  gitRestorePointRetentionDays: 90,
  workspaceReaperCooldownDays: 1,
  workspaceCompactionDelayHours: 1,
  ...patch,
});
const saved = (mode: SavedWorktreeCleanup["worktreeCleanup"], patch: Partial<SavedWorktreeCleanup> = {}): SavedWorktreeCleanup =>
  ({ worktreeCleanup: mode, ...patch });

describe("worktree cleanup setting (step 4b part 3)", () => {
  it("off stops the archive, compaction and expiration of task worktrees", () => {
    expect(resolveWorktreeCleanup(saved("off"), config({ gitCacheExpirationEnabled: true }))).toMatchObject({
      mode: "off", source: "setting", dryRun: false, archive: false, compactionDelayMs: null, expiration: null,
    });
  });

  it("each level adds its rules, with the defaults when only the level is saved", () => {
    expect(resolveWorktreeCleanup(saved("merged"), config())).toMatchObject({
      archive: true, archiveCooldownMs: DAY, compactionDelayMs: HOUR, expiration: null,
      values: { waitDays: 1, removeBuildOutput: true, restorePointAfterDays: 3, restorePointIdleDays: 7 },
    });
    expect(resolveWorktreeCleanup(saved("strict"), config())).toMatchObject({
      archive: true, expiration: { dryRun: false, restorePoints: false, terminalDelayMs: DAY },
    });
    expect(resolveWorktreeCleanup(saved("restore_points"), config())).toMatchObject({
      archive: true, expiration: { dryRun: false, restorePoints: true, terminalDelayMs: DAY, restorePointDelayMs: 3 * DAY, idleMs: 7 * DAY },
    });
  });

  it("uses the saved wait, compaction and restore point values", () => {
    const resolved = resolveWorktreeCleanup(saved("restore_points", { worktreeCleanupWaitDays: 4, worktreeCleanupRemoveBuildOutput: false,
      worktreeRestorePointAfterDays: 5, worktreeRestorePointIdleDays: 0 }), config({ workspaceCompactionDelayHours: null }));
    expect(resolved).toMatchObject({ archiveCooldownMs: 4 * DAY, compactionDelayMs: null,
      expiration: { terminalDelayMs: 4 * DAY, restorePointDelayMs: 5 * DAY, idleMs: null } });
    // Compaction on uses the environment's delay, even where the environment turned compaction off.
    expect(resolveWorktreeCleanup(saved("merged"), config({ workspaceCompactionDelayHours: null })).compactionDelayMs).toBe(HOUR);
    expect(resolveWorktreeCleanup(saved("merged"), config({ workspaceCompactionDelayHours: 6 })).compactionDelayMs).toBe(6 * HOUR);
  });

  it("falls back to the environment's rules while never saved", () => {
    expect(resolveWorktreeCleanup(null, config())).toMatchObject({
      mode: "merged", source: "environment", dryRun: false, archive: true, archiveCooldownMs: DAY, compactionDelayMs: HOUR, expiration: null,
    });
    expect(resolveWorktreeCleanup({ worktreeCleanup: null, worktreeCleanupWaitDays: 9 },
      config({ workspaceReaperCooldownDays: 2, workspaceCompactionDelayHours: null }))).toMatchObject({
      mode: "merged", archiveCooldownMs: 2 * DAY, compactionDelayMs: null, values: { waitDays: 2, removeBuildOutput: false },
    });
    const strict = resolveWorktreeCleanup(undefined, config({ gitCacheExpirationEnabled: true }));
    expect(strict).toMatchObject({ mode: "strict", dryRun: true, expiration: { dryRun: true, restorePoints: false } });
    expect(strict.expiration?.terminalDelayMs).toBeUndefined();
    expect(resolveWorktreeCleanup(null, config({ gitCacheExpirationEnabled: true, gitRestorePointsEnabled: true, gitCacheExpirationDryRun: false })))
      .toMatchObject({ mode: "restore_points", dryRun: false, expiration: { restorePoints: true, restorePointDelayMs: 3 * DAY } });
    expect(environmentWorktreeCleanupFlags({ PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED: "true", PAPERCLIP_GIT_CACHE_EXPIRATION_DRY_RUN: "false" }))
      .toEqual({ gitCacheExpirationEnabled: true, gitCacheExpirationDryRun: false, gitRestorePointsEnabled: false });
  });

  it("reads restore points unavailable on S3 without PAPERCLIP_SECRETS_MASTER_KEY", () => {
    expect(restorePointAvailability(config({ storageProvider: "s3" }), {})).toMatchObject({ available: false, keyDurable: false, reason: expect.stringMatching(/PAPERCLIP_SECRETS_MASTER_KEY/) });
    expect(restorePointAvailability(config({ storageProvider: "s3" }), { PAPERCLIP_SECRETS_MASTER_KEY: "k" })).toMatchObject({ available: true });
    expect(restorePointAvailability(config(), {})).toMatchObject({ available: true, reason: null });
  });

  it("reports the values in force", () => {
    expect(worktreeCleanupStatus(null, config({ gitRestorePointIdleDays: 0 }), {})).toEqual({
      saved: null, mode: "merged", source: "environment", dryRun: false,
      restorePoints: { available: true, reason: null },
      values: { waitDays: 1, removeBuildOutput: true, restorePointAfterDays: 3, restorePointIdleDays: 0 },
      retentionDays: 90,
    });
    expect(worktreeCleanupStatus(saved("off"), config(), {})).toMatchObject({ saved: "off", mode: "off", source: "setting" });
  });
});

describe("why a worktree was kept", () => {
  const kept = (reason: string, mode = "strict") => ({ [WORKTREE_KEPT_METADATA_KEY]: { reason, mode, at: "2026-11-21T00:00:00.000Z" } });

  it("labels the lasting skip reasons and ignores transient ones", () => {
    expect(worktreeKeptLabel("upstream_commit_unverified")).toBe("branch not pushed");
    expect(worktreeKeptLabel("dirty_or_untracked_files")).toBe("uncommitted changes");
    expect(worktreeKeptLabel("unsupported_index_flags")).toBe("its git state can't be saved");
    expect(worktreeKeptLabel("live_or_unresolved_consumer")).toBeNull();
    expect(worktreeKeptLabel("lifecycle_busy")).toBeNull();
  });

  it("shows the recorded reason only while expiration runs (strict or restore points)", () => {
    expect(readWorktreeKept(kept("upstream_commit_unverified"))).toMatchObject({ label: "branch not pushed" });
    expect(visibleWorktreeKept(kept("upstream_commit_unverified"), "strict")).toMatchObject({ reason: "upstream_commit_unverified" });
    expect(visibleWorktreeKept(kept("upstream_commit_unverified"), "restore_points")).toMatchObject({ reason: "upstream_commit_unverified" });
    expect(visibleWorktreeKept(kept("upstream_commit_unverified"), "merged")).toBeNull();
    expect(visibleWorktreeKept(kept("upstream_commit_unverified"), "off")).toBeNull();
    expect(visibleWorktreeKept({}, "strict")).toBeNull();
    expect(readWorktreeKept(kept("upstream_commit_unverified", "bogus"))).toBeNull();
  });
});
