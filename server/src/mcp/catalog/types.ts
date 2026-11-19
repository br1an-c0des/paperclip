import type { z } from "zod";
import type { AgentAccessAction, ResolvedAgentAccess } from "@paperclipai/shared";
import type { AuthorizationActor } from "../../services/authorization.js";
import type { PaperclipToolName } from "./tool-names.js";

export type McpCallerKind = "run" | "agent_key" | "oauth_person" | "oauth_agent";

/** Who is calling a catalog tool, as the REST routes understand it, and the access that applies. */
export interface McpCaller {
  kind: McpCallerKind;
  actor: AuthorizationActor;
  companyId: string;
  agentId: string | null;
  userId: string | null;
  runId: string | null;
  grantId: string | null;
  access: ResolvedAgentAccess;
}

/** Re-enters the REST API as the caller. `path` is relative to `/api`. */
export type CatalogDispatch = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<unknown>;

export interface PaperclipTool<S extends z.ZodType = z.ZodType> {
  name: PaperclipToolName;
  description: string;
  input: S;
  /** The action the tool needs; an array means any of them. */
  action: AgentAccessAction | readonly AgentAccessAction[];
  /** Hidden from callers without a run id. */
  needsRun?: boolean;
  /** Hidden from callers without an OAuth grant (the file-link tools: tickets belong to a grant). */
  needsGrant?: boolean;
  /** Whether a denial becomes an Inbox request. Defaults to `true` unless the action is `tasks:read`. */
  requestable?: boolean;
  run(caller: McpCaller, args: z.infer<S>, api: CatalogDispatch): Promise<unknown>;
}
