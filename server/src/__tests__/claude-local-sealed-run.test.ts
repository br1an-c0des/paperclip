import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterInvocationMeta } from "@paperclipai/adapter-utils";
import { isClaudeRunManifest, type ClaudeRunManifest } from "@paperclipai/shared";
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
  runPluginsAtEnd?: string[] | null;
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
  // What the run's own plugins folder (the second --plugin-dir) holds as the run ends.
  const runPluginsDir = argv.filter((arg, index) => argv[index - 1] === "--plugin-dir")[1];
  if (capturePath && runPluginsDir) {
    const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    capture.runPluginsAtEnd = fs.existsSync(runPluginsDir) ? fs.readdirSync(runPluginsDir).sort() : null;
    fs.writeFileSync(capturePath, JSON.stringify(capture), "utf8");
  }
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

  it("drops a managed connection's blanked provider keys", async () => {
    const { metas, onMeta } = metaCollector();
    const blanked = { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", AWS_ACCESS_KEY_ID: "" };
    const result = await execute(buildContext({
      config: { managedAiConnection: { connectionId: "conn-1", method: "subscription" } },
      configEnv: blanked,
      onMeta,
    }));
    expect(result.exitCode).toBe(0);
    const { env } = await readCapture();
    const manifest = manifestOf(metas[0]);

    for (const key of Object.keys(blanked)) {
      expect(env).not.toHaveProperty(key);
      expect(manifest.envKeys).not.toContain(key);
    }
    expect(Object.values(env)).not.toContain("");
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SEALED_TEST_CLAUDE_TOKEN);
    expect(manifest.envKeys).toEqual(expect.arrayContaining(["CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_OAUTH_TOKEN"]));
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

async function makeCheckout(dir: string, options: { claudeMd?: boolean; skills?: string[]; gitFile?: boolean } = {}) {
  await fs.mkdir(dir, { recursive: true });
  if (options.gitFile) await fs.writeFile(path.join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n", "utf8");
  else await fs.mkdir(path.join(dir, ".git"), { recursive: true });
  if (options.claudeMd) await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Repo instructions\n", "utf8");
  for (const skill of options.skills ?? []) {
    await fs.mkdir(path.join(dir, ".claude", "skills", skill), { recursive: true });
    await fs.writeFile(path.join(dir, ".claude", "skills", skill, "SKILL.md"), `---\nname: ${skill}\n---\n`, "utf8");
  }
  return dir;
}

function workspaceContext(
  cwd: string,
  switches: { agentsReadClaudeMd?: boolean | null; agentsUseRepoSkills?: boolean | null } = {},
) {
  return {
    paperclipWorkspace: {
      cwd,
      source: "project_primary",
      projectId: "project-sealed",
      agentsReadClaudeMd: switches.agentsReadClaudeMd ?? true,
      agentsUseRepoSkills: switches.agentsUseRepoSkills ?? true,
    },
  };
}

function flagValues(argv: string[], flag: string): string[] {
  return argv.flatMap((arg, index) => (arg === flag ? [argv[index + 1]] : []));
}

function metaCollector() {
  const metas: AdapterInvocationMeta[] = [];
  return { metas, onMeta: async (meta: AdapterInvocationMeta) => { metas.push(meta); } };
}

function manifestOf(meta: AdapterInvocationMeta | undefined): ClaudeRunManifest {
  const manifest = meta?.runManifest;
  if (!isClaudeRunManifest(manifest)) throw new Error("onMeta carried no run manifest");
  return manifest;
}

describe("sealed claude_local CLI runs: arguments, repo, prompt and manifest", () => {
  it("passes the sealed flags", async () => {
    await execute(buildContext());
    const { argv } = await readCapture();

    expect(argv.slice(0, 6)).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--setting-sources", "user"]);
    expect(argv).toContain("--strict-mcp-config");
    expect(flagValues(argv, "--mcp-config")).toHaveLength(1);
    expect(flagValues(argv, "--plugin-dir")).toHaveLength(1);
    expect(flagValues(argv, "--plugin-dir")[0]).toMatch(/claude-prompt-cache\/[0-9a-f]{64}\/plugins$/);
    expect(argv).not.toContain("--add-dir");
  });

  it("loads the bundle's skills as the paperclip plugin", async () => {
    await execute(buildContext());
    const { pluginSkills } = await readCapture();
    expect(pluginSkills).toContain("paperclip:paperclip");
  });

  it("loads a company skill with a suffixed runtime name under its plain name", async () => {
    const skillDir = path.join(root, "library", "m7-test-skill-renamed");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: m7-test-skill-renamed\ndescription: M7 test\n---\n# M7 test\n", "utf8");
    const key = "company/company-sealed/m7-test-skill-renamed";
    const { metas, onMeta } = metaCollector();
    await execute(buildContext({
      config: {
        paperclipRuntimeSkills: [{ key, runtimeName: "m7-test-skill-renamed--cb66fbdc10", source: skillDir }],
        paperclipSkillSync: { desiredSkills: [key] },
      },
      onMeta,
    }));
    const { pluginSkills } = await readCapture();
    expect(pluginSkills).toContain("company:m7-test-skill-renamed");
    expect(pluginSkills.some((skill) => skill.includes("--cb66fbdc10"))).toBe(false);
    expect(manifestOf(metas[0]).skills).toContainEqual({ name: "m7-test-skill-renamed", key, origin: "assigned", plugin: "company" });
  });

  it("adds the repo root when the project allows it", async () => {
    const repo = await makeCheckout(path.join(root, "repo"), { claudeMd: true });
    const on = metaCollector();
    await execute(buildContext({ context: workspaceContext(repo), onMeta: on.onMeta }));
    const onCapture = await readCapture();

    expect(flagValues(onCapture.argv, "--add-dir")).toEqual([repo]);
    expect(onCapture.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD).toBe("1");
    expect(manifestOf(on.metas[0]).claudeMd).toEqual({ enabled: true, path: path.join(repo, "CLAUDE.md") });

    const off = metaCollector();
    await execute(buildContext({
      runId: "run-sealed-2",
      context: workspaceContext(repo, { agentsReadClaudeMd: false }),
      onMeta: off.onMeta,
    }));
    const offCapture = await readCapture();
    expect(offCapture.argv).not.toContain("--add-dir");
    expect(offCapture.env).not.toHaveProperty("CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD");
    expect(manifestOf(off.metas[0]).claudeMd).toEqual({ enabled: false, reason: "project_switch_off" });
  });

  it("adds the repo's skills when the project allows it", async () => {
    const repo = await makeCheckout(path.join(root, "repo"), { skills: ["m7"] });
    const on = metaCollector();
    await execute(buildContext({ runId: "run-repo-skills", context: workspaceContext(repo), onMeta: on.onMeta }));
    const onCapture = await readCapture();
    const runPluginsDir = path.join(agentFolder(), "claude-run-plugins", "run-repo-skills");

    expect(flagValues(onCapture.argv, "--plugin-dir")).toHaveLength(2);
    expect(flagValues(onCapture.argv, "--plugin-dir")[1]).toBe(runPluginsDir);
    expect(onCapture.pluginSkills).toContain("project:m7");
    expect(await exists(runPluginsDir)).toBe(false);
    const manifest = manifestOf(on.metas[0]);
    expect(manifest.repoSkills).toEqual({ enabled: true, dir: path.join(repo, ".claude", "skills"), count: 1 });
    expect(manifest.skills.at(-1)).toEqual({ name: "m7", key: "repo:.claude/skills/m7", origin: "repo", plugin: "project" });

    const off = metaCollector();
    await execute(buildContext({
      runId: "run-repo-skills-off",
      context: workspaceContext(repo, { agentsUseRepoSkills: false }),
      onMeta: off.onMeta,
    }));
    const offCapture = await readCapture();
    expect(flagValues(offCapture.argv, "--plugin-dir")).toHaveLength(1);
    expect(offCapture.pluginSkills.some((skill) => skill.startsWith("project:"))).toBe(false);
    expect(manifestOf(off.metas[0]).repoSkills).toEqual({ enabled: false, reason: "project_switch_off" });
  });

  it("removes the repo-skills plugin folder after a failed run", async () => {
    const repo = await makeCheckout(path.join(root, "repo"), { skills: ["m7"] });
    const failing = path.join(root, "bin", "claude-failing");
    await fs.writeFile(failing, "#!/usr/bin/env node\nprocess.stderr.write('boom\\n');\nprocess.exit(3);\n", "utf8");
    await fs.chmod(failing, 0o755);

    const result = await execute(buildContext({ runId: "run-fails", config: { command: failing }, context: workspaceContext(repo) }));

    expect(result.exitCode).toBe(3);
    expect(await exists(path.join(agentFolder(), "claude-run-plugins", "run-fails"))).toBe(false);
  });

  it("gives concurrent runs in two worktrees their own repo skills", async () => {
    const repo = await makeCheckout(path.join(root, "repo"), { skills: ["main-only"] });
    const worktreeA = await makeCheckout(path.join(repo, ".paperclip", "worktrees", "a"), { gitFile: true, skills: ["skill-a"] });
    const worktreeB = await makeCheckout(path.join(repo, ".paperclip", "worktrees", "b"), { gitFile: true, skills: ["skill-b"] });
    const captureA = path.join(root, "capture-a.json");
    const captureB = path.join(root, "capture-b.json");

    // Run b finishes while run a is still running: a's plugin folder must survive b's cleanup.
    await Promise.all([
      execute(buildContext({
        runId: "run-a",
        capture: captureA,
        context: workspaceContext(worktreeA),
        configEnv: { PAPERCLIP_TEST_DELAY_MS: "400" },
      })),
      execute(buildContext({ runId: "run-b", capture: captureB, context: workspaceContext(worktreeB) })),
    ]);

    const a = await readCapture(captureA);
    const b = await readCapture(captureB);
    expect(a.pluginSkills.filter((skill) => skill.startsWith("project:"))).toEqual(["project:skill-a"]);
    expect(b.pluginSkills.filter((skill) => skill.startsWith("project:"))).toEqual(["project:skill-b"]);
    expect(a.runPluginsAtEnd).toEqual(["project"]);
    expect(await exists(path.join(agentFolder(), "claude-run-plugins", "run-a"))).toBe(false);
    expect(await exists(path.join(agentFolder(), "claude-run-plugins", "run-b"))).toBe(false);
  });

  it("resumes when only the repo's skill set changed", async () => {
    const repo = await makeCheckout(path.join(root, "repo"), { skills: ["m7"] });
    const first = await execute(buildContext({ runId: "run-first", context: workspaceContext(repo) }));
    await makeCheckout(repo, { skills: ["m7-added"] });
    const { metas, onMeta } = metaCollector();

    await execute(buildContext({
      runId: "run-second",
      context: workspaceContext(repo),
      runtime: { sessionId: null, sessionParams: first.sessionParams ?? null, sessionDisplayId: null, taskKey: null },
      onMeta,
    }));
    const capture = await readCapture();

    expect(flagValues(capture.argv, "--resume")).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(capture.pluginSkills).toEqual(expect.arrayContaining(["project:m7", "project:m7-added"]));
    expect(manifestOf(metas[0]).session).toEqual({ mode: "resumed", sessionId: "11111111-1111-4111-8111-111111111111" });
  });

  it("points fresh runs at the MCP tools", async () => {
    const first = await execute(buildContext());
    const fresh = await readCapture();
    expect(fresh.prompt).toContain("paperclip_task_context");
    expect(fresh.prompt).toContain("paperclip_finish");

    await execute(buildContext({
      runId: "run-resumed",
      runtime: { sessionId: null, sessionParams: first.sessionParams ?? null, sessionDisplayId: null, taskKey: null },
    }));
    const resumed = await readCapture();
    expect(resumed.argv).toContain("--resume");
    expect(resumed.prompt).not.toContain("paperclip_task_context");
  });

  it("records the manifest", async () => {
    const { metas, onMeta } = metaCollector();
    await execute(buildContext({
      context: { paperclipAgentAccess: { level: "worker", overrides: { "tasks:delete": false } } },
      configEnv: { HOME: path.join(root, "agent-home") },
      config: { extraArgs: ["--debug"] },
      onMeta,
    }));
    const capture = await readCapture();
    const manifest = manifestOf(metas[0]);

    expect(manifest).toMatchObject({
      autoMemory: false,
      settingSources: ["user"],
      strictMcpConfig: true,
      builtInSkills: true,
      configDir: path.join(agentFolder(), "claude-config"),
      credential: { kind: "agent_env", method: "subscription", connectionId: null, connectionName: null },
      access: { level: "worker", overrides: { "tasks:delete": false } },
      overriddenEnv: ["HOME"],
      setAside: null,
      claudeMd: { enabled: false, reason: "no_project" },
      repoSkills: { enabled: false, reason: "no_project" },
      mcpServers: [{ name: "paperclip", url: "http://127.0.0.1:3100/api/mcp/paperclip" }],
      extraArgs: ["--debug"],
      instructions: { entryFile: null, sent: false },
      session: { mode: "fresh", reason: "no_saved_session" },
    });
    expect(manifest.skills).toContainEqual({
      name: "paperclip",
      key: "paperclipai/paperclip/paperclip",
      origin: "always_on",
      plugin: "paperclip",
    });
    expect(manifest.envKeys).toEqual(Object.keys(capture.env).sort());
    expect(JSON.stringify(manifest)).not.toContain("run-jwt-token");
    expect(JSON.stringify(manifest)).not.toContain(SEALED_TEST_CLAUDE_TOKEN);
    expect(metas[0]?.commandNotes?.[0]).toMatch(
      /^Sealed run: \d+ skills, 1 MCP servers, CLAUDE\.md skipped: no_project, repo skills skipped: no_project\.$/,
    );
  });

  it("records the instructions as sent on a fresh session only", async () => {
    const instructions = path.join(root, "AGENTS.md");
    await fs.writeFile(instructions, "# M7 test agent\n", "utf8");
    const fresh = metaCollector();
    const first = await execute(buildContext({ config: { instructionsFilePath: instructions }, onMeta: fresh.onMeta }));
    expect(manifestOf(fresh.metas[0]).instructions).toEqual({ entryFile: instructions, sent: true });

    const resumed = metaCollector();
    await execute(buildContext({
      runId: "run-resumed-instructions",
      config: { instructionsFilePath: instructions },
      runtime: { sessionId: null, sessionParams: first.sessionParams ?? null, sessionDisplayId: null, taskKey: null },
      onMeta: resumed.onMeta,
    }));
    expect(manifestOf(resumed.metas[0]).instructions).toEqual({ entryFile: instructions, sent: false });
  });

  it("starts fresh after the skill set changed, and says why", async () => {
    const first = await execute(buildContext());
    const saved = { ...(first.sessionParams ?? {}), promptBundleKey: "an-older-bundle" };
    const changed = metaCollector();

    await execute(buildContext({
      runId: "run-bundle-changed",
      runtime: { sessionId: null, sessionParams: saved, sessionDisplayId: null, taskKey: null },
      onMeta: changed.onMeta,
    }));
    const changedCapture = await readCapture();
    expect(changedCapture.argv).not.toContain("--resume");
    expect(manifestOf(changed.metas[0]).session).toEqual({ mode: "fresh", reason: "prompt_bundle_changed" });

    const matching = metaCollector();
    await execute(buildContext({
      runId: "run-bundle-matching",
      runtime: { sessionId: null, sessionParams: first.sessionParams ?? null, sessionDisplayId: null, taskKey: null },
      onMeta: matching.onMeta,
    }));
    expect(manifestOf(matching.metas[0]).session).toEqual({ mode: "resumed", sessionId: "11111111-1111-4111-8111-111111111111" });
  });
});
