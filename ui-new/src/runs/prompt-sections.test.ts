import { describe, expect, it } from "vitest";
import { freshRecord, promptSection, resumedRecord, unmatchedRecord } from "./fixtures/prompt-records";
import { promptSize } from "./invocation";
import { promptViewFromLegacyPrompt, promptViewFromRecord, sectionInfo } from "./prompt-sections";

describe("promptViewFromRecord", () => {
  it("gives the system prompt, then the first message, with the sections in their recorded order", () => {
    const view = promptViewFromRecord(freshRecord);
    expect(view.groups.map((group) => [group.placement, group.title])).toEqual([
      ["system", "System prompt"],
      ["first_message", "First message"],
    ]);
    const [system, first] = view.groups;
    expect(system!.sections.map((section) => section.id)).toEqual(["agent_instructions", "skill_library"]);
    expect(first!.sections.map((section) => section.id)).toEqual(["communication_guidance", "wake", "task_brief"]);
    expect(system!.note).toBeNull();
    expect(view.session).toBe("fresh");
    expect(view.matchedPlan).toBe(true);
    expect(view.legacy).toBe(false);
  });

  it("keeps each section's label, reason, source, delivery and parts", () => {
    const [, first] = promptViewFromRecord(freshRecord).groups;
    const guidance = first!.sections[0]!;
    expect(guidance).toMatchObject({
      label: "Communication guidance",
      reason: "a new session",
      source: "paperclipTaskCommunicationGuidance",
      delivery: "New sessions only",
    });
    expect(guidance.info).toBeTruthy();
    const wake = first!.sections[1]!;
    expect(wake.delivery).toBe("Every run");
    expect(wake.parts.map((part) => [part.id, part.label, part.source])).toEqual([
      ["wake.comments", "Comments", "task comments"],
      ["wake.continuation", "Continuation", "execution continuation"],
    ]);
    expect(wake.parts.every((part) => part.pending === null)).toBe(true);
  });

  it("shows a part without the blank line that separates it from the one before", () => {
    const wake = freshRecord.firstMessage[1]!;
    const record = {
      ...freshRecord,
      firstMessage: [{ ...wake, parts: [
        { id: "wake.header", label: "Header", source: "wake", text: "## Wake", chars: 7 },
        { id: "wake.comments", label: "Comments", source: "task comments", text: "\n\n- a comment", chars: 13, pending: "read at launch" },
      ] }],
    };
    const [, first] = promptViewFromRecord(record).groups;
    expect(first!.sections[0]!.parts.map((part) => [part.text, part.pending])).toEqual([["## Wake", null], ["- a comment", "read at launch"]]);
  });

  it("gives the whole first message as sent, for Copy", () => {
    const view = promptViewFromRecord(freshRecord);
    expect(view.firstMessageText).toBe(
      freshRecord.firstMessage.map((section) => section.text).join("\n\n"),
    );
    expect(view.firstMessageChars).toBe(freshRecord.firstMessageChars);
  });

  it("marks a resumed run's empty system prompt as kept from the session's start", () => {
    const [system, first] = promptViewFromRecord(resumedRecord).groups;
    expect(system!.sections).toEqual([]);
    expect(system!.note).toBe("Kept from the session's start");
    expect(system!.size).toBeNull();
    expect(first!.sections).toHaveLength(1);
  });

  it("says when a fresh run's system prompt had nothing added", () => {
    const [system] = promptViewFromRecord({ ...freshRecord, systemPrompt: [] }).groups;
    expect(system!.note).toBe("Nothing added to Claude's own");
  });

  it("carries matchedPlan: false through, with the sent text as one section", () => {
    const view = promptViewFromRecord(unmatchedRecord);
    expect(view.matchedPlan).toBe(false);
    expect(view.groups[1]!.sections.map((section) => section.id)).toEqual(["unsplit"]);
  });

  it("formats sizes like the rest of the run view", () => {
    const long = "x".repeat(40_000);
    const view = promptViewFromRecord({
      ...freshRecord,
      firstMessage: [promptSection("task_brief", long), promptSection("mcp_note", "y".repeat(333))],
      firstMessageChars: 40_335,
    });
    const [system, first] = view.groups;
    expect(first!.sections.map((section) => section.size)).toEqual([promptSize(long), promptSize("y".repeat(333))]);
    expect(first!.sections.map((section) => section.size)).toEqual(["40k characters", "333 characters"]);
    expect(first!.size).toBe("40.3k characters");
    // The system prompt's size is its sections' sizes added up.
    expect(system!.size).toBe("54 characters");
  });

  it("shows the wake's four headings as sections, each with its own tip, and still shows an old record's wake and brief", () => {
    const view = promptViewFromRecord({
      ...freshRecord,
      firstMessage: [
        promptSection("what_happened", "## What happened\n\nA new comment."),
        promptSection("where_things_stand", "## Where things stand\n\nThe history."),
        promptSection("the_task", "## The task\n\nTES-45 \"Add a toggle\""),
        promptSection("to_do", "## What to do now\n\n- Reply."),
      ],
    });
    const sections = view.groups[1]!.sections;
    expect(sections.map((section) => section.id)).toEqual(["what_happened", "where_things_stand", "the_task", "to_do"]);
    const tips = sections.map((section) => section.info);
    expect(new Set(tips).size).toBe(4);
    for (const tip of tips) expect(tip).not.toBe(sectionInfo("unknown_section"));
    // An old record: one wake section and the brief, each with its tip.
    const [, old] = promptViewFromRecord(freshRecord).groups;
    expect(old!.sections.map((section) => section.id)).toEqual(["communication_guidance", "wake", "task_brief"]);
    expect(old!.sections.map((section) => section.info).every((tip) => tip !== sectionInfo("unknown_section"))).toBe(true);
  });

  it("keeps a section's pending marker for the preview to show", () => {
    const view = promptViewFromRecord({
      ...freshRecord,
      firstMessage: [promptSection("mcp_note", "", { pending: "filled in at launch" })],
    });
    expect(view.groups[1]!.sections[0]!.pending).toBe("filled in at launch");
  });
});

describe("promptViewFromLegacyPrompt", () => {
  it("shows a prompt recorded before step 5 as one section", () => {
    const view = promptViewFromLegacyPrompt("You are agent 7c1e (Quant Researcher).");
    expect(view.legacy).toBe(true);
    expect(view.session).toBeNull();
    const [system, first] = view.groups;
    expect(system!.sections).toEqual([]);
    expect(system!.note).toBe("Not recorded for this run");
    expect(first!.sections).toHaveLength(1);
    expect(first!.sections[0]).toMatchObject({ id: "unsplit", label: "Recorded before sections", text: "You are agent 7c1e (Quant Researcher).", size: "38 characters" });
    expect(view.firstMessageText).toBe("You are agent 7c1e (Quant Researcher).");
    expect(view.truncatedChars).toBeNull();
  });

  it("notices a legacy prompt that was cut when it was stored", () => {
    const view = promptViewFromLegacyPrompt(`${"x".repeat(16_384)}\n[truncated 23616 chars]`);
    expect(view.truncatedChars).toBe(23_616);
    expect(view.firstMessageChars).toBe(40_000);
  });
});
