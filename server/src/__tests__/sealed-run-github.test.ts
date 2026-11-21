import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupGitHubOperationLaunchers, prepareGitHubExecutionEnvironment } from "@paperclipai/adapter-utils/execution-target";
import { prepareHeartbeatGitHubLaunchers } from "../services/heartbeat-github-launchers.js";
import { decideRunGitHubAccess, isSealedClaudeRun } from "../services/heartbeat/sealed-run-github.js";

/**
 * Step 4b, agent F: a sealed claude_local CLI run gets GitHub only through a Paperclip
 * connection. Without one it gets the managed launchers with no credential, never the
 * server's own `gh` login, tokens or SSH agent. Other adapters keep the host fallback.
 */

const SEALED = { adapterType: "claude_local", adapterConfig: { engine: "cli" }, environmentDriver: "local" };
const STANDARD = { trustKind: "standard", githubConfigured: false };

describe("which runs are sealed", () => {
  it("is a claude_local run on the CLI engine on a local target", () => {
    expect(isSealedClaudeRun(SEALED)).toBe(true);
    expect(isSealedClaudeRun({ ...SEALED, environmentDriver: null })).toBe(true);
    expect(isSealedClaudeRun({ ...SEALED, adapterConfig: { engine: "acp" } })).toBe(false);
    expect(isSealedClaudeRun({ ...SEALED, environmentDriver: "ssh" })).toBe(false);
    expect(isSealedClaudeRun({ ...SEALED, environmentDriver: "sandbox" })).toBe(false);
    expect(isSealedClaudeRun({ ...SEALED, adapterType: "codex_local" })).toBe(false);
    expect(isSealedClaudeRun({ ...SEALED, adapterType: "paperclip_runner" })).toBe(false);
  });
});

describe("decideRunGitHubAccess", () => {
  it("never gives a sealed run the server's GitHub login", () => {
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD })).toEqual({ sealed: true, useHostGitHub: false });
  });

  it("uses managed mode when a GitHub connection covers the agent, sealed or not", () => {
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, githubConfigured: true }).useHostGitHub).toBe(false);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local", githubConfigured: true }).useHostGitHub).toBe(false);
  });

  it("keeps the host fallback for other adapters, engines and targets", () => {
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local" })).toEqual({ sealed: false, useHostGitHub: true });
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterConfig: { engine: "acp" } }).useHostGitHub).toBe(true);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, environmentDriver: "ssh" }).useHostGitHub).toBe(true);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local", environmentDriver: "sandbox" }).useHostGitHub).toBe(false);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local", trustKind: "low_trust_review" }).useHostGitHub).toBe(false);
  });
});

describe("a sealed run's GitHub environment", () => {
  const HOST_ENV = {
    GH_TOKEN: "host-gh-token",
    GITHUB_TOKEN: "host-github-token",
    GH_CONFIG_DIR: "/home/server-user/.config/gh",
    SSH_AUTH_SOCK: "/tmp/server-user-ssh-agent.sock",
    GIT_SSH_COMMAND: "ssh -i /home/server-user/.ssh/id_ed25519",
  };
  const saved = new Map<string, string | undefined>();
  let cwd: string;
  const runIds: string[] = [];

  beforeEach(async () => {
    for (const [key, value] of Object.entries(HOST_ENV)) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }
    cwd = await mkdtemp(path.join(tmpdir(), "paperclip-sealed-github-"));
  });

  afterEach(async () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
    for (const runId of runIds.splice(0)) await cleanupGitHubOperationLaunchers({ runId, target: null });
    await rm(cwd, { recursive: true, force: true });
  });

  /** What heartbeat.ts builds for the run: the Git context, then the launchers in managed mode. */
  async function runGitHubEnv(githubConfigured: boolean, adapterType = "claude_local") {
    const { useHostGitHub } = decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType, githubConfigured });
    const gitEnv = await prepareGitHubExecutionEnvironment({
      target: null, cwd, env: {}, hostCredentials: useHostGitHub, networkAccess: true,
    });
    if (useHostGitHub) return gitEnv;
    const runId = `sealed-github-${runIds.length}-${Date.now()}`;
    runIds.push(runId);
    const launchers = await prepareHeartbeatGitHubLaunchers({
      native: false, githubConfigured, agentId: "agent-sealed", runId, target: null, cwd, env: gitEnv,
      brokerUrl: "http://127.0.0.1:1", createBrokerToken: () => "run-capability",
    });
    return launchers.env;
  }

  it.each([false, true])("gets none of the server's GitHub setup (connection: %s)", async (githubConfigured) => {
    const env = await runGitHubEnv(githubConfigured);
    expect(env.PAPERCLIP_GITHUB_AUTH_MODE).toBe("managed");
    expect(env).not.toHaveProperty("PAPERCLIP_GITHUB_HOST_HOME");
    expect(env.GH_TOKEN ?? "").toBe("");
    expect(env.GITHUB_TOKEN ?? "").toBe("");
    expect(env.SSH_AUTH_SOCK ?? "").toBe("");
    expect(env.GIT_SSH_COMMAND).not.toContain("server-user");
    // gh reads a per-run folder under the launchers, never the server user's ~/.config/gh.
    expect(env.GH_CONFIG_DIR).toBe(path.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR!, "gh-config"));
    expect(env.PATH.split(path.delimiter)[0]).toBe(env.PAPERCLIP_GITHUB_LAUNCHER_DIR);
    // The launchers ask the broker per operation; it answers "absent" without a connection.
    expect(env.PAPERCLIP_GITHUB_BROKER_TOKEN).toBe("run-capability");
  });

  it("leaves another adapter's host fallback as it was", async () => {
    const env = await runGitHubEnv(false, "codex_local");
    expect(env.PAPERCLIP_GITHUB_AUTH_MODE).toBe("host");
    expect(env.GH_CONFIG_DIR).toBe(HOST_ENV.GH_CONFIG_DIR);
    expect(env.GH_TOKEN).toBe(HOST_ENV.GH_TOKEN);
    expect(env.SSH_AUTH_SOCK).toBe(HOST_ENV.SSH_AUTH_SOCK);
    expect(env.PAPERCLIP_GITHUB_HOST_HOME).toBeTypeOf("string");
  });
});
