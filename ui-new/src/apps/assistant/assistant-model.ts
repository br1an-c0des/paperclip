import type { McpConnection } from "@paperclipai/shared";

/*
 * View model for Apps → Assistants (`/apps/assistant-connection`, the old UI's
 * AssistantConnection): the invitation and setup steps for each assistant, and the connections that
 * are yours in this organization.
 *
 * The invitation and setup steps are the shared package's mcp-setup helpers (`mcpInvitation`,
 * `mcpSetupSteps`, `assistantClientNames`, `mcpAuthorizationHandoffInstructions`), copied here
 * because ui-new imports the shared package for types only (decision 10). Keep them in step with
 * packages/shared/src/mcp-setup.ts.
 */

export type AssistantClient = "codex" | "claude" | "opencode" | "browser" | "headless" | "other";

export const ASSISTANT_NAMES: Record<AssistantClient, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  browser: "ChatGPT / Claude web",
  headless: "Headless",
  other: "Other",
};

export const ASSISTANTS = Object.keys(ASSISTANT_NAMES) as AssistantClient[];

/** `PUBLIC_MCP_SCOPES` (packages/shared/src/public-mcp.ts). */
const PUBLIC_MCP_SCOPES = ["paperclip:read", "paperclip:write", "paperclip:configure", "offline_access"] as const;

export const AUTHORIZATION_HANDOFF =
  "Authorization commands wait for human approval. When using an assistant shell tool, keep the command running in a persistent terminal or background process, capture its output privately, and share the approval URL immediately while it is still running. Client callback deadlines still apply. If the command timed out or stopped, start a fresh authorization request before sharing a link. If the host cannot keep the command alive across turns, ask the user to run it in their own terminal.";

export function setupUrl(serverUrl: string, companyId?: string) {
  const url = new URL("/mcp/setup", serverUrl);
  if (companyId) url.searchParams.set("company", companyId);
  return url.toString();
}

/** The message to paste into an assistant: where its instructions are, and what to do. */
export function invitation(serverUrl: string, company?: { id: string; name: string }) {
  return `Connect to my ${company ? `${company.name} ` : ""}Paperclip organization using the instructions at ${setupUrl(serverUrl, company?.id)}. Start authorization, give me the approval link, and verify the connection after I approve.`;
}

export type SetupStep = { text: string; code?: string };

/** How to add Paperclip to one assistant by hand. */
export function setupSteps(serverUrl: string, assistant: AssistantClient): SetupStep[] {
  const quoted = `'${serverUrl.replaceAll("'", "'\"'\"'")}'`;
  const scopes = PUBLIC_MCP_SCOPES.join(" ");
  switch (assistant) {
    case "codex":
      return [
        {
          text: "Check for an existing Paperclip server first. Reuse it only if its URL matches this instance. Add the remote server with the Codex CLI.",
          code: `codex mcp add paperclip --url ${quoted}`,
        },
        {
          text: "Start browser authorization and give the user the approval link.",
          code: "codex mcp login paperclip --scopes paperclip:read,paperclip:write,paperclip:configure,offline_access",
        },
        {
          text: "If the current conversation does not reload its MCP tools, start a new conversation or restart the client. Verify the connection with paperclip_connection before claiming success.",
        },
      ];
    case "claude":
      return [
        {
          text: "Check existing servers and reuse a matching instance. Add the remote server using Claude Code.",
          code: `claude mcp add --transport http paperclip ${quoted}`,
        },
        {
          text: "In Claude Code, run /mcp, select paperclip, and choose Authenticate. Versions that offer `claude mcp login --help` can also start authorization with `claude mcp login paperclip`. Give the user the approval link.",
        },
        { text: "Reconnect through /mcp, or start a new session if needed. Verify the account and organization with paperclip_connection." },
      ];
    case "opencode":
      return [
        {
          text: "Check `opencode --version` and existing configuration. For OpenCode 1.x, merge this entry into opencode.json without replacing other settings. OpenCode 2.x uses mcp.servers; use that version's documented format instead.",
          code: JSON.stringify({ mcp: { paperclip: { type: "remote", url: serverUrl, enabled: true, oauth: { scope: scopes } } } }, null, 2),
        },
        {
          text: "Run from the same project directory. OpenCode opens Paperclip's sign-in and consent page; give the user the approval link.",
          code: "opencode mcp auth paperclip",
        },
        {
          text: "If OpenCode was already running, restart it to load the connection. For the browser app, use this command. Verify the tools with paperclip_connection.",
          code: "opencode web",
        },
      ];
    case "browser":
      return [
        {
          text: "Open your assistant's Apps / Connectors settings and add a custom remote MCP connection using this URL. Availability depends on the account and workspace policy. Reading this page in chat does not install a connector.",
          code: serverUrl,
        },
        {
          text: "Choose OAuth / browser sign-in. Approve the connection in Paperclip, then select the connector in your conversation. If custom connectors are unavailable, use a supported local client. Verify the connected account and organization before doing work.",
        },
      ];
    case "headless":
      return [
        {
          text: "Use a Paperclip CLI version with `mcp login --device` support. This needs no callback listener; it prints a verification URL and user code, then waits for human approval.",
          code: `paperclipai mcp login --device --url ${quoted}`,
        },
        {
          text: "After approval, configure a local stdio MCP server running the command below. Credentials stay in the CLI's private credential store. Do not copy tokens or device codes into chat or project configuration.",
          code: `paperclipai mcp proxy --url ${quoted}`,
        },
        {
          text: "The user code is for the human to verify the request. The private device code remains inside the CLI. After connecting, call paperclip_connection to verify the account and organization.",
        },
      ];
    default:
      return [
        { text: "Add a remote HTTP MCP server at this URL, then choose OAuth / browser sign-in.", code: serverUrl },
        {
          text: "If the client cannot install MCP servers from chat, use its connection settings. If it cannot receive a browser callback, use the Headless instructions. After approval, verify the account and organization with paperclip_connection.",
        },
      ];
  }
}

/** Each assistant's own MCP documentation, as the old page links it. */
export function docsUrl(assistant: AssistantClient) {
  if (assistant === "opencode") return "https://opencode.ai/docs/mcp-servers/";
  if (assistant === "claude") return "https://code.claude.com/docs/en/mcp";
  return "https://developers.openai.com/codex/mcp";
}

/** Your assistants in this organization: not revoked, and not agent (Dot) connections. */
export function assistantRows(connections: readonly McpConnection[] | undefined, companyId: string) {
  return (connections ?? []).filter((row) => row.companyId === companyId && !row.revokedAt && !row.scopes.includes("paperclip:agent"));
}

/** "Connected as you · Read and write · Configure agents, projects and skills". */
export function assistantAccess(scopes: readonly string[]) {
  const base = scopes.includes("paperclip:write") ? "Read and write" : "Read only";
  return `Connected as you · ${base}${scopes.includes("paperclip:configure") ? " · Configure agents, projects and skills" : ""}`;
}
