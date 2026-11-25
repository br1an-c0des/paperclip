import {
  joinPaperclipPromptParts,
  normalizePaperclipWakePayload,
  type PaperclipPromptPart,
} from "@paperclipai/adapter-utils/server-utils";
import { detectClaudeWakeEvents, type ClaudeWakeRenderOptions } from "./events.js";
import { makeCtx, type WakeBlock, type WakePartMeta } from "./context.js";
import { renderWhatHappened, WHAT_HAPPENED_PART_META } from "./what-happened.js";
import { renderWhereThingsStand, WHERE_THINGS_STAND_PART_META } from "./where-things-stand.js";
import { renderTheTask, THE_TASK_PART_META } from "./the-task.js";
import { renderToDo, TO_DO_PART_META } from "./to-do.js";

/**
 * The claude_local wake (step 5 phase 2, fork/step-5-wake.md "The shape"): what happened, quoted;
 * where things stand on a fresh session; the task; and what to do now. Each heading is its own
 * module and its own section of the run's record (fork/step-5-brief.md "The renderer's modules",
 * "Sections in the record and the preview"); `context.ts` holds what they share.
 * Pure: the CLI (`composeClaudeCliPrompt`) sends the sections' text, joined, and the run prompt
 * builder labels the same sections, which join to `renderClaudeWake` exactly. The shared
 * `renderPaperclipWakePrompt` stays for ACP and the dormant adapters.
 */

export type { ClaudeWakeEventKind, ClaudeWakeRenderOptions } from "./events.js";
export { detectClaudeWakeEvents } from "./events.js";
export { quoteClaudeWakeText, runTaskForWake } from "./context.js";
export { CLAUDE_WAKE_HISTORY_CAP, CLAUDE_WAKE_REQUEST_CAP, CLAUDE_WAKE_RUN_SUMMARY_CAP } from "./where-things-stand.js";

const PART_META: WakePartMeta = {
  ...WHAT_HAPPENED_PART_META,
  ...WHERE_THINGS_STAND_PART_META,
  ...THE_TASK_PART_META,
  ...TO_DO_PART_META,
};

/** The run message's sections, one per heading, in order (`RunPromptSectionId`). */
export type ClaudeRunMessageSectionId = "what_happened" | "where_things_stand" | "the_task" | "to_do";

export interface ClaudeRunMessageSection {
  id: ClaudeRunMessageSectionId;
  /** Join with `joinPaperclipPromptParts`; the first has no leading blank line. */
  parts: PaperclipPromptPart[];
}

function toParts(blocks: readonly WakeBlock[]): PaperclipPromptPart[] {
  return blocks.map((block, index) => ({
    id: block.id,
    label: block.label ?? PART_META[block.id]?.label ?? block.id,
    source: block.source ?? PART_META[block.id]?.source ?? block.id,
    text: `${index > 0 ? block.separator ?? "\n\n" : ""}${block.text}`,
  }));
}

/**
 * The wake as its four sections, empty ones left out (a resumed session has no "Where things
 * stand"). Joined like the first message's sections (each trimmed, a blank line between), they
 * make `renderClaudeWake`. Null payload: [].
 */
export function renderClaudeRunMessageSections(payload: unknown, options: ClaudeWakeRenderOptions): ClaudeRunMessageSection[] {
  const wake = normalizePaperclipWakePayload(payload);
  if (!wake) return [];
  const ctx = makeCtx(wake, payload, options);
  const events = detectClaudeWakeEvents(wake, options);
  const where = renderWhereThingsStand(ctx);
  const happened = renderWhatHappened(ctx, events, where.length > 0);
  const sections: Array<[ClaudeRunMessageSectionId, WakeBlock[]]> = [
    ["what_happened", happened.blocks],
    ["where_things_stand", where],
    ["the_task", renderTheTask(ctx)],
    ["to_do", renderToDo(ctx, happened, events)],
  ];
  return sections.filter(([, blocks]) => blocks.length > 0).map(([id, blocks]) => ({ id, parts: toParts(blocks) }));
}

/** The wake as labelled parts that join, with `joinPaperclipPromptParts`, to `renderClaudeWake`. Null payload: []. */
export function renderClaudeWakeParts(payload: unknown, options: ClaudeWakeRenderOptions): PaperclipPromptPart[] {
  return renderClaudeRunMessageSections(payload, options).flatMap((section, index) =>
    section.parts.map((part, partIndex) => (index > 0 && partIndex === 0 ? { ...part, text: `\n\n${part.text}` } : part)));
}

/** The wake's text; "" for a null payload. */
export function renderClaudeWake(payload: unknown, options: ClaudeWakeRenderOptions): string {
  return joinPaperclipPromptParts(renderClaudeWakeParts(payload, options));
}
