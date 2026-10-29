import { describe, expect, it } from "vitest";
import { serverInfoRows } from "./server-info-model";

type Health = Parameters<typeof serverInfoRows>[0];

const health = (serverInfo: unknown, devServer?: unknown) => ({ status: "ok", serverInfo, devServer }) as unknown as Health;

describe("serverInfoRows", () => {
  it("shows a placeholder while loading or after a failure", () => {
    expect(serverInfoRows(undefined, { loading: true, failed: false }).map((row) => row.value)).toEqual(["Loading…", "Loading…", "Loading…"]);
    expect(serverInfoRows(undefined, { loading: false, failed: true })[1]!.value).toBe("Health unavailable");
  });

  it("reads the commit and a clean checkout", () => {
    const rows = serverInfoRows(
      health({ processStartedAt: "2026-10-28T10:00:00Z", git: { available: true, shortSha: "abc1234", subject: "Fix it", localChanges: { available: true, hasLocalChanges: false } } }),
      { loading: false, failed: false },
    );
    expect(rows[0]!.dateTime).toBe("2026-10-28T10:00:00Z");
    expect(rows[1]!.value).toBe("abc1234 · Fix it");
    expect(rows[2]!.value).toBe("Clean checkout");
  });

  it("counts local changes and prefers a dev server's last restart", () => {
    const rows = serverInfoRows(
      health(
        {
          processStartedAt: "2026-10-28T10:00:00Z",
          git: { available: true, shortSha: "abc", subject: "x", localChanges: { available: true, hasLocalChanges: true, stagedFileCount: 0, unstagedFileCount: 2, untrackedFileCount: 1 } },
        },
        { lastRestartAt: "2026-10-28T11:00:00Z" },
      ),
      { loading: false, failed: false },
    );
    expect(rows[0]!.dateTime).toBe("2026-10-28T11:00:00Z");
    expect(rows[2]!.value).toBe("Local changes (2 unstaged, 1 untracked)");
  });

  it("says what's unavailable", () => {
    const rows = serverInfoRows(health({ git: { available: false } }), { loading: false, failed: false });
    expect(rows.map((row) => row.value)).toEqual(["Unavailable", "Commit unavailable", "Unavailable"]);
  });
});
