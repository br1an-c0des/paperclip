import { hasAgentAccess, type AgentAccessAction } from "@paperclipai/shared";
import type { McpCaller, PaperclipTool } from "./types.js";

export const NEEDS_RUN_REASON = "Needs a run: only a run's own token can end its work.";
export const NEEDS_GRANT_REASON = "Needs an outside connection (OAuth): file links are tied to the connection that asked for them.";
export const NEEDS_RUN_OR_GRANT_REASON = "Needs a run or an outside connection (OAuth): a file link is tied to the run or connection that asked for it.";

/** How a tool appears to a caller. */
export type ToolVisibility =
  | { state: "allowed" }
  /** Listed, but calling it is denied and sent to the board as a request. */
  | { state: "needs_approval"; missingAction: AgentAccessAction }
  | { state: "hidden"; reason: string; missingAction?: AgentAccessAction; code?: "run_required" | "grant_required" };

export function actionsOf(definition: PaperclipTool): readonly AgentAccessAction[] {
  return typeof definition.action === "string" ? [definition.action] : definition.action;
}

const readActionOf = (definition: PaperclipTool): AgentAccessAction => definition.readAction ?? "tasks:read";

/** Whether a denial of this tool can become a request; the default is every action but `tasks:read`. */
export function isRequestable(definition: PaperclipTool): boolean {
  return definition.requestable ?? !actionsOf(definition).every(action => action === "tasks:read");
}

/**
 * How a tool is listed. A tool that reads or writes by its arguments (`writes`) is listed for a
 * caller who may read with it; its writes are checked per call (`callAccess`).
 */
export function toolVisibility(caller: McpCaller, definition: PaperclipTool): ToolVisibility {
  if (definition.needsRun && !caller.runId) return { state: "hidden", reason: NEEDS_RUN_REASON, code: "run_required" };
  if (definition.needsGrant && !caller.grantId) return { state: "hidden", reason: NEEDS_GRANT_REASON, code: "grant_required" };
  if (definition.needsRunOrGrant && !caller.runId && !caller.grantId) {
    return { state: "hidden", reason: NEEDS_RUN_OR_GRANT_REASON, code: "grant_required" };
  }
  if (hasAgentAccess(caller.access, definition.action)) return { state: "allowed" };
  if (definition.writes && hasAgentAccess(caller.access, readActionOf(definition))) return { state: "allowed" };
  const missingAction = actionsOf(definition)[0]!;
  if (isRequestable(definition)) return { state: "needs_approval", missingAction };
  return { state: "hidden", reason: `Needs ${missingAction}.`, missingAction };
}

/** Whether this call writes: a `writes` tool says per call; otherwise any action but `tasks:read`. */
export function isWriteCall(definition: PaperclipTool, args: unknown): boolean {
  if (definition.writes) return definition.writes(args);
  return !actionsOf(definition).every(action => action === "tasks:read");
}

/** The access one call needs, once its arguments are known. */
export function callAccess(
  caller: McpCaller,
  definition: PaperclipTool,
  args: unknown,
): { state: "allowed" } | { state: "needs_approval" | "denied"; missingAction: AgentAccessAction } {
  const needed = definition.writes && !definition.writes(args) ? [readActionOf(definition)] : actionsOf(definition);
  if (hasAgentAccess(caller.access, needed)) return { state: "allowed" };
  const missingAction = needed[0]!;
  return { state: isRequestable(definition) && missingAction !== "tasks:read" ? "needs_approval" : "denied", missingAction };
}
