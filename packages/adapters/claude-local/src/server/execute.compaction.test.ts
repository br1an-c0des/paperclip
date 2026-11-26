import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { runAdapterExecutionTargetProcess } = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(),
}));

vi.mock("./acp.js", () => ({
  createClaudeAcpExecutor: () => vi.fn(),
  resolveClaudeExecutionEngineForRun: async () => ({ engine: "cli", explicit: true }),
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
    ensureAdapterExecutionTargetRuntimeCommandInstalled: vi.fn(async () => undefined),
    resolveAdapterExecutionTargetCommandForLogs: vi.fn(async () => "claude"),
    runAdapterExecutionTargetProcess,
  };
});

import { execute } from "./execute.js";

// A real `compact_boundary` from Claude Code 2.1.325 (`--resume <id> "/compact"`), trimmed.
const fixture = readFileSync(new URL("./__fixtures__/compact-boundary.jsonl", import.meta.url), "utf8");
const boundaryLine = fixture.split("\n").find((line) => line.includes("compact_boundary"))!;

/** The CLI process streams `stdout` through the run's log, as the real one does. */
function streamStdout(stdout: string) {
  runAdapterExecutionTargetProcess.mockImplementation(
    async (_runId: string, _target: unknown, _command: string, args: string[], options: { onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void> }) => {
      if (args.includes("--version")) {
        return { exitCode: 0, signal: null, timedOut: false, stdout: "2.1.325 (Claude Code)", stderr: "", pid: 1, startedAt: new Date().toISOString() };
      }
      await options.onLog("stdout", stdout);
      return { exitCode: 0, signal: null, timedOut: false, stdout, stderr: "", pid: 321, startedAt: new Date().toISOString() };
    },
  );
}

function buildContext(onEvent: (event: unknown) => Promise<void>) {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", name: "Claude Coder", adapterType: "claude_local", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { engine: "cli", env: { CLAUDE_CODE_OAUTH_TOKEN: "test-token" } },
    context: {},
    authToken: "run-jwt-token",
    runtimeMcp: {
      getServers: () => [{ name: "paperclip", url: "http://127.0.0.1:3100/api/mcp/paperclip", token: "run-jwt-token", connectionId: "paperclip" }],
    },
    onLog: vi.fn(async () => {}),
    onEvent,
  };
}

describe("claude_local CLI runs record compactions", () => {
  let paperclipHome: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    paperclipHome = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-compaction-"));
    vi.stubEnv("PAPERCLIP_HOME", paperclipHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(paperclipHome, { recursive: true, force: true });
  });

  const compactions = (onEvent: ReturnType<typeof vi.fn>) =>
    onEvent.mock.calls.map((call) => call[0] as { eventType: string; payload: { prpEvent: Record<string, unknown> } })
      .filter((event) => event.eventType === "context.compacted");

  it("calls onEvent once for the stream's compact_boundary", async () => {
    streamStdout(fixture);
    const onEvent = vi.fn(async () => {});
    await execute(buildContext(onEvent) as never);
    const events = compactions(onEvent);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.prpEvent).toMatchObject({
      sourceKind: "claude_local",
      normalizedSessionId: "10632812-510b-4a83-a708-a5031e2982d7",
      payload: { compactionId: "b1529e2c-c9de-468e-bb1e-89772abdfa45", reason: "manual", preTokens: 41981, postTokens: 10166 },
    });
  });

  it("still calls it once when the boundary line comes twice", async () => {
    streamStdout(`${boundaryLine}\n${fixture}`);
    const onEvent = vi.fn(async () => {});
    await execute(buildContext(onEvent) as never);
    expect(compactions(onEvent)).toHaveLength(1);
  });

  it("records nothing for a /compact with nothing to compact (no boundary)", async () => {
    streamStdout(fixture.split("\n").filter((line) => !line.includes("compact_boundary")).join("\n"));
    const onEvent = vi.fn(async () => {});
    await execute(buildContext(onEvent) as never);
    expect(compactions(onEvent)).toHaveLength(0);
  });
});
