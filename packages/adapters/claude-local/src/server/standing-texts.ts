import path from "node:path";
import { isPaperclipRecoveryWakePayload } from "@paperclipai/adapter-utils/server-utils";

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
