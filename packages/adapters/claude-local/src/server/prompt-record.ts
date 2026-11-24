import {
  joinRunPromptSections,
  type RunPromptPlan,
  type RunPromptRecord,
  type RunPromptSection,
} from "@paperclipai/shared";

/**
 * The adapter-context key the heartbeat puts the run prompt builder's plan on (step 5). The
 * server sets it as a non-enumerable property, so it never reaches the run's saved context or
 * the `adapter.invoke` event's context; reading it is ordinary property access.
 */
export const PAPERCLIP_RUN_PROMPT_PLAN_KEY = "paperclipRunPromptPlan";

export const PROMPT_SECTIONS_MISMATCH_NOTE =
  "[paperclip] prompt sections didn't match the sent prompt; recorded it unsplit.\n";

function isRunPromptSectionList(value: unknown): value is RunPromptSection[] {
  return Array.isArray(value) && value.every((section) =>
    typeof section === "object" && section !== null && typeof (section as RunPromptSection).text === "string");
}

/** The plan on the adapter context, when it's one this version understands. */
export function readRunPromptPlan(context: Record<string, unknown>): RunPromptPlan | null {
  const value = context[PAPERCLIP_RUN_PROMPT_PLAN_KEY];
  if (typeof value !== "object" || value === null) return null;
  const plan = value as Partial<RunPromptPlan>;
  return plan.version === 1 && isRunPromptSectionList(plan.fresh) && isRunPromptSectionList(plan.resumed)
    ? plan as RunPromptPlan
    : null;
}

function unsplitSection(prompt: string, reason: string): RunPromptSection {
  return {
    id: "unsplit",
    label: "First message",
    placement: "first_message",
    delivery: "every_run",
    reason,
    source: "the text sent to Claude",
    text: prompt,
    chars: prompt.length,
  };
}

/**
 * What one attempt sent, for its `adapter.prompt` event. The first message is the plan's set for
 * the session this attempt starts when it joins to exactly the sent text; otherwise it's the sent
 * text as one unsplit section, with `matchedPlan: false`.
 */
export function buildClaudePromptRecord(input: {
  plan: RunPromptPlan | null;
  resumed: boolean;
  /** The text sent on stdin. */
  prompt: string;
  /** The run plan's system-prompt sections, when this attempt sent them; otherwise []. */
  systemPrompt: RunPromptSection[];
}): RunPromptRecord {
  const set = input.plan ? (input.resumed ? input.plan.resumed : input.plan.fresh) : null;
  const matchedPlan = set !== null && joinRunPromptSections(set) === input.prompt;
  const firstMessage = matchedPlan
    ? set!
    : [unsplitSection(input.prompt, input.plan
      ? "the prompt sections didn't match the sent text"
      : "no prompt sections were prepared for this run")];
  return {
    version: 1,
    session: input.resumed ? "resumed" : "fresh",
    systemPrompt: input.systemPrompt,
    firstMessage,
    firstMessageChars: input.prompt.length,
    matchedPlan,
  };
}
