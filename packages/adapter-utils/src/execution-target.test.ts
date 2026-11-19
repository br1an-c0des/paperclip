import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupGitHubOperationLaunchers,
  prepareGitHubOperationLaunchers,
  adapterExecutionTargetUsesManagedHome,
  resolveAdapterExecutionTargetCwd,
} from "./execution-target.js";

// SSH and sandbox targets are tested in execution-target.dormant.test.ts (opt-in tier).

describe("runAdapterExecutionTargetShellCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps managed homes disabled for both local and SSH targets", () => {
    expect(adapterExecutionTargetUsesManagedHome(null)).toBe(false);
    expect(adapterExecutionTargetUsesManagedHome({
      kind: "remote",
      transport: "ssh",
      remoteCwd: "/srv/paperclip/workspace",
      spec: {
        host: "ssh.example.test",
        port: 22,
        username: "ssh-user",
        remoteCwd: "/srv/paperclip/workspace",
        remoteWorkspacePath: "/srv/paperclip/workspace",
        privateKey: null,
        knownHosts: null,
        strictHostKeyChecking: true,
      },
    })).toBe(false);
  });
});

describe("resolveAdapterExecutionTargetCwd", () => {
  it("keeps the local fallback cwd for local targets", () => {
    expect(resolveAdapterExecutionTargetCwd(null, "", "/Users/host/repo/server")).toBe(
      "/Users/host/repo/server",
    );
  });
});

describe("GitHub launcher lifecycle", () => {
  it("removes only the completed run's launchers and leaves concurrent runs usable", async () => {
    const first = { runId: randomUUID(), target: null };
    const second = { runId: randomUUID(), target: null };
    try {
      const a = await prepareGitHubOperationLaunchers({ ...first, cwd: "/tmp", env: {} });
      const b = await prepareGitHubOperationLaunchers({ ...second, cwd: "/tmp", env: {} });
      await cleanupGitHubOperationLaunchers(first);
      await expect(access(a.PAPERCLIP_GITHUB_LAUNCHER_DIR)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(`${b.PAPERCLIP_GITHUB_LAUNCHER_DIR}/git`, "utf8")).toContain("PAPERCLIP_GITHUB_BROKER_URL");
      await cleanupGitHubOperationLaunchers(first); // teardown replay is harmless
    } finally {
      await cleanupGitHubOperationLaunchers(first);
      await cleanupGitHubOperationLaunchers(second);
    }
  });
});
