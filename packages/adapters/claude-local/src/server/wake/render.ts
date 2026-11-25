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
 * where things stand on a fresh session or a recovery; the task in one line; and what to do now.
 * Each heading is its own module (fork/step-5-brief.md "The renderer's modules"); `context.ts`
 * holds what they share.
 * Pure: the CLI (`composeClaudeCliPrompt`) sends `renderClaudeWake`'s text and the run prompt
 * builder labels `renderClaudeWakeParts`, which join to it exactly. The shared
 * `renderPaperclipWakePrompt` stays for ACP and the dormant adapters.
 */

export type { ClaudeWakeEventKind, ClaudeWakeRenderOptions } from "./events.js";
export { detectClaudeWakeEvents } from "./events.js";
export { quoteClaudeWakeText } from "./context.js";
export { CLAUDE_WAKE_HISTORY_CAP, CLAUDE_WAKE_REQUEST_CAP, CLAUDE_WAKE_RUN_SUMMARY_CAP } from "./where-things-stand.js";

const PART_META: WakePartMeta = {
  ...WHAT_HAPPENED_PART_META,
  ...WHERE_THINGS_STAND_PART_META,
  ...THE_TASK_PART_META,
  ...TO_DO_PART_META,
};

/** The wake as labelled parts that join, with `joinPaperclipPromptParts`, to `renderClaudeWake`. Null payload: []. */
export function renderClaudeWakeParts(payload: unknown, options: ClaudeWakeRenderOptions): PaperclipPromptPart[] {
  const wake = normalizePaperclipWakePayload(payload);
  if (!wake) return [];
  const ctx = makeCtx(wake, payload, options);
  const events = detectClaudeWakeEvents(wake, options);
  const where = renderWhereThingsStand(ctx);
  const happened = renderWhatHappened(ctx, events, where.length > 0);
  const blocks: WakeBlock[] = [
    ...happened.blocks,
    ...where,
    ...renderTheTask(ctx),
    ...renderToDo(ctx, happened, events),
  ];
  return blocks.map((block, index) => ({
    id: block.id,
    label: block.label ?? PART_META[block.id]?.label ?? block.id,
    source: block.source ?? PART_META[block.id]?.source ?? block.id,
    text: `${index > 0 ? block.separator ?? "\n\n" : ""}${block.text}`,
  }));
}

/** The wake's text; "" for a null payload. */
export function renderClaudeWake(payload: unknown, options: ClaudeWakeRenderOptions): string {
  return joinPaperclipPromptParts(renderClaudeWakeParts(payload, options));
}
