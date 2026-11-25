import path from "node:path";
import type { PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";

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
 * sections and the system prompt; fork/step-5-light.md, fork/step-5-system-prompt.md): where the
 * agent's instructions are this run, and who the agent is on an unsealed run (a sealed run has it
 * in its system prompt). claude_local's own; ACP and the other adapters keep the shared texts
 * (`renderPaperclipMcpNote`, `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`).
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

/**
 * The agent's instructions copy this run, as the server puts it on the run context
 * (`context.paperclipInstructionCopy`, `server/src/services/heartbeat/instruction-working-copy.ts`):
 * an agent directory (AGENT_HOME, kept after the run), a registered copy of the instructions file
 * (saved after the run), or none that can be saved (`unavailable`). Absent: no registered copy.
 */
export type ClaudeInstructionCopy =
  | { kind: "agent_directory"; root: string; entryFile: string; storageWarning: string | null }
  | { kind: "instruction_file"; root: string; entryFile: string }
  | { kind: "unavailable" };

/** The context key the server sets the run's `ClaudeInstructionCopy` on. */
export const PAPERCLIP_INSTRUCTION_COPY_KEY = "paperclipInstructionCopy";

/** The run's instructions copy from the context value, or null when absent or not understood. */
export function readClaudeInstructionCopy(value: unknown): ClaudeInstructionCopy | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "unavailable") return { kind: "unavailable" };
  const root = trimmedString(record.root);
  const entryFile = trimmedString(record.entryFile);
  if (!root || !entryFile) return null;
  if (record.kind === "agent_directory") {
    return { kind: "agent_directory", root, entryFile, storageWarning: trimmedString(record.storageWarning) || null };
  }
  if (record.kind === "instruction_file") return { kind: "instruction_file", root, entryFile };
  return null;
}

/**
 * The first message's one instructions line (bug 88): where the agent's instructions are this
 * run, with each path printed once. An agent directory names the folder and its entry file, then
 * any storage warning on its own line; otherwise the file and the folder its relative paths
 * resolve from, and whether changes to it are saved.
 */
export function claudeInstructionsLocation(input: {
  instructionsFilePath: string;
  copy: ClaudeInstructionCopy | null;
}): string {
  const { instructionsFilePath, copy } = input;
  if (copy?.kind === "agent_directory") {
    const line =
      `Your agent directory this run is ${copy.root} (AGENT_HOME): your instructions are ${copy.entryFile} there, ` +
      "and changes you make in it are kept after the run. Task files go in the task's working directory.";
    return copy.storageWarning ? `${line}\n${copy.storageWarning}` : line;
  }
  const fileLine = `Your instructions file is ${instructionsFilePath}; relative paths in it resolve from ${path.dirname(instructionsFilePath)}/.`;
  if (copy?.kind === "instruction_file") return `${fileLine} Changes to it are saved after the run.`;
  if (copy?.kind === "unavailable") return `${fileLine} Changes to it aren't saved.`;
  return fileLine;
}
