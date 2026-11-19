import { z } from "zod";
import { HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { McpToolError } from "./dispatch.js";
import type { CatalogDispatch, McpCaller, PaperclipTool } from "./catalog/types.js";
import { hasAgentAccess } from "@paperclipai/shared";
import { callAccess, isRequestable, toolVisibility } from "./catalog/visibility.js";
import type { AgentAccessAction } from "@paperclipai/shared";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { paperclipNeedsApproval: true };
}

export interface CallToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Turns a requestable denial into a `permission_request` for the board (step 4a, section 7). */
export type RequestPermission = (input: {
  caller: McpCaller;
  tool: string;
  arguments: Record<string, unknown>;
  missingAction: AgentAccessAction;
  taskId: string | null;
}) => Promise<{ approvalId: string; url: string; reused?: boolean }>;

export interface McpSession {
  caller: McpCaller;
  catalog: readonly PaperclipTool[];
  dispatch: CatalogDispatch;
  /** When set, a requestable denial becomes a request instead of an error. */
  requestPermission?: RequestPermission;
}

type JsonRpcId = string | number | null;
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

/**
 * Drops what costs context without telling the model anything: the regex Zod adds to every
 * `format: "uuid"` (~180 characters each) and the safe-integer bound on unbounded integers.
 * Validation still runs on the full Zod schema.
 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).filter(([key, entry]) => {
    if (key === "$schema") return false;
    if (key === "pattern" && (value as Record<string, unknown>).format === "uuid") return false;
    if (key === "maximum" && entry === Number.MAX_SAFE_INTEGER) return false;
    return true;
  });
  return Object.fromEntries(entries.map(([key, entry]) => [key, compact(entry)]));
}

const schemaCache = new WeakMap<PaperclipTool, Record<string, unknown>>();
function inputSchema(definition: PaperclipTool): Record<string, unknown> {
  let schema = schemaCache.get(definition);
  if (!schema) {
    schema = compact(z.toJSONSchema(definition.input, { io: "input", unrepresentable: "any" })) as Record<string, unknown>;
    schemaCache.set(definition, schema);
  }
  return schema;
}

/**
 * The tools a caller sees: those it may use, plus requestable ones it may not, marked as needing
 * approval. Run-only tools are hidden without a run id; tools it can't use or request are hidden.
 */
export function listTools(caller: McpCaller, catalog: readonly PaperclipTool[]): McpToolDefinition[] {
  return catalog.flatMap((definition): McpToolDefinition[] => {
    const visibility = toolVisibility(caller, definition);
    if (visibility.state === "hidden") return [];
    const base = { name: definition.name, inputSchema: inputSchema(definition) };
    if (visibility.state === "needs_approval") {
      return [{ ...base, description: `${definition.description} Needs approval.`, annotations: { paperclipNeedsApproval: true } }];
    }
    // A tool that reads or writes by its arguments, listed for its reads: say its changes need approval.
    const changesNeedApproval = definition.writes && !hasAgentAccess(caller.access, definition.action);
    return [{ ...base, description: changesNeedApproval ? `${definition.description} Changes need approval.` : definition.description }];
  });
}

function errorResult(message: string, details: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }], structuredContent: { ...details, error: message } };
}

async function requested(
  session: McpSession,
  definition: PaperclipTool,
  args: Record<string, unknown>,
  missingAction: AgentAccessAction,
): Promise<CallToolResult> {
  const taskId = typeof args.taskId === "string" ? args.taskId : null;
  const request = await session.requestPermission!({ caller: session.caller, tool: definition.name, arguments: args, missingAction, taskId });
  const text = `Sent to the board for approval (request ${request.approvalId}, ${request.url}): ${definition.name} needs ${missingAction}.`
    + " If it's approved, Paperclip carries the call out once and comments on the task. Carry on with other work, or block on it.";
  return {
    isError: false,
    content: [{ type: "text", text }],
    structuredContent: { status: "requested", approvalId: request.approvalId, url: request.url, missingAction },
  };
}

/** Calls a catalog tool as the caller. Every failure comes back as an `isError` result. */
export async function callTool(session: McpSession, name: unknown, args: unknown): Promise<CallToolResult> {
  const definition = session.catalog.find(candidate => candidate.name === name);
  if (!definition) return errorResult(`Unknown tool ${String(name)}.`, { code: "unknown_tool" });
  const visibility = toolVisibility(session.caller, definition);
  if (visibility.state === "hidden") {
    return visibility.missingAction
      ? errorResult(`You don't have ${visibility.missingAction}, which ${definition.name} needs.`, {
        code: "access_denied", missingAction: visibility.missingAction, requestable: false,
      })
      : visibility.code === "grant_required"
        ? errorResult(visibility.reason, { code: "grant_required" })
        : errorResult("This tool works only during a run, with the run's own token.", { code: "run_required" });
  }
  const parsed = definition.input.safeParse(args ?? {});
  if (!parsed.success) return errorResult(`Invalid arguments: ${z.prettifyError(parsed.error)}`, { code: "invalid_arguments" });
  const input = parsed.data !== null && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : {};
  try {
    const access = callAccess(session.caller, definition, input);
    if (access.state === "denied") {
      return errorResult(`You don't have ${access.missingAction}, which this call needs.`, {
        code: "access_denied", missingAction: access.missingAction, requestable: false,
      });
    }
    if (access.state === "needs_approval") {
      if (session.requestPermission) return await requested(session, definition, input, access.missingAction);
      return errorResult(`You don't have ${access.missingAction}, which ${definition.name} needs; it needs the board's approval.`, {
        code: "access_denied", missingAction: access.missingAction, requestable: true,
      });
    }
    const result = await definition.run(session.caller, parsed.data, session.dispatch);
    const structured = result !== null && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown> : { result };
    return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
  } catch (error) {
    if (error instanceof McpToolError) {
      // A route's refusal by the level or an override becomes a request, like a refusal up front.
      if (error.code === "access_denied" && error.requestable && error.missingAction && isRequestable(definition) && session.requestPermission) {
        try {
          return await requested(session, definition, input, error.missingAction);
        } catch (requestError) {
          logger.error({ err: requestError, tool: definition.name }, "Paperclip MCP permission request failed");
        }
      }
      return errorResult(error.message, {
        code: error.code ?? "request_failed", status: error.status,
        ...(error.missingAction ? { missingAction: error.missingAction } : {}),
        ...(error.requestable !== undefined ? { requestable: error.requestable } : {}),
      });
    }
    if (error instanceof HttpError) return errorResult(error.message, { code: "request_failed", status: error.status });
    logger.error({ err: error, tool: definition.name }, "Paperclip MCP tool failed");
    return errorResult(`${definition.name} failed unexpectedly.`, { code: "tool_failed" });
  }
}

/** Handles one JSON-RPC message; null for a notification (no response). */
export async function handleMcpMessage(session: McpSession, message: unknown): Promise<JsonRpcResponse | null> {
  const body = message !== null && typeof message === "object" ? message as Record<string, unknown> : {};
  const id = (typeof body.id === "string" || typeof body.id === "number") ? body.id : null;
  const params = body.params !== null && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
  const isNotification = !("id" in body);
  const respond = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  switch (body.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      return respond({
        protocolVersion: requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "paperclip", version: "1" },
      });
    }
    case "ping":
      return respond({});
    case "tools/list":
      return respond({ tools: listTools(session.caller, session.catalog) });
    case "tools/call":
      return respond(await callTool(session, params.name, params.arguments));
    default:
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }
}
