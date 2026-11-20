import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { execute } from "@paperclipai/adapter-claude-local/server";
import { sealedRunInputs, SEALED_TEST_CLAUDE_TOKEN } from "./helpers/claude-local-sealed-run.js";

/**
 * Sealed `claude_local` CLI runs on a local target (fork/step-4b-plan.md, Tasks 7 and 8): what
 * a run gets from Paperclip, and nothing from the server's own environment. A fake `claude`
 * records what it was started with; no real Claude runs.
 */

type Capture = {
  argv: string[];
  prompt: string;
  env: Record<string, string>;
  homeExists: boolean;
  pluginSkills: string[];
};

async function writeFakeClaude(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("2.1.325 (Claude Code)"); process.exit(0); }
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const pluginSkills = [];
argv.forEach((arg, index) => {
  if (arg !== "--plugin-dir") return;
  const dir = argv[index + 1];
  for (const plugin of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const skillsDir = path.join(dir, plugin, "skills");
    for (const skill of fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).sort() : []) {
      if (fs.existsSync(path.join(skillsDir, skill, "SKILL.md"))) pluginSkills.push(plugin + ":" + skill);
    }
  }
});
const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify({
    argv,
    prompt: fs.readFileSync(0, "utf8"),
    env: process.env,
    homeExists: Boolean(process.env.HOME) && fs.existsSync(process.env.HOME),
    pluginSkills,
  }), "utf8");
}
if (process.env.PAPERCLIP_TEST_POISON_RESUME === "1" && argv.includes("--resume")) {
  console.log(JSON.stringify({
    type: "result", subtype: "success", is_error: true, session_id: argv[argv.indexOf("--resume") + 1],
    result: "API Error: 400 diagnostics.previous_message_id: must be the \`id\` from a prior /v1/messages response (starts with \`msg_\`)",
  }));
  process.exit(1);
}
const delayMs = Number(process.env.PAPERCLIP_TEST_DELAY_MS || 0);
setTimeout(() => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "claude-sonnet" }));
  console.log(JSON.stringify({ type: "result", subtype: "success", session_id: sessionId, result: "done", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
}, delayMs);
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

const SERVER_ENV = {
  BETTER_AUTH_SECRET: "server-better-auth-secret",
  PAPERCLIP_AGENT_JWT_SECRET: "server-jwt-secret",
  DATABASE_URL: "postgres://server@localhost/paperclip",
  ANTHROPIC_API_KEY: "",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
} as const;

let root: string;
let workspace: string;
let commandPath: string;
let capturePath: string;
const savedEnv = new Map<string, string | undefined>();

function setProcessEnv(key: string, value: string): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  process.env[key] = value;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-sealed-"));
  workspace = path.join(root, "workspace");
  commandPath = path.join(root, "bin", "claude");
  capturePath = path.join(root, "capture.json");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.dirname(commandPath), { recursive: true });
  await writeFakeClaude(commandPath);
  for (const [key, value] of Object.entries(SERVER_ENV)) setProcessEnv(key, value);
  setProcessEnv("HOME", root);
  setProcessEnv("PAPERCLIP_HOME", path.join(root, "paperclip-home"));
  setProcessEnv("PAPERCLIP_INSTANCE_ID", "sealed-test");
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  await fs.rm(root, { recursive: true, force: true });
});

const AGENT = { id: "agent-sealed", companyId: "company-sealed", name: "M7 test sealed", adapterType: "claude_local", adapterConfig: {} };

function agentFolder(): string {
  return path.join(root, "paperclip-home", "instances", "sealed-test", "companies", AGENT.companyId, "agents", AGENT.id);
}

function buildContext(overrides: {
  runId?: string;
  config?: Record<string, unknown>;
  configEnv?: Record<string, string>;
  context?: Record<string, unknown>;
  runtime?: AdapterExecutionContext["runtime"];
  inputs?: Partial<ReturnType<typeof sealedRunInputs>> | null;
  onMeta?: AdapterExecutionContext["onMeta"];
  capture?: string;
} = {}): AdapterExecutionContext {
  const inputs: Partial<ReturnType<typeof sealedRunInputs>> =
    overrides.inputs === null ? {} : { ...sealedRunInputs(), ...overrides.inputs };
  return {
    runId: overrides.runId ?? "run-sealed-1",
    agent: AGENT,
    runtime: overrides.runtime ?? { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      engine: "cli",
      command: commandPath,
      cwd: workspace,
      promptTemplate: "Do the sealed work.",
      ...overrides.config,
      env: {
        ...(inputs.env ?? {}),
        PAPERCLIP_TEST_CAPTURE_PATH: overrides.capture ?? capturePath,
        ...overrides.configEnv,
      },
    },
    context: overrides.context ?? {},
    ...(inputs.authToken ? { authToken: inputs.authToken } : {}),
    ...(inputs.runtimeMcp ? { runtimeMcp: inputs.runtimeMcp } : {}),
    onLog: async () => {},
    ...(overrides.onMeta ? { onMeta: overrides.onMeta } : {}),
  } as AdapterExecutionContext;
}

async function readCapture(file = capturePath): Promise<Capture> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Capture;
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true).catch(() => false);
}

describe("sealed claude_local CLI runs: gates", () => {
  it("refuses to start without a credential", async () => {
    const inputs = sealedRunInputs();
    const result = await execute(buildContext({ inputs: { ...inputs, env: {} } }));

    expect(result.errorCode).toBe("claude_credential_missing");
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("managed AI connection");
    expect(result.errorMessage).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(result.resultJson).toEqual({ executionRecovery: { kind: "bootstrap", providerWorkStarted: false } });
    expect(await exists(capturePath)).toBe(false);
  });

  it("refuses to start with only empty credential values", async () => {
    const inputs = sealedRunInputs();
    const result = await execute(buildContext({
      inputs: { ...inputs, env: { ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "  " } },
    }));

    expect(result.errorCode).toBe("claude_credential_missing");
    expect(await exists(capturePath)).toBe(false);
  });

  it("refuses to start without the paperclip server", async () => {
    const result = await execute(buildContext({ inputs: { runtimeMcp: { getServers: () => [] } } }));

    expect(result.errorCode).toBe("paperclip_mcp_unavailable");
    expect(result.errorMessage).toContain("PAPERCLIP_API_URL");
    expect(result.resultJson).toEqual({ executionRecovery: { kind: "bootstrap", providerWorkStarted: false } });
    expect(await exists(capturePath)).toBe(false);
  });

  it("refuses to start without a run token", async () => {
    const inputs = sealedRunInputs();
    const context = buildContext({ inputs });
    delete (context as { authToken?: string }).authToken;
    const result = await execute(context);

    expect(result.errorCode).toBe("paperclip_mcp_unavailable");
    expect(result.errorMessage).toContain("PAPERCLIP_AGENT_JWT_SECRET");
    expect(await exists(capturePath)).toBe(false);
  });
});

describe("sealed claude_local CLI runs: environment and config folder", () => {
  it("passes no server secrets", async () => {
    const result = await execute(buildContext({ configEnv: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" } }));
    expect(result.exitCode).toBe(0);
    const { env } = await readCapture();

    expect(env).not.toHaveProperty("BETTER_AUTH_SECRET");
    expect(env).not.toHaveProperty("PAPERCLIP_AGENT_JWT_SECRET");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SEALED_TEST_CLAUDE_TOKEN);
    expect(env.PATH).toBeTruthy();
    expect(env.PAPERCLIP_API_KEY).toBe("run-jwt-token");
  });

  it("uses Paperclip's HOME", async () => {
    await execute(buildContext());
    const capture = await readCapture();

    expect(capture.env.HOME).toBeTruthy();
    expect(capture.env.HOME).not.toBe(root);
    expect(capture.homeExists).toBe(true);
    expect(capture.env.XDG_CONFIG_HOME).toBe(path.join(capture.env.HOME, "config"));
    expect(await exists(capture.env.HOME)).toBe(false);
  });

  it("keeps a managed connection's HOME", async () => {
    const managedHome = path.join(root, "managed-home");
    await fs.mkdir(managedHome, { recursive: true });
    await execute(buildContext({
      config: { managedAiConnection: { connectionId: "conn-1", method: "subscription" } },
      configEnv: { HOME: managedHome, CLAUDE_CONFIG_DIR: path.join(managedHome, "provider") },
    }));
    const capture = await readCapture();

    expect(capture.env.HOME).toBe(managedHome);
    expect(capture.env.CLAUDE_CONFIG_DIR).toBe(path.join(agentFolder(), "claude-config"));
  });

  it("uses the agent's config folder", async () => {
    await execute(buildContext({ configEnv: { CLAUDE_CONFIG_DIR: path.join(root, "agent-chosen-config") } }));
    const capture = await readCapture();

    expect(capture.env.CLAUDE_CONFIG_DIR).toBe(path.join(agentFolder(), "claude-config"));
    expect(capture.env.CLAUDE_CONFIG_DIR).toMatch(/companies\/company-sealed\/agents\/agent-sealed\/claude-config$/);
  });

  it("sets stray settings aside", async () => {
    const configDir = path.join(agentFolder(), "claude-config");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "settings.json"), "{\"hooks\":{}}\n", "utf8");
    await fs.writeFile(path.join(configDir, ".claude.json"), "{}\n", "utf8");
    const logs: string[] = [];
    const context = buildContext({ runId: "run-set-aside" });
    context.onLog = async (_stream, chunk) => { logs.push(chunk); };

    await execute(context);

    const setAsideDir = path.join(agentFolder(), "claude-config-set-aside", "run-set-aside");
    expect(await exists(path.join(setAsideDir, "settings.json"))).toBe(true);
    expect(await exists(path.join(configDir, "settings.json"))).toBe(false);
    expect(await exists(path.join(configDir, ".claude.json"))).toBe(true);
    expect(logs.some((line) => line.includes("Set aside settings.json") && line.includes(setAsideDir))).toBe(true);
  });

  it("removes a poisoned session's transcript from the agent's config folder", async () => {
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const encodedCwd = workspace.replace(/[^a-zA-Z0-9-]/g, "-");
    const transcript = path.join(agentFolder(), "claude-config", "projects", encodedCwd, `${sessionId}.jsonl`);
    await fs.mkdir(path.dirname(transcript), { recursive: true });
    await fs.writeFile(transcript, "{}\n", "utf8");

    const result = await execute(buildContext({
      configEnv: { PAPERCLIP_TEST_POISON_RESUME: "1" },
      runtime: { sessionId, sessionParams: { sessionId, cwd: workspace }, sessionDisplayId: null, taskKey: null },
    }));

    expect(result.exitCode).toBe(0);
    expect(await exists(transcript)).toBe(false);
  });

  it("confines the run with the sealed HOME and the agent's folders", async () => {
    // A fake Bubblewrap records its arguments and environment, then runs the command after `--`.
    const bwrapPath = path.join(root, "bin", "fake-bwrap");
    const bwrapCapturePath = path.join(root, "bwrap.json");
    await fs.writeFile(bwrapPath, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(bwrapCapturePath)}, JSON.stringify({ args, home: process.env.HOME }), "utf8");
const separator = args.indexOf("--");
const result = spawnSync(args[separator + 1], args.slice(separator + 2), { stdio: "inherit" });
process.exit(result.status ?? 1);
`, "utf8");
    await fs.chmod(bwrapPath, 0o755);

    const result = await execute(buildContext({
      config: { filesystemScope: "workspace", filesystemSandboxCommand: bwrapPath },
    }));
    expect(result.exitCode).toBe(0);
    const bwrap = JSON.parse(await fs.readFile(bwrapCapturePath, "utf8")) as { args: string[]; home: string };
    const capture = await readCapture();
    const configDir = path.join(agentFolder(), "claude-config");

    // runChildProcess sets HOME to the sandbox's homeDir: it is the sealed HOME.
    expect(bwrap.home).toBe(capture.env.HOME);
    expect(capture.env.HOME).not.toBe(root);
    expect(path.basename(capture.env.HOME)).toMatch(/^paperclip-claude-home-agent-sealed-/);
    expect(capture.env.CLAUDE_CONFIG_DIR).toBe(configDir);
    const binds = (flag: string) => bwrap.args.flatMap((arg, index) => (arg === flag ? [bwrap.args[index + 1]] : []));
    expect(binds("--bind")).toEqual(expect.arrayContaining([configDir, capture.env.HOME, workspace]));
    expect(binds("--bind")).not.toContain(path.join(root, ".claude"));
  });
});
