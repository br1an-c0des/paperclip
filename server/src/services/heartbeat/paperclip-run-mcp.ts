import type { AdapterRuntimeMcpServer } from "../../adapters/index.js";

/** Set to `1` to give runs Paperclip's own MCP endpoint instead of the project-tools server. */
export const UNIFIED_RUN_MCP_ENV = "PAPERCLIP_UNIFIED_RUN_MCP";

export function isUnifiedRunMcpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[UNIFIED_RUN_MCP_ENV]?.trim() === "1";
}

/**
 * The Paperclip MCP server a run reaches with its own token. With the switch on, one server,
 * `paperclip`, at `/api/mcp/paperclip`, for every run with a token. Otherwise today's
 * "Paperclip projects" server, for task-bound runs only. The connection-tools and
 * "paperclip-assigned" servers are added separately and don't change.
 */
export function paperclipRunMcpServers(input: {
  authToken: string | null | undefined;
  /** `configuredPaperclipApiBaseUrl()`: null when `PAPERCLIP_API_URL` isn't set. */
  apiBaseUrl: string | null;
  taskBound: boolean;
  unified: boolean;
}): AdapterRuntimeMcpServer[] {
  if (!input.authToken || !input.apiBaseUrl) return [];
  if (input.unified) {
    return [{ name: "paperclip", url: `${input.apiBaseUrl}/api/mcp/paperclip`, token: input.authToken, connectionId: "paperclip" }];
  }
  if (!input.taskBound) return [];
  return [{
    name: "Paperclip projects",
    url: `${input.apiBaseUrl}/api/mcp/project-tools`,
    token: input.authToken,
    connectionId: "paperclip-project-tools",
  }];
}
