import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext, AdapterInvocationMeta } from "@paperclipai/adapter-utils";
import { joinRunPromptSections, type RunPromptPlan, type RunPromptRecord } from "@paperclipai/shared";
import { execute as executeClaudeLocal, PAPERCLIP_RUN_PROMPT_PLAN_KEY } from "@paperclipai/adapter-claude-local/server";
import { createPromptContextFixture } from "@paperclipai/adapter-utils/test-fixtures/prompt-context";
import { attachClaudeRunPromptPlan } from "../services/run-prompt/attach-claude-run-prompt.js";
import { copyTaskMarkdownParts, PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY } from "../services/heartbeat/task-context.js";
import { SEALED_TEST_RUN_TOKEN, withSealedRunInputs } from "./helpers/claude-local-sealed-run.js";

// Step 5, Task 7: a claude_local CLI run records what it sent as the heartbeat's prompt sections
// (adapter.prompt), checked against the text it sends, which never changes.

const execute: typeof executeClaudeLocal = (ctx) => executeClaudeLocal(withSealedRunInputs(ctx));
const OLD_SESSION = "11111111-1111-4111-8111-111111111111";

/** A fake `claude` that records each invocation's argv and stdin; `--resume` fails once when asked. */
async function writeFakeClaude(commandPath: string) {
  await fs.writeFile(commandPath, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("2.1.286 (Claude Code)"); process.exit(0); }
const fs = require("node:fs");
const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const entries = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, "utf8")) : [];
entries.push({ argv: process.argv.slice(2), prompt: fs.readFileSync(0, "utf8") });
fs.writeFileSync(capturePath, JSON.stringify(entries), "utf8");
const statePath = process.env.PAPERCLIP_TEST_FAIL_RESUME_ONCE;
if (process.argv.includes("--resume") && statePath && !fs.existsSync(statePath)) {
  fs.writeFileSync(statePath, "failed", "utf8");
  console.log(JSON.stringify({ type: "result", subtype: "error", session_id: "${OLD_SESSION}",
    result: "No conversation found with session id ${OLD_SESSION}", errors: ["No conversation found with session id ${OLD_SESSION}"] }));
  process.exit(1);
}
const session = process.argv.includes("--resume") ? "${OLD_SESSION}" : "22222222-2222-4222-8222-222222222222";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: session, model: "claude-sonnet" }));
console.log(JSON.stringify({ type: "result", session_id: session, result: "done", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
`, "utf8");
  await fs.chmod(commandPath, 0o755);
}

let root: string;
let commandPath: string;
let capturePath: string;
let instructionsFile: string;
let previousHome: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-prompt-record-"));
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  commandPath = path.join(root, "bin", "claude");
  capturePath = path.join(root, "capture.json");
  instructionsFile = path.join(root, "AGENTS.md");
  await fs.writeFile(instructionsFile, "# Ada\n\nKeep the ledger.\n", "utf8");
  await writeFakeClaude(commandPath);
  previousHome = process.env.HOME;
  process.env.HOME = root;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await fs.rm(root, { recursive: true, force: true });
});

const agent = { id: "agent-1", companyId: "company-1", name: "Ada", adapterType: "claude_local", adapterConfig: {} };

function config(extra: Record<string, unknown> = {}) {
  return {
    engine: "cli",
    command: commandPath,
    cwd: path.join(root, "workspace"),
    instructionsFilePath: instructionsFile,
    promptTemplate: "Heartbeat for {{agent.name}}.",
    env: { PAPERCLIP_TEST_CAPTURE_PATH: capturePath, ...extra },
  };
}

/** The heartbeat's context, with the brief's parts on it as prepareHeartbeatTaskContext leaves them. */
function heartbeatContext(): Record<string, unknown> {
  const fixture = createPromptContextFixture();
  const context: Record<string, unknown> = { ...fixture, paperclipTaskCommunicationGuidance: "Say what you'll do first." };
  copyTaskMarkdownParts({
    [PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY]: [
      { id: "task_brief.header", label: "Header", source: "test", text: "## Owned assignment\n\n" },
      { id: "task_brief.description", label: "Description", source: "test", text: String(fixture.paperclipTaskMarkdownAssignment).slice("## Owned assignment\n\n".length) },
    ],
  }, context);
  return context;
}

/** What the heartbeat does just before adapter.execute: a copied context with the plan on it. */
async function adapterContextWithPlan(
  heartbeat: Record<string, unknown>,
  runConfig: Record<string, unknown>,
  getFreshSessionHandoff?: () => Promise<string | null>,
) {
  const adapterContext: Record<string, unknown> = { ...heartbeat };
  const plan = await attachClaudeRunPromptPlan({
    agent, runId: "run-1", config: runConfig, context: heartbeat, adapterContext,
    executionTarget: null, legacyRemoteExecution: null, authToken: SEALED_TEST_RUN_TOKEN,
    getFreshSessionHandoff, onWarning: async () => {},
  });
  return { adapterContext, plan: plan! };
}

async function run(input: {
  context: Record<string, unknown>;
  config: Record<string, unknown>;
  sessionId?: string | null;
  getFreshSessionHandoff?: () => Promise<string | null>;
}) {
  const metas: AdapterInvocationMeta[] = [];
  const logs: string[] = [];
  const result = await execute({
    runId: "run-1",
    agent,
    runtime: { sessionId: input.sessionId ?? null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: input.config,
    context: input.context,
    getFreshSessionHandoff: input.getFreshSessionHandoff,
    onLog: async (_stream, chunk) => { logs.push(chunk); },
    onMeta: async (meta) => { metas.push(meta); },
  } as AdapterExecutionContext);
  const captured = JSON.parse(await fs.readFile(capturePath, "utf8")) as Array<{ argv: string[]; prompt: string }>;
  await fs.rm(capturePath, { force: true });
  return { result, metas, logs, captured, records: metas.map((meta) => meta.promptRecord as RunPromptRecord) };
}

describe("claude_local prompt record", () => {
  it("records a fresh run's sections, with the system prompt, and sends the same text", async () => {
    const heartbeat = heartbeatContext();
    const { adapterContext, plan } = await adapterContextWithPlan(heartbeat, config());
    const { metas, captured, records, logs } = await run({ context: adapterContext, config: config() });
    expect(captured).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({ version: 1, session: "fresh", matchedPlan: true });
    expect(record!.firstMessage).toEqual(plan.fresh);
    expect(joinRunPromptSections(record!.firstMessage)).toBe(captured[0]!.prompt);
    expect(record!.firstMessageChars).toBe(captured[0]!.prompt.length);
    expect(metas[0]!.prompt).toBe(captured[0]!.prompt);
    expect(record!.systemPrompt.map((section) => section.id)[0]).toBe("agent_instructions");
    expect(record!.systemPrompt[0]!.text.startsWith("# Ada\n\nKeep the ledger.\n")).toBe(true);
    expect(record!.firstMessage.find((section) => section.id === "task_brief")?.parts?.map((part) => part.id))
      .toEqual(["task_brief.header", "task_brief.description"]);
    expect(logs.join("")).not.toContain("prompt sections didn't match");
    // Neither the plan nor the parts travel in the adapter.invoke context.
    const invokeContext = JSON.stringify(metas[0]!.context);
    expect(invokeContext).not.toContain(PAPERCLIP_RUN_PROMPT_PLAN_KEY);
    expect(invokeContext).not.toContain(PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY);
  });

  it("records a resumed run's sections and no system prompt", async () => {
    const { adapterContext, plan } = await adapterContextWithPlan(heartbeatContext(), config());
    const { captured, records } = await run({ context: adapterContext, config: config(), sessionId: OLD_SESSION });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.argv).toContain("--resume");
    expect(records[0]).toMatchObject({ session: "resumed", matchedPlan: true, systemPrompt: [] });
    expect(records[0]!.firstMessage).toEqual(plan.resumed);
    expect(joinRunPromptSections(records[0]!.firstMessage)).toBe(captured[0]!.prompt);
  });

  it("records the fresh attempt when a resume fails and retries fresh (review focus 1)", async () => {
    const handoff = vi.fn(async () => "## Fresh session handoff\n\nEarlier: the ledger was drafted.");
    const runConfig = config({ PAPERCLIP_TEST_FAIL_RESUME_ONCE: path.join(root, "resume-failed") });
    const { adapterContext, plan } = await adapterContextWithPlan(heartbeatContext(), runConfig, handoff);
    const { captured, records, result } = await run({
      context: adapterContext, config: runConfig, sessionId: OLD_SESSION, getFreshSessionHandoff: handoff,
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]!.argv).toContain("--resume");
    expect(captured[1]!.argv).not.toContain("--resume");
    expect(result.sessionId).toBe("22222222-2222-4222-8222-222222222222");
    // One record per attempt; the last is the attempt that ran.
    expect(records.map((record) => record.session)).toEqual(["resumed", "fresh"]);
    const ran = records.at(-1)!;
    expect(ran.matchedPlan).toBe(true);
    expect(ran.firstMessage).toEqual(plan.fresh);
    expect(joinRunPromptSections(ran.firstMessage)).toBe(captured[1]!.prompt);
    expect(captured[1]!.prompt).toContain("Earlier: the ledger was drafted.");
    expect(ran.systemPrompt.length).toBeGreaterThan(0);
    expect(records[0]!.systemPrompt).toEqual([]);
  });

  it("sends the same text with a plan, a mismatching plan and no plan, and records the latter two unsplit", async () => {
    const heartbeat = heartbeatContext();

    const matching = await adapterContextWithPlan(heartbeat, config());
    const withPlan = await run({ context: matching.adapterContext, config: config() });

    const altered = await adapterContextWithPlan(heartbeat, config());
    const alteredPlan: RunPromptPlan = { ...altered.plan, fresh: altered.plan.fresh.slice(0, -1) };
    Object.defineProperty(altered.adapterContext, PAPERCLIP_RUN_PROMPT_PLAN_KEY, { value: alteredPlan, enumerable: false, configurable: true });
    const mismatched = await run({ context: altered.adapterContext, config: config() });

    const withoutPlan = await run({ context: { ...heartbeat }, config: config() });

    expect(mismatched.captured[0]!.prompt).toBe(withPlan.captured[0]!.prompt);
    expect(withoutPlan.captured[0]!.prompt).toBe(withPlan.captured[0]!.prompt);
    expect(withPlan.records[0]!.matchedPlan).toBe(true);

    for (const unsplit of [mismatched, withoutPlan]) {
      const [record] = unsplit.records;
      expect(record!.matchedPlan).toBe(false);
      expect(record!.firstMessage).toHaveLength(1);
      expect(record!.firstMessage[0]).toMatchObject({ id: "unsplit", text: withPlan.captured[0]!.prompt });
      expect(record!.firstMessageChars).toBe(withPlan.captured[0]!.prompt.length);
      expect(record!.systemPrompt).toEqual(withPlan.records[0]!.systemPrompt);
    }
    expect(mismatched.logs.join("")).toContain("[paperclip] prompt sections didn't match the sent prompt; recorded it unsplit.");
    expect(withoutPlan.logs.join("")).not.toContain("prompt sections didn't match");
  });
});

describe("attachClaudeRunPromptPlan", () => {
  const attach = (overrides: Partial<Parameters<typeof attachClaudeRunPromptPlan>[0]> = {}) => {
    const heartbeat = heartbeatContext();
    const adapterContext: Record<string, unknown> = { ...heartbeat };
    const onWarning = vi.fn(async () => {});
    const pending = attachClaudeRunPromptPlan({
      agent, runId: "run-1", config: config(), context: heartbeat, adapterContext,
      executionTarget: null, legacyRemoteExecution: null, authToken: SEALED_TEST_RUN_TOKEN,
      getFreshSessionHandoff: undefined, onWarning, ...overrides,
    });
    return { pending, adapterContext, onWarning };
  };

  it("puts a non-enumerable plan and the brief's parts on a local CLI run's adapter context", async () => {
    const { pending, adapterContext } = attach();
    const plan = await pending;
    expect(plan?.version).toBe(1);
    expect(adapterContext[PAPERCLIP_RUN_PROMPT_PLAN_KEY]).toBe(plan);
    expect(Object.keys(adapterContext)).not.toContain(PAPERCLIP_RUN_PROMPT_PLAN_KEY);
    expect(JSON.stringify(adapterContext)).not.toContain(PAPERCLIP_RUN_PROMPT_PLAN_KEY);
    expect(adapterContext[PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY]).toBeDefined();
    expect(JSON.stringify(adapterContext)).not.toContain(PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY);
  });

  it.each([
    ["the ACP engine", () => ({ config: { ...config(), engine: "acp" } })],
    ["a remote target", () => ({ executionTarget: { kind: "remote", transport: "ssh", remoteCwd: "/srv/work", spec: { host: "h", port: 22, username: "u", remoteCwd: "/srv/work", remoteWorkspacePath: "/srv/work", privateKey: null, knownHosts: null, strictHostKeyChecking: true } } })],
    ["another adapter", () => ({ agent: { ...agent, adapterType: "codex_local" } })],
  ])("gives %s no plan", async (_name, overrides) => {
    const { pending, adapterContext } = attach(overrides() as never);
    expect(await pending).toBeNull();
    expect(adapterContext[PAPERCLIP_RUN_PROMPT_PLAN_KEY]).toBeUndefined();
  });

  it("warns and leaves the plan unset when the builder fails; the run then records unsplit", async () => {
    const { pending, adapterContext, onWarning } = attach({
      getFreshSessionHandoff: async () => { throw new Error("handoff read failed"); },
    });
    expect(await pending).toBeNull();
    expect(adapterContext[PAPERCLIP_RUN_PROMPT_PLAN_KEY]).toBeUndefined();
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("handoff read failed"));
  });
});
