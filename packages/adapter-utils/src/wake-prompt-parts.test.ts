import { describe, expect, it } from "vitest";
import {
  joinPaperclipPromptPartGroups,
  joinPaperclipPromptParts,
  joinPromptSections,
  renderPaperclipWakePrompt,
  renderPaperclipWakePromptParts,
  trimPaperclipPromptParts,
  type PaperclipPromptPart,
} from "./server-utils.js";
import { createPromptContextFixture } from "./test-fixtures/prompt-context.js";

// The wake's display parts (step 5, Task 2). The renderer's own test files check every one of
// their fixtures through `test-fixtures/wake-prompt-parts.ts`; this file pins the part ids.

function part(id: string, text: string): PaperclipPromptPart {
  return { id, label: id, source: id, text };
}

function busyWake() {
  const fixture = createPromptContextFixture();
  return {
    ...fixture.paperclipWake,
    comments: [
      ...fixture.paperclipWake.comments,
      { id: "comment-new", body: "Also check the release notes.", authorType: "user", authorId: "user-1", createdAt: "2026-09-22T01:00:00.000Z" },
    ],
    commentWindow: { requestedCount: 4, includedCount: 4, missingCount: 0 },
    latestCommentId: "comment-new",
    planReviewContext: {
      documentKey: "plan",
      issueId: "issue-1",
      latestRevisionNumber: 2,
      threads: [{ id: "thread-1", status: "open", selectedText: "Ship Friday", comments: [{ id: "pc-1", body: "Friday is too soon." }] }],
    },
    executionStage: { wakeRole: "reviewer", stageType: "review", allowedActions: ["approve", "request_changes"] },
    continuationSummary: { body: "Ledger drafted; checklist pending." },
    childIssueSummaries: [{ id: "child-1", identifier: "PAP-2", title: "Draft notes", status: "done", summary: "Notes drafted." }],
    checkedOutByHarness: true,
    connectorSkillInstructions: "Use the ledger connector.",
    connectionInstructions: { text: "## Connection instructions\n\nAsk before posting." },
  };
}

describe("renderPaperclipWakePromptParts", () => {
  it("names a busy wake's blocks in order, and they join to the rendered text", () => {
    const wake = busyWake();
    for (const resumedSession of [false, true]) {
      const parts = renderPaperclipWakePromptParts(wake, { resumedSession, suppressIssueDescription: true });
      expect(joinPaperclipPromptParts(parts)).toBe(
        renderPaperclipWakePrompt(wake, { resumedSession, suppressIssueDescription: true }),
      );
    }
    const parts = renderPaperclipWakePromptParts(wake, { suppressIssueDescription: true });
    expect(parts.map((entry) => entry.id)).toEqual([
      "wake.header",
      "wake.summary",
      "wake.continuation",
      "wake.issue_state",
      "wake.checkout_line",
      "wake.plan_review",
      "wake.execution_stage",
      "wake.continuation_summary",
      "wake.children",
      "wake.checkout_note",
      "wake.comments",
      "wake.connector_skills",
      "wake.connection_instructions",
    ]);
    expect(parts.find((entry) => entry.id === "wake.comments")?.text).toContain("Also check the release notes.");
    for (const entry of parts) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("names the recovery contract and an answered question", () => {
    const wake = {
      reason: "issue_continuation_needed",
      issue: { id: "issue-1", identifier: "PAP-1", title: "Release ledger" },
      recovery: { cause: "process_lost", failureSummary: "exited" },
      questionResponse: { interactionId: "interaction-1", summaryMarkdown: "Q: Ship? A: Monday." },
    };
    const parts = renderPaperclipWakePromptParts(wake, {});
    expect(joinPaperclipPromptParts(parts)).toBe(renderPaperclipWakePrompt(wake, {}));
    expect(parts.map((entry) => entry.id)).toEqual([
      "wake.header",
      "wake.recovery_contract",
      "wake.summary",
      "wake.answered_questions",
    ]);
  });

  it("returns no parts when there is no wake, and only the appended text when the body is empty", () => {
    expect(renderPaperclipWakePromptParts(null, {})).toEqual([]);
    const appendedOnly = { mcpAppContext: "  Widget says hi.  " };
    expect(renderPaperclipWakePrompt(appendedOnly)).toBe("Widget says hi.");
    const parts = renderPaperclipWakePromptParts(appendedOnly, {});
    expect(parts.map((entry) => entry.id)).toEqual(["wake.mcp_app_context"]);
    expect(joinPaperclipPromptParts(parts)).toBe("Widget says hi.");
  });
});

describe("prompt part helpers", () => {
  it("trims across parts the way String.trim trims their join", () => {
    const parts = [part("a", "\n \n"), part("b", "  x\n"), part("c", "y  "), part("d", " \n")];
    const trimmed = trimPaperclipPromptParts(parts);
    expect(joinPaperclipPromptParts(trimmed)).toBe(joinPaperclipPromptParts(parts).trim());
    expect(trimmed.map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(trimPaperclipPromptParts([part("a", "  ")])).toEqual([]);
  });

  it("joins groups of parts by the joinPromptSections rule", () => {
    const groups = [[part("a", "  one\n"), part("b", "two ")], [], [part("c", "   ")], [part("d", "\nthree")]];
    const joined = joinPaperclipPromptPartGroups(groups);
    expect(joinPaperclipPromptParts(joined)).toBe(
      joinPromptSections(groups.map((group) => joinPaperclipPromptParts(group))),
    );
    expect(joined.map((entry) => entry.id)).toEqual(["a", "b", "d"]);
  });
});
