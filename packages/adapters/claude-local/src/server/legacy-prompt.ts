import {
  asString,
  joinPaperclipPromptParts,
  joinPromptSections,
  normalizePaperclipRunTask,
  normalizePaperclipSharedWorkspaceNote,
  renderTemplate,
  isPaperclipExternalChatQuestionResponseTurn,
  isPaperclipExternalChatTurn,
  renderPaperclipMcpNote,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
  isPaperclipRecoveryWakePayload,
  normalizePaperclipWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
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
 * phase 2), except on an external chat turn.
 */
export interface ClaudeCliPromptInput {
  /** The adapter context, after `hydrateFreshSessionHandoff` for this attempt. */
  context: Record<string, unknown>;
  resumed: boolean;
  instructionsPathDirective: string;
  bootstrapPromptTemplate: string;
  promptTemplate: string;
  templateData: Record<string, unknown>;
  sealed: boolean;
  /** For `renderPaperclipMcpNote`. */
  env: Record<string, string>;
}

/** The eight texts the first message joins, in order, before `joinPromptSections` trims them. */
export interface ClaudeCliPromptSectionTexts {
  instructionsDirective: string;
  bootstrapTemplate: string;
  communicationGuidance: string;
  /** The wake's text: `wakeSections` joined, or the shared wake on an external chat turn. */
  wake: string;
  /**
   * The claude_local wake's four sections (what happened, where things stand, the task, what to
   * do now), empty ones left out; [] on an external chat turn. Display only: the prompt joins `wake`.
   */
  wakeSections: ClaudeRunMessageSection[];
  sessionRotationNote: string;
  /** "" when the task's facts replace it (`runTaskReplacesBrief`). */
  taskBrief: string;
  mcpNote: string;
  heartbeatTemplate: string;
}

export function composeClaudeCliPrompt(input: ClaudeCliPromptInput): {
  prompt: string;
  promptMetrics: Record<string, number>;
  sections: ClaudeCliPromptSectionTexts;
} {
  const { context, resumed, instructionsPathDirective, bootstrapPromptTemplate, promptTemplate, templateData, sealed, env } = input;
  const renderedBootstrapPrompt =
    !resumed && bootstrapPromptTemplate.trim().length > 0
      ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
      : "";
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
  const renderedPrompt = shouldUseResumeDeltaPrompt || isPaperclipRecoveryWakePayload(context.paperclipWake)
    ? ""
    : renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  // Fresh sealed sessions are pointed at the `paperclip_*` tools, as ACP's are; resumed
  // sessions and external chat turns aren't.
  const paperclipMcpNote = sealed && !resumed && !isPaperclipExternalChatTurn(context.paperclipWake)
    ? renderPaperclipMcpNote(env, true)
    : "";
  const sections: ClaudeCliPromptSectionTexts = {
    instructionsDirective: instructionsPathDirective,
    bootstrapTemplate: renderedBootstrapPrompt,
    communicationGuidance: selectInitialCommunicationGuidance(
      wakeHistoryReplacesHandoff(context) ? withoutFreshSessionHandoff(context) : context,
      { resumedSession: resumed },
    ),
    wake: wakePrompt,
    wakeSections,
    sessionRotationNote: sessionHandoffNote,
    taskBrief,
    mcpNote: paperclipMcpNote,
    heartbeatTemplate: renderedPrompt,
  };
  const prompt = joinPromptSections([
    sections.instructionsDirective,
    sections.bootstrapTemplate,
    sections.communicationGuidance,
    sections.wake,
    sections.sessionRotationNote,
    sections.taskBrief,
    sections.mcpNote,
    sections.heartbeatTemplate,
  ]);
  const promptMetrics = {
    promptChars: prompt.length,
    bootstrapPromptChars: renderedBootstrapPrompt.length,
    wakePromptChars: wakePrompt.length,
    sessionHandoffChars: sessionHandoffNote.length,
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

/** The heartbeat template a run renders: the agent's own, or the default for its kind of run. */
export function resolveClaudePromptTemplate(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): string {
  return asString(
    config.promptTemplate,
    context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
}
