import type { McpConnection, McpConnectionRequest, McpConnectionSetup, McpDotPairingPreview } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Paperclip's MCP connection for assistants (Claude Code, Codex, ChatGPT), as ui/src/pages/
 * McpConnect.tsx uses it: approve a client's OAuth request (`/mcp/requests/:id`) or a device code
 * (`/mcp/device`), pair a Dot agent (`/dot-mcp/requests/:id`), and list or revoke connections.
 *
 * These only answer when the server has a public URL (`PAPERCLIP_PUBLIC_URL`, HTTPS or loopback) and
 * the experimental setting `enablePublicMcp` is on (build plan 3.12). Errors come back as OAuth
 * errors, `{ error: code, error_description }`; see `mcpProblem` in src/auth/auth-model.ts.
 */

export type McpConsentInput = {
  decision: "approve" | "deny";
  companyId?: string;
  allowWrites: boolean;
  allowConfiguration: boolean;
};

const enc = encodeURIComponent;
const prefix = (agentPairingOnly: boolean) => (agentPairingOnly ? "/dot-mcp/requests" : "/mcp/requests");

export const mcpApi = {
  request: (id: string, agentPairingOnly = false) => api.get<McpConnectionRequest>(`${prefix(agentPairingOnly)}/${enc(id)}`),
  device: (userCode: string) => api.get<McpConnectionRequest>(`/mcp/device?user_code=${enc(userCode)}`),
  consent: (id: string, input: McpConsentInput) =>
    api.post<{ redirectUrl?: string }>(`/mcp/requests/${enc(id)}/consent`, input),
  consentDevice: (userCode: string, input: McpConsentInput) =>
    api.post<{ status?: "approved" | "denied" }>("/mcp/device/consent", { ...input, userCode }),
  previewDotPairing: (id: string, pairingCode: string, agentPairingOnly = false) =>
    api.post<McpDotPairingPreview>(`${prefix(agentPairingOnly)}/${enc(id)}/dot-pairing/preview`, { pairingCode }),
  pairDot: (id: string, pairingCode: string, agentPairingOnly = false) =>
    api.post<{ redirectUrl: string }>(`${prefix(agentPairingOnly)}/${enc(id)}/dot-pairing`, { pairingCode }),

  setup: () => api.get<McpConnectionSetup>("/mcp/setup"),
  connections: () => api.get<McpConnection[]>("/mcp/connections"),
  revoke: (id: string) => api.delete<void>(`/mcp/connections/${enc(id)}`),
};
