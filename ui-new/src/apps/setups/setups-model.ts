import type {
  AggregatorAppSnapshot,
  ConnectionGrantKind,
  ConnectionMethodDef,
  ConnectToolApp,
  ToolConnection,
  ToolConnectionCreateCapabilities,
} from "@paperclipai/shared";

/*
 * View model for the setups the gallery used to hide (src/apps/setups/):
 *
 * - Who a new connection acts as: the organization's shared credential, "Just me" (a personal
 *   identity), or a dedicated account for one agent, as the method allows.
 * - Google Workspace's service picker: Gmail, Drive (Docs, Sheets, Slides) and Calendar, each read
 *   only or read and write. The server turns the choice into scopes.
 * - Aggregators (Composio, Arcade): the gateway's MCP address and sign-in, and the accounts behind
 *   it. Copied from the old UI's remote-mcp providers and the shared package's aggregator helpers
 *   (decision 10: ui-new imports the shared package for types only).
 */

// ---------------------------------------------------------------------------------------------
// Identity on create

export type IdentityChoice = { kind: ConnectionGrantKind; agentId: string | null };

export const IDENTITY_LABELS: Record<ConnectionGrantKind, { title: string; text: string }> = {
  organization: { title: "The organization", text: "One shared credential. You choose which people and agents may use it." },
  user: { title: "Just me", text: "Your own account. Agents act as you when they use it for your work." },
  agent: { title: "One agent's own account", text: "A dedicated account for one agent, used for everyone's work with it." },
};

/** The identities a method can create, in order; the organization one only when you may create it. */
export function identityKinds(method: ConnectionMethodDef | null | undefined, capabilities: ToolConnectionCreateCapabilities | undefined): ConnectionGrantKind[] {
  // A keyless server has no credential to own.
  if (!method || method.auth === "none") return [];
  const allowed = method?.grantKinds?.length ? method.grantKinds : (["organization", "user"] as ConnectionGrantKind[]);
  return (["organization", "user", "agent"] as ConnectionGrantKind[]).filter(
    (kind) => allowed.includes(kind) && (kind !== "organization" || capabilities?.canCreateOrganizationGrant !== false),
  );
}

/** The payload with the chosen identity; the organization (the server's default) is left out. */
export function withIdentity(payload: ConnectToolApp, choice: IdentityChoice): ConnectToolApp {
  if (choice.kind === "organization") return payload;
  if (choice.kind === "agent") return { ...payload, grantKind: "agent", subjectAgentId: choice.agentId ?? undefined } as ConnectToolApp;
  return { ...payload, grantKind: "user" } as ConnectToolApp;
}

export function identityProblem(choice: IdentityChoice) {
  return choice.kind === "agent" && !choice.agentId ? "Choose the agent the account belongs to." : null;
}

// ---------------------------------------------------------------------------------------------
// Google Workspace

export type WorkspaceService = "gmail" | "drive" | "calendar";
export type WorkspaceSelection = Partial<Record<WorkspaceService, "read" | "write">>;

export const WORKSPACE_SERVICES: { id: WorkspaceService; name: string; description?: string; logo: string }[] = [
  { id: "gmail", name: "Gmail", logo: "/brands/apps/gmail.svg" },
  { id: "drive", name: "Drive", description: "Docs, Sheets and Slides", logo: "/brands/apps/google-drive.svg" },
  { id: "calendar", name: "Calendar", logo: "/brands/apps/google-calendar.svg" },
];

export const DEFAULT_WORKSPACE_SELECTION: WorkspaceSelection = { gmail: "write", drive: "write", calendar: "write" };

export function withService(selection: WorkspaceSelection, id: WorkspaceService, access: "read" | "write" | null): WorkspaceSelection {
  const next = { ...selection };
  if (access) next[id] = access;
  else delete next[id];
  return next;
}

export function workspaceProblem(selection: WorkspaceSelection) {
  return Object.keys(selection).length === 0 ? "Choose at least one Google service." : null;
}

// ---------------------------------------------------------------------------------------------
// Aggregators

export type AggregatorId = "composio" | "arcade";

export const AGGREGATORS: Record<
  AggregatorId,
  { name: string; steps: string[]; setupUrl: string; dashboardUrl: string; defaultUrl: string; placeholder: string; urlHelp: string; authHelp: string }
> = {
  composio: {
    name: "Composio",
    steps: ["Connect to Composio and sign in with your account.", "Connect the apps you want in Composio when it asks."],
    setupUrl: "https://docs.composio.dev/docs/composio-connect",
    dashboardUrl: "https://dashboard.composio.dev/~/org/connect/apps",
    defaultUrl: "https://connect.composio.dev/mcp",
    placeholder: "https://connect.composio.dev/mcp",
    urlHelp: "Keep Composio Connect's address, or paste the MCP address from a Composio session you set up yourself.",
    authHelp: "Session addresses and headers come from your own Composio setup.",
  },
  arcade: {
    name: "Arcade",
    steps: ["Create a gateway in Arcade and choose its tools.", "Pick its user source and copy the gateway address.", "Paste it here, then sign in when asked."],
    setupUrl: "https://docs.arcade.dev/en/operate/governance/mcp-gateways",
    dashboardUrl: "https://app.arcade.dev/",
    defaultUrl: "",
    placeholder: "https://api.arcade.dev/mcp/your-gateway",
    urlHelp: "The MCP gateway address from Arcade. An app may ask you to authorize it the first time a tool is used.",
    authHelp: "For Arcade headers, use an API key as the bearer token and add an Arcade-User-ID header for the acting user.",
  },
};

export function isAggregator(slug: string | null | undefined): slug is AggregatorId {
  return slug === "composio" || slug === "arcade";
}

/** The aggregator a connection is a gateway for, from the gallery app it was made from. */
export function aggregatorOf(connection: Pick<ToolConnection, "config" | "transportConfig" | "transport">): AggregatorId | null {
  const source = connection.config?.sourceTemplateKey ?? connection.transportConfig?.sourceTemplateKey;
  return connection.transport === "mcp_remote" && isAggregator(typeof source === "string" ? source : null) ? (source as AggregatorId) : null;
}

export type GatewayAuth = "auto" | "bearer" | "custom_headers" | "none";

export type GatewayDraft = {
  url: string;
  auth: GatewayAuth;
  token: string;
  headers: { name: string; value: string }[];
};

export function newGatewayDraft(id: AggregatorId): GatewayDraft {
  return { url: AGGREGATORS[id].defaultUrl, auth: "auto", token: "", headers: [{ name: "", value: "" }] };
}

export function gatewayProblem(draft: GatewayDraft) {
  try {
    const url = new URL(draft.url.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "Paste the full MCP address, starting with https://.";
  } catch {
    return "Paste the full MCP address, starting with https://.";
  }
  if (draft.auth === "bearer" && !draft.token.trim()) return "Paste the token.";
  const half = draft.headers.some((header) => Boolean(header.name.trim()) !== Boolean(header.value));
  if ((draft.auth === "custom_headers" || draft.auth === "bearer") && half) return "Give each header a name and a value.";
  if (draft.auth === "custom_headers" && !draft.headers.some((header) => header.name.trim() && header.value)) return "Add at least one header.";
  return null;
}

/** The connect request for a gateway: the pasted address, how it signs in, and its secrets. */
export function gatewayPayload(id: AggregatorId, method: ConnectionMethodDef | null | undefined, draft: GatewayDraft): ConnectToolApp {
  const credentials: Record<string, string> = {};
  if (draft.auth === "bearer" && draft.token.trim()) credentials["credentials.authorization"] = draft.token.trim();
  if (draft.auth === "bearer" || draft.auth === "custom_headers") {
    for (const header of draft.headers) if (header.name.trim() && header.value) credentials[`headers.${header.name.trim()}`] = header.value;
  }
  return {
    galleryKey: id,
    connectionMethodKey: method?.key ?? "mcp",
    name: AGGREGATORS[id].name,
    link: draft.url.trim(),
    authMode: draft.auth,
    ...(Object.keys(credentials).length > 0 ? { credentialValues: credentials } : {}),
  } as ConnectToolApp;
}

/** How fresh an account behind a gateway is, in words (the old UI's account observations). */
export function accountStatus(snapshot: Pick<AggregatorAppSnapshot, "freshness" | "errorAt" | "checkedAt">, account: { status: string }, now = Date.now()) {
  if (snapshot.freshness === "stale" || snapshot.errorAt || now - new Date(snapshot.checkedAt).getTime() > 5 * 60_000) {
    return { label: "Not verified", hint: "Last known · refresh to check" };
  }
  if (account.status === "UNVERIFIED") return { label: "Not verified", hint: "Found upstream; sign-in not checked" };
  if (account.status === "ACTIVE") return { label: "Connected", hint: null };
  if (account.status === "INITIATED") return { label: "Waiting for sign-in", hint: null };
  return { label: "Needs sign-in", hint: "Sign in again in the provider" };
}

/** A management address the provider owns, never one carrying credentials (the shared package's rule). */
export function managementUrl(id: AggregatorId, configured?: string | null) {
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      if ([...url.searchParams.keys()].some((key) => /token|secret|api.?key|authorization|code/i.test(key))) return null;
      if (id === "composio" && url.hostname !== "dashboard.composio.dev") return null;
      if (id === "arcade" && url.hostname !== "app.arcade.dev") return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  return AGGREGATORS[id].dashboardUrl;
}

/** A Composio toolkit slug as people type it ("Google Sheets" → "googlesheets"). */
export function toolkitSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "");
}
