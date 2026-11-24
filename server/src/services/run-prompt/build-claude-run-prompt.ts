import type { RunPromptDelivery, RunPromptPart, RunPromptPlan, RunPromptSection, RunPromptSectionId } from "@paperclipai/shared";
import {
  composeClaudeCliPrompt,
  planClaudeInstructionsDirective,
  resolveClaudePromptTemplate,
} from "@paperclipai/adapter-claude-local/server";
import {
  asString,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  hydrateFreshSessionHandoff,
  isAssignmentShapedPaperclipWakeReason,
  isPaperclipRecoveryWakePayload,
  joinPaperclipPromptPartGroups,
  joinPaperclipPromptParts,
  normalizePaperclipWakePayload,
  renderPaperclipWakePromptParts,
  renderTemplate,
  trimPaperclipPromptParts,
  type PaperclipPromptPart,
} from "@paperclipai/adapter-utils/server-utils";
import {
  copyTaskMarkdownParts,
  PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY,
  PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY,
  readTaskMarkdownParts,
} from "../heartbeat/task-context.js";

/**
 * The first message of a `claude_local` CLI run, as labelled sections (step 5; README.md in this
 * folder). It reproduces today's prompt exactly: each set is `composeClaudeCliPrompt`'s eight
 * texts, the same selectors the run uses, with labels, reasons, sources and display parts added.
 * It reads the agent's instructions file and nothing else; it writes nothing.
 */
export interface ClaudeRunPromptInput {
  agent: { id: string; companyId: string } & Record<string, unknown>;
  runId: string;
  /** The runtime config the adapter gets. */
  config: Record<string, unknown>;
  /** The adapter context, before the fresh-session handoff is hydrated. Not changed. */
  context: Record<string, unknown>;
  /** A local target: the run is sealed. */
  sealed: boolean;
  /** The run has a token and PAPERCLIP_API_URL, so the MCP note applies. */
  paperclipApiReachable: boolean;
  /**
   * The fresh-session handoff loader the adapter gets (`getFreshSessionHandoff`). Without one, a
   * fresh session keeps whatever handoff the context already carries, as the adapter does.
   */
  loadFreshSessionHandoff?: () => Promise<string | null>;
}

type PromptSet = "fresh" | "resumed";

export async function buildClaudeRunPromptPlan(input: ClaudeRunPromptInput): Promise<RunPromptPlan> {
  const { agent, runId, config, context, sealed } = input;
  const { directive } = await planClaudeInstructionsDirective(config);
  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
  const promptTemplate = resolveClaudePromptTemplate(config, context);
  // renderPaperclipMcpNote reads only whether these are set, never their values.
  const env: Record<string, string> = input.paperclipApiReachable
    ? { PAPERCLIP_API_URL: "set", PAPERCLIP_API_KEY: "set" }
    : {};

  // A fresh attempt hydrates the handoff onto its context first (execute.ts, runAttempt).
  const freshContext: Record<string, unknown> = { ...context };
  copyTaskMarkdownParts(context, freshContext);
  await hydrateFreshSessionHandoff(
    { context: freshContext, getFreshSessionHandoff: input.loadFreshSessionHandoff },
    { resumedSession: false },
  );

  const build = (set: PromptSet): RunPromptSection[] => {
    const resumed = set === "resumed";
    const setContext = resumed ? context : freshContext;
    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context: setContext,
    };
    const { sections: texts } = composeClaudeCliPrompt({
      context: setContext,
      resumed,
      instructionsPathDirective: directive,
      bootstrapPromptTemplate,
      promptTemplate,
      templateData,
      sealed,
      env,
    });
    const labelled = describeSections({ texts, context: setContext, resumed, config, templateData, promptTemplate });
    return labelled.filter((section) => section.text.length > 0);
  };

  const fresh = build("fresh");
  const resumed = build("resumed");
  const freshIds = new Set(fresh.map((section) => section.id));
  const resumedIds = new Set(resumed.map((section) => section.id));
  const delivery = (id: RunPromptSectionId): RunPromptDelivery =>
    freshIds.has(id) && resumedIds.has(id) ? "every_run" : freshIds.has(id) ? "fresh_only" : "resumed_only";
  for (const section of [...fresh, ...resumed]) section.delivery = delivery(section.id);
  return { version: 1, fresh, resumed };
}

// --- Sections -------------------------------------------------------------------

type SectionTexts = ReturnType<typeof composeClaudeCliPrompt>["sections"];

function describeSections(input: {
  texts: SectionTexts;
  context: Record<string, unknown>;
  resumed: boolean;
  config: Record<string, unknown>;
  templateData: Record<string, unknown>;
  promptTemplate: string;
}): RunPromptSection[] {
  const { texts, context, resumed, config } = input;
  const wake = normalizePaperclipWakePayload(context.paperclipWake);
  const ownTemplate = typeof config.promptTemplate === "string" && config.promptTemplate.length > 0;
  return [
    section("instructions_directive", texts.instructionsDirective, {
      label: "Instructions file location",
      reason: "the agent's instructions file was read; sent every run, since resumed sessions keep an older location",
      source: "claude_local run plan: the instructions file's path",
    }),
    section("bootstrap_template", texts.bootstrapTemplate, {
      label: "Bootstrap template",
      reason: "a fresh session, and the agent sets a bootstrap template",
      source: "agent setting: bootstrapPromptTemplate",
    }),
    section("communication_guidance", texts.communicationGuidance, {
      label: "Communication guidance",
      reason: asString(context.paperclipFreshSessionHandoffMarkdown, "").trim()
        ? "a fresh session; the task has history, so the handoff follows"
        : "a fresh session",
      source: "context: paperclipTaskCommunicationGuidance and the fresh-session handoff",
      parts: joinPaperclipPromptPartGroups([
        part("communication_guidance.guidance", "Guidance", "context: paperclipTaskCommunicationGuidance",
          asString(context.paperclipTaskCommunicationGuidance, "")),
        part("communication_guidance.handoff", "Fresh-session handoff", "native session handoff: earlier runs on the task",
          asString(context.paperclipFreshSessionHandoffMarkdown, "")),
      ]),
    }),
    section("wake", texts.wake, {
      label: resumed ? "Wake (resume delta)" : "Wake",
      reason: wakeReason(wake?.reason ?? null, resumed),
      source: "context: paperclipWake, rendered by renderPaperclipWakePrompt",
      parts: renderPaperclipWakePromptParts(context.paperclipWake, {
        resumedSession: resumed,
        conversationMode: context.conversationMode === true,
        suppressIssueDescription: texts.taskBrief.length > 0,
      }),
    }),
    section("session_rotation_note", texts.sessionRotationNote, {
      label: "Session rotation note",
      reason: "the session was rotated",
      source: "context: paperclipSessionHandoffMarkdown",
    }),
    taskBriefSection(texts.taskBrief, context, resumed),
    section("mcp_note", texts.mcpNote, {
      label: "Paperclip MCP note",
      reason: "a fresh sealed session with Paperclip API access",
      source: "renderPaperclipMcpNote",
    }),
    section("heartbeat_template", texts.heartbeatTemplate, {
      label: "Heartbeat template",
      reason: resumed ? "a resumed session without a wake" : "every fresh session except recovery wakes",
      source: ownTemplate
        ? "agent setting: promptTemplate"
        : context.conversationMode === true
          ? "default: conversation template (DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE)"
          : "default: heartbeat template (DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE)",
      parts: input.promptTemplate === DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE
        ? defaultTemplateParts(input.templateData)
        : undefined,
    }),
  ];
}

function taskBriefSection(text: string, context: Record<string, unknown>, resumed: boolean): RunPromptSection {
  const variant = matchTaskBriefVariant(text, context);
  const wake = normalizePaperclipWakePayload(context.paperclipWake);
  const fullOnResume = !wake || isAssignmentShapedPaperclipWakeReason(wake.reason) ||
    isPaperclipRecoveryWakePayload(context.paperclipWake);
  return section("task_brief", text, {
    label: "Task brief",
    reason: text === "null"
      ? "no task: the brief is the literal string \"null\" (bug 84)"
      : !resumed
        ? "a fresh session gets the full brief"
        : fullOnResume
          ? "an assignment-shaped or recovery wake gets the full brief"
          : "a resumed session gets the compact brief",
    source: variant ? `context: ${variant.key}` : "context: task markdown",
    parts: variant?.parts ?? undefined,
  });
}

const TASK_BRIEF_VARIANTS = [
  { key: "paperclipTaskMarkdownAssignment", partsKey: PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_PARTS_KEY },
  { key: "paperclipTaskMarkdownAssignmentCompact", partsKey: PAPERCLIP_TASK_MARKDOWN_ASSIGNMENT_COMPACT_PARTS_KEY },
  { key: "paperclipTaskMarkdown", partsKey: null },
  { key: "paperclipTaskMarkdownCompact", partsKey: null },
] as const;

/** Which stored variant the selector picked (by its trimmed text), and that variant's parts. */
function matchTaskBriefVariant(text: string, context: Record<string, unknown>) {
  if (!text) return null;
  for (const variant of TASK_BRIEF_VARIANTS) {
    if (asString(context[variant.key], "").trim() !== text) continue;
    const parts = variant.partsKey ? readTaskMarkdownParts(context, variant.partsKey) : null;
    return { key: variant.key, parts: parts ? alignParts(parts, text, "task_brief") : null };
  }
  return null;
}

/**
 * The default heartbeat template's two parts, each rendered as the whole template is (a
 * placeholder never spans the line break between them).
 */
function defaultTemplateParts(templateData: Record<string, unknown>): PaperclipPromptPart[] {
  const identity = DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE.split("\n")[0] ?? "";
  return [
    { id: "heartbeat_template.identity", label: "Agent identity", source: "default template: agent id and name",
      text: renderTemplate(identity, templateData) },
    { id: "heartbeat_template.connection_guidance", label: "Connection guidance", source: "CONNECTION_INTENT_AGENT_GUIDANCE",
      text: renderTemplate(DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE.slice(identity.length), templateData) },
  ];
}

const WAKE_REASONS: Record<string, string> = {
  issue_assigned: "assigned the task",
  issue_commented: "a new comment on the task",
  issue_comment_mentioned: "mentioned in a comment",
  issue_reopened_via_comment: "the task was reopened by a comment",
  issue_continuation_needed: "the task needs a continuation",
  issue_recovery_action_restored: "a recovery action was restored",
  issue_children_completed: "child issues completed",
  approval_approved: "an approval was approved",
  approval_cancelled: "an approval was cancelled",
  execution_review_requested: "a review was requested",
  execution_approval_requested: "an approval was requested",
  execution_changes_requested: "changes were requested",
  task_watchdog_stopped_subtree: "a watched subtree stopped",
  "External chat message received": "an external chat message",
};

function wakeReason(reason: string | null, resumed: boolean): string {
  const what = reason ? WAKE_REASONS[reason] ?? `wake reason: ${reason}` : "a wake payload";
  return resumed ? `${what}; a resumed session gets the resume delta` : what;
}

// --- Helpers --------------------------------------------------------------------

function part(id: string, label: string, source: string, text: string): PaperclipPromptPart[] {
  return text.trim() ? [{ id, label, source, text }] : [];
}

/**
 * Display parts for a section's text: the parts trimmed as the section is. When a later stage
 * appended to the text after the parts were made (the shared-workspace note does), the rest
 * becomes one more part. Null when they can't describe the text exactly.
 */
function alignParts(parts: readonly PaperclipPromptPart[], text: string, sectionId: string): PaperclipPromptPart[] | null {
  const trimmed = trimPaperclipPromptParts(parts);
  const joined = joinPaperclipPromptParts(trimmed);
  if (joined === text) return trimmed;
  if (joined.length > 0 && text.startsWith(joined) && text.length > joined.length) {
    return [...trimmed, {
      id: `${sectionId}.added`,
      label: "Added before the run",
      source: "a later heartbeat stage",
      text: text.slice(joined.length),
    }];
  }
  return null;
}

function section(
  id: RunPromptSectionId,
  rawText: string,
  meta: { label: string; reason: string; source: string; parts?: readonly PaperclipPromptPart[] | null },
): RunPromptSection {
  const text = rawText.trim();
  const parts = meta.parts ? alignParts(meta.parts, text, id) : null;
  return {
    id,
    label: meta.label,
    placement: "first_message",
    // Set once both sets are built.
    delivery: "every_run",
    reason: meta.reason,
    source: meta.source,
    text,
    chars: text.length,
    ...(parts && parts.length > 0 ? { parts: parts.map(toRunPromptPart) } : {}),
  };
}

function toRunPromptPart(entry: PaperclipPromptPart): RunPromptPart {
  return { id: entry.id, label: entry.label, source: entry.source, text: entry.text, chars: entry.text.length };
}
