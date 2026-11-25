import {
  asString,
  joinPaperclipPromptParts,
  joinPromptSections,
  normalizePaperclipRunTask,
  normalizePaperclipSharedWorkspaceNote,
  renderTemplate,
  isPaperclipExternalChatQuestionResponseTurn,
  isPaperclipExternalChatTurn,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
  isPaperclipRecoveryWakePayload,
  normalizePaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import { claudeIdentityLine, claudeToolsNote, claudeToolsNoteEndsRun } from "./standing-texts.js";
import {
  renderClaudeRunMessageSections,
  runTaskForWake,
  type ClaudeRunMessageSection,
  type ClaudeWakeRenderOptions,
} from "./wake/render.js";

/**
 * Today's `claude --print` first message, as one pure function (step 5, Task 1). The CLI engine
 * sends what this returns; the run prompt builder (`server/src/services/run-prompt/`) labels the
 * same text and is checked against it. Its wake is the claude_local one (`wake/render.ts`, step 5
 * phase 2), except on an external chat turn. The standing texts (who the agent is, the
 * instructions location, the tools note) come first, so the wake ends the message (step 5 phase
 * 2, the light sections). The legacy bootstrap template and the session rotation note aren't read.
 */
export interface ClaudeCliPromptInput {
  /** The adapter context, after `hydrateFreshSessionHandoff` for this attempt. */
  context: Record<string, unknown>;
  resumed: boolean;
  instructionsPathDirective: string;
  /** The agent's own prompt template (`resolveClaudePromptTemplate`); null sends the identity line. */
  promptTemplate: string | null;
  /** `renderTemplate`'s data; `agent` carries `id`, `name` and `title` for the identity line. */
  templateData: Record<string, unknown> & { agent: { id: string; name?: unknown; title?: unknown } };
  sealed: boolean;
  /** For the tools note: it needs `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY`. */
  env: Record<string, string>;
}

/** The texts the first message joins, before `joinPromptSections` trims them (order: `composeClaudeCliPrompt`). */
export interface ClaudeCliPromptSectionTexts {
  instructionsDirective: string;
  communicationGuidance: string;
  /** The wake's text: `wakeSections` joined, or the shared wake on an external chat turn. */
  wake: string;
  /**
   * The claude_local wake's four sections (what happened, where things stand, the task, what to
   * do now), empty ones left out; [] on an external chat turn. Display only: the prompt joins `wake`.
   */
  wakeSections: ClaudeRunMessageSection[];
  /** "" when the task's facts replace it (`runTaskReplacesBrief`). */
  taskBrief: string;
  /** The Paperclip tools note (`claudeToolsNote`). */
  mcpNote: string;
  /** The identity line, or the agent's own rendered template; "" when not sent. */
  heartbeatTemplate: string;
}

export function composeClaudeCliPrompt(input: ClaudeCliPromptInput): {
  prompt: string;
  promptMetrics: Record<string, number>;
  sections: ClaudeCliPromptSectionTexts;
} {
  const { context, resumed, instructionsPathDirective, promptTemplate, templateData, sealed, env } = input;
  const { taskContextNote, wakePrompt: sharedWakePrompt } = selectPaperclipPromptSections(context, {
    resumedSession: resumed,
    includeCommunicationGuidance: false,
  });
  // The claude_local wake (step 5 phase 2), except for an external chat turn, which keeps the
  // shared renderer's contract (dormant here).
  const wakeSections = usesSharedWake(context)
    ? []
    : renderClaudeRunMessageSections(context.paperclipWake, claudeWakeOptions({ context, resumed, agentId: asString(templateData.agentId, "") }));
  const wakePrompt = usesSharedWake(context)
    ? sharedWakePrompt
    : joinPromptSections(wakeSections.map((section) => joinPaperclipPromptParts(section.parts)));
  // With the task's facts, the wake carries the task and its rules: no separate brief.
  const taskBrief = runTaskReplacesBrief(context) ? "" : taskContextNote;
  const shouldUseResumeDeltaPrompt = resumed && wakePrompt.length > 0;
  // Who the agent is: its own template when it sets one, else the identity line. Not on a
  // resumed session with a wake, nor on a recovery wake.
  const renderedPrompt = shouldUseResumeDeltaPrompt || isPaperclipRecoveryWakePayload(context.paperclipWake)
    ? ""
    : promptTemplate !== null && promptTemplate.trim().length > 0
      ? renderTemplate(promptTemplate, templateData)
      : claudeIdentityLine(templateData.agent);
  // Fresh sealed sessions are pointed at the `paperclip_*` tools; resumed sessions and external
  // chat turns aren't. Chat tasks and recovery wakes get no end-of-run line.
  const paperclipMcpNote = sealed && !resumed && !isPaperclipExternalChatTurn(context.paperclipWake)
    ? claudeToolsNote({ env, endOfRunLine: claudeToolsNoteEndsRun(context) })
    : "";
  const sections: ClaudeCliPromptSectionTexts = {
    instructionsDirective: instructionsPathDirective,
    communicationGuidance: selectInitialCommunicationGuidance(
      wakeHistoryReplacesHandoff(context) ? withoutFreshSessionHandoff(context) : context,
      { resumedSession: resumed },
    ),
    wake: wakePrompt,
    wakeSections,
    taskBrief,
    mcpNote: paperclipMcpNote,
    heartbeatTemplate: renderedPrompt,
  };
  const prompt = joinPromptSections([
    sections.heartbeatTemplate,
    sections.instructionsDirective,
    sections.mcpNote,
    sections.communicationGuidance,
    sections.wake,
    sections.taskBrief,
  ]);
  // The bootstrap and handoff counters keep their keys for older readers; neither is sent.
  const promptMetrics = {
    promptChars: prompt.length,
    bootstrapPromptChars: 0,
    wakePromptChars: wakePrompt.length,
    sessionHandoffChars: 0,
    taskContextChars: taskBrief.length,
    heartbeatPromptChars: renderedPrompt.length,
  };
  return { prompt, promptMetrics, sections };
}

/** An external chat turn keeps the shared wake renderer (its contract), not the claude_local one. */
export function usesSharedWake(context: Record<string, unknown>): boolean {
  return isPaperclipExternalChatTurn(context.paperclipWake) ||
    isPaperclipExternalChatQuestionResponseTurn(context.paperclipWake);
}

/**
 * Whether the wake's history stands in for the fresh-session handoff (step 5 phase 2, the
 * handoff): the payload carries `history` (the assignee's own non-chat task; plan decision 2) and
 * the claude_local wake renders it. The handoff is still hydrated onto the context, for ACP and
 * the others; the CLI and the run prompt builder leave it out of the first message.
 */
export function wakeHistoryReplacesHandoff(context: Record<string, unknown>): boolean {
  return !usesSharedWake(context) && Boolean(normalizePaperclipWakePayload(context.paperclipWake)?.history);
}

/**
 * Whether the task's facts replace the task brief (step 5 phase 2, the task brief; plan decision
 * 1): the context carries `paperclipRunTask` for the wake's task (the server sets it on a non-chat
 * task only) and the claude_local wake renders it. The brief's variants are still built and set
 * on the context, for chat tasks, ACP and the others; the CLI and the run prompt builder leave
 * the brief out of the first message.
 */
export function runTaskReplacesBrief(context: Record<string, unknown>): boolean {
  return !usesSharedWake(context) &&
    runTaskForWake(normalizePaperclipWakePayload(context.paperclipWake), context.paperclipRunTask) !== null;
}

function withoutFreshSessionHandoff(context: Record<string, unknown>): Record<string, unknown> {
  const { paperclipFreshSessionHandoffMarkdown: _handoff, ...rest } = context;
  return rest;
}

/**
 * The claude_local wake's options for one attempt: `context` is the attempt's, after
 * `hydrateFreshSessionHandoff`, so a fresh session's handoff is on it. `handoffPresent` is false
 * when the history replaces the handoff, since the handoff isn't sent.
 */
export function claudeWakeOptions(input: {
  context: Record<string, unknown>;
  resumed: boolean;
  agentId: string;
}): ClaudeWakeRenderOptions {
  return {
    agentId: input.agentId,
    resumedSession: input.resumed,
    conversationMode: input.context.conversationMode === true,
    handoffPresent: !input.resumed && !wakeHistoryReplacesHandoff(input.context) &&
      asString(input.context.paperclipFreshSessionHandoffMarkdown, "").trim().length > 0,
    runTask: normalizePaperclipRunTask(input.context.paperclipRunTask),
    sharedWorkspaceNote: normalizePaperclipSharedWorkspaceNote(input.context.paperclipSharedWorkspaceNote),
  };
}

/**
 * The agent's own prompt template (`adapterConfig.promptTemplate`), or null when it sets none or a
 * blank one: the run then sends the identity line (`claudeIdentityLine`), in task runs and chat.
 */
export function resolveClaudePromptTemplate(config: Record<string, unknown>): string | null {
  const template = config.promptTemplate;
  return typeof template === "string" && template.trim().length > 0 ? template : null;
}
