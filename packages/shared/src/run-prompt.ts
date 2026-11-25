/**
 * A run's prompt as labelled sections (fork/step-5-prompt-builder.md, fork/step-5-plan.md).
 *
 * The first message is the sections' text joined by `joinRunPromptSections`, the same rule as
 * `joinPromptSections` in `@paperclipai/adapter-utils`. A section's `parts` are for display only:
 * they never change the sent text.
 */

import type { IssuePriority, IssueStatus } from "./constants.js";
import type { IssueExecutionWorkspaceSettings } from "./types/workspace-runtime.js";

/** Where a section goes: the system prompt or the first user message. */
export type RunPromptPlacement = "system" | "first_message";

/** Which sessions get a section. */
export type RunPromptDelivery = "every_run" | "fresh_only" | "resumed_only";

export type RunPromptSectionId =
  // system prompt
  | "agent_instructions"
  | "skill_library"
  // first message
  | "instructions_directive"
  | "bootstrap_template"
  | "communication_guidance"
  // The claude_local wake's four headings, each its own section (step 5 phase 2, the task
  // brief); older records, and external chat turns, have one "wake" section instead.
  | "what_happened"
  | "where_things_stand"
  | "the_task"
  | "to_do"
  | "wake"
  | "session_rotation_note"
  | "task_brief"
  | "mcp_note"
  | "heartbeat_template"
  // the sent text, not split
  | "unsplit";

/** A finer split of a section's text, for display. */
export interface RunPromptPart {
  /** e.g. "wake.comments", "task_brief.description". */
  id: string;
  /** Short, for the UI. */
  label: string;
  /** e.g. "task description", "template: default heartbeat". */
  source: string;
  text: string;
  chars: number;
  /** Preview only: why the value is filled in at launch. */
  pending?: string;
}

export interface RunPromptSection {
  id: RunPromptSectionId;
  label: string;
  placement: RunPromptPlacement;
  delivery: RunPromptDelivery;
  /** Why it was included, e.g. "woken by a comment". */
  reason: string;
  source: string;
  text: string;
  chars: number;
  /** Present only when the parts join to `text` exactly. */
  parts?: RunPromptPart[];
  /** Preview only: why the value is filled in at launch. */
  pending?: string;
}

/** The builder's output: the first-message sections for each kind of session. */
export interface RunPromptPlan {
  version: 1;
  /** The first-message sections a fresh session gets, in order. */
  fresh: RunPromptSection[];
  /** The first-message sections a resumed session gets, in order. */
  resumed: RunPromptSection[];
}

/** What a run was sent, stored as its `adapter.prompt` run event. */
export interface RunPromptRecord {
  version: 1;
  session: "fresh" | "resumed";
  /** Fresh: the system prompt's parts as sent. Resumed: [] (Claude keeps the session's own). */
  systemPrompt: RunPromptSection[];
  firstMessage: RunPromptSection[];
  firstMessageChars: number;
  /** false: the builder's sections didn't join to the sent text; firstMessage is one "unsplit" section. */
  matchedPlan: boolean;
}

/** The kinds of run the next-run preview can draft. */
export type RunPromptPreviewKind = "assignment" | "comment" | "chat_turn" | "no_task";

/** A draft of the next run's prompt, for the agent's run preview. */
export interface RunPromptPreview {
  kind: RunPromptPreviewKind;
  issueId: string | null;
  systemPrompt: RunPromptSection[];
  /** The fresh set. */
  firstMessage: RunPromptSection[];
  firstMessageChars: number;
}

/**
 * A task still being written in the New task dialog, for a preview of the prompt its assignee
 * would get (`POST /api/agents/:id/run-preview/draft`, fork/task-prompt-preview.md). The fields
 * are the create request's, as the dialog sends them; validated by `runPromptDraftSchema`, which
 * reuses issue creation's rules. A title or a description is needed, as for creating the task.
 */
export interface RunPromptDraft {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  goalId?: string | null;
  /** Defaults as creation does: `todo` (the draft is assigned to the agent). */
  status?: IssueStatus;
  priority?: IssuePriority;
  workMode?: RunPromptDraftWorkMode;
  /** The workspace choice, as the dialog sends it on create. */
  projectWorkspaceId?: string | null;
  executionWorkspaceId?: string | null;
  executionWorkspacePreference?: string | null;
  executionWorkspaceSettings?: IssueExecutionWorkspaceSettings | null;
}

/** The work modes the New task dialog offers: do the work, answer a question, plan first. */
export type RunPromptDraftWorkMode = "standard" | "ask" | "planning";

/** A stored `adapter.prompt` payload this version understands. */
export function isRunPromptRecord(value: unknown): value is RunPromptRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Array.isArray(record.systemPrompt) &&
    Array.isArray(record.firstMessage)
  );
}

/**
 * The first message the sections make: each text trimmed, empty ones dropped, the rest joined
 * with a blank line. Must stay the same rule as `joinPromptSections` in
 * `packages/adapter-utils/src/server-utils.ts`; `run-prompt.test.ts` pins it.
 */
export function joinRunPromptSections(sections: RunPromptSection[]): string {
  return sections
    .map((section) => (typeof section.text === "string" ? section.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}
