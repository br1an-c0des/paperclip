import {
  asString,
  joinPromptSections,
  renderTemplate,
  isPaperclipExternalChatTurn,
  renderPaperclipMcpNote,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
  isPaperclipRecoveryWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";

/**
 * Today's `claude --print` first message, as one pure function (step 5, Task 1). The CLI engine
 * sends what this returns; the run prompt builder (`server/src/services/run-prompt/`) labels the
 * same text and is checked against it.
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
  wake: string;
  sessionRotationNote: string;
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
  const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
    resumedSession: resumed,
    includeCommunicationGuidance: false,
  });
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
    communicationGuidance: selectInitialCommunicationGuidance(context, { resumedSession: resumed }),
    wake: wakePrompt,
    sessionRotationNote: sessionHandoffNote,
    taskBrief: taskContextNote,
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
    taskContextChars: taskContextNote.length,
    heartbeatPromptChars: renderedPrompt.length,
  };
  return { prompt, promptMetrics, sections };
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
