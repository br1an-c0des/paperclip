import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";
import {
  CLAUDE_INSTRUCTIONS_RELATIVE_NOTE,
  claudeIdentityLine,
  claudeInstructionsLocation,
  claudeSkillsSection,
  readClaudeInstructionCopy,
  WORKING_IN_PAPERCLIP,
  WORKING_IN_PAPERCLIP_ENDING,
} from "./standing-texts.js";

// The standing texts on a claude_local CLI run (step 5 phase 2, the light sections and the
// system prompt). Exact copy from fork/step-5-light.md and fork/step-5-system-prompt-plan.md.

describe("claudeIdentityLine", () => {
  it("names the agent and its title", () => {
    expect(claudeIdentityLine({ id: "a1", name: "M7 test sealed runner", title: "QA engineer" }))
      .toBe("You are M7 test sealed runner, QA engineer.");
  });

  it("leaves out a missing, empty or blank title", () => {
    expect(claudeIdentityLine({ id: "a1", name: "Ada", title: "  " })).toBe("You are Ada.");
    expect(claudeIdentityLine({ id: "a1", name: "Ada", title: "" })).toBe("You are Ada.");
    expect(claudeIdentityLine({ id: "a1", name: "Ada", title: null })).toBe("You are Ada.");
    expect(claudeIdentityLine({ id: "a1", name: "Ada" })).toBe("You are Ada.");
    expect(claudeIdentityLine({ id: "a1", name: "Ada", title: 42 })).toBe("You are Ada.");
  });

  it("trims the name and title", () => {
    expect(claudeIdentityLine({ id: "a1", name: " Ada ", title: " CTO " })).toBe("You are Ada, CTO.");
  });

  it("prints a name with template braces as is", () => {
    expect(claudeIdentityLine({ id: "a1", name: "A {{agent.id}}" })).toBe("You are A {{agent.id}}.");
  });

  it("falls back to the agent's id when the name is blank", () => {
    expect(claudeIdentityLine({ id: "a1", name: "" })).toBe("You are agent a1.");
    expect(claudeIdentityLine({ id: "a1", name: "   ", title: "CTO" })).toBe("You are agent a1, CTO.");
    expect(claudeIdentityLine({ id: "a1" })).toBe("You are agent a1.");
  });
});

describe("claudeInstructionsLocation", () => {
  const instructionsFilePath = "/x/instructions/AGENTS.md";
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  it("names the agent directory and its entry file once, with no trailing newline", () => {
    const text = claudeInstructionsLocation({
      instructionsFilePath: "/home/run/live/AGENTS.md",
      copy: { kind: "agent_directory", root: "/home/run/live", entryFile: "AGENTS.md", storageWarning: null },
    });
    expect(text).toBe(
      "Your agent directory this run is /home/run/live (AGENT_HOME): your instructions are AGENTS.md there, " +
        "and changes you make in it are kept after the run. Task files go in the task's working directory.",
    );
    expect(count(text, "/home/run/live")).toBe(1);
    expect(text.endsWith("\n")).toBe(false);
  });

  it("puts a storage warning on its own line after the agent directory line", () => {
    const text = claudeInstructionsLocation({
      instructionsFilePath: "/home/run/live/AGENTS.md",
      copy: { kind: "agent_directory", root: "/home/run/live", entryFile: "AGENTS.md", storageWarning: "Agent files are near their limit." },
    });
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^Your agent directory this run is \/home\/run\/live \(AGENT_HOME\)/),
      "Agent files are near their limit.",
    ]);
  });

  it("names a registered instructions file once, saying its changes are saved", () => {
    const text = claudeInstructionsLocation({ instructionsFilePath, copy: { kind: "instruction_file", root: "/x/instructions", entryFile: "AGENTS.md" } });
    expect(text).toBe("Your instructions file is /x/instructions/AGENTS.md; relative paths in it resolve from /x/instructions/. Changes to it are saved after the run.");
    expect(count(text, instructionsFilePath)).toBe(1);
  });

  it("says changes aren't saved when no copy can be saved", () => {
    expect(claudeInstructionsLocation({ instructionsFilePath, copy: { kind: "unavailable" } }))
      .toBe("Your instructions file is /x/instructions/AGENTS.md; relative paths in it resolve from /x/instructions/. Changes to it aren't saved.");
  });

  it("is the file and its folder without a copy", () => {
    const text = claudeInstructionsLocation({ instructionsFilePath, copy: null });
    expect(text).toBe("Your instructions file is /x/instructions/AGENTS.md; relative paths in it resolve from /x/instructions/.");
    expect(count(text, instructionsFilePath)).toBe(1);
    expect(text).not.toContain("\n");
  });
});

describe("readClaudeInstructionCopy", () => {
  it("reads each kind", () => {
    expect(readClaudeInstructionCopy({ kind: "agent_directory", root: "/r", entryFile: "AGENTS.md", storageWarning: "  " }))
      .toEqual({ kind: "agent_directory", root: "/r", entryFile: "AGENTS.md", storageWarning: null });
    expect(readClaudeInstructionCopy({ kind: "agent_directory", root: "/r", entryFile: "AGENTS.md", storageWarning: "Full." }))
      .toEqual({ kind: "agent_directory", root: "/r", entryFile: "AGENTS.md", storageWarning: "Full." });
    expect(readClaudeInstructionCopy({ kind: "instruction_file", root: "/r", entryFile: "AGENTS.md" }))
      .toEqual({ kind: "instruction_file", root: "/r", entryFile: "AGENTS.md" });
    expect(readClaudeInstructionCopy({ kind: "unavailable" })).toEqual({ kind: "unavailable" });
  });

  it("is null when absent or not understood", () => {
    for (const value of [undefined, null, "x", [], {}, { kind: "other", root: "/r", entryFile: "a" }, { kind: "agent_directory", root: "", entryFile: "a" }]) {
      expect(readClaudeInstructionCopy(value)).toBeNull();
    }
  });
});

// --- The sealed system prompt (step 5 phase 2, the system prompt). Exact copy from
// fork/step-5-system-prompt-plan.md, "Global Constraints".

const ENDING_COPY = `### Ending a run

End every task run with exactly one of:

- \`paperclip_finish\` with a summary: the task goes to \`done\`, or to \`in_review\` (\`status: "in_review"\`) when someone has a real way to review it: a question or approval you created, a human reviewer, or a review stage. "Please review" in a comment isn't one.
- \`paperclip_block\` when work can't go on until a named owner does a concrete thing, or other tasks finish (\`blockedByTaskIds\`). Always give the \`owner\` and the exact \`unblockAction\`.
- \`paperclip_report_progress\` with \`continue: true\` when the work carries on in a later run.

A final message alone doesn't end a run. A chat turn ends with your reply instead. When the run message gives other closing steps (a recovery, say), follow those.`;

const WORKING_COPY = `## Working in Paperclip

Paperclip wakes you in runs, each about one task (a task and an issue are the same thing). A run's first message says what happened and what to do now. Work with Paperclip through the \`paperclip\` MCP server's \`paperclip_*\` tools, not HTTP requests; \`paperclip_read_task\` and \`paperclip_task_context\` read more when you need it.

${ENDING_COPY}

### While you work

- Work on the run's task, not others you come across. Start concrete work in this run unless the task asks only for a plan or a review.
- Don't poll other agents, subtasks or processes: Paperclip wakes you when something changes.
- Ask a person (\`paperclip_ask_board\`) only when something stops the next useful step; carry on with independent work meanwhile.

### Comments and commits

- Comments are short markdown: a status line, then bullets. Say what happened and what's next, not which tools you called.
- Link tickets as \`[PAP-224](/PAP/issues/PAP-224)\`: relative, with the company prefix. Never a bare identifier or a raw UUID.
- End every commit message with \`Co-Authored-By: Paperclip <noreply@paperclip.ing>\`.

The \`paperclip\` skill has the rest: asking and approvals, delegating and handing off, documents, plans and files, review stages, the REST API. Open it before doing any of those.`;

const SKILLS_POINTER =
  "The company's skill library may hold others that aren't enabled for you: `paperclip_skills` lists them. " +
  "Say a skill is installed but not enabled rather than missing, and ask for it to be added to you.";

describe("WORKING_IN_PAPERCLIP", () => {
  it("is the spec's text, with the ending rules as their own export", () => {
    expect(WORKING_IN_PAPERCLIP_ENDING).toBe(ENDING_COPY);
    expect(WORKING_IN_PAPERCLIP).toBe(WORKING_COPY);
  });
});

describe("the paperclip skill", () => {
  // ACP and the other engines read the same skill without this system prompt: its "Every run"
  // keeps the same ending rules, word for word.
  it("the paperclip skill carries the system prompt's ending rules verbatim", async () => {
    const skill = await fs.readFile(fileURLToPath(new URL("../../../../../skills/paperclip/SKILL.md", import.meta.url)), "utf8");
    expect(skill).toContain(WORKING_IN_PAPERCLIP_ENDING);
  });
});

describe("CLAUDE_INSTRUCTIONS_RELATIVE_NOTE", () => {
  it("points at the run message for the directory, without a path", () => {
    expect(CLAUDE_INSTRUCTIONS_RELATIVE_NOTE)
      .toBe("\nRelative paths in these instructions resolve from the directory the run message names.");
  });
});

describe("claudeSkillsSection", () => {
  const entry = (key: string, extra: Partial<PaperclipSkillEntry> = {}): PaperclipSkillEntry =>
    ({ key, runtimeName: key, source: `/skills/${key}`, ...extra });

  it("claudeSkillsSection lists enabled skills and always ends with the paperclip_skills line", () => {
    const text = claudeSkillsSection({
      entries: [entry("notes"), entry("ledger"), entry("other"), entry("broken", { sourceStatus: "missing", missingDetail: "gone\nnow" })],
      desiredSkillKeys: new Set(["notes", "ledger", "broken"]),
    });
    expect(text).toBe([
      "## Skills",
      "",
      "These skills are enabled for you:",
      "",
      "- broken — enabled but unavailable: gone now",
      "- ledger",
      "- notes",
      "",
      SKILLS_POINTER,
    ].join("\n"));
    expect(text).not.toContain("- other");
  });

  it("claudeSkillsSection with no skills is the heading and the paperclip_skills line", () => {
    expect(claudeSkillsSection({ entries: [], desiredSkillKeys: new Set() })).toBe(`## Skills\n\n${SKILLS_POINTER}`);
    expect(claudeSkillsSection({ entries: [entry("other")], desiredSkillKeys: new Set() })).toBe(`## Skills\n\n${SKILLS_POINTER}`);
  });

  it("flattens a key with line breaks to one line", () => {
    const text = claudeSkillsSection({ entries: [entry("a\n## Injected")], desiredSkillKeys: new Set(["a\n## Injected"]) });
    expect(text).toContain("- a ## Injected");
    expect(text.split("\n").filter((line) => line.startsWith("## "))).toEqual(["## Skills"]);
  });
});
