import { describe, expect, it } from "vitest";
import { createPromptContextFixture } from "@paperclipai/adapter-utils/test-fixtures/prompt-context";
import {
  claudeIdentityLine,
  claudeInstructionsLocation,
  claudeToolsNote,
  claudeToolsNoteEndsRun,
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
