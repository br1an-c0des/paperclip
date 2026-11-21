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
} from "./worktree-cleanup.js";

const config = (patch: Partial<Parameters<typeof worktreeCleanupStatus>[1]> = {}) => ({
  gitCacheExpirationEnabled: false,
  gitCacheExpirationDryRun: true,
  gitRestorePointsEnabled: false,
  storageProvider: "local_disk",
  gitRestorePointTerminalDelayDays: 3,
  gitRestorePointIdleDays: 7,
  gitRestorePointRetentionDays: 90,
  ...patch,
});

describe("worktree cleanup setting (step 4b part 3)", () => {
  it("is off by default, and a saved mode runs for real", () => {
    expect(resolveWorktreeCleanup(null, config())).toEqual({ mode: "off", source: "environment", dryRun: false });
    expect(resolveWorktreeCleanup("strict", config())).toEqual({ mode: "strict", source: "setting", dryRun: false });
    expect(resolveWorktreeCleanup("restore_points", config())).toEqual({ mode: "restore_points", source: "setting", dryRun: false });
    expect(resolveWorktreeCleanup("off", config({ gitCacheExpirationEnabled: true }))).toEqual({ mode: "off", source: "setting", dryRun: false });
  });

  it("falls back to the environment variables while never saved, keeping their dry run", () => {
    expect(resolveWorktreeCleanup(undefined, config({ gitCacheExpirationEnabled: true }))).toEqual({ mode: "strict", source: "environment", dryRun: true });
    expect(resolveWorktreeCleanup(null, config({ gitCacheExpirationEnabled: true, gitRestorePointsEnabled: true, gitCacheExpirationDryRun: false })))
      .toEqual({ mode: "restore_points", source: "environment", dryRun: false });
    expect(environmentWorktreeCleanupFlags({ PAPERCLIP_GIT_CACHE_EXPIRATION_ENABLED: "true", PAPERCLIP_GIT_CACHE_EXPIRATION_DRY_RUN: "false" }))
      .toEqual({ gitCacheExpirationEnabled: true, gitCacheExpirationDryRun: false, gitRestorePointsEnabled: false });
  });

  it("reads restore points unavailable on S3 without PAPERCLIP_SECRETS_MASTER_KEY", () => {
    expect(restorePointAvailability(config({ storageProvider: "s3" }), {})).toMatchObject({ available: false, keyDurable: false, reason: expect.stringMatching(/PAPERCLIP_SECRETS_MASTER_KEY/) });
    expect(restorePointAvailability(config({ storageProvider: "s3" }), { PAPERCLIP_SECRETS_MASTER_KEY: "k" })).toMatchObject({ available: true });
    expect(restorePointAvailability(config(), {})).toMatchObject({ available: true, reason: null });
  });

  it("reports the day counts in force", () => {
    expect(worktreeCleanupStatus(null, config({ gitRestorePointIdleDays: 0 }), {}).days).toEqual({ strictDelay: 1, restorePointDelay: 3, idle: 0, retention: 90 });
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

  it("shows the recorded reason only while the sweep is on", () => {
    expect(readWorktreeKept(kept("upstream_commit_unverified"))).toMatchObject({ label: "branch not pushed" });
    expect(visibleWorktreeKept(kept("upstream_commit_unverified"), "strict")).toMatchObject({ reason: "upstream_commit_unverified" });
    expect(visibleWorktreeKept(kept("upstream_commit_unverified"), "off")).toBeNull();
    expect(visibleWorktreeKept({}, "strict")).toBeNull();
    expect(readWorktreeKept(kept("upstream_commit_unverified", "bogus"))).toBeNull();
  });
});
