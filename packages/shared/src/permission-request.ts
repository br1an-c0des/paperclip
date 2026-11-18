import { z } from "zod";
import { AGENT_ACCESS_ACTIONS, type AgentAccessAction } from "./agent-access.js";

/**
 * The payload of a `permission_request` approval: a tool call refused by the caller's level or an
 * override, held for the board. Approving it replays the call once. See
 * fork/step-4a-mcp-and-permissions.md, section 7.
 */
export interface PermissionRequestPayload {
  version: 1;
  caller: {
    kind: "run" | "agent_key" | "oauth_person" | "oauth_agent";
    agentId: string | null;
    userId: string | null;
    runId: string | null;
    grantId: string | null;
  };
  taskId: string | null;
  tool: string;
  arguments: Record<string, unknown>;
  missingAction: AgentAccessAction;
  summary: string;
  /** ISO timestamp. */
  expiresAt: string;
  /** Set once the request has been approved and replayed. */
  result?: { status: "done" | "refused" | "failed"; detail: string; at: string };
}

export const permissionRequestPayloadSchema = z.object({
  version: z.literal(1),
  caller: z.object({
    kind: z.enum(["run", "agent_key", "oauth_person", "oauth_agent"]),
    agentId: z.string().nullable(),
    userId: z.string().nullable(),
    runId: z.string().nullable(),
    grantId: z.string().nullable(),
  }),
  taskId: z.string().nullable(),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  missingAction: z.enum(AGENT_ACCESS_ACTIONS),
  summary: z.string(),
  expiresAt: z.string().min(1),
  result: z.object({
    status: z.enum(["done", "refused", "failed"]),
    detail: z.string(),
    at: z.string().min(1),
  }).optional(),
}) satisfies z.ZodType<PermissionRequestPayload>;
