import path from "node:path";
import { isPaperclipRecoveryWakePayload, type PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";

// --- The sealed system prompt (step 5 phase 2, the system prompt; fork/step-5-system-prompt.md) --
//
// Nothing here may carry a per-run value (a path, run id, date or task fact): the system prompt
// is hashed into the prompt bundle's key, so a per-run value would reset the session every run.

/**
 * How a task run ends: the part of "Working in Paperclip" that the `paperclip` skill carries
 * verbatim too (its "Every run", for engines without this system prompt). A test keeps the two in
 * step.
 */
export const WORKING_IN_PAPERCLIP_ENDING = [
  "### Ending a run",
  "End every task run with exactly one of:",
  [
    "- `paperclip_finish` with a summary: the task goes to `done`, or to `in_review` (`status: \"in_review\"`) when someone has a real way to review it: a question or approval you created, a human reviewer, or a review stage. \"Please review\" in a comment isn't one.",
    "- `paperclip_block` when work can't go on until a named owner does a concrete thing, or other tasks finish (`blockedByTaskIds`). Always give the `owner` and the exact `unblockAction`.",
    "- `paperclip_report_progress` with `continue: true` when the work carries on in a later run.",
  ].join("\n"),
  "A final message alone doesn't end a run. A chat turn ends with your reply instead. When the run message gives other closing steps (a recovery, say), follow those.",
].join("\n\n");

const WORKING_IN_PAPERCLIP_INTRO =
  "Paperclip wakes you in runs, each about one task (a task and an issue are the same thing). A run's first message says what happened and what to do now. Work with Paperclip through the `paperclip` MCP server's `paperclip_*` tools, not HTTP requests; `paperclip_read_task` and `paperclip_task_context` read more when you need it.";

const WORKING_IN_PAPERCLIP_REST = [
  "### While you work",
  [
    "- Work on the run's task, not others you come across. Start concrete work in this run unless the task asks only for a plan or a review.",
    "- Don't poll other agents, subtasks or processes: Paperclip wakes you when something changes.",
    "- Ask a person (`paperclip_ask_board`) only when something stops the next useful step; carry on with independent work meanwhile.",
  ].join("\n"),
  "### Comments and commits",
  [
    "- Comments are short markdown: a status line, then bullets. Say what happened and what's next, not which tools you called.",
    "- Link tickets as `[PAP-224](/PAP/issues/PAP-224)`: relative, with the company prefix. Never a bare identifier or a raw UUID.",
    "- End every commit message with `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.",
  ].join("\n"),
  "The `paperclip` skill has the rest: asking and approvals, delegating and handing off, documents, plans and files, review stages, the REST API. Open it before doing any of those.",
].join("\n\n");

/** "Working in Paperclip": the rules every run needs, in a sealed run's system prompt. */
export const WORKING_IN_PAPERCLIP = [
  "## Working in Paperclip",
  WORKING_IN_PAPERCLIP_INTRO,
  WORKING_IN_PAPERCLIP_ENDING,
  WORKING_IN_PAPERCLIP_REST,
].join("\n\n");

/**
 * Follows the agent's instructions in a sealed run's system prompt. The path itself is in the
 * run message (`claudeInstructionsLocation`), since it changes every run.
 */
export const CLAUDE_INSTRUCTIONS_RELATIVE_NOTE =
  "\nRelative paths in these instructions resolve from the directory the run message names.";

/**
 * Flattens untrusted text to one bounded line, as `buildSkillLibraryManifestMarkdown` does: a
 * skill's key or missing-source detail can carry skill-authored text, and a newline in either
 * would let a skill add lines to the system prompt.
 */
function sanitizeSkillText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * The system prompt's "Skills": the agent's own skills, then a pointer to `paperclip_skills` for
 * the rest of the company's library (bug 92). Only the agent's own skills are listed, so
 * installing a company skill doesn't change every agent's bundle key.
 */
export function claudeSkillsSection(input: {
  entries: readonly PaperclipSkillEntry[];
  desiredSkillKeys: ReadonlySet<string>;
}): string {
  const enabled = input.entries
    .filter((entry) => input.desiredSkillKeys.has(entry.key))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => {
      const key = sanitizeSkillText(entry.key, 200);
      if (entry.sourceStatus === "missing") {
        const detail = entry.missingDetail ? sanitizeSkillText(entry.missingDetail, 200) : "";
        return `- ${key} — enabled but unavailable${detail ? `: ${detail}` : ""}`;
      }
      return `- ${key}`;
    });
  return [
    "## Skills",
    "",
    ...(enabled.length > 0 ? ["These skills are enabled for you:", "", ...enabled, ""] : []),
    "The company's skill library may hold others that aren't enabled for you: `paperclip_skills` lists them. Say a skill is installed but not enabled rather than missing, and ask for it to be added to you.",
  ].join("\n");
}

// --- The first message's standing texts --------------------------------------------------------

/**
 * The first message's standing texts on a claude_local CLI run (step 5 phase 2, the light
 * sections; fork/step-5-light.md): who the agent is, where its instructions file is this run, and
 * how it works with Paperclip. claude_local's own; ACP and the other adapters keep the shared
 * texts (`renderPaperclipMcpNote`, `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`).
 */

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * "You are <name>, <title>." Composed in code, never through `renderTemplate`, so a name with
 * `{{…}}` is printed as is. A blank title is left out; a blank name falls back to the agent's id.
 */
export function claudeIdentityLine(agent: { id: string; name?: unknown; title?: unknown }): string {
  const name = trimmedString(agent.name) || `agent ${agent.id}`;
  const title = trimmedString(agent.title);
  return title ? `You are ${name}, ${title}.` : `You are ${name}.`;
}

/** Where the agent's instructions file is this run, and the folder its relative paths resolve from. */
export function claudeInstructionsLocation(instructionsFilePath: string): string {
  return `Your instructions file this run is ${instructionsFilePath}; resolve relative paths in it from ${path.dirname(instructionsFilePath)}/.`;
}

/**
 * How the run works with Paperclip: the `paperclip_*` tools and, unless `endOfRunLine` is false,
 * how to end the run. Empty without the API URL and key, as `renderPaperclipMcpNote` is.
 */
export function claudeToolsNote(input: { env: Record<string, string>; endOfRunLine: boolean }): string {
  if (!input.env.PAPERCLIP_API_URL || !input.env.PAPERCLIP_API_KEY) return "";
  return [
    "Work with Paperclip through the `paperclip` MCP server's `paperclip_*` tools, not HTTP requests. " +
      "This message has what's new and the task; `paperclip_read_task` and `paperclip_task_context` read more when you need it.",
    ...(input.endOfRunLine
      ? ["End the run with `paperclip_finish`, `paperclip_block` (if you're waiting on someone) or `paperclip_report_progress` with `continue: true`."]
      : []),
    "PAPERCLIP_API_KEY is there for scripts that need the REST API.",
  ].join("\n");
}

/**
 * Whether the tools note carries the end-of-run line: not on a chat task, which ends with its
 * reply, and not on a recovery wake, whose own rules say how it ends.
 */
export function claudeToolsNoteEndsRun(context: Record<string, unknown>): boolean {
  return context.conversationMode !== true && !isPaperclipRecoveryWakePayload(context.paperclipWake);
}
