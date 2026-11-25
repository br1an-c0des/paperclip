import { describe, expect, it } from "vitest";
import { createPromptContextFixture } from "@paperclipai/adapter-utils/test-fixtures/prompt-context";
import type { PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";
import {
  CLAUDE_INSTRUCTIONS_RELATIVE_NOTE,
  claudeIdentityLine,
  claudeInstructionsLocation,
  claudeSkillsSection,
  claudeToolsNote,
  claudeToolsNoteEndsRun,
  WORKING_IN_PAPERCLIP,
  WORKING_IN_PAPERCLIP_ENDING,
} from "./standing-texts.js";

// The first message's standing texts on a claude_local CLI run (step 5 phase 2, the light
// sections). Exact copy from fork/step-5-light.md.

const TOOLS_LINE =
  "Work with Paperclip through the `paperclip` MCP server's `paperclip_*` tools, not HTTP requests. " +
  "This message has what's new and the task; `paperclip_read_task` and `paperclip_task_context` read more when you need it.";
const END_OF_RUN_LINE =
  "End the run with `paperclip_finish`, `paperclip_block` (if you're waiting on someone) or `paperclip_report_progress` with `continue: true`.";
const API_KEY_LINE = "PAPERCLIP_API_KEY is there for scripts that need the REST API.";

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
  it("is one line naming the file and the folder relative paths resolve from", () => {
    expect(claudeInstructionsLocation("/x/instructions/AGENTS.md"))
      .toBe("Your instructions file this run is /x/instructions/AGENTS.md; resolve relative paths in it from /x/instructions/.");
  });
});

describe("claudeToolsNote", () => {
  const env = { PAPERCLIP_API_URL: "u", PAPERCLIP_API_KEY: "k" };

  it("has three lines with the end-of-run line", () => {
    const note = claudeToolsNote({ env, endOfRunLine: true });
    expect(note.split("\n")).toHaveLength(3);
    expect(note).toBe([TOOLS_LINE, END_OF_RUN_LINE, API_KEY_LINE].join("\n"));
  });

  it("leaves the end-of-run line out when asked", () => {
    const note = claudeToolsNote({ env, endOfRunLine: false });
    expect(note).not.toContain("paperclip_finish");
    expect(note).toBe([TOOLS_LINE, API_KEY_LINE].join("\n"));
  });

  it("is empty without the API URL or key", () => {
    expect(claudeToolsNote({ env: {}, endOfRunLine: true })).toBe("");
    expect(claudeToolsNote({ env: { PAPERCLIP_API_URL: "u" }, endOfRunLine: true })).toBe("");
    expect(claudeToolsNote({ env: { PAPERCLIP_API_KEY: "k" }, endOfRunLine: true })).toBe("");
  });

  it("has no heading and doesn't say to start with paperclip_task_context", () => {
    const note = claudeToolsNote({ env, endOfRunLine: true });
    expect(note).not.toContain("Paperclip API access note:");
    expect(note).not.toContain("Start with");
  });
});

describe("claudeToolsNoteEndsRun", () => {
  it("is false on a chat task", () => {
    expect(claudeToolsNoteEndsRun({ conversationMode: true })).toBe(false);
  });

  it("is false on a recovery wake", () => {
    const fixture = createPromptContextFixture();
    // A payload needs an issue (or comments) to normalize.
    expect(claudeToolsNoteEndsRun({
      paperclipWake: { reason: "source_scoped_recovery_action", issue: fixture.paperclipWake.issue },
    })).toBe(false);
    expect(claudeToolsNoteEndsRun({
      ...fixture,
      paperclipWake: {
        reason: "issue_continuation_needed",
        issue: fixture.paperclipWake.issue,
        recovery: {
          cause: "process_lost", failureSummary: "the process exited", originalAssignee: { id: "agent-1", name: "Ada" },
          attemptCount: 1, maxAttempts: 3, nextAction: "retry",
        },
        comments: [],
        fallbackFetchNeeded: false,
      },
    })).toBe(false);
  });

  it("is true otherwise", () => {
    expect(claudeToolsNoteEndsRun({})).toBe(true);
    expect(claudeToolsNoteEndsRun({ conversationMode: false })).toBe(true);
    expect(claudeToolsNoteEndsRun(createPromptContextFixture())).toBe(true);
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
