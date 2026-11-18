import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { resolveMcpCaller } from "../mcp/caller.js";
import { catalogDeps } from "../mcp/catalog-deps.js";
import { createPaperclipCatalog } from "../mcp/catalog/index.js";
import { createCatalogDispatch, type CatalogDispatchOptions } from "../mcp/dispatch.js";
import { handleMcpMessage } from "../mcp/server.js";

/**
 * Paperclip's own MCP server for runs and agent keys: stateless Streamable HTTP with JSON
 * responses. Mounted on the API router after actor middleware; `api` is that same router, which
 * the tools re-enter in-process as the caller.
 */
export function paperclipMcpRoutes(db: Db, api: Router, options: CatalogDispatchOptions = {}) {
  const router = Router();
  const catalog = createPaperclipCatalog(catalogDeps(db));
  router.post("/mcp/paperclip", async (req, res) => {
    const caller = await resolveMcpCaller(db, req.actor);
    const session = { caller, catalog, dispatch: createCatalogDispatch(api, caller, options) };
    if (Array.isArray(req.body)) {
      const responses = (await Promise.all(req.body.map(message => handleMcpMessage(session, message)))).filter(Boolean);
      if (responses.length === 0) return res.status(202).end();
      return res.json(responses);
    }
    const response = await handleMcpMessage(session, req.body);
    if (!response) return res.status(202).end();
    return res.json(response);
  });
  router.get("/mcp/paperclip", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ error: "This MCP server answers POST requests only" });
  });
  return router;
}
