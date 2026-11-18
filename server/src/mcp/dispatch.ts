import { IncomingMessage } from "node:http";
import express, { type RequestHandler, type Router } from "express";
import { inject } from "light-my-request";
import type { AgentAccessAction } from "@paperclipai/shared";
import { DEFAULT_JSON_BODY_LIMIT } from "../http/body-limits.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { CatalogDispatch, McpCaller } from "./catalog/types.js";

/**
 * A REST call made for a catalog tool that didn't succeed. `code: "access_denied"` with
 * `missingAction` and `requestable` is the access-level denial from the routes and the route policy.
 */
export class McpToolError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly missingAction?: AgentAccessAction;
  readonly requestable?: boolean;

  constructor(input: { status: number; message: string; code?: string | null; missingAction?: AgentAccessAction; requestable?: boolean }) {
    super(input.message);
    this.name = "McpToolError";
    this.status = input.status;
    this.code = input.code ?? null;
    if (input.missingAction) this.missingAction = input.missingAction;
    if (input.requestable !== undefined) this.requestable = input.requestable;
  }
}

export interface CatalogDispatchOptions {
  /** The main app's locals, so a call that outlives the database pool is recognized (as in the public MCP). */
  parentLocals?: Record<string, unknown>;
  /** Handlers run before the API router, for middleware the app mounts outside it (the agent route policy). */
  middleware?: RequestHandler[];
}

function errorFromResponse(status: number, payload: unknown): McpToolError {
  const body = payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const details = body.details !== null && typeof body.details === "object" ? body.details as Record<string, unknown> : {};
  const code = typeof body.code === "string" ? body.code : typeof details.code === "string" ? details.code : null;
  const message = typeof body.error === "string" && body.error ? body.error
    : typeof body.message === "string" && body.message ? body.message
    : `Paperclip refused the request (HTTP ${status})`;
  const missingAction = body.missingAction ?? details.missingAction;
  const requestable = body.requestable ?? details.requestable;
  return new McpToolError({
    status, code, message,
    ...(typeof missingAction === "string" ? { missingAction: missingAction as AgentAccessAction } : {}),
    ...(typeof requestable === "boolean" ? { requestable } : {}),
  });
}

/**
 * Re-enters the REST API in-process as the caller, the way the public MCP's `createMcpApiDispatch`
 * does: each call gets its own Express request with the caller's verified actor, so the routes' own
 * authorization, validation and audit apply. Runs also send their run id header.
 */
export function createCatalogDispatch(api: Router, caller: McpCaller, options: CatalogDispatchOptions = {}): CatalogDispatch {
  return async (method, path, body) => {
    const app = express();
    const parentLocals = options.parentLocals;
    if (parentLocals) {
      Object.defineProperty(app.locals, "paperclipDatabaseClosing", {
        get: () => parentLocals.paperclipDatabaseClosing === true,
      });
    }
    // light-my-request adapts the parent prototypes of app.request/response.
    // Clone Express's shared parents so injection cannot alter real HTTP traffic.
    for (const target of [app.request, app.response]) {
      const parent = Object.getPrototypeOf(target);
      Object.setPrototypeOf(target, Object.create(Object.getPrototypeOf(parent), Object.getOwnPropertyDescriptors(parent)));
    }
    app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }));
    app.use((req, _res, next) => { req.actor = caller.actor as Express.Request["actor"]; next(); });
    for (const handler of options.middleware ?? []) app.use("/api", handler);
    app.use("/api", api);
    app.use(errorHandler);
    const headers: Record<string, string> = {};
    if (caller.runId) headers["x-paperclip-run-id"] = caller.runId;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await inject(app, {
      method, url: "/api" + path, Request: IncomingMessage, headers,
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    if (response.statusCode >= 400) {
      let payload: unknown = null;
      try { payload = response.json(); } catch { /* A non-JSON error keeps the generic message. */ }
      throw errorFromResponse(response.statusCode, payload);
    }
    return response.statusCode === 204 || !response.payload ? null : response.json<unknown>();
  };
}
