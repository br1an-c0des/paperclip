import { describe, expect, it } from "vitest";
import {
  WORKTREE_KEPT_METADATA_KEY,
  readWorktreeKept,
  resolveWorktreeCleanup,
  restorePointAvailability,
  visibleWorktreeKept,
  worktreeCleanupMode,
  worktreeCleanupStatus,
  worktreeKeptLabel,
  type SavedWorktreeCleanup,
  type WorktreeCleanupConfig,
} from "./worktree-cleanup.js";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const config = (patch: Partial<WorktreeCleanupConfig> = {}): WorktreeCleanupConfig => ({
  storageProvider: "local_disk",
  gitRestorePointRetentionDays: 90,
  workspaceCompactionDelayHours: 1,
  ...patch,
});
const saved = (mode: SavedWorktreeCleanup["worktreeCleanup"], patch: Partial<SavedWorktreeCleanup> = {}): SavedWorktreeCleanup =>
  ({ worktreeCleanup: mode, ...patch });

describe("worktree cleanup setting (step 4b part 3)", () => {
  it("is off until a level is saved, and values saved alone don't turn it on", () => {
    for (const unsaved of [null, undefined, saved(null), saved(null, { worktreeCleanupWaitDays: 0, worktreeCleanupRemoveBuildOutput: true })]) {
      expect(worktreeCleanupMode(unsaved)).toBe("off");
      expect(resolveWorktreeCleanup(unsaved, config())).toMatchObject({
        mode: "off", source: "default", archive: false, compactionDelayMs: null, expiration: null,
      });
    }
  });

  it("off stops the archive, compaction and expiration of task worktrees", () => {
    expect(resolveWorktreeCleanup(saved("off"), config())).toMatchObject({
      mode: "off", source: "setting", archive: false, compactionDelayMs: null, expiration: null,
    });
  });

  it("each level adds its rules, with the defaults when only the level is saved", () => {
    expect(resolveWorktreeCleanup(saved("merged"), config())).toMatchObject({
      archive: true, archiveCooldownMs: DAY, compactionDelayMs: HOUR, expiration: null,
      values: { waitDays: 1, removeBuildOutput: true, restorePointAfterDays: 3, restorePointIdleDays: 7 },
    });
    expect(resolveWorktreeCleanup(saved("strict"), config())).toMatchObject({
      archive: true, expiration: { restorePoints: false, terminalDelayMs: DAY },
    });
    expect(resolveWorktreeCleanup(saved("restore_points"), config())).toMatchObject({
      archive: true, expiration: { restorePoints: true, terminalDelayMs: DAY, restorePointDelayMs: 3 * DAY, idleMs: 7 * DAY },
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

  it("reads restore points unavailable on S3 without PAPERCLIP_SECRETS_MASTER_KEY", () => {
    expect(restorePointAvailability(config({ storageProvider: "s3" }), {})).toMatchObject({ available: false, keyDurable: false, reason: expect.stringMatching(/PAPERCLIP_SECRETS_MASTER_KEY/) });
    expect(restorePointAvailability(config({ storageProvider: "s3" }), { PAPERCLIP_SECRETS_MASTER_KEY: "k" })).toMatchObject({ available: true });
    expect(restorePointAvailability(config(), {})).toMatchObject({ available: true, reason: null });
  });

  it("reports Off by default, and the values in force", () => {
    expect(worktreeCleanupStatus(null, config({ gitRestorePointRetentionDays: 30 }), {})).toEqual({
      saved: false, mode: "off", source: "default",
      restorePoints: { available: true, reason: null },
      values: { waitDays: 1, removeBuildOutput: true, restorePointAfterDays: 3, restorePointIdleDays: 7 },
      retentionDays: 30,
    });
    expect(worktreeCleanupStatus(saved("strict", { worktreeCleanupWaitDays: 2 }), config(), {}))
      .toMatchObject({ saved: true, mode: "strict", source: "setting", values: { waitDays: 2 } });
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
