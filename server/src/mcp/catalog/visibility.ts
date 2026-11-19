import { hasAgentAccess, type AgentAccessAction } from "@paperclipai/shared";
import type { McpCaller, PaperclipTool } from "./types.js";

export const NEEDS_RUN_REASON = "Needs a run: only a run's own token can end its work.";
export const NEEDS_GRANT_REASON = "Needs an outside connection (OAuth): file links are tied to the connection that asked for them.";

/** How a tool appears to a caller. */
export type ToolVisibility =
  | { state: "allowed" }
  /** Listed, but calling it is denied (and, in wave 2, sent to the board as a request). */
  | { state: "needs_approval"; missingAction: AgentAccessAction }
  | { state: "hidden"; reason: string; missingAction?: AgentAccessAction; code?: "run_required" | "grant_required" };

function actionsOf(definition: PaperclipTool): readonly AgentAccessAction[] {
  return typeof definition.action === "string" ? [definition.action] : definition.action;
}

/** Whether a denial of this tool can become a request; the default is every action but `tasks:read`. */
export function isRequestable(definition: PaperclipTool): boolean {
  return definition.requestable ?? !actionsOf(definition).every(action => action === "tasks:read");
}

export function toolVisibility(caller: McpCaller, definition: PaperclipTool): ToolVisibility {
  if (definition.needsRun && !caller.runId) return { state: "hidden", reason: NEEDS_RUN_REASON, code: "run_required" };
  if (definition.needsGrant && !caller.grantId) return { state: "hidden", reason: NEEDS_GRANT_REASON, code: "grant_required" };
  if (hasAgentAccess(caller.access, definition.action)) return { state: "allowed" };
  const missingAction = actionsOf(definition)[0]!;
  if (isRequestable(definition)) return { state: "needs_approval", missingAction };
  return { state: "hidden", reason: `Needs ${missingAction}.`, missingAction };
}
