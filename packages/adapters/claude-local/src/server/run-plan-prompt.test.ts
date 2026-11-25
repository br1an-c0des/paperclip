import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planClaudeInstructionsDirective, planClaudeRunSkillsAndInstructions } from "./run-plan.js";
import { claudeInstructionsLocation } from "./standing-texts.js";

// The run plan's prompt pieces (step 5, Task 4): the directive on its own, and the system prompt
// as labelled sections that join to the bundle's instructions file.

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
let dir: string;
let instructionsFilePath: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-run-plan-prompt-"));
  instructionsFilePath = path.join(dir, "AGENTS.md");
  await fs.writeFile(instructionsFilePath, "# Ada\n\nYou keep the release ledger.\n");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("planClaudeInstructionsDirective", () => {
  it("is the directive the run plan computes", async () => {
    const config = { instructionsFilePath };
    const plan = await planClaudeRunSkillsAndInstructions({ config, moduleDir });
    const { directive, readError } = await planClaudeInstructionsDirective(config);
    expect(directive).toBe(plan.instructionsPathDirective);
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

describe("systemPromptSections", () => {
  const skills = () => [
    { key: "ledger", runtimeName: "ledger", source: path.join(dir, "skills", "ledger") },
    { key: "notes", runtimeName: "notes", source: path.join(dir, "skills", "notes") },
  ];

  it("joins with a blank line to the bundle's instructions contents", async () => {
    const plan = await planClaudeRunSkillsAndInstructions({
      config: { instructionsFilePath, paperclipRuntimeSkills: skills(), paperclipSkillSync: { desiredSkills: ["ledger"] } },
      moduleDir,
    });
    expect(plan.systemPromptSections.map((section) => section.id)).toEqual(["agent_instructions", "skill_library"]);
    expect(plan.systemPromptSections.map((section) => section.text).join("\n\n")).toBe(plan.combinedInstructionsContents);
    const [instructions, library] = plan.systemPromptSections;
    expect(instructions).toMatchObject({ placement: "system", delivery: "fresh_only" });
    expect(instructions!.text.startsWith("# Ada\n\nYou keep the release ledger.\n")).toBe(true);
    expect(library!.text).toContain("## Company skill library");
    for (const section of plan.systemPromptSections) {
      expect(section.chars).toBe(section.text.length);
      expect(section.parts!.map((part) => part.text).join("")).toBe(section.text);
    }
  });

  it("has only what exists: the skill library alone, or nothing", async () => {
    const libraryOnly = await planClaudeRunSkillsAndInstructions({ config: { paperclipRuntimeSkills: skills() }, moduleDir });
    expect(libraryOnly.systemPromptSections.map((section) => section.id)).toEqual(["skill_library"]);
    expect(libraryOnly.systemPromptSections[0]!.text).toBe(libraryOnly.combinedInstructionsContents);
    const none = await planClaudeRunSkillsAndInstructions({ config: { paperclipRuntimeSkills: [] }, moduleDir });
    expect(none.systemPromptSections).toEqual([]);
    expect(none.combinedInstructionsContents).toBeNull();
  });
});
