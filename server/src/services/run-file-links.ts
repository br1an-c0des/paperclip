import { createHash, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Request, Response, Router } from "express";
import { and, eq } from "drizzle-orm";
import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentRunWritesRevoked } from "../agent-run-cancellation.js";
import { logger } from "../middleware/logger.js";
import type { McpCaller } from "../mcp/catalog/types.js";
import { McpToolError, createCatalogDispatch, type CatalogDispatchOptions } from "../mcp/dispatch.js";
import type { StorageService } from "../storage/types.js";
import { issueService } from "./issues.js";

/** Where a run's download link points, on the address runs reach Paperclip at. */
export const RUN_FILE_DOWNLOAD_PATH = "/api/mcp/paperclip/files/download";
const LIFETIME_MS = 10 * 60_000;
const MAX_LINKS_PER_RUN = 100;
const ATTACHMENT_FIELDS = ["id", "issueId", "originalFilename", "contentType", "byteSize", "sha256", "createdAt"] as const;
const TICKET = /^[A-Za-z0-9_-]{43}$/;

interface RunFileTicket {
  /** The run's caller as its MCP request resolved it: the download re-enters the API as this caller. */
  caller: McpCaller;
  attachmentId: string;
  issueId: string;
  expiresAt: number;
}

export interface RunFileLinksOptions {
  /** The API router, re-entered as the run to check the task read on issue and on download. */
  api: Router;
  storage: StorageService;
  /** The address runs reach Paperclip at (`PAPERCLIP_API_URL`); read when a link is issued. */
  origin: () => string | null | undefined;
  dispatchOptions?: CatalogDispatchOptions;
  now?: () => number;
}

const refused = () => new McpToolError({
  status: 404, code: "attachment_not_found",
  message: "Attachment not found, or it isn't on a task you can read.",
});

const pick = (value: Record<string, unknown>) =>
  Object.fromEntries(ATTACHMENT_FIELDS.filter(key => key in value).map(key => [key, value[key]]));

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Download links for runs (step 5 phase 2, Task 2). The public MCP's links are tickets tied to an
 * OAuth grant (`public-mcp/file-transfers.ts`, a table whose rows need one); a run has no grant, so
 * its links are tied to the run instead and kept in memory: a link lives ten minutes, a restart
 * drops it, and the run asks again.
 *
 * A link is issued, and the file served, only while the run is running (not cancelled or
 * superseded), its agent is active, and the agent can read the attachment's task: both times the
 * check re-enters `GET /issues/:id/attachments` as the run, the same company and task-read checks
 * that `GET /attachments/:id/content` makes, and the attachment must be listed there. A link names
 * one attachment, and works only for the run that asked for it.
 */
export function createRunFileLinks(db: Db, options: RunFileLinksOptions) {
  const now = options.now ?? Date.now;
  const tickets = new Map<string, RunFileTicket>();

  function sweep() {
    const time = now();
    for (const [key, ticket] of tickets) if (ticket.expiresAt <= time) tickets.delete(key);
  }

  async function runIsLive(caller: McpCaller): Promise<boolean> {
    if (caller.kind !== "run" || !caller.runId || !caller.agentId) return false;
    const [run] = await db.select({ status: heartbeatRuns.status, resultJson: heartbeatRuns.resultJson })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.id, caller.runId), eq(heartbeatRuns.agentId, caller.agentId), eq(heartbeatRuns.companyId, caller.companyId)));
    if (!run || run.status !== "running" || agentRunWritesRevoked(run)) return false;
    const [agent] = await db.select({ status: agents.status, companyId: agents.companyId }).from(agents).where(eq(agents.id, caller.agentId));
    return Boolean(agent && agent.companyId === caller.companyId && agent.status !== "terminated" && agent.status !== "pending_approval");
  }

  /** The attachment, when the caller can read its task: refused the same way when it can't, or it's missing. */
  async function readableAttachment(caller: McpCaller, attachmentId: string) {
    const attachment = await issueService(db).getAttachmentById(attachmentId);
    if (!attachment || attachment.companyId !== caller.companyId) throw refused();
    let listed: unknown;
    try {
      listed = await createCatalogDispatch(options.api, caller, options.dispatchOptions)("GET", `/issues/${encodeURIComponent(attachment.issueId)}/attachments`);
    } catch (error) {
      if (error instanceof McpToolError && [401, 403, 404].includes(error.status)) throw refused();
      throw error;
    }
    if (!Array.isArray(listed) || !listed.some(row => (row as { id?: unknown } | null)?.id === attachment.id)) throw refused();
    return attachment;
  }

  return {
    /** Issues a ten-minute link to one attachment, for the run that asks. */
    async download(caller: McpCaller, attachmentId: string) {
      if (caller.kind !== "run") {
        throw new McpToolError({ status: 403, code: "run_required", message: "File links for agents belong to a run: ask during a run, with the run's own token." });
      }
      const origin = options.origin()?.trim().replace(/\/+$/, "");
      if (!origin) {
        throw new McpToolError({ status: 503, code: "files_unavailable", message: "File links need PAPERCLIP_API_URL, the address runs reach Paperclip at." });
      }
      if (!(await runIsLive(caller))) {
        throw new McpToolError({ status: 403, code: "run_not_active", message: "This run is no longer running, so it can't get file links." });
      }
      const attachment = await readableAttachment(caller, attachmentId);
      sweep();
      let active = 0;
      for (const ticket of tickets.values()) if (ticket.caller.runId === caller.runId) active += 1;
      if (active >= MAX_LINKS_PER_RUN) {
        throw new McpToolError({ status: 429, code: "too_many_links", message: "Too many active file links for this run. Wait for earlier links to expire." });
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now() + LIFETIME_MS;
      tickets.set(hash(token), { caller, attachmentId: attachment.id, issueId: attachment.issueId, expiresAt });
      return {
        url: `${origin}${RUN_FILE_DOWNLOAD_PATH}?ticket=${token}`,
        expiresAt: new Date(expiresAt).toISOString(),
        method: "GET",
        attachment: pick(attachment as unknown as Record<string, unknown>),
        instructions: "Download this file with your HTTP tools (for example curl -o) within ten minutes. The link works only for this run and this file; don't share it.",
      };
    },

    /** Serves a link's file, after checking the run and its task access again. */
    async serve(req: Request, res: Response) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      const deny = () => res.status(403).json({
        error: "transfer_unavailable",
        message: "This download link is expired, invalid or no longer authorized. Ask paperclip_file_download for a new one.",
      });
      const raw = req.query.ticket;
      const ticket = typeof raw === "string" && TICKET.test(raw) ? tickets.get(hash(raw)) : undefined;
      if (!ticket || ticket.expiresAt <= now()) return deny();
      try {
        if (!(await runIsLive(ticket.caller))) return deny();
        const attachment = await readableAttachment(ticket.caller, ticket.attachmentId);
        if (attachment.issueId !== ticket.issueId || ticket.expiresAt <= now()) return deny();
        const file = await options.storage.getObject(attachment.companyId, attachment.objectKey);
        res.attachment(attachment.originalFilename ?? "attachment");
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(attachment.byteSize));
        await pipeline(file.stream, res);
      } catch (error) {
        if (res.headersSent) { res.destroy(); return; }
        if (!(error instanceof McpToolError)) logger.warn({ err: error, attachmentId: ticket.attachmentId }, "Run file download failed");
        return deny();
      }
    },
  };
}

export type RunFileLinks = ReturnType<typeof createRunFileLinks>;
