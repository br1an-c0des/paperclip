import { z } from "zod";
import { MAX_ATTACHMENT_BYTES, isAllowedContentType } from "../../attachment-types.js";
import { McpToolError } from "../dispatch.js";
import type { McpCaller, PaperclipTool } from "./types.js";
import { tool } from "./util.js";

export interface FileUploadInput {
  taskId: string;
  requestId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}

/**
 * Temporary file links (carried over from the public MCP). An upload link is a ticket tied to an
 * OAuth grant, so only outside connections can upload this way; a run attaches files through the
 * task's API. A download link is tied to the outside connection's grant, or to the run that asked
 * for it (`services/run-file-links.ts`). Each catalog supplies the links its callers can use.
 */
export interface CatalogFiles {
  upload?(caller: McpCaller, input: FileUploadInput): Promise<unknown>;
  download?(caller: McpCaller, attachmentId: string): Promise<unknown>;
}

function unavailable(): never {
  throw new McpToolError({ status: 503, code: "files_unavailable", message: "File links aren't available on this server." });
}

export function createFileTools(files: CatalogFiles | undefined): PaperclipTool[] {
  return [
    tool({
      name: "paperclip_file_upload",
      description: "Get a ten-minute URL to attach a file to a task: compute its size and SHA-256, then PUT the exact bytes there. Reuse requestId after a lost response.",
      action: ["tasks:update_own", "tasks:update_any"],
      needsGrant: true,
      requestable: false,
      input: z.object({
        taskId: z.uuid(),
        requestId: z.uuid().describe("A new UUID for this upload; reuse it on retries"),
        filename: z.string().trim().min(1).max(240).regex(/^[^/\\\x00-\x1f\x7f]+$/),
        contentType: z.string().min(1).max(150).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).refine(isAllowedContentType, "Unsupported attachment content type"),
        byteSize: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }).strict(),
      run: async (caller, args) => files?.upload ? files.upload(caller, args) : unavailable(),
    }),
    tool({
      name: "paperclip_file_download",
      description: "Get a ten-minute URL to download a file attached to a task you can read (attachment ids from the wake or paperclip_deliverables), then fetch it with your HTTP tools.",
      action: "tasks:read",
      needsRunOrGrant: true,
      input: z.object({ attachmentId: z.uuid() }).strict(),
      run: async (caller, args) => files?.download ? files.download(caller, args.attachmentId) : unavailable(),
    }),
  ];
}
