import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterRunPreviewContext, AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";
import type { ClaudeRunManifest } from "@paperclipai/shared";
import { execute } from "./execute.js";
import { previewClaudeRun } from "./preview.js";

/**
 * The run preview against a real launch (fork/step-4b-parts-2-3.md, part 2): for the same
 * inputs, `previewClaudeRun` (planning only) gives the manifest `execute` (planning and acting)
 * records, less the session and what was set aside, and leaves nothing behind.
 */

const FAKE_CLAUDE = `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("2.1.325 (Claude Code)"); process.exit(0); }
require("node:fs").readFileSync(0, "utf8");
const sessionId = "11111111-1111-4111-8111-111111111111";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "claude-sonnet" }));
console.log(JSON.stringify({ type: "result", subtype: "success", session_id: sessionId, result: "done", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
`;

const AGENT = { id: "agent-preview", companyId: "company-preview", name: "M7 test preview", adapterType: "claude_local", adapterConfig: {} };
const SERVERS: AdapterRuntimeMcpServer[] = [
  { name: "paperclip", url: "http://127.0.0.1:3100/api/mcp/paperclip", token: "run-token", connectionId: "paperclip" },
  { name: "Paperclip connections", url: "http://127.0.0.1:3100/mcp/runtime-tools", token: "tools-token", connectionId: "paperclip-runtime-tools" },
];

let root: string;
let repo: string;
let commandPath: string;
let instructionsPath: string;
const savedEnv = new Map<string, string | undefined>();

function setEnv(key: string, value: string) {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  process.env[key] = value;
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-preview-")));
  repo = path.join(root, "repo");
  await fs.mkdir(path.join(repo, ".git"), { recursive: true });
  await fs.mkdir(path.join(repo, ".claude", "skills", "release"), { recursive: true });
  await fs.writeFile(path.join(repo, "CLAUDE.md"), "# Rules\n", "utf8");
  await fs.writeFile(path.join(repo, ".claude", "skills", "release", "SKILL.md"), "---\nname: release\n---\n", "utf8");
  commandPath = path.join(root, "bin", "claude");
  await fs.mkdir(path.dirname(commandPath), { recursive: true });
  await fs.writeFile(commandPath, FAKE_CLAUDE, "utf8");
  await fs.chmod(commandPath, 0o755);
  instructionsPath = path.join(root, "AGENTS.md");
  await fs.writeFile(instructionsPath, "You are a test agent.\n", "utf8");
  setEnv("HOME", root);
  setEnv("PAPERCLIP_HOME", path.join(root, "paperclip-home"));
  setEnv("PAPERCLIP_INSTANCE_ID", "preview-test");
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  await fs.rm(root, { recursive: true, force: true });
});

function inputs(overrides: {
  config?: Record<string, unknown>;
  env?: Record<string, string>;
  context?: Record<string, unknown>;
} = {}) {
  const config = {
    engine: "cli",
    command: commandPath,
    promptTemplate: "Do the work.",
    instructionsFilePath: instructionsPath,
    extraArgs: ["--verbose"],
    ...overrides.config,
    env: overrides.env ?? { CLAUDE_CODE_OAUTH_TOKEN: "test-token", HOME: "/configured/home" },
  };
  const context = {
    paperclipAgentAccess: { level: "worker", overrides: {} },
    paperclipGitHub: { mode: "none" },
    ...overrides.context,
  };
  return { config, context };
}

function workspace(projectId: string | null, switches: { agentsReadClaudeMd?: boolean; agentsUseRepoSkills?: boolean } = {}) {
  return {
    paperclipWorkspace: {
      cwd: projectId ? repo : path.join(root, "agent-home"),
      source: projectId ? "project_primary" : "agent_home",
      projectId,
      agentsReadClaudeMd: switches.agentsReadClaudeMd ?? (projectId ? true : null),
      agentsUseRepoSkills: switches.agentsUseRepoSkills ?? (projectId ? true : null),
    },
  };
}

async function runManifest(input: ReturnType<typeof inputs>): Promise<ClaudeRunManifest> {
  let manifest: Record<string, unknown> | undefined;
  const ctx = {
    runId: "run-preview-1",
    agent: AGENT,
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: input.config,
    context: input.context,
    authToken: "run-token",
    runtimeMcp: { getServers: () => SERVERS },
    onLog: async () => {},
    onMeta: async (meta: { runManifest?: Record<string, unknown> }) => {
      if (meta.runManifest) manifest = meta.runManifest;
    },
  } as unknown as AdapterExecutionContext;
  const result = await execute(ctx);
  expect(result.exitCode).toBe(0);
  expect(manifest).toBeDefined();
  return manifest as unknown as ClaudeRunManifest;
}

function previewContext(input: ReturnType<typeof inputs>, overrides: Partial<AdapterRunPreviewContext> = {}): AdapterRunPreviewContext {
  return {
    agent: AGENT,
    config: input.config,
    context: input.context,
    runtimeMcp: { getServers: () => SERVERS.map((server) => ({ ...server, token: "<placeholder>" })) },
    runTokenAvailable: true,
    ...overrides,
  };
}

async function expectSameAsRun(input: ReturnType<typeof inputs>) {
  const preview = await previewClaudeRun(previewContext(input));
  const ran = await runManifest(input);
  expect(preview.supported).toBe(true);
  if (!preview.supported) return ran;
  expect(preview.blockers).toEqual([]);
  const { session: _session, setAside: _setAside, ...rest } = ran;
  expect(preview.manifest).toEqual(rest);
  return ran;
}

describe("previewClaudeRun", () => {
  it("matches a real launch for a task in no project", async () => {
    const ran = await expectSameAsRun(inputs({ context: workspace(null) }));
    expect(ran.claudeMd).toEqual({ enabled: false, reason: "no_project" });
    expect(ran.overriddenEnv).toEqual(["HOME"]);
    expect(ran.instructions).toEqual({ entryFile: instructionsPath, sent: true });
  });

  it("matches a real launch for a task in a project with both switches on", async () => {
    const ran = await expectSameAsRun(inputs({ context: workspace("project-1") }));
    expect(ran.claudeMd).toEqual({ enabled: true, path: path.join(repo, "CLAUDE.md") });
    expect(ran.repoSkills).toMatchObject({ enabled: true, count: 1 });
  });

  it("matches a real launch for a task in a project with both switches off", async () => {
    const ran = await expectSameAsRun(inputs({
      context: workspace("project-1", { agentsReadClaudeMd: false, agentsUseRepoSkills: false }),
    }));
    expect(ran.claudeMd).toEqual({ enabled: false, reason: "project_switch_off" });
    expect(ran.repoSkills).toEqual({ enabled: false, reason: "project_switch_off" });
  });

  it("makes no config folder, plugin folder, MCP config, prompt bundle or temporary HOME", async () => {
    const tempBefore = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("paperclip-claude-home-"));
    const preview = await previewClaudeRun(previewContext(inputs({ context: workspace("project-1") })));
    expect(preview.supported).toBe(true);
    expect(await fs.readdir(root)).not.toContain("paperclip-home");
    expect((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("paperclip-claude-home-"))).toEqual(tempBefore);
    expect(await fs.readdir(repo)).toEqual(expect.not.arrayContaining([".paperclip"]));
  });

  it("isn't available on the ACP engine or a remote target", async () => {
    expect(await previewClaudeRun(previewContext(inputs({ config: { engine: "acp" } }))))
      .toEqual({ supported: false, reason: "not_cli_engine" });
    expect(await previewClaudeRun(previewContext(inputs(), {
      executionTarget: {
        kind: "remote", transport: "ssh", remoteCwd: "/remote/workspace",
        spec: { host: "ssh.example.test", port: 22, username: "agent", remoteCwd: "/remote/workspace", remoteWorkspacePath: "/remote/workspace",
          privateKey: null, knownHosts: null, strictHostKeyChecking: true },
      } as never,
    }))).toEqual({ supported: false, reason: "remote_target" });
  });

  it("lists what part 1 refuses at launch, credential first among them", async () => {
    const noCredential = await previewClaudeRun(previewContext(inputs({ env: {} })));
    expect(noCredential.supported && noCredential.blockers.map((blocker) => blocker.code)).toEqual(["claude_credential_missing"]);
    expect(noCredential.supported && noCredential.manifest.credential).toBeNull();

    const noToken = await previewClaudeRun(previewContext(inputs({ env: {} }), { runTokenAvailable: false }));
    expect(noToken.supported && noToken.blockers.map((blocker) => blocker.code))
      .toEqual(["paperclip_mcp_unavailable", "claude_credential_missing"]);

    const noServer = await previewClaudeRun(previewContext(inputs(), { runtimeMcp: { getServers: () => [] } }));
    expect(noServer.supported && noServer.blockers.map((blocker) => blocker.code)).toEqual(["paperclip_mcp_unavailable"]);
    expect(noServer.supported && noServer.manifest.mcpServers).toEqual([]);
  });
});
