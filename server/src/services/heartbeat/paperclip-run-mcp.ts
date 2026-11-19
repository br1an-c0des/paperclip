import type { AdapterRuntimeMcpServer } from "../../adapters/index.js";

/**
 * The Paperclip MCP server a run reaches with its own token: one server, `paperclip`, at
 * `/api/mcp/paperclip`, for every run with a token, whether or not it's bound to a task. The run
 * tools need only the run id in the token: on a run without a task, `paperclip_task_context` says
 * so and the finish/block/progress tools refuse with `run_without_task`. The connection-tools and
 * "paperclip-assigned" servers are added separately and don't change.
 */
export function paperclipRunMcpServers(input: {
  authToken: string | null | undefined;
  /** `configuredPaperclipApiBaseUrl()`: null when `PAPERCLIP_API_URL` isn't set. */
  apiBaseUrl: string | null;
}): AdapterRuntimeMcpServer[] {
  if (!input.authToken || !input.apiBaseUrl) return [];
  return [{ name: "paperclip", url: `${input.apiBaseUrl}/api/mcp/paperclip`, token: input.authToken, connectionId: "paperclip" }];
}
