import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { resolveMcpCaller } from "../mcp/caller.js";
import { catalogDeps } from "../mcp/catalog-deps.js";
import { createPaperclipCatalog } from "../mcp/catalog/index.js";
import { createCatalogDispatch, type CatalogDispatchOptions } from "../mcp/dispatch.js";
import { handleMcpMessage, type RequestPermission } from "../mcp/server.js";
import { createRunFileLinks } from "../services/run-file-links.js";
import type { StorageService } from "../storage/types.js";

export interface PaperclipMcpRouteOptions extends CatalogDispatchOptions {
  requestPermission?: RequestPermission;
  /** Where attachments are stored: with it, a run can get download links (`paperclip_file_download`). */
  storage?: StorageService;
  /** The address runs reach Paperclip at, for those links; defaults to `PAPERCLIP_API_URL`. */
  runOrigin?: () => string | null | undefined;
}

/**
 * Paperclip's own MCP server for runs and agent keys: stateless Streamable HTTP with JSON
 * responses. Mounted on the API router after actor middleware; `api` is that same router, which
 * the tools re-enter in-process as the caller.
 */
export function paperclipMcpRoutes(db: Db, api: Router, options: PaperclipMcpRouteOptions = {}) {
  const router = Router();
  const { requestPermission, storage, runOrigin, ...dispatchOptions } = options;
  const runFiles = storage ? createRunFileLinks(db, {
    api, storage, dispatchOptions, origin: runOrigin ?? (() => process.env.PAPERCLIP_API_URL),
  }) : null;
  const catalog = createPaperclipCatalog({
    ...catalogDeps(db),
    ...(runFiles ? { files: { download: (caller, attachmentId) => runFiles.download(caller, attachmentId) } } : {}),
  });
  router.post("/mcp/paperclip", async (req, res) => {
    const caller = await resolveMcpCaller(db, req.actor);
    const session = { caller, catalog, dispatch: createCatalogDispatch(api, caller, dispatchOptions), requestPermission };
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
  // A run's download link (`paperclip_file_download`): the ticket is the credential, not the actor.
  router.get("/mcp/paperclip/files/download", async (req, res) => {
    if (!runFiles) return res.status(404).json({ error: "File links aren't available on this server." });
    await runFiles.serve(req, res);
  });
  return router;
}
