import type {
  AppDefinition,
  ConnectToolApp,
  ConnectToolAppResult,
  ConnectionMethodDef,
  FieldDef,
  InstanceExperimentalSettings,
  ToolActionRequestListItem,
  ToolApplication,
  ToolCatalogEntry,
  ToolConnection,
  ToolConnectionInstall,
  ToolPolicy,
  ToolProfileWithDetails,
} from "@paperclipai/shared";
import type { AccessSelection, InstallTarget } from "@/api/tools";
import type { Tone } from "@/ui/Status";

/*
 * View model for Apps and tools (src/apps/): the routes under `/:prefix/apps`, the gallery and your
 * connections, a connection's state, the connect forms' requests, and who may use a connection and
 * how each of its actions is allowed. The rules follow the old UI (ui/src/pages/apps/,
 * ui/src/features/connections/) and the shared package's app-definition helpers, copied here because
 * ui-new imports the shared package for types only (decision 10).
 */

export type AppCategory = AppDefinition["categories"][number];

// ---------------------------------------------------------------------------------------------
// Routes

export type DetailTab = "permissions" | "review" | "settings";
export const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: "permissions", label: "Permissions" },
  { key: "review", label: "Review" },
  { key: "settings", label: "Settings" },
];

export type AppsView =
  | { section: "browse" }
  | { section: "ai" }
  | { section: "review" }
  | { section: "connect" }
  | { section: "byo" }
  | { section: "application"; applicationId: string }
  | { section: "detail"; connectionId: string; tab: DetailTab }
  /** Pages the old UI has that ui-new leaves for later. */
  | { section: "later"; name: string }
  /** `to` is relative to `/:prefix/apps`, or absolute from the company when it starts with `/`. */
  | { section: "redirect"; to: string };

const LATER: Record<string, string> = {
  "assistant-connection": "Assistant connection",
  gateways: "Gateways",
  advanced: "Advanced",
  chat: "Chat endpoints",
  "vercel-connect": "Vercel Connect",
};

/** Where `/:prefix/apps/<rest>` goes. Keeps the old UI's addresses (ui/src/App.tsx). */
export function appsView(rest: string): AppsView {
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (!first) return { section: "browse" };
  if (first === "browse" || first === "connections" || first === "attention") return { section: "redirect", to: "" };
  if (first === "ai") return { section: "ai" };
  if (first === "review") return { section: "review" };
  if (first === "byo") return { section: "byo" };
  if (first === "connect") {
    // The old `/apps/connect/:appKey(/:stage)` addresses: open that app's setup.
    if (second) return { section: "redirect", to: `connect?source=${encodeURIComponent(second)}` };
    return { section: "connect" };
  }
  if (first === "app" && second) return { section: "application", applicationId: second };
  if (first in LATER) return { section: "later", name: LATER[first]! };
  if (!second) return { section: "redirect", to: `${encodeURIComponent(first)}/permissions` };
  // Setup and Test were folded into Permissions; Activity moved to the company's activity.
  if (second === "setup" || second === "test") return { section: "redirect", to: `${encodeURIComponent(first)}/permissions` };
  if (second === "activity") return { section: "redirect", to: "/activity" };
  if (DETAIL_TABS.some((tab) => tab.key === second) && !third) {
    return { section: "detail", connectionId: first, tab: second as DetailTab };
  }
  return { section: "redirect", to: `${encodeURIComponent(first)}/permissions` };
}

// ---------------------------------------------------------------------------------------------
// Gallery

/** The shared package's ownership defaults for an app without `ownershipAvailability`. */
const DEFAULT_OWNERSHIP = { platform_shared: false, platform_provisioned: false, customer: true, dcr: true } as const;

/**
 * Apps whose setup ui-new doesn't have yet, hidden from the gallery. Empty since M6 round 3:
 * aggregators, Google Workspace and AgentMail have theirs (src/apps/setups/, src/apps/chat/).
 */
export const SPECIAL_SETUP_APPS = new Set<string>();

const TOOL_TRANSPORTS = new Set(["mcp_remote", "rest_api"]);

/** The methods that connect the app as tools (not AI accounts, chat channels or local commands). */
export function toolMethods(app: AppDefinition): ConnectionMethodDef[] {
  const availability = { ...DEFAULT_OWNERSHIP, ...app.ownershipAvailability };
  return app.methods.filter(
    (method) =>
      (method.purpose ?? "tool") === "tool" &&
      TOOL_TRANSPORTS.has(method.transport) &&
      method.ownershipModes.some((ownership) => availability[ownership] !== false),
  );
}

export function supportsAutomaticOAuth(method: ConnectionMethodDef | null | undefined) {
  return (
    method?.auth === "oauth" &&
    (method.oauthStrategy === "paperclip_cloud_connector" ||
      method.oauthStrategy === "paperclip_id_connector" ||
      method.ownershipModes.includes("dcr"))
  );
}

export function acceptsOwnOAuthClient(method: ConnectionMethodDef | null | undefined) {
  return method?.auth === "oauth" && !method.oauthStrategy && method.ownershipModes.includes("customer");
}

/** OAuth that needs a client registered by you (no automatic registration). */
export function needsOwnOAuthClient(method: ConnectionMethodDef | null | undefined) {
  return acceptsOwnOAuthClient(method) && !supportsAutomaticOAuth(method);
}

/** A method ui-new can set up: no auth, an API key, or OAuth it can register or you register. */
export function canSetUp(method: ConnectionMethodDef) {
  if (method.auth === "none" || method.auth === "api_key") return true;
  return supportsAutomaticOAuth(method) || acceptsOwnOAuthClient(method);
}

/** The shared package's pick: write or draft capability first, then managed sign-in, then order. */
export function recommendedMethod(methods: readonly ConnectionMethodDef[]): ConnectionMethodDef | null {
  const capable = (list: readonly ConnectionMethodDef[]) =>
    list.find((method) => method.capabilityProfile?.key === "write" || method.capabilityProfile?.key === "draft");
  const managed = methods.filter(
    (method) => method.oauthStrategy === "paperclip_cloud_connector" || method.oauthStrategy === "paperclip_id_connector",
  );
  return capable(managed) ?? capable(methods) ?? managed[0] ?? methods[0] ?? null;
}

/** A pasted-address method: an MCP server with no address of its own (Zapier, Executor). */
export function needsLink(method: ConnectionMethodDef | null | undefined) {
  return method?.transport === "mcp_remote" && !method.defaults?.serverUrl && !method.defaults?.serverUrlTemplate;
}

export function methodTitle(app: AppDefinition, method: ConnectionMethodDef) {
  if (method.label) return method.label;
  if (method.auth === "oauth") return `Sign in with ${app.name}`;
  if (method.auth === "api_key") return "Use an API key";
  return "Connect";
}

type Flags = Partial<InstanceExperimentalSettings> | undefined;

/** True when the instance has the app's feature on (apps without one are always shown). */
export function appFlagOn(app: AppDefinition, flags: Flags) {
  if (!app.experimentalFeatureKey) return true;
  return Boolean((flags as Record<string, unknown> | undefined)?.[app.experimentalFeatureKey]);
}

/** The gallery: tool apps ui-new can connect, featured first, then by name. */
export function galleryApps(apps: readonly AppDefinition[], flags: Flags): AppDefinition[] {
  return apps
    .filter(
      (app) =>
        !app.aiConnectionRouter &&
        !SPECIAL_SETUP_APPS.has(app.slug) &&
        appFlagOn(app, flags) &&
        toolMethods(app).some(canSetUp),
    )
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.name.localeCompare(b.name));
}

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  ai: "AI",
  analytics: "Analytics",
  commerce: "Commerce",
  communication: "Communication",
  content: "Content",
  data: "Data",
  developer: "Developer",
  productivity: "Productivity",
  other: "Other",
};

/** The categories the apps use, in the label table's order. */
export function categoriesIn(apps: readonly AppDefinition[]): AppCategory[] {
  const used = new Set(apps.flatMap((app) => app.categories));
  return (Object.keys(CATEGORY_LABELS) as AppCategory[]).filter((category) => used.has(category));
}

export function matchesApp(app: AppDefinition, query: string, category: AppCategory | null) {
  if (category && !app.categories.includes(category)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [app.name, app.slug, app.description, ...(app.tags ?? []), ...app.categories.map((c) => CATEGORY_LABELS[c])]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

// ---------------------------------------------------------------------------------------------
// Connections

/** The gallery slug a connection or application was made from, when it was. */
export function connectionSlug(connection: ToolConnection | null | undefined, application?: ToolApplication | null): string | null {
  const source = connection?.config?.sourceTemplateKey ?? connection?.transportConfig?.sourceTemplateKey;
  if (typeof source === "string" && source.trim()) return source.trim();
  if (!application) return null;
  const meta = application.metadata?.sourceTemplateKey ?? application.metadata?.galleryKey;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  const key = application.applicationKey ?? "";
  if (key.startsWith("app-gallery:")) {
    const slug = key.slice("app-gallery:".length).split(":")[0];
    return slug && slug !== "link" ? slug : null;
  }
  return null;
}

const NETWORK_ADDRESS = /^(https?:\/\/|[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$))/i;

function titleCase(identifier: string) {
  return identifier
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** A readable name for a connection or tool (the shared package's humanizeConnectionDisplayName, in brief). */
export function displayName(raw: string | null | undefined, title?: string | null) {
  if (title?.trim()) return title.trim();
  const name = raw?.trim();
  if (!name) return "Custom app";
  if (NETWORK_ADDRESS.test(name)) return "Custom app";
  if (name.includes(":") && !name.includes("://")) {
    const tool = name.slice(name.lastIndexOf(":") + 1).trim();
    if (tool) return titleCase(tool);
  }
  if (/\s/.test(name) || /[A-Z]/.test(name)) return name;
  if (/[._-]/.test(name)) return titleCase(name);
  return name;
}

/** "hosted at mcp.example.com" for a connection named by its address. */
export function hostedAt(connection: ToolConnection) {
  const config = { ...connection.transportConfig, ...connection.config };
  const url = config.url ?? config.endpoint ?? config.remoteUrl ?? config.serverUrl;
  if (typeof url !== "string") return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export type ConnectionStateKind = "connected" | "attention" | "paused" | "draft";
export type ConnectionState = { kind: ConnectionStateKind; label: string; tone: Tone | null; message: string | null };

const ATTENTION_HEALTH = new Set(["degraded", "failed", "error", "missing_secret"]);

function needsIsolatedLogin(connection: ToolConnection) {
  const ai = connection.config?.ai as { method?: unknown; provider?: unknown } | undefined;
  return (
    ai?.method === "subscription" &&
    (ai.provider === "openai" || ai.provider === "xai") &&
    connection.config?.aiIsolatedSubscription !== true
  );
}

/** Connected, Setup incomplete, Paused or Needs attention, as the old gallery reads it. */
export function connectionState(connection: ToolConnection): ConnectionState {
  if (connection.status === "draft") {
    return { kind: "draft", label: "Setup incomplete", tone: "amber", message: "Finish setup before agents can use it." };
  }
  if (connection.enabled === false || connection.status === "disabled") {
    return { kind: "paused", label: "Paused", tone: null, message: "Agents can't use it right now." };
  }
  const aiTrouble = connection.connectionPurpose === "ai" && (connection.healthStatus !== "ok" || needsIsolatedLogin(connection));
  if (aiTrouble || ATTENTION_HEALTH.has(connection.healthStatus) || connection.requiresReauthorization) {
    return {
      kind: "attention",
      label: "Needs attention",
      tone: "amber",
      message:
        connection.healthMessage ??
        connection.lastError ??
        (connection.authKind === "oauth" ? "Sign in again to restore access." : "Replace the credential to restore access."),
    };
  }
  return { kind: "connected", label: "Connected", tone: "green", message: null };
}

export type ConnectionGroup = "tools" | "ai" | "channels";

export function connectionGroup(connection: ToolConnection): ConnectionGroup {
  if (connection.connectionPurpose === "ai") return "ai";
  if (connection.connectionPurpose === "channel" || connection.transport === "chat_sdk" || connection.transport === "voice") return "channels";
  return "tools";
}

export type ConnectionRow = {
  connection: ToolConnection;
  application: ToolApplication | null;
  app: AppDefinition | null;
  name: string;
  state: ConnectionState;
};

/** Your connections, each with its app, sorted: needs you first, then by name. */
export function connectionRows(
  connections: readonly ToolConnection[],
  applications: readonly ToolApplication[],
  apps: readonly AppDefinition[],
): ConnectionRow[] {
  const appsBySlug = new Map(apps.map((app) => [app.slug, app]));
  const applicationsById = new Map(applications.map((application) => [application.id, application]));
  const rank: Record<ConnectionStateKind, number> = { attention: 0, draft: 1, connected: 2, paused: 3 };
  return connections
    .filter((connection) => connection.status !== "archived")
    .map((connection) => {
      const application = applicationsById.get(connection.applicationId) ?? null;
      const slug = connectionSlug(connection, application);
      const app = slug ? (appsBySlug.get(slug) ?? null) : null;
      return { connection, application, app, name: displayName(connection.name), state: connectionState(connection) };
    })
    .sort((a, b) => rank[a.state.kind] - rank[b.state.kind] || a.name.localeCompare(b.name));
}

/** How many of your connections came from each gallery app. */
export function connectionCounts(rows: readonly ConnectionRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.app) counts.set(row.app.slug, (counts.get(row.app.slug) ?? 0) + 1);
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Who may use a connection, and its actions

export type AccessDraft = { mode: "all" | "specific"; agentIds: Set<string> };
export type InstallState = { onAll: boolean; agentIds: Set<string> };
export type ActionPermission = "off" | "ask" | "allowed";

export function installState(installs: readonly ToolConnectionInstall[] | undefined): InstallState {
  const agentIds = new Set<string>();
  let onAll = false;
  for (const install of installs ?? []) {
    if (install.targetType === "company") onAll = true;
    else if (install.targetType === "agent") agentIds.add(install.targetId);
  }
  return { onAll, agentIds };
}

export function installTargets(companyId: string, state: InstallState): InstallTarget[] {
  if (state.onAll) return [{ targetType: "company", targetId: companyId }];
  return [...state.agentIds].map((targetId) => ({ targetType: "agent", targetId }));
}

/** The app's own profile (`app:<connectionId>`), which holds its actions and who may use it. */
export function appProfile(profiles: readonly ToolProfileWithDetails[], connectionId: string) {
  return profiles.find((profile) => profile.profileKey === `app:${connectionId}`);
}

export function enabledIds(profile: ToolProfileWithDetails | undefined) {
  const ids = new Set<string>();
  for (const entry of profile?.entries ?? []) if (entry.effect === "include" && entry.catalogEntryId) ids.add(entry.catalogEntryId);
  return ids;
}

/** The actions set to Ask first: the approval policies the app's setup wrote. */
export function askFirstIds(policies: readonly ToolPolicy[], connectionId: string) {
  const ids = new Set<string>();
  for (const policy of policies) {
    if (policy.policyType !== "require_approval" || policy.enabled === false) continue;
    const config = (policy.config ?? {}) as { source?: unknown; connectionId?: unknown; catalogEntryId?: unknown };
    if (config.source === "app_gallery_finish" && config.connectionId === connectionId && typeof config.catalogEntryId === "string") {
      ids.add(config.catalogEntryId);
    }
  }
  return ids;
}

/**
 * Who may use the connection, read from the app profile's bindings. Without bindings it mirrors the
 * installs: the old UI found that reading an unbound profile as "all agents" turned any save into a
 * silent company-wide grant.
 */
export function accessFrom(profile: ToolProfileWithDetails | undefined, install: InstallState): AccessDraft {
  const bindings = profile?.bindings ?? [];
  if (bindings.some((binding) => binding.targetType === "company")) return { mode: "all", agentIds: new Set() };
  const agentIds = new Set(bindings.filter((binding) => binding.targetType === "agent").map((binding) => binding.targetId));
  if (agentIds.size > 0) return { mode: "specific", agentIds };
  return install.onAll ? { mode: "all", agentIds: new Set() } : { mode: "specific", agentIds: new Set(install.agentIds) };
}

/** An agent that carries the tools on every run must be allowed to use them. */
export function accessWithInstalls(next: AccessDraft, install: InstallState): AccessDraft {
  if (install.onAll || next.mode === "all") return { mode: "all", agentIds: new Set() };
  return { mode: "specific", agentIds: new Set([...next.agentIds, ...install.agentIds]) };
}

export function accessSelection(access: AccessDraft): AccessSelection {
  return access.mode === "all" ? "all_agents" : { agentIds: [...access.agentIds] };
}

export function actionPermission(id: string, enabled: Set<string>, askFirst: Set<string>): ActionPermission {
  if (!enabled.has(id)) return "off";
  return askFirst.has(id) ? "ask" : "allowed";
}

/** Sets several actions at once: every save restates the whole set, so one change per group. */
export function withPermission(ids: readonly string[], next: ActionPermission, enabled: Set<string>, askFirst: Set<string>) {
  const nextEnabled = new Set(enabled);
  const nextAsk = new Set(askFirst);
  for (const id of ids) {
    if (next === "off") {
      nextEnabled.delete(id);
      nextAsk.delete(id);
    } else {
      nextEnabled.add(id);
      if (next === "ask") nextAsk.add(id);
      else nextAsk.delete(id);
    }
  }
  return { enabled: nextEnabled, askFirst: nextAsk };
}

/** Active actions split into read-only and the ones that make changes; new ones wait for review. */
export function splitCatalog(catalog: readonly ToolCatalogEntry[]) {
  const active = catalog.filter((entry) => entry.status === "active");
  return {
    active,
    readOnly: active.filter((entry) => entry.isReadOnly),
    changes: active.filter((entry) => !entry.isReadOnly),
    quarantined: catalog.filter((entry) => entry.status === "quarantined"),
  };
}

export function riskLabel(entry: Pick<ToolCatalogEntry, "isDestructive" | "isReadOnly" | "riskLevel">) {
  if (entry.isDestructive || entry.riskLevel === "destructive" || entry.riskLevel === "critical") return "Destructive";
  if (entry.isReadOnly || entry.riskLevel === "read") return "Read only";
  if (entry.riskLevel === "high") return "High risk";
  return "Makes changes";
}

// ---------------------------------------------------------------------------------------------
// Connecting

export type ConnectDraft = {
  name: string;
  link: string;
  /** Credential fields by key (`credentialValues`). */
  credentials: Record<string, string>;
  /** Tenant and extension fields by key (`configValues`). */
  config: Record<string, string | boolean>;
  oauthClientId: string;
  oauthClientSecret: string;
  access: AccessDraft;
};

export function visibleFields(fields: FieldDef[] | undefined) {
  return (fields ?? []).filter((field) => !field.hidden);
}

export function configFields(method: ConnectionMethodDef | null | undefined) {
  return visibleFields([...(method?.tenantFields ?? []), ...(method?.extensionFields ?? [])]);
}

export function newConnectDraft(app: AppDefinition | null, method: ConnectionMethodDef | null): ConnectDraft {
  const config: Record<string, string | boolean> = {};
  for (const field of [...(method?.tenantFields ?? []), ...(method?.extensionFields ?? [])]) {
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
  }
  return {
    name: app?.name ?? "",
    link: "",
    credentials: {},
    config,
    oauthClientId: "",
    oauthClientSecret: "",
    access: { mode: "all", agentIds: new Set() },
  };
}

function filled(value: unknown) {
  return typeof value === "boolean" || (typeof value === "string" && value.trim().length > 0);
}

function fieldProblem(field: FieldDef, value: unknown) {
  if (field.required && !filled(value)) return `${field.label} is required.`;
  const pattern = field.validation?.pattern;
  if (pattern && typeof value === "string" && value.trim() && !new RegExp(pattern).test(value.trim())) {
    return `${field.label} doesn't look right.`;
  }
  return null;
}

/** The first thing stopping Connect, or null. */
export function connectProblem(method: ConnectionMethodDef | null, draft: ConnectDraft): string | null {
  if (!method) return "Choose how to connect.";
  if (!draft.name.trim()) return "Give the connection a name.";
  if (needsLink(method)) {
    if (!draft.link.trim()) return "Paste the server address.";
    if (!/^https?:\/\//i.test(draft.link.trim())) return "The address should start with https://.";
  }
  for (const field of method.credentialFields ?? []) {
    const problem = fieldProblem(field, draft.credentials[field.key]);
    if (problem) return problem;
  }
  for (const field of configFields(method)) {
    const problem = fieldProblem(field, draft.config[field.key]);
    if (problem) return problem;
  }
  const oneOf = method.configRequirements?.atLeastOneOf ?? [];
  if (oneOf.length > 0 && !oneOf.some((key) => filled(draft.config[key]))) return "Fill in at least one of the options.";
  if (needsOwnOAuthClient(method)) {
    if (!draft.oauthClientId.trim()) return "Add your OAuth client ID.";
    if (method.oauthClientSecretRequired && !draft.oauthClientSecret.trim()) return "Add your OAuth client secret.";
  }
  return null;
}

/** `POST tools/apps/connect` for a gallery app. */
export function connectPayload(
  app: AppDefinition,
  method: ConnectionMethodDef,
  draft: ConnectDraft,
  options: { applicationId?: string; resumeConnectionId?: string } = {},
): ConnectToolApp {
  const credentials = Object.fromEntries(Object.entries(draft.credentials).filter(([, value]) => value.trim()));
  const config = Object.fromEntries(Object.entries(draft.config).filter(([, value]) => filled(value)));
  const clientId = draft.oauthClientId.trim();
  const secret = draft.oauthClientSecret.trim();
  return {
    galleryKey: app.slug,
    connectionMethodKey: method.key,
    name: draft.name.trim(),
    credentialSource: "paperclip_vault",
    ...(needsLink(method) ? { link: draft.link.trim() } : {}),
    ...(Object.keys(credentials).length > 0 ? { credentialValues: credentials } : {}),
    ...(Object.keys(config).length > 0 ? { configValues: config } : {}),
    ...(acceptsOwnOAuthClient(method) && clientId ? { oauthClient: { clientId, ...(secret ? { clientSecret: secret } : {}) } } : {}),
    ...(options.applicationId ? { applicationId: options.applicationId } : {}),
    ...(options.resumeConnectionId ? { resumeConnectionId: options.resumeConnectionId } : {}),
  } as ConnectToolApp;
}

/** Every discovered action on; the risky ones the server suggests ask first. */
export function finishDefaults(result: Pick<ConnectToolAppResult, "actions" | "suggestedDefaults">) {
  const enabled = [...result.actions.readOnly, ...result.actions.canMakeChanges].map((action) => action.catalogEntryId);
  const levels = result.suggestedDefaults?.askFirstRiskLevels;
  const ask = new Set(Array.isArray(levels) ? levels.filter((level): level is string => typeof level === "string") : []);
  const askFirst = result.actions.canMakeChanges.filter((action) => ask.has(action.riskLevel)).map((action) => action.catalogEntryId);
  return { enabled, askFirst };
}

/** The installs that go with a new connection's access: every agent, or the chosen ones. */
export function accessInstalls(companyId: string, access: AccessDraft): InstallTarget[] {
  return installTargets(companyId, access.mode === "all" ? { onAll: true, agentIds: new Set() } : { onAll: false, agentIds: access.agentIds });
}

// Your own MCP server ("bring your own"), as ui/src/pages/apps/generic-mcp-connect.ts builds it.

export type ByoAuth = "auto" | "none" | "bearer" | "custom_headers" | "oauth";
export type HeaderRow = { name: string; value: string };

export type ByoDraft = {
  link: string;
  name: string;
  auth: ByoAuth;
  key: string;
  headers: HeaderRow[];
  oauthClientId: string;
  oauthClientSecret: string;
  access: AccessDraft;
};

export function newByoDraft(): ByoDraft {
  return {
    link: "",
    name: "",
    auth: "auto",
    key: "",
    headers: [{ name: "", value: "" }],
    oauthClientId: "",
    oauthClientSecret: "",
    access: { mode: "all", agentIds: new Set() },
  };
}

/** "mcp.example.com/mcp": host and path, never the query (it can carry a token). */
export function defaultServerName(link: string) {
  try {
    const url = new URL(link);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.host.replace(/^www\./, "")}${path}`.slice(0, 160) || null;
  } catch {
    return null;
  }
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export function byoProblem(draft: ByoDraft): string | null {
  const link = draft.link.trim();
  if (!link) return "Paste the server address.";
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "The address should start with https://.";
  } catch {
    return "That doesn't look like a server address. Paste the full address, starting with https://.";
  }
  if (draft.auth === "bearer" && !draft.key.trim()) return "Add the key.";
  if (draft.auth === "custom_headers") {
    const rows = draft.headers.filter((row) => row.name.trim() || row.value.trim());
    if (rows.length === 0) return "Add at least one header.";
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!HEADER_NAME.test(name)) return `"${name || "(blank)"}" isn't a valid header name.`;
      if (!row.value.trim()) return `Add a value for "${name}", or remove the row.`;
      if (seen.has(name.toLowerCase())) return `"${name}" is listed twice.`;
      seen.add(name.toLowerCase());
    }
  }
  return null;
}

/** `POST tools/apps/connect` for a pasted address. Header values go in as credentials, never config. */
export function byoPayload(draft: ByoDraft): ConnectToolApp {
  const credentials: Record<string, string> = {};
  if (draft.auth === "bearer" && draft.key.trim()) credentials["credentials.authorization"] = draft.key.trim();
  if (draft.auth === "custom_headers") {
    for (const row of draft.headers) if (row.name.trim() && row.value.trim()) credentials[`headers.${row.name.trim()}`] = row.value;
  }
  const name = draft.name.trim() || defaultServerName(draft.link.trim()) || "Custom app";
  const clientId = draft.oauthClientId.trim();
  const secret = draft.oauthClientSecret.trim();
  return {
    link: draft.link.trim(),
    name,
    ...(draft.auth === "auto" ? {} : { authMode: draft.auth }),
    ...(Object.keys(credentials).length > 0 ? { credentialValues: credentials } : {}),
    ...(draft.auth === "oauth" && clientId ? { oauthClient: { clientId, ...(secret ? { clientSecret: secret } : {}) } } : {}),
  } as ConnectToolApp;
}

/** Plain advice for a failed connect, by the server's error code. */
export function connectFailure(code: string | null | undefined, message: string | null | undefined): string {
  switch (code) {
    case "mcp_remote_url_missing":
    case "mcp_remote_url_invalid":
      return "That doesn't look like a server address. Paste the full address, starting with https://.";
    case "remote_http_private_endpoint":
      return "That address is inside a private network, which this Paperclip won't call. Use the server's public address.";
    case "remote_http_dns_failed":
      return "We couldn't find that host. Check the spelling, or confirm the server is published on the internet.";
    case "oauth_challenge":
      return "The server wants a credential it can't get by itself. Add its key or headers.";
    case "oauth_manual_client_required":
    case "oauth_manual_client_rebinding_required":
      return "This server needs an OAuth client you register yourself. Choose \"Sign in with your OAuth app\" and add its client ID and secret.";
    case "oauth_redirect_origin_unsupported":
    case "oauth_redirect_uri_invalid":
      return "Sign-in needs this Paperclip to have a public HTTPS address. Ask your Paperclip admin to set it up.";
    case "runtime_error":
      return "Nothing answered at that address. Check the server is running and the address is right.";
    default:
      return message?.trim() || "Paperclip couldn't connect. Check the details and try again.";
  }
}

/** The `details.code` an API error carries, when it has one. */
export function errorCode(error: unknown): string | null {
  const body = (error as { body?: unknown } | null)?.body;
  if (!body || typeof body !== "object") return null;
  const details = (body as { details?: unknown }).details;
  const code = details && typeof details === "object" ? (details as { code?: unknown }).code : (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

// ---------------------------------------------------------------------------------------------
// Review

export function requestTitle(item: ToolActionRequestListItem) {
  if (!item.toolTitle && !item.toolName) return "This action";
  return displayName(item.toolName, item.toolTitle);
}

/** Always allow makes a trust rule for an agent's action on a connection; approvals can't. */
export function canAlwaysAllow(item: ToolActionRequestListItem) {
  return Boolean(item.requestedByAgentId && item.connectionId && !item.request.approvalId);
}
