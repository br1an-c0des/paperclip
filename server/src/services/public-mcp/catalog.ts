import { randomUUID } from "node:crypto";
import type { Router } from "express";
import { and, eq } from "drizzle-orm";
import { mcpMutationReceipts, type Db } from "@paperclipai/db";
import { resolveMcpCaller } from "../../mcp/caller.js";
import { catalogDeps } from "../../mcp/catalog-deps.js";
import { createPaperclipCatalog, type CatalogFiles } from "../../mcp/catalog/index.js";
import type { PaperclipTool } from "../../mcp/catalog/types.js";
import { actionsOf, isWriteCall } from "../../mcp/catalog/visibility.js";
import { createCatalogDispatch } from "../../mcp/dispatch.js";
import { callTool, listTools, type CallToolResult, type McpToolDefinition, type RequestPermission } from "../../mcp/server.js";
import { logActivity } from "../activity-log.js";
import { stable } from "./contracts.js";
import type { PublicMcpTransfers } from "./file-transfers.js";
import { hashMcpSecret, type McpPrincipal, type PublicMcpOAuth } from "./oauth.js";

/** The public MCP's tools: the Paperclip catalog, for a person's connection (step 4a, task 4.4). */
export interface PublicMcpCatalog {
  listTools(principal: McpPrincipal): Promise<McpToolDefinition[]>;
  callTool(principal: McpPrincipal, name: string, args: unknown): Promise<CallToolResult>;
}

export interface PublicMcpCatalogOptions {
  /** The main API router, re-entered in-process as the caller. */
  api: Router;
  parentLocals?: Record<string, unknown>;
  transfers?: PublicMcpTransfers;
  requestPermission?: RequestPermission;
}

const REQUEST_ID_SCHEMA = {
  type: "string",
  format: "uuid",
  description: "Optional: a new UUID for this change. Reuse it, with the same arguments, to retry after an uncertain result.",
};

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A tool that takes its own `requestId` (the file upload, whose ticket code keeps its own retry
 * identity) gets it as an argument and no receipt: a link is ephemeral, as before.
 */
function ownsRequestId(definition: PaperclipTool): boolean {
  const shape = (definition.input as unknown as { shape?: Record<string, unknown> }).shape;
  return Boolean(shape && "requestId" in shape);
}

function errorResult(message: string, details: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }], structuredContent: { ...details, error: message } };
}

/**
 * Serves the catalog through the public MCP's OAuth front. Writes keep `mcp_mutation_receipts`:
 * an outside assistant may send `requestId` with any change (the listed schemas say so) and gets the
 * first outcome back on a retry; without one the change is still recorded, under a fresh id.
 */
export function createPublicMcpCatalog(db: Db, oauth: PublicMcpOAuth, options: PublicMcpCatalogOptions): PublicMcpCatalog {
  const transfers = options.transfers;
  const files: CatalogFiles | undefined = transfers ? {
    async upload(caller, input) {
      const principal = await oauth.authorizeGrant(caller.grantId!);
      return transfers.getUploadUrl(principal, { ...input, companyId: caller.companyId });
    },
    async download(caller, attachmentId) {
      return transfers.getDownloadUrl(await oauth.authorizeGrant(caller.grantId!), attachmentId);
    },
  } : undefined;
  const catalog = createPaperclipCatalog({ ...catalogDeps(db), files });
  const byName = new Map(catalog.map(definition => [definition.name as string, definition]));

  async function session(principal: McpPrincipal) {
    const caller = await resolveMcpCaller(db, principal.actor, { grant: principal.grant });
    return {
      caller,
      catalog,
      dispatch: createCatalogDispatch(options.api, caller, { parentLocals: options.parentLocals }),
      requestPermission: options.requestPermission,
    };
  }

  function withRequestId(definition: McpToolDefinition, tool: PaperclipTool | undefined): McpToolDefinition {
    const changes = tool && !ownsRequestId(tool) && (tool.writes || !actionsOf(tool).every(action => action === "tasks:read"));
    if (!changes) return definition;
    const schema = definition.inputSchema;
    return { ...definition, inputSchema: { ...schema, properties: { ...object(schema.properties), requestId: REQUEST_ID_SCHEMA } } };
  }

  return {
    async listTools(principal) {
      const { caller } = await session(principal);
      return listTools(caller, catalog).map(definition => withRequestId(definition, byName.get(definition.name)));
    },

    async callTool(principal, name, rawArgs) {
      const current = await session(principal);
      const definition = byName.get(name);
      if (definition && ownsRequestId(definition)) return callTool(current, name, rawArgs);
      const { requestId: rawRequestId, ...args } = object(rawArgs);
      if (!definition || !isWriteCall(definition, args)) return callTool(current, name, args);
      if (rawRequestId !== undefined && (typeof rawRequestId !== "string" || !UUID.test(rawRequestId))) {
        return errorResult("requestId must be a UUID.", { code: "invalid_arguments" });
      }
      const requestId = typeof rawRequestId === "string" ? rawRequestId : randomUUID();
      const { grant } = principal;
      const argumentsHash = hashMcpSecret(stable(args));
      const key = { companyId: grant.companyId, userId: grant.userId, grantId: grant.id, operation: name, requestId };
      const [receipt] = await db.insert(mcpMutationReceipts).values({ ...key, argumentsHash }).onConflictDoNothing().returning();
      if (!receipt) {
        const [existing] = await db.select().from(mcpMutationReceipts).where(and(
          eq(mcpMutationReceipts.companyId, grant.companyId), eq(mcpMutationReceipts.userId, grant.userId),
          eq(mcpMutationReceipts.operation, name), eq(mcpMutationReceipts.requestId, requestId),
        ));
        if (!existing || existing.argumentsHash !== argumentsHash) {
          return errorResult("requestId was already used with different arguments.", { code: "request_id_reused" });
        }
        if (existing.status === "completed" && existing.result) return existing.result as unknown as CallToolResult;
        return errorResult("This change is in progress or its outcome is unknown. Check the task in Paperclip before another change; don't retry with a new requestId.", {
          code: "outcome_unknown", requestId,
        });
      }
      await logActivity(db, {
        companyId: grant.companyId, actorType: "user", actorId: grant.userId, action: "mcp.tool_called",
        entityType: "mcp_connection", entityId: grant.id, details: { clientId: grant.clientId, operation: name, requestId },
      });
      const result = await callTool(current, name, args);
      const structured = object(result.structuredContent);
      const uncertain = result.isError && (structured.code === "tool_failed" || (typeof structured.status === "number" && structured.status >= 500));
      await db.update(mcpMutationReceipts)
        .set(uncertain ? { status: "unknown" } : { status: "completed", result: result as unknown as Record<string, unknown> })
        .where(eq(mcpMutationReceipts.id, receipt.id));
      return result;
    },
  };
}
