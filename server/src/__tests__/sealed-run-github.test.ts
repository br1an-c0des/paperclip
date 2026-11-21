import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupGitHubOperationLaunchers, prepareGitHubExecutionEnvironment } from "@paperclipai/adapter-utils/execution-target";
import { buildGitAuthInvocation } from "../services/git-credentials.js";
import { prepareHeartbeatGitHubLaunchers } from "../services/heartbeat-github-launchers.js";
import {
  agentGitAuthor,
  decideRunGitHubAccess,
  isSealedClaudeRun,
  readServerGitIdentity,
  readUseServerGitHubLogin,
  runGitHubManifest,
  sealedRunGitHubEnv,
} from "../services/heartbeat/sealed-run-github.js";

/**
 * Step 4b, agent F: a sealed claude_local CLI run gets GitHub only through a Paperclip
 * connection. Without one it gets the managed launchers with no credential, never the
 * server's own `gh` login, tokens or SSH agent. Other adapters keep the host fallback.
 */

const exec = promisify(execFile);
const SEALED = { adapterType: "claude_local", adapterConfig: { engine: "cli" }, environmentDriver: "local" };
const STANDARD = { trustKind: "standard", githubConfigured: false, useServerLogin: false };

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

  it("gives a sealed run the server's login when the agent opted in, and no connection covers it", () => {
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, useServerLogin: true })).toEqual({ sealed: true, useHostGitHub: true });
    // A connection still wins, and low trust never gets host credentials.
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, useServerLogin: true, githubConfigured: true }).useHostGitHub).toBe(false);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, useServerLogin: true, trustKind: "low_trust_review" }).useHostGitHub).toBe(false);
  });

  it("keeps the host fallback for other adapters, engines and targets", () => {
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local" })).toEqual({ sealed: false, useHostGitHub: true });
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterConfig: { engine: "acp" } }).useHostGitHub).toBe(true);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, environmentDriver: "ssh" }).useHostGitHub).toBe(true);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local", environmentDriver: "sandbox" }).useHostGitHub).toBe(false);
    expect(decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType: "codex_local", trustKind: "low_trust_review" }).useHostGitHub).toBe(false);
  });
});

describe("runGitHubManifest", () => {
  it("records the connection and its account when one covers the agent", () => {
    const grant = { providerTenant: { github: { login: "octocat" } } };
    expect(runGitHubManifest({ useHostGitHub: false, selection: { configured: true, identitySource: "dedicated", grant } }))
      .toEqual({ mode: "connection", identitySource: "dedicated", login: "octocat" });
    // Configured but unavailable: still the connection, with no account to name.
    expect(runGitHubManifest({ useHostGitHub: false, selection: { configured: true, identitySource: "personal" } }))
      .toEqual({ mode: "connection", identitySource: "personal", login: null });
  });

  it("records the server's login, or none", () => {
    expect(runGitHubManifest({ useHostGitHub: true, selection: { configured: false } })).toEqual({ mode: "server_login" });
    expect(runGitHubManifest({ useHostGitHub: false, selection: { configured: false } })).toEqual({ mode: "none" });
  });
});

describe("the opt-in", () => {
  it("reads runtimeConfig.github.useServerLogin, off unless exactly true", () => {
    expect(readUseServerGitHubLogin({ github: { useServerLogin: true } })).toBe(true);
    expect(readUseServerGitHubLogin({ github: { useServerLogin: false } })).toBe(false);
    expect(readUseServerGitHubLogin({ github: { useServerLogin: "true" } })).toBe(false);
    expect(readUseServerGitHubLogin({ github: {} })).toBe(false);
    expect(readUseServerGitHubLogin({})).toBe(false);
    expect(readUseServerGitHubLogin(null)).toBe(false);
  });
});

describe("the server's git identity in server-login mode", () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), "paperclip-server-gitconfig-")); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });
  const hostEnv = (extra: Record<string, string> = {}) => ({
    PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), GIT_CONFIG_NOSYSTEM: "1", ...extra,
  });

  it("reads the global user.name and user.email", async () => {
    await writeFile(path.join(home, ".gitconfig"), "[user]\n\tname = Server Person\n\temail = server@example.test\n");
    expect(await readServerGitIdentity(hostEnv())).toEqual({ name: "Server Person", email: "server@example.test" });
  });

  it("prefers the server's GIT_COMMITTER_* values", async () => {
    await writeFile(path.join(home, ".gitconfig"), "[user]\n\tname = Server Person\n\temail = server@example.test\n");
    expect(await readServerGitIdentity(hostEnv({ GIT_COMMITTER_NAME: "Env Person", GIT_COMMITTER_EMAIL: "env@example.test" })))
      .toEqual({ name: "Env Person", email: "env@example.test" });
  });

  it("is null without both a name and an email", async () => {
    expect(await readServerGitIdentity(hostEnv())).toBeNull();
    await writeFile(path.join(home, ".gitconfig"), "[user]\n\tname = Server Person\n");
    expect(await readServerGitIdentity(hostEnv())).toBeNull();
  });

  it("becomes the committer of a sealed run in server-login mode, with the agent as author", async () => {
    const readServerIdentity = async () => ({ name: "Server Person", email: "server@example.test" });
    expect(await sealedRunGitHubEnv({ access: { sealed: true, useHostGitHub: true }, agent: AGENT, readServerIdentity })).toEqual({
      PAPERCLIP_GIT_AUTHOR_NAME: AGENT_NAME, PAPERCLIP_GIT_AUTHOR_EMAIL: AGENT_EMAIL,
      GIT_AUTHOR_NAME: AGENT_NAME, GIT_AUTHOR_EMAIL: AGENT_EMAIL,
      GIT_COMMITTER_NAME: "Server Person", GIT_COMMITTER_EMAIL: "server@example.test",
    });
  });
});

const AGENT = { id: "6f1c2b9e-0d4a-4e8b-9a51-3c7d2e8f1a20", name: "Builder", title: "Senior engineer" };
const AGENT_NAME = "Builder (Senior engineer)";
const AGENT_EMAIL = "6f1c2b9e-0d4a-4e8b-9a51-3c7d2e8f1a20@agents.paperclip.invalid";

describe("the commit author", () => {
  it("is the agent's name and title, with a stable .invalid address", () => {
    expect(agentGitAuthor(AGENT)).toEqual({ name: AGENT_NAME, email: AGENT_EMAIL });
    // Renaming keeps the address.
    expect(agentGitAuthor({ ...AGENT, name: "Renamed" }).email).toBe(AGENT_EMAIL);
  });

  it("is the name alone without a title", () => {
    expect(agentGitAuthor({ ...AGENT, title: null }).name).toBe("Builder");
    expect(agentGitAuthor({ ...AGENT, title: "  " }).name).toBe("Builder");
  });

  it("drops characters git can't keep in a name", () => {
    expect(agentGitAuthor({ ...AGENT, name: "Bob <evil>\nX", title: "QA\tlead" }).name).toBe("Bob evil X (QA lead)");
  });

  it("reaches the launchers in managed mode, which apply it", async () => {
    expect(await sealedRunGitHubEnv({ access: { sealed: true, useHostGitHub: false }, agent: AGENT }))
      .toEqual({ PAPERCLIP_GIT_AUTHOR_NAME: AGENT_NAME, PAPERCLIP_GIT_AUTHOR_EMAIL: AGENT_EMAIL });
  });

  it("is the committer too in server-login mode when the server has no git identity", async () => {
    expect(await sealedRunGitHubEnv({ access: { sealed: true, useHostGitHub: true }, agent: AGENT, readServerIdentity: async () => null }))
      .toMatchObject({ GIT_AUTHOR_NAME: AGENT_NAME, GIT_COMMITTER_NAME: AGENT_NAME, GIT_COMMITTER_EMAIL: AGENT_EMAIL });
  });

  it("leaves runs that aren't sealed alone", async () => {
    expect(await sealedRunGitHubEnv({ access: { sealed: false, useHostGitHub: true }, agent: AGENT })).toEqual({});
    expect(await sealedRunGitHubEnv({ access: { sealed: false, useHostGitHub: false }, agent: AGENT })).toEqual({});
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

  /**
   * What execution-configuration.ts and heartbeat.ts build for the run: the GitHub variables
   * of its mode, the Git context, then the launchers in managed mode.
   */
  async function runGitHubEnv(githubConfigured: boolean, adapterType = "claude_local", useServerLogin = false, options: {
    brokerUrl?: string; agent?: { id: string; name: string; title?: string | null }; serverIdentity?: { name: string; email: string } | null;
  } = {}) {
    const access = decideRunGitHubAccess({ ...SEALED, ...STANDARD, adapterType, githubConfigured, useServerLogin });
    const runEnv = await sealedRunGitHubEnv({
      access, agent: options.agent ?? AGENT, readServerIdentity: async () => options.serverIdentity ?? null,
    });
    const gitEnv = await prepareGitHubExecutionEnvironment({
      target: null, cwd, env: runEnv, hostCredentials: access.useHostGitHub, networkAccess: true,
    });
    if (access.useHostGitHub) return gitEnv;
    const runId = `sealed-github-${runIds.length}-${Date.now()}`;
    runIds.push(runId);
    const launchers = await prepareHeartbeatGitHubLaunchers({
      native: false, githubConfigured, agentId: AGENT.id, runId, target: null, cwd, env: gitEnv,
      brokerUrl: options.brokerUrl ?? "http://127.0.0.1:1", createBrokerToken: () => "run-capability",
    });
    return launchers.env;
  }

  /** A fake broker: the answer `/runtime-tools/github/credentials` gives the launchers. */
  async function fakeBroker(answer: Record<string, unknown>): Promise<string> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    brokers.push(server);
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  const brokers: Server[] = [];
  afterEach(async () => {
    for (const server of brokers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Commits one file in a fresh repo with the run's `git` (the launcher, when the run has one). */
  async function commitAs(env: Record<string, string>): Promise<string> {
    const repo = path.join(cwd, `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await exec("git", ["init", "-q", repo]);
    await writeFile(path.join(repo, "work.txt"), "work\n");
    // The sealed launch: the server's allowlisted values, the run's env, Paperclip's HOME.
    const home = path.join(cwd, "sealed-home");
    await mkdir(home, { recursive: true });
    const launchEnv = { PATH: process.env.PATH ?? "", ...env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") };
    const git = env.PAPERCLIP_GITHUB_LAUNCHER_DIR ? path.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR, "git") : "git";
    await exec(git, ["-C", repo, "add", "work.txt"], { env: launchEnv });
    await exec(git, ["-C", repo, "commit", "-q", "-m", "Work"], { env: launchEnv });
    return (await exec("git", ["-C", repo, "log", "-1", "--format=%an <%ae> | %cn <%ce>"])).stdout.trim();
  }

  it("commits as the agent, with the connection's account as committer", async () => {
    const answer = buildGitAuthInvocation({
      token: "fake-token-not-real", source: "managed_connection", secretName: null,
      githubIdentity: { userId: "583231", login: "octocat" },
    });
    const brokerUrl = await fakeBroker({ status: "available", login: "octocat", env: answer.env });
    const env = await runGitHubEnv(true, "claude_local", false, { brokerUrl });
    expect(await commitAs(env)).toBe(`${AGENT_NAME} <${AGENT_EMAIL}> | octocat <583231+octocat@users.noreply.github.com>`);
  });

  it("commits as the agent alone when no connection covers it", async () => {
    const brokerUrl = await fakeBroker({ status: "absent", reason: "No GitHub identity connected" });
    const env = await runGitHubEnv(false, "claude_local", false, { brokerUrl });
    expect(await commitAs(env)).toBe(`${AGENT_NAME} <${AGENT_EMAIL}> | ${AGENT_NAME} <${AGENT_EMAIL}>`);
  });

  it("names a title-less agent alone", async () => {
    const brokerUrl = await fakeBroker({ status: "absent" });
    const env = await runGitHubEnv(false, "claude_local", false, { brokerUrl, agent: { ...AGENT, title: null } });
    expect(await commitAs(env)).toBe(`Builder <${AGENT_EMAIL}> | Builder <${AGENT_EMAIL}>`);
  });

  it("commits as the agent, with the server's identity as committer, in server-login mode", async () => {
    // The server's own author value reaches host mode, and the agent's wins over it.
    if (!saved.has("GIT_AUTHOR_NAME")) saved.set("GIT_AUTHOR_NAME", process.env.GIT_AUTHOR_NAME);
    process.env.GIT_AUTHOR_NAME = "Server Author";
    const env = await runGitHubEnv(false, "claude_local", true, { serverIdentity: { name: "Server Person", email: "server@example.test" } });
    expect(await commitAs(env)).toBe(`${AGENT_NAME} <${AGENT_EMAIL}> | Server Person <server@example.test>`);
  });

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

  it("gets the server's login when the agent opted in", async () => {
    const env = await runGitHubEnv(false, "claude_local", true);
    expect(env.PAPERCLIP_GITHUB_AUTH_MODE).toBe("host");
    expect(env.GH_CONFIG_DIR).toBe(HOST_ENV.GH_CONFIG_DIR);
    expect(env.GH_TOKEN).toBe(HOST_ENV.GH_TOKEN);
    expect(env.SSH_AUTH_SOCK).toBe(HOST_ENV.SSH_AUTH_SOCK);
    expect(env.PAPERCLIP_GITHUB_HOST_HOME).toBeTypeOf("string");
    expect(env).not.toHaveProperty("PAPERCLIP_GITHUB_LAUNCHER_DIR");
  });
});
