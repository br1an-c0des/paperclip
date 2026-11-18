import { z } from "zod";
import { hasAgentAccess, type AgentAccessAction } from "@paperclipai/shared";
import { buildOpenApiDocument } from "../../routes/openapi.js";
import { McpToolError } from "../dispatch.js";
import { routeAction, type RoutePolicyEntry } from "./route-policy.js";
import type { CatalogDispatch, McpCaller } from "./types.js";
import { object, tool } from "./util.js";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Who the OpenAPI document says may call an operation; agents can call these. */
const AGENT_CALLABLE = new Set(["board_or_agent", "agent"]);

export interface ApiOperation {
  /** `METHOD /path`, the path relative to `/api` with OpenAPI `{params}`. */
  operationId: string;
  method: Method;
  path: string;
  summary: string | null;
  pathParams: string[];
  query: Array<{ name: string; required: boolean; schema: unknown }>;
  body: unknown;
}

function operationsFromDocument(): ApiOperation[] {
  const document = buildOpenApiDocument() as { paths?: Record<string, Record<string, unknown>> };
  const operations: ApiOperation[] = [];
  for (const [fullPath, item] of Object.entries(document.paths ?? {})) {
    if (!fullPath.startsWith("/api/") || fullPath.startsWith("/api/mcp/")) continue;
    const path = fullPath.slice("/api".length);
    for (const lower of METHODS) {
      const operation = object(item[lower]);
      if (!item[lower]) continue;
      const actor = object(operation["x-paperclip-authorization"]).actor;
      if (typeof actor !== "string" || !AGENT_CALLABLE.has(actor)) continue;
      const parameters = Array.isArray(operation.parameters) ? operation.parameters.map(object) : [];
      const method = lower.toUpperCase() as Method;
      operations.push({
        operationId: `${method} ${path}`,
        method,
        path,
        summary: typeof operation.summary === "string" ? operation.summary : null,
        pathParams: [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!),
        query: parameters.filter(parameter => parameter.in === "query").map(parameter => ({
          name: String(parameter.name), required: parameter.required === true, schema: parameter.schema ?? null,
        })),
        body: object(object(object(operation.requestBody).content)["application/json"]).schema ?? null,
      });
    }
  }
  return operations;
}

function callableBy(caller: McpCaller, operation: ApiOperation, table?: readonly RoutePolicyEntry[]): boolean {
  return hasAgentAccess(caller.access, "api:raw")
    && hasAgentAccess(caller.access, routeAction(operation.method, operation.path, table));
}

/** Operations matching every word of `query` that the caller may call through `paperclip_call_api`. */
export function searchOperations(caller: McpCaller, query: string, limit: number, table?: readonly RoutePolicyEntry[]): ApiOperation[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // "issue" also finds "issues"; agents say "task" for issues.
  const expanded = words.map(word => word === "task" || word === "tasks" ? "issue" : word);
  return operationsFromDocument()
    .filter(operation => callableBy(caller, operation, table))
    .filter(operation => {
      const haystack = `${operation.operationId} ${operation.summary ?? ""}`.toLowerCase();
      return expanded.every(word => haystack.includes(word));
    })
    .slice(0, limit);
}

function denied(missingAction: AgentAccessAction) {
  return new McpToolError({
    status: 403, code: "access_denied", requestable: false, missingAction,
    message: `Calling this operation needs ${missingAction}.`,
  });
}

function queryString(query: Record<string, unknown> | undefined) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.set(name, Array.isArray(value) ? value.map(String).join(",") : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function callOperation(
  caller: McpCaller,
  args: { operationId: string; pathParams?: Record<string, string>; query?: Record<string, unknown>; body?: unknown },
  api: CatalogDispatch,
) {
  if (!hasAgentAccess(caller.access, "api:raw")) throw denied("api:raw");
  const operation = operationsFromDocument().find(candidate => candidate.operationId === args.operationId);
  if (!operation) {
    throw new McpToolError({ status: 404, code: "unknown_operation", message: `Unknown operation ${args.operationId}; find one with paperclip_search_api.` });
  }
  const needed = routeAction(operation.method, operation.path);
  if (!hasAgentAccess(caller.access, needed)) throw denied(typeof needed === "string" ? needed : needed[0]!);
  const path = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = args.pathParams?.[name];
    if (value === undefined || value === "") {
      throw new McpToolError({ status: 400, code: "missing_path_param", message: `pathParams.${name} is required for ${operation.operationId}.` });
    }
    return encodeURIComponent(value);
  });
  const result = await api(operation.method, path + queryString(args.query), operation.method === "GET" ? undefined : args.body);
  return { result };
}

export const API_TOOLS = [
  tool({
    name: "paperclip_search_api",
    description: "Search the Paperclip REST API for operations you may call with paperclip_call_api; every word must match.",
    // Only useful with call_api, so it needs the same action (the spec gave it tasks:read).
    action: "api:raw",
    requestable: false,
    input: z.object({ query: z.string().trim().max(200).default(""), limit: z.number().int().min(1).max(20).default(10) }).strict(),
    run: async (caller, args) => ({ operations: searchOperations(caller, args.query, args.limit) }),
  }),
  tool({
    name: "paperclip_call_api",
    description: "Call a REST operation found with paperclip_search_api, by operationId, with its path parameters, query and JSON body.",
    action: "api:raw",
    requestable: false,
    input: z.object({
      operationId: z.string().trim().min(1).max(300),
      pathParams: z.record(z.string(), z.string()).optional(),
      query: z.record(z.string(), z.unknown()).optional(),
      body: z.unknown().optional(),
    }).strict(),
    run: (caller, args, api) => callOperation(caller, args, api),
  }),
];
