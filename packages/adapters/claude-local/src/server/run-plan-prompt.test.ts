import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildClaudePromptBundleKey } from "./prompt-cache.js";
import { planClaudeInstructionsDirective, planClaudeRunSkillsAndInstructions } from "./run-plan.js";
import {
  CLAUDE_INSTRUCTIONS_RELATIVE_NOTE,
  claudeInstructionsLocation,
  claudeSkillsSection,
  WORKING_IN_PAPERCLIP,
} from "./standing-texts.js";

// The run plan's prompt pieces (step 5, Task 4): the directive on its own, and the system prompt
// as labelled sections that join to the bundle's instructions file. A sealed run's system prompt
// is who the agent is, Working in Paperclip, the agent's instructions and its skills (step 5
// phase 2, the system prompt); an unsealed one keeps the earlier text.

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
let dir: string;
let instructionsFilePath: string;

const AGENTS_MD = "# Ada\n\nYou keep the release ledger.\n";
const agent = { id: "agent-1", name: "Ada", title: "Release manager" };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-run-plan-prompt-"));
  instructionsFilePath = path.join(dir, "AGENTS.md");
  await fs.writeFile(instructionsFilePath, AGENTS_MD);
  for (const key of ["ledger", "notes"]) {
    await fs.mkdir(path.join(dir, "skills", key), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", key, "SKILL.md"), `# ${key}\n`);
  }
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const skills = () => [
  { key: "ledger", runtimeName: "ledger", source: path.join(dir, "skills", "ledger") },
  { key: "notes", runtimeName: "notes", source: path.join(dir, "skills", "notes") },
];

const plan = (input: {
  config: Record<string, unknown>;
  sealed?: boolean;
  agent?: { id: string; name?: unknown; title?: unknown };
  context?: Record<string, unknown>;
}) => planClaudeRunSkillsAndInstructions({
  config: input.config,
  moduleDir,
  agent: input.agent ?? agent,
  sealed: input.sealed ?? true,
  context: input.context ?? {},
});

describe("planClaudeInstructionsDirective", () => {
  it("is the directive the run plan computes", async () => {
    const config = { instructionsFilePath };
    const planned = await plan({ config });
    const { directive, readError } = await planClaudeInstructionsDirective(config);
    expect(directive).toBe(planned.instructionsPathDirective);
    expect(directive).toBe(claudeInstructionsLocation(instructionsFilePath));
    expect(readError).toBeNull();
  });

  it("is empty, with the error, when the file can't be read", async () => {
    const result = await planClaudeInstructionsDirective({ instructionsFilePath: path.join(dir, "missing.md") });
    expect(result.directive).toBe("");
    expect(result.readError).toMatch(/ENOENT/);
    expect(await planClaudeInstructionsDirective({})).toEqual({ directive: "", readError: null });
  });
});

describe("the sealed system prompt", () => {
  const config = () => ({ instructionsFilePath, paperclipRuntimeSkills: skills(), paperclipSkillSync: { desiredSkills: ["ledger"] } });

  it("sealed system prompt has identity, working, instructions and skills in order", async () => {
    const planned = await plan({ config: config() });
    expect(planned.systemPromptSections.map((section) => section.id))
      .toEqual(["identity", "working_in_paperclip", "agent_instructions", "skill_library"]);
    expect(planned.systemPromptSections.map((section) => section.label))
      .toEqual(["Who you are", "Working in Paperclip", "Agent instructions", "Skills"]);
    const [identity, working, instructions, library] = planned.systemPromptSections;
    expect(identity!.text).toBe("You are Ada, Release manager.");
    expect(working!.text).toBe(WORKING_IN_PAPERCLIP);
    expect(instructions!.text).toBe(AGENTS_MD + CLAUDE_INSTRUCTIONS_RELATIVE_NOTE);
    expect(library!.text).toBe(claudeSkillsSection({
      entries: skills(),
      desiredSkillKeys: new Set(["ledger"]),
    }));
    expect(library!.text).toContain("- ledger");
    expect(library!.text).not.toContain("notes");
    expect(planned.combinedInstructionsContents).toBe([
      "You are Ada, Release manager.",
      WORKING_IN_PAPERCLIP,
      AGENTS_MD + CLAUDE_INSTRUCTIONS_RELATIVE_NOTE,
      library!.text,
    ].join("\n\n"));
    expect(planned.systemPromptSections.map((section) => section.text).join("\n\n")).toBe(planned.combinedInstructionsContents);
    for (const section of planned.systemPromptSections) {
      expect(section.chars).toBe(section.text.length);
      expect(section.parts!.map((part) => part.text).join("")).toBe(section.text);
    }
  });

  it("names the agent without a title", async () => {
    const planned = await plan({ config: config(), agent: { id: "agent-1", name: "Ada", title: null } });
    expect(planned.systemPromptSections[0]!.text).toBe("You are Ada.");
  });

  it("sealed system prompt without an instructions file still has identity, working and skills", async () => {
    for (const noFile of [{}, { instructionsFilePath: path.join(dir, "missing.md") }]) {
      const planned = await plan({ config: { ...noFile, paperclipRuntimeSkills: [] } });
      expect(planned.systemPromptSections.map((section) => section.id))
        .toEqual(["identity", "working_in_paperclip", "skill_library"]);
      expect(planned.combinedInstructionsContents).toBe(planned.systemPromptSections.map((section) => section.text).join("\n\n"));
      expect(planned.systemPromptSections[2]!.text).toBe(claudeSkillsSection({ entries: [], desiredSkillKeys: new Set() }));
    }
  });

  it("sealed system sections are every_run", async () => {
    const planned = await plan({ config: config() });
    for (const section of planned.systemPromptSections) {
      expect(section).toMatchObject({ placement: "system", delivery: "every_run" });
      expect(section.reason.endsWith("; a resumed session uses it only after a compaction")).toBe(true);
    }
  });

  it("sealed system prompt is identical across two runs with different instruction paths and contexts", async () => {
    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-run-plan-prompt-other-"));
    try {
      const otherPath = path.join(otherDir, "runs", "run-2", "live", "AGENTS.md");
      await fs.mkdir(path.dirname(otherPath), { recursive: true });
      await fs.writeFile(otherPath, AGENTS_MD);
      const first = await plan({
        config: { ...config(), instructionsFilePath },
        context: { taskId: "task-1", paperclipWake: { reason: "issue_assigned" } },
      });
      const second = await plan({
        config: { ...config(), instructionsFilePath: otherPath },
        context: { taskId: "task-2", wakeCommentId: "comment-9", paperclipWake: { reason: "issue_commented" } },
      });
      expect(first.instructionsPathDirective).not.toBe(second.instructionsPathDirective);
      expect(second.combinedInstructionsContents).toBe(first.combinedInstructionsContents);
      expect(first.combinedInstructionsContents).not.toContain(dir);
      const key = (contents: string | null) =>
        buildClaudePromptBundleKey({ skills: first.mountableSkillEntries, instructionsContents: contents });
      expect(await key(second.combinedInstructionsContents)).toBe(await key(first.combinedInstructionsContents));
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });

  it("bundle key changes when the agent is renamed", async () => {
    const before = await plan({ config: config() });
    const after = await plan({ config: config(), agent: { ...agent, name: "Ada Lovelace" } });
    const key = (contents: string | null) =>
      buildClaudePromptBundleKey({ skills: before.mountableSkillEntries, instructionsContents: contents });
    expect(await key(after.combinedInstructionsContents)).not.toBe(await key(before.combinedInstructionsContents));
  });
});

describe("the unsealed system prompt", () => {
  // Today's text, byte for byte: the dormant remote paths keep their launch and bundle keys.
  const UNSEALED_LIBRARY = [
    "## Company skill library",
    "",
    'Skills marked "enabled" are loaded into your runtime. Skills marked',
    '"installed, not enabled for you" exist in this company\'s skill library but',
    "are not attached to you — never report those as not installed; say they",
    "are installed but not enabled for you, and ask an operator to enable them",
    'for you (the skill page\'s "Add to agent" control) when you need one.',
    "",
    "- ledger — enabled",
    "- notes — installed, not enabled for you",
  ].join("\n");
  const UNSEALED_NOTE = "\nUse the agent instruction file location supplied in the current run prompt to resolve relative file references.";

  it("unsealed system prompt is unchanged", async () => {
    const planned = await plan({
      sealed: false,
      config: { instructionsFilePath, paperclipRuntimeSkills: skills(), paperclipSkillSync: { desiredSkills: ["ledger"] } },
    });
    expect(planned.combinedInstructionsContents).toBe(`${AGENTS_MD}${UNSEALED_NOTE}\n\n${UNSEALED_LIBRARY}`);
    expect(planned.systemPromptSections.map((section) => section.id)).toEqual(["agent_instructions", "skill_library"]);
    expect(planned.systemPromptSections.map((section) => section.label)).toEqual(["Agent instructions", "Company skill library"]);
    expect(planned.systemPromptSections.map((section) => section.text).join("\n\n")).toBe(planned.combinedInstructionsContents);
    for (const section of planned.systemPromptSections) {
      expect(section).toMatchObject({ placement: "system", delivery: "fresh_only" });
    }
  });

  it("has only what exists: the skill library alone, or nothing", async () => {
    const libraryOnly = await plan({ sealed: false, config: { paperclipRuntimeSkills: skills() } });
    expect(libraryOnly.systemPromptSections.map((section) => section.id)).toEqual(["skill_library"]);
    expect(libraryOnly.systemPromptSections[0]!.text).toBe(libraryOnly.combinedInstructionsContents);
    const none = await plan({ sealed: false, config: { paperclipRuntimeSkills: [] } });
    expect(none.systemPromptSections).toEqual([]);
    expect(none.combinedInstructionsContents).toBeNull();
  });
});
