import { IncomingMessage } from "node:http";
import express, { type Router } from "express";
import { inject } from "light-my-request";
import { errorHandler } from "../../middleware/error-handler.js";
import { DEFAULT_JSON_BODY_LIMIT } from "../../http/body-limits.js";
import { McpApiError, object, type ApiDispatch } from "./contracts.js";

export { McpApiError, McpCapabilityError } from "./contracts.js";
export type { ApiDispatch } from "./contracts.js";

// The public MCP's own tool list lived here until step 4a: it now serves the Paperclip catalog
// (`./catalog.ts`, `server/src/mcp/catalog/`). This dispatch stays for the events and file links.

/** Internal HTTP dispatch reuses domain authorization, validation, audit and scheduling.
 * Neither an arbitrary path nor an actor is accepted from the MCP client.
 * Each invocation has its own Express request and verified actor.
 * `parentLocals` is the main app's locals; the orderly-shutdown flag is read
 * through it so a call that outlives the database pool is recognized.
 */
export function createMcpApiDispatch(api: Router, parentLocals?: Record<string, unknown>): ApiDispatch {
  return async (principal, method, path, body) => {
    const app = express();
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
    app.use((req, _res, next) => { req.actor = principal.actor; next(); });
    app.use("/api", api);
    app.use(errorHandler);
    const response = await inject(app, {
      method, url: "/api" + path, Request: IncomingMessage,
      ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    if (response.statusCode >= 400) {
      // Keep upstream error details out of the public tool boundary.
      let payload: Record<string, unknown> = {};
      try { payload = object(response.json()); } catch { /* Non-JSON upstream errors remain private. */ }
      const details = object(payload.details);
      const safe: Record<string, unknown> = {};
      for (const key of ["code", "currentRevisionId", "latestRevisionId", "currentVersionId"]) {
        const value = payload[key] ?? details[key];
        if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) safe[key] = value;
      }
      throw new McpApiError(response.statusCode, safe);
    }
    return response.statusCode === 204 || !response.payload ? null : response.json<unknown>();
  };
}
