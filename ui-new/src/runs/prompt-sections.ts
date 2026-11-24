import type { RunPromptDelivery, RunPromptPart, RunPromptPlacement, RunPromptRecord, RunPromptSection, RunPromptSectionId } from "@paperclipai/shared";
import { joinRunPromptSections } from "@paperclipai/shared/run-prompt";
import { charsSize } from "./invocation";

/*
 * A run's prompt in labelled sections (step 5, fork/step-5-prompt-builder.md "In ui-new"): the
 * system prompt Paperclip added, then the first message, each made of the sections the run's
 * `adapter.prompt` record holds. A run recorded before sections existed, or on an engine that
 * doesn't record them, has only `adapter.invoke`'s prompt, shown as one section. The view
 * (PromptSections.tsx) is shared with the agent's run preview, whose drafts carry `pending` markers.
 */

export type PromptViewPart = {
  key: string;
  id: string;
  label: string;
  source: string;
  text: string;
  size: string;
  /** Preview only: why the value is filled in at launch. */
  pending: string | null;
};

export type PromptViewSection = {
  key: string;
  id: RunPromptSectionId;
  label: string;
  reason: string;
  source: string;
  /** "Every run", "New sessions only", "Resumed sessions only"; null when unknown. */
  delivery: string | null;
  text: string;
  size: string;
  parts: PromptViewPart[];
  /** Preview only: why the value is filled in at launch. */
  pending: string | null;
  /** What this kind of section is, for its "i" tip. */
  info: string;
};

export type PromptViewGroup = {
  placement: RunPromptPlacement;
  title: "System prompt" | "First message";
  sections: PromptViewSection[];
  /** The group's size; null when it has no sections. */
  size: string | null;
  /** Why the group has no sections, when it has none. */
  note: string | null;
};

export type PromptView = {
  /** null: not recorded (a run from before sections). */
  session: "fresh" | "resumed" | null;
  /** System prompt, then first message. */
  groups: [PromptViewGroup, PromptViewGroup];
  /** The whole first message as sent, for Copy. */
  firstMessageText: string;
  firstMessageChars: number;
  /** false: the sections didn't join to the sent text, so the first message is the sent text whole. */
  matchedPlan: boolean;
  /** A run recorded before sections existed: one section from `adapter.invoke`'s prompt. */
  legacy: boolean;
  /** A legacy prompt cut when it was stored: how many characters were left out. */
  truncatedChars: number | null;
};

const DELIVERY: Record<RunPromptDelivery, string> = {
  every_run: "Every run",
  fresh_only: "New sessions only",
  resumed_only: "Resumed sessions only",
};

const SECTION_INFO: Record<RunPromptSectionId, string> = {
  agent_instructions: "The agent's instructions file, added to Claude's own system prompt.",
  skill_library: "The skills this run can load, listed so Claude knows they're there.",
  instructions_directive: "Tells Claude where the agent's instructions came from, and how to find the files they mention.",
  bootstrap_template: "The agent's bootstrap prompt, sent when a session starts.",
  communication_guidance: "How to talk to people through Paperclip, and on a new session the handoff from the one before.",
  wake: "Why the agent was woken: the comments, continuation and review threads behind this run.",
  session_rotation_note: "A note carried over when Paperclip starts a new session in place of a long one.",
  task_brief: "The task the run is for: its title, description, plan and surroundings.",
  mcp_note: "How the run reaches Paperclip through its MCP server.",
  heartbeat_template: "The agent's heartbeat prompt: its own setting, or Paperclip's default.",
  unsplit: "The prompt as it was sent, in one piece.",
};

/** What a section of this kind is, for its "i" tip. */
export function sectionInfo(id: string): string {
  return SECTION_INFO[id as RunPromptSectionId] ?? "A part of the prompt Paperclip sent.";
}

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function viewPart(part: RunPromptPart, key: string): PromptViewPart {
  const text = str(part.text);
  return {
    key,
    id: str(part.id),
    label: str(part.label, str(part.id)),
    source: str(part.source),
    text,
    size: charsSize(typeof part.chars === "number" ? part.chars : text.length),
    pending: typeof part.pending === "string" && part.pending ? part.pending : null,
  };
}

function viewSection(section: RunPromptSection, key: string): PromptViewSection {
  const text = str(section.text);
  return {
    key,
    id: section.id,
    label: str(section.label, section.id),
    reason: str(section.reason),
    source: str(section.source),
    delivery: DELIVERY[section.delivery] ?? null,
    text,
    size: charsSize(typeof section.chars === "number" ? section.chars : text.length),
    parts: Array.isArray(section.parts) ? section.parts.map((part, index) => viewPart(part, `${key}.${index}`)) : [],
    pending: typeof section.pending === "string" && section.pending ? section.pending : null,
    info: sectionInfo(section.id),
  };
}

function chars(section: RunPromptSection) {
  return typeof section.chars === "number" ? section.chars : str(section.text).length;
}

function group(
  placement: RunPromptPlacement,
  sections: RunPromptSection[],
  options: { chars?: number; emptyNote: string },
): PromptViewGroup {
  const total = options.chars ?? sections.reduce((n, section) => n + chars(section), 0);
  return {
    placement,
    title: placement === "system" ? "System prompt" : "First message",
    sections: sections.map((section, index) => viewSection(section, `${placement}.${index}`)),
    size: sections.length > 0 ? charsSize(total) : null,
    note: sections.length > 0 ? null : options.emptyNote,
  };
}

/** A run's `adapter.prompt` record, or a preview's draft in the same shape. */
export function promptViewFromRecord(record: RunPromptRecord): PromptView {
  const firstMessageText = joinRunPromptSections(record.firstMessage);
  const firstMessageChars = typeof record.firstMessageChars === "number" ? record.firstMessageChars : firstMessageText.length;
  return {
    session: record.session === "resumed" ? "resumed" : record.session === "fresh" ? "fresh" : null,
    groups: [
      group("system", record.systemPrompt, {
        emptyNote: record.session === "resumed" ? "Kept from the session's start" : "Nothing added to Claude's own",
      }),
      group("first_message", record.firstMessage, { chars: firstMessageChars, emptyNote: "Nothing recorded" }),
    ],
    firstMessageText,
    firstMessageChars,
    matchedPlan: record.matchedPlan !== false,
    legacy: false,
    truncatedChars: null,
  };
}

/* Run event storage cuts a long string and appends this note (server heartbeat/run-log.ts). */
const TRUNCATED_NOTE = /\n\[truncated (\d+) chars\]$/;

/** A run recorded before sections existed: `adapter.invoke`'s prompt as one section. */
export function promptViewFromLegacyPrompt(prompt: string): PromptView {
  const cut = TRUNCATED_NOTE.exec(prompt);
  const truncatedChars = cut ? Number(cut[1]) : null;
  const keptChars = cut ? cut.index : prompt.length;
  const firstMessageChars = keptChars + (truncatedChars ?? 0);
  const section: RunPromptSection = {
    id: "unsplit",
    label: "Recorded before sections",
    placement: "first_message",
    delivery: "every_run",
    reason: "this run recorded its prompt in one piece",
    source: "adapter.invoke",
    text: prompt,
    chars: prompt.length,
  };
  const view = viewSection(section, "first_message.0");
  view.delivery = null;
  return {
    session: null,
    groups: [
      { placement: "system", title: "System prompt", sections: [], size: null, note: "Not recorded for this run" },
      { placement: "first_message", title: "First message", sections: [view], size: charsSize(firstMessageChars), note: null },
    ],
    firstMessageText: prompt,
    firstMessageChars,
    matchedPlan: true,
    legacy: true,
    truncatedChars,
  };
}
