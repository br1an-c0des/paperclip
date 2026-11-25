import { describe, expect, it, vi } from "vitest";
import { claudeInstructionsLocation, readClaudeInstructionCopy } from "@paperclipai/adapter-claude-local/server";
import { AGENT_FILES_CONTRACT } from "../agent-file-store.js";
import { createHeartbeatInstructionWorkingCopy, runTakesInstructionCopyFacts } from "./instruction-working-copy.js";

// The instructions copy's facts on the run context (step 5 phase 2, the system prompt; bug 88):
// a claude_local CLI run gets `context.paperclipInstructionCopy` and says where its instructions
// are in one line of its own, so the long working-copy notes aren't appended to its brief, on a
// run with a task or without one, and on the 403 path. ACP and the other adapters keep the notes.

type Input = Parameters<typeof createHeartbeatInstructionWorkingCopy>[0];
type Prepare = Parameters<ReturnType<typeof createHeartbeatInstructionWorkingCopy>["prepare"]>[0];
type Copy = NonNullable<Awaited<ReturnType<Input["instructionCopies"]["prepare"]>>>;

const AGENT_DIRECTORY_NOTE = "Your persistent agent directory is";
const REGISTERED_COPY_NOTE = "Your editable agent instruction file is";
const UNAVAILABLE_NOTE = "No editable agent instruction working copy is registered for this turn.";

function fixture(input: {
  adapterType: string;
  runtimeConfig: Record<string, unknown>;
  copy?: "agent_directory" | "instruction_file" | "forbidden";
  storageWarning?: string;
  context?: Record<string, unknown>;
}) {
  const run = { id: "run-1", companyId: "company", agentId: "agent", runnerProfileJson: null, status: "queued" } as ReturnType<Input["readRun"]>;
  const receipt = input.copy === "instruction_file"
    ? { revision: { id: "rev-1" } }
    : { schema: AGENT_FILES_CONTRACT, ...(input.storageWarning ? { storageWarning: input.storageWarning } : {}) };
  const copy = {
    runId: run.id, companyId: run.companyId, agentId: run.agentId,
    localRoot: "/agents/agent/runs/run-1/live", executionRoot: "/agents/agent/runs/run-1/live", entryFile: "AGENTS.md",
    state: "prepared", receipt, errorCode: null, errorMessage: null,
  } as unknown as Copy;
  const copies = {
    prepare: input.copy === "forbidden"
      ? vi.fn().mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }))
      : vi.fn().mockResolvedValue(copy),
  };
  const db = { update: () => ({ set: () => ({ where: async () => undefined }) }) };
  const context: Record<string, unknown> = { paperclipWorkspace: { agentHome: "/canonical" }, ...input.context };
  const controller = createHeartbeatInstructionWorkingCopy({
    db: db as unknown as Input["db"],
    instructionCopies: copies as unknown as Input["instructionCopies"],
    readRun: () => run,
    agent: { id: "agent", companyId: "company", adapterType: input.adapterType, adapterConfig: input.runtimeConfig, runtimeConfig: {} } as unknown as Input["agent"],
    context: context as Input["context"],
    session: { taskSession: null, taskSessionForRun: null, sessionConfigMetadata: {} as Input["session"]["sessionConfigMetadata"] },
    workspace: { executionTarget: null, executionWorkspace: { cwd: "/workspace" } as Input["workspace"]["executionWorkspace"], persistedExecutionWorkspace: null },
    appendRunEvent: vi.fn().mockResolvedValue(undefined),
  });
  const prepare: Prepare = {
    runtimeConfig: { ...input.runtimeConfig, instructionsFilePath: "/agents/agent/instructions/AGENTS.md" },
    hasInstructionFilesystem: true,
    nativeLifecyclePolicy: null,
    nativeRuntimeResolution: { kind: "legacy" } as Prepare["nativeRuntimeResolution"],
  };
  return { controller, context, prepare };
}

const cli = { adapterType: "claude_local", runtimeConfig: {} };
const acp = { adapterType: "claude_local", runtimeConfig: { engine: "acp" } };

describe("runTakesInstructionCopyFacts", () => {
  it("is true for a claude_local CLI run only", () => {
    expect(runTakesInstructionCopyFacts("claude_local", {})).toBe(true);
    expect(runTakesInstructionCopyFacts("claude_local", { engine: "cli" })).toBe(true);
    expect(runTakesInstructionCopyFacts("claude_local", { engine: "acp" })).toBe(false);
    expect(runTakesInstructionCopyFacts("codex_local", {})).toBe(false);
    expect(runTakesInstructionCopyFacts(null, {})).toBe(false);
  });
});

describe("the instructions copy's facts on the run context", () => {
  it("no-task claude_local CLI run gets no working-copy note in task_brief", async () => {
    const f = fixture({ ...cli, copy: "agent_directory" });
    const runtimeConfig = await f.controller.prepare(f.prepare);
    expect(f.context.paperclipTaskMarkdown).toBeUndefined();
    expect(f.context.paperclipTaskMarkdownCompact).toBeUndefined();
    expect(f.context.paperclipInstructionCopy).toEqual({
      kind: "agent_directory", root: "/agents/agent/runs/run-1/live", entryFile: "AGENTS.md", storageWarning: null,
    });
    // The adapter's one line names the directory once.
    const line = claudeInstructionsLocation({
      instructionsFilePath: String(runtimeConfig.instructionsFilePath),
      copy: readClaudeInstructionCopy(f.context.paperclipInstructionCopy),
    });
    expect(line.split("/agents/agent/runs/run-1/live")).toHaveLength(2);
    expect(line).not.toContain("Codex");
  });

  it("a CLI run with a task keeps its brief without the note", async () => {
    const f = fixture({ ...cli, copy: "agent_directory", context: { paperclipTaskMarkdown: "# The brief", paperclipTaskMarkdownCompact: "# Compact" } });
    await f.controller.prepare(f.prepare);
    expect(f.context.paperclipTaskMarkdown).toBe("# The brief");
    expect(f.context.paperclipTaskMarkdownCompact).toBe("# Compact");
  });

  it("carries a storage warning in the facts", async () => {
    const f = fixture({ ...cli, copy: "agent_directory", storageWarning: "Agent files are near their limit." });
    await f.controller.prepare(f.prepare);
    expect(f.context.paperclipInstructionCopy).toMatchObject({ kind: "agent_directory", storageWarning: "Agent files are near their limit." });
    expect(f.context.paperclipTaskMarkdown).toBeUndefined();
  });

  it("a registered instructions file is the instruction_file kind, without the Runner note", async () => {
    const f = fixture({ ...cli, copy: "instruction_file" });
    await f.controller.prepare(f.prepare);
    expect(f.context.paperclipInstructionCopy).toEqual({ kind: "instruction_file", root: "/agents/agent/runs/run-1/live", entryFile: "AGENTS.md" });
    expect(f.context.paperclipTaskMarkdown).toBeUndefined();
  });

  it("403 path sets kind unavailable and appends no note for CLI runs; ACP still gets the note", async () => {
    const forCli = fixture({ ...cli, copy: "forbidden" });
    await forCli.controller.prepare(forCli.prepare);
    expect(forCli.context.paperclipInstructionCopy).toEqual({ kind: "unavailable" });
    expect(forCli.context.paperclipTaskMarkdown).toBeUndefined();
    expect(claudeInstructionsLocation({ instructionsFilePath: "/agents/agent/instructions/AGENTS.md", copy: { kind: "unavailable" } }))
      .toContain("Changes to it aren't saved.");

    const forAcp = fixture({ ...acp, copy: "forbidden" });
    await forAcp.controller.prepare(forAcp.prepare);
    expect(String(forAcp.context.paperclipTaskMarkdown)).toContain(UNAVAILABLE_NOTE);
    expect(String(forAcp.context.paperclipTaskMarkdownCompact)).toContain(UNAVAILABLE_NOTE);
  });

  it("ACP and other adapters still get the long notes", async () => {
    for (const [runtime, copy, note] of [
      [acp, "agent_directory", AGENT_DIRECTORY_NOTE],
      [{ adapterType: "codex_local", runtimeConfig: {} }, "agent_directory", AGENT_DIRECTORY_NOTE],
      [acp, "instruction_file", REGISTERED_COPY_NOTE],
    ] as const) {
      const f = fixture({ ...runtime, copy });
      await f.controller.prepare(f.prepare);
      expect(String(f.context.paperclipTaskMarkdown)).toContain(note);
      expect(String(f.context.paperclipTaskMarkdownCompact)).toContain(note);
    }
  });
});
