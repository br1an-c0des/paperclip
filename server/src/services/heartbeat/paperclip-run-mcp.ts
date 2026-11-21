import type { AdapterRuntimeMcpServer, AdapterRuntimeToolDelivery } from "../../adapters/index.js";

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

/**
 * A run's MCP servers in launch order: `paperclip` first, then the connection tools (for an
 * adapter that takes them over MCP), then the assigned-tools gateway. The run and its preview
 * (`services/run-preview.ts`) both assemble them here.
 */
export function orderRunMcpServers(input: {
  paperclip: AdapterRuntimeMcpServer[];
  /** `runtimeTools` (mcpEndpoint, bearerToken) when the run has them. */
  runtimeTools: { mcpEndpoint: string; bearerToken: string } | null | undefined;
  runtimeToolDelivery: AdapterRuntimeToolDelivery;
  assigned: AdapterRuntimeMcpServer[];
}): AdapterRuntimeMcpServer[] {
  const connections: AdapterRuntimeMcpServer[] = input.runtimeTools && input.runtimeToolDelivery === "native_mcp"
    ? [{
        name: "Paperclip connections",
        url: input.runtimeTools.mcpEndpoint,
        token: input.runtimeTools.bearerToken,
        connectionId: "paperclip-runtime-tools",
      }]
    : [];
  return [...input.paperclip, ...connections, ...input.assigned];
}
