import { describe, expect, it } from "vitest";
import { normalizePaperclipRunTask, normalizePaperclipSharedWorkspaceNote } from "./server-utils.js";

// The task's facts and the shared-workspace note (step 5 phase 2, the task brief): the contract's
// two context fields, as the claude_local wake reads them.

describe("normalizePaperclipRunTask", () => {
  it("is null without an object or an issue id", () => {
    for (const value of [undefined, null, "x", [], {}, { issueId: " " }]) expect(normalizePaperclipRunTask(value)).toBeNull();
  });

  it("fills what an older or partial value leaves out", () => {
    expect(normalizePaperclipRunTask({ issueId: "issue-1" })).toEqual({
      issueId: "issue-1",
      ancestors: [],
      ancestorsOmitted: 0,
      description: null,
      descriptionChangedSinceLastRun: false,
      plan: null,
      workMode: null,
      titleNeedsGeneration: false,
      rejectedPlan: null,
      acceptedPlan: null,
      wakeCommentAttachments: [],
      attachmentOmissions: [],
      prefixParts: [],
      compactedSinceLastRun: false,
    });
  });

  it("keeps the contract's fields and drops malformed entries", () => {
    const task = normalizePaperclipRunTask({
      issueId: "issue-1",
      ancestors: Array.from({ length: 8 }, (_, index) => ({ identifier: `TES-${index}`, title: index === 0 ? " " : "A", status: null })),
      ancestorsOmitted: 1,
      description: "  Do it.  ",
      descriptionChangedSinceLastRun: true,
      plan: { revisionNumber: 2, body: "1. Step", truncatedFrom: 15_000, changedSinceLastRun: true },
      workMode: "planning",
      titleNeedsGeneration: true,
      rejectedPlan: { reason: "" },
      acceptedPlan: { revisionNumber: "2" },
      wakeCommentAttachments: [
        { commentId: "c-1", id: "a-1", filename: "x.png", contentType: "image/png", byteSize: 10 },
        { commentId: "c-1", filename: "no-id.png" },
      ],
      attachmentOmissions: [{ commentId: "c-1", notice: "too big" }, { commentId: "c-1", notice: "" }],
      prefixParts: [{ id: "wake.task.case", text: "Case.\n\n" }, { id: "wake.other", text: "No." }, { id: "wake.task.live_voice", text: " " }],
      compactedSinceLastRun: true,
    })!;
    expect(task.ancestors).toHaveLength(6);
    expect(task.ancestors[0]).toEqual({ identifier: "TES-0", title: null, status: null });
    expect(task.ancestorsOmitted).toBe(3);
    expect(task.description).toBe("Do it.");
    expect(task.plan).toEqual({ revisionNumber: 2, body: "1. Step", truncatedFrom: 15_000, changedSinceLastRun: true });
    expect(task.rejectedPlan).toEqual({ reason: null });
    expect(task.acceptedPlan).toEqual({ revisionNumber: null });
    expect(task.wakeCommentAttachments).toEqual([{ commentId: "c-1", id: "a-1", filename: "x.png", contentType: "image/png", byteSize: 10 }]);
    expect(task.attachmentOmissions).toEqual([{ commentId: "c-1", notice: "too big" }]);
    expect(task.prefixParts).toEqual([{ id: "wake.task.case", text: "Case." }]);
    expect(task.compactedSinceLastRun).toBe(true);
    expect(normalizePaperclipRunTask({ issueId: "i", plan: { revisionNumber: 1, body: "  " } })!.plan).toBeNull();
  });
});

describe("normalizePaperclipSharedWorkspaceNote", () => {
  it("needs the holding run", () => {
    expect(normalizePaperclipSharedWorkspaceNote({ heldByRunId: "run-1", heldByIssue: "TES-12" })).toEqual({ heldByRunId: "run-1", heldByIssue: "TES-12" });
    expect(normalizePaperclipSharedWorkspaceNote({ heldByRunId: "run-1" })).toEqual({ heldByRunId: "run-1", heldByIssue: null });
    expect(normalizePaperclipSharedWorkspaceNote({ heldByIssue: "TES-12" })).toBeNull();
    expect(normalizePaperclipSharedWorkspaceNote(null)).toBeNull();
  });
});
