import type { RunPromptRecord, RunPromptSection } from "@paperclipai/shared";

/* Prompt records (`adapter.prompt`, step 5) for the Input tab's tests. */

export function promptSection(id: RunPromptSection["id"], text: string, extra: Partial<RunPromptSection> = {}): RunPromptSection {
  return {
    id,
    label: id,
    placement: "first_message",
    delivery: "every_run",
    reason: "fixture",
    source: "fixture",
    text,
    chars: text.length,
    ...extra,
  };
}

const comments = "## Comments\n\nBrian: please look at the failing test.";
const continuation = "## Continuation\n\nYou were fixing the parser.";
const wakeText = `${comments}\n\n${continuation}`;

export const freshRecord: RunPromptRecord = {
  version: 1,
  session: "fresh",
  systemPrompt: [
    promptSection("agent_instructions", "You are the Quant Researcher.", {
      label: "Agent instructions",
      placement: "system",
      reason: "the agent has an instructions file",
      source: "AGENTS.md",
    }),
    promptSection("skill_library", "Skills: paperclip, review", {
      label: "Skill library",
      placement: "system",
      reason: "2 skills assigned",
      source: "assigned skills",
    }),
  ],
  firstMessage: [
    promptSection("communication_guidance", "Talk to people through task comments.", {
      label: "Communication guidance",
      delivery: "fresh_only",
      reason: "a new session",
      source: "paperclipTaskCommunicationGuidance",
    }),
    promptSection("wake", wakeText, {
      label: "Wake",
      reason: "woken by a comment",
      source: "wake payload",
      parts: [
        { id: "wake.comments", label: "Comments", source: "task comments", text: comments, chars: comments.length },
        { id: "wake.continuation", label: "Continuation", source: "execution continuation", text: continuation, chars: continuation.length },
      ],
    }),
    promptSection("task_brief", "# TRA-41 Fix the parser\n\nThe parser drops the last line.", {
      label: "Task brief",
      reason: "the run is for TRA-41",
      source: "task description",
    }),
  ],
  firstMessageChars: 0,
  matchedPlan: true,
};
freshRecord.firstMessageChars = freshRecord.firstMessage.map((section) => section.text.trim()).filter(Boolean).join("\n\n").length;

/** A sealed run's resumed attempt: the system prompt file goes with every run (step 5 phase 2, bug 90). */
export const sealedResumedRecord: RunPromptRecord = {
  version: 1,
  session: "resumed",
  systemPrompt: [
    promptSection("identity", "You are Ada, Release manager.", { label: "Who you are", placement: "system" }),
    promptSection("working_in_paperclip", "## Working in Paperclip\n\nPaperclip wakes you in runs.", { label: "Working in Paperclip", placement: "system" }),
    promptSection("skill_library", "## Skills\n\nThe company's skill library may hold others.", { label: "Skills", placement: "system" }),
  ],
  firstMessage: [
    promptSection("what_happened", "## What happened\n\nA new comment.", { label: "What happened", reason: "woken by a comment" }),
  ],
  firstMessageChars: "## What happened\n\nA new comment.".length,
  matchedPlan: true,
};

/** An older (or unsealed) resumed run: no system prompt recorded, since the session kept its own. */
export const resumedRecord: RunPromptRecord = {
  version: 1,
  session: "resumed",
  systemPrompt: [],
  firstMessage: [
    promptSection("wake", "## Resume Delta\n\nA new comment.", {
      label: "Wake",
      reason: "woken by a comment",
      source: "wake payload",
    }),
  ],
  firstMessageChars: "## Resume Delta\n\nA new comment.".length,
  matchedPlan: true,
};

const sentText = "Sent prompt the builder didn't match.";
export const unmatchedRecord: RunPromptRecord = {
  version: 1,
  session: "fresh",
  systemPrompt: [],
  firstMessage: [
    promptSection("unsplit", sentText, { label: "The prompt as sent", reason: "the sections didn't match the sent text", source: "adapter join" }),
  ],
  firstMessageChars: sentText.length,
  matchedPlan: false,
};
