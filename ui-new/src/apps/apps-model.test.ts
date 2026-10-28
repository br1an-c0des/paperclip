import type {
  AppDefinition,
  ConnectionMethodDef,
  ToolActionRequestListItem,
  ToolApplication,
  ToolConnection,
  ToolPolicy,
  ToolProfileWithDetails,
} from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  accessFrom,
  accessInstalls,
  accessWithInstalls,
  actionPermission,
  appsView,
  askFirstIds,
  byoPayload,
  byoProblem,
  canAlwaysAllow,
  categoriesIn,
  connectFailure,
  connectionRows,
  connectionState,
  connectPayload,
  connectProblem,
  defaultServerName,
  displayName,
  enabledIds,
  errorCode,
  finishDefaults,
  galleryApps,
  installState,
  matchesApp,
  needsLink,
  needsOwnOAuthClient,
  newByoDraft,
  newConnectDraft,
  recommendedMethod,
  supportsAutomaticOAuth,
  toolMethods,
  withPermission,
} from "./apps-model";

const method = (extra: Partial<ConnectionMethodDef>): ConnectionMethodDef => ({
  key: "mcp",
  transport: "mcp_remote",
  auth: "none",
  ownershipModes: ["customer"],
  whenToUse: "",
  guidanceMd: "",
  riskTier: "S1",
  defaults: { serverUrl: "https://mcp.example.com/mcp" },
  ...extra,
});

const app = (extra: Partial<AppDefinition>): AppDefinition => ({
  schemaVersion: 1,
  slug: "example",
  name: "Example",
  description: "Does things",
  categories: ["developer"],
  branding: { logoUrl: "/brands/apps/example.svg" },
  urlPatterns: [],
  methods: [method({})],
  ...extra,
});

const connection = (extra: Partial<ToolConnection>): ToolConnection =>
  ({
    id: "c1",
    companyId: "co",
    applicationId: "a1",
    name: "Example",
    connectionPurpose: "tool",
    transport: "mcp_remote",
    authKind: "none",
    status: "active",
    enabled: true,
    healthStatus: "ok",
    lastError: null,
    config: {},
    transportConfig: {},
    credentialPolicy: "shared",
    ...extra,
  }) as ToolConnection;

describe("appsView", () => {
  it("routes the old UI's addresses", () => {
    expect(appsView("")).toEqual({ section: "browse" });
    expect(appsView("browse")).toEqual({ section: "redirect", to: "" });
    expect(appsView("ai")).toEqual({ section: "ai" });
    expect(appsView("review")).toEqual({ section: "review" });
    expect(appsView("byo")).toEqual({ section: "byo" });
    expect(appsView("connect")).toEqual({ section: "connect" });
    expect(appsView("connect/linear/key")).toEqual({ section: "redirect", to: "connect?source=linear" });
    expect(appsView("app/a1/permissions")).toEqual({ section: "application", applicationId: "a1" });
    expect(appsView("c1")).toEqual({ section: "redirect", to: "c1/permissions" });
    expect(appsView("c1/setup")).toEqual({ section: "redirect", to: "c1/permissions" });
    expect(appsView("c1/activity")).toEqual({ section: "redirect", to: "/activity" });
    expect(appsView("c1/review")).toEqual({ section: "detail", connectionId: "c1", tab: "review" });
    expect(appsView("gateways/g1/tokens")).toEqual({ section: "later", name: "Gateways" });
    expect(appsView("advanced/profiles")).toEqual({ section: "later", name: "Advanced" });
  });
});

describe("gallery", () => {
  it("keeps tool apps it can set up, featured first", () => {
    const apps = [
      app({ slug: "zeta", name: "Zeta" }),
      app({ slug: "alpha", name: "Alpha" }),
      app({ slug: "star", name: "Star", featured: true }),
      app({ slug: "anthropic", name: "Anthropic", methods: [method({ purpose: "ai", transport: "runtime_auth", auth: "api_key" })] }),
      app({ slug: "slack-chat", name: "Chat", methods: [method({ purpose: "channel", transport: "chat_sdk" })] }),
      app({ slug: "composio", name: "Composio" }),
      app({ slug: "memory", name: "Memory", experimentalFeatureKey: "enableMemoryConnectors" as AppDefinition["experimentalFeatureKey"] }),
    ];
    // Composio, Arcade, Google Workspace and AgentMail have their setups since M6 round 3.
    expect(galleryApps(apps, {}).map((entry) => entry.slug)).toEqual(["star", "alpha", "composio", "zeta"]);
    expect(galleryApps(apps, { enableMemoryConnectors: true }).map((entry) => entry.slug)).toContain("memory");
  });

  it("filters by words and category", () => {
    const entry = app({ name: "Linear", description: "Issues", categories: ["productivity"], tags: ["tickets"] });
    expect(matchesApp(entry, "ticket", null)).toBe(true);
    expect(matchesApp(entry, "", "developer")).toBe(false);
    expect(matchesApp(entry, "productivity", null)).toBe(true);
    expect(categoriesIn([entry, app({ categories: ["data", "ai"] })])).toEqual(["ai", "data", "productivity"]);
  });

  it("picks methods as the shared package does", () => {
    const oauth = method({ key: "oauth", auth: "oauth", ownershipModes: ["dcr", "customer"] });
    const key = method({ key: "key", auth: "api_key" });
    const write = method({ key: "write", capabilityProfile: { key: "write", label: "Write" } });
    expect(recommendedMethod([oauth, key])?.key).toBe("oauth");
    expect(recommendedMethod([oauth, write])?.key).toBe("write");
    expect(supportsAutomaticOAuth(oauth)).toBe(true);
    expect(needsOwnOAuthClient(method({ auth: "oauth", ownershipModes: ["customer"] }))).toBe(true);
    expect(needsOwnOAuthClient(oauth)).toBe(false);
    expect(needsLink(method({ defaults: {} }))).toBe(true);
    expect(toolMethods(app({ methods: [key, method({ purpose: "ai" })], ownershipAvailability: { customer: true } })).map((m) => m.key)).toEqual(["key"]);
  });
});

describe("connections", () => {
  it("reads a connection's state", () => {
    expect(connectionState(connection({})).kind).toBe("connected");
    expect(connectionState(connection({ status: "draft" })).label).toBe("Setup incomplete");
    expect(connectionState(connection({ enabled: false })).kind).toBe("paused");
    expect(connectionState(connection({ healthStatus: "missing_secret", authKind: "api_key" })).message).toBe("Replace the credential to restore access.");
    expect(connectionState(connection({ connectionPurpose: "ai", healthStatus: "unknown" })).kind).toBe("attention");
  });

  it("names connections and finds their app", () => {
    expect(displayName("https://mcp.example.com/mcp")).toBe("Custom app");
    expect(displayName("query-docs")).toBe("Query Docs");
    expect(displayName("vendor:update_note")).toBe("Update Note");
    expect(displayName("x", "A title")).toBe("A title");
    const rows = connectionRows(
      [
        connection({ id: "1", name: "B", config: { sourceTemplateKey: "example" } }),
        connection({ id: "2", name: "A", applicationId: "a2", healthStatus: "error" }),
        connection({ id: "3", status: "archived" }),
      ],
      [{ id: "a2", applicationKey: "app-gallery:example", metadata: null } as ToolApplication],
      [app({})],
    );
    expect(rows.map((row) => row.connection.id)).toEqual(["2", "1"]);
    expect(rows.every((row) => row.app?.slug === "example")).toBe(true);
  });
});

describe("permissions", () => {
  const profile = {
    profileKey: "app:c1",
    entries: [
      { effect: "include", catalogEntryId: "e1" },
      { effect: "include", catalogEntryId: "e2" },
      { effect: "exclude", catalogEntryId: "e3" },
    ],
    bindings: [{ targetType: "agent", targetId: "ag1" }],
  } as unknown as ToolProfileWithDetails;
  const policies = [
    { policyType: "require_approval", enabled: true, config: { source: "app_gallery_finish", connectionId: "c1", catalogEntryId: "e2" } },
    { policyType: "require_approval", enabled: true, config: { source: "app_gallery_finish", connectionId: "c2", catalogEntryId: "e1" } },
  ] as unknown as ToolPolicy[];

  it("reads actions and who may use them", () => {
    const on = enabledIds(profile);
    const ask = askFirstIds(policies, "c1");
    expect([...on]).toEqual(["e1", "e2"]);
    expect([...ask]).toEqual(["e2"]);
    expect(actionPermission("e1", on, ask)).toBe("allowed");
    expect(actionPermission("e2", on, ask)).toBe("ask");
    expect(actionPermission("e3", on, ask)).toBe("off");
    const next = withPermission(["e1", "e3"], "ask", on, ask);
    expect([...next.enabled].sort()).toEqual(["e1", "e2", "e3"]);
    expect([...next.askFirst].sort()).toEqual(["e1", "e2", "e3"]);
    expect([...withPermission(["e2"], "off", on, ask).askFirst]).toEqual([]);
  });

  it("never reads an unbound profile as every agent", () => {
    const install = installState([{ targetType: "agent", targetId: "ag2" }] as never);
    expect(accessFrom(profile, install)).toEqual({ mode: "specific", agentIds: new Set(["ag1"]) });
    expect(accessFrom(undefined, install)).toEqual({ mode: "specific", agentIds: new Set(["ag2"]) });
    expect(accessFrom(undefined, installState([{ targetType: "company", targetId: "co" }] as never)).mode).toBe("all");
    expect(accessWithInstalls({ mode: "specific", agentIds: new Set(["ag1"]) }, install).agentIds).toEqual(new Set(["ag1", "ag2"]));
    expect(accessInstalls("co", { mode: "all", agentIds: new Set() })).toEqual([{ targetType: "company", targetId: "co" }]);
    expect(accessInstalls("co", { mode: "specific", agentIds: new Set() })).toEqual([]);
  });
});

describe("connecting", () => {
  const vercel = method({
    key: "rest-api-key",
    transport: "rest_api",
    auth: "api_key",
    credentialFields: [{ key: "authorization", label: "Token", type: "password", required: true }],
    tenantFields: [{ key: "teamId", label: "Team ID", type: "text", required: true, validation: { pattern: "^team_[A-Za-z0-9]+$" } }],
  });

  it("checks the form and builds the request", () => {
    const entry = app({ slug: "vercel", name: "Vercel", methods: [vercel] });
    const draft = newConnectDraft(entry, vercel);
    expect(connectProblem(vercel, draft)).toBe("Token is required.");
    draft.credentials.authorization = "tok";
    draft.config.teamId = "nope";
    expect(connectProblem(vercel, draft)).toBe("Team ID doesn't look right.");
    draft.config.teamId = "team_abc";
    expect(connectProblem(vercel, draft)).toBeNull();
    expect(connectPayload(entry, vercel, draft, { resumeConnectionId: "c9" })).toEqual({
      galleryKey: "vercel",
      connectionMethodKey: "rest-api-key",
      name: "Vercel",
      credentialSource: "paperclip_vault",
      credentialValues: { authorization: "tok" },
      configValues: { teamId: "team_abc" },
      resumeConnectionId: "c9",
    });
  });

  it("asks for your own OAuth client only where it's needed", () => {
    const own = method({ auth: "oauth", ownershipModes: ["customer"], oauthClientSecretRequired: true });
    const draft = newConnectDraft(app({}), own);
    expect(connectProblem(own, draft)).toBe("Add your OAuth client ID.");
    draft.oauthClientId = "id";
    expect(connectProblem(own, draft)).toBe("Add your OAuth client secret.");
  });

  it("turns everything on and asks first for the risky ones", () => {
    const result = {
      actions: {
        readOnly: [{ catalogEntryId: "r1", riskLevel: "read" }],
        canMakeChanges: [
          { catalogEntryId: "w1", riskLevel: "write" },
          { catalogEntryId: "d1", riskLevel: "destructive" },
        ],
      },
      suggestedDefaults: { askFirstRiskLevels: ["destructive"] },
    } as never;
    expect(finishDefaults(result)).toEqual({ enabled: ["r1", "w1", "d1"], askFirst: ["d1"] });
  });

  it("builds your own server's request", () => {
    const draft = newByoDraft();
    expect(byoProblem(draft)).toBe("Paste the server address.");
    draft.link = "ftp://x";
    expect(byoProblem(draft)).toBe("The address should start with https://.");
    draft.link = "https://www.mcp.example.com/mcp/?token=secret";
    draft.auth = "custom_headers";
    draft.headers = [{ name: "X-Key", value: "v" }, { name: "x-key", value: "w" }];
    expect(byoProblem(draft)).toBe('"x-key" is listed twice.');
    draft.headers = [{ name: "X-Key", value: "v" }];
    expect(byoProblem(draft)).toBeNull();
    expect(defaultServerName(draft.link)).toBe("mcp.example.com/mcp");
    expect(byoPayload(draft)).toEqual({
      link: draft.link,
      name: "mcp.example.com/mcp",
      authMode: "custom_headers",
      credentialValues: { "headers.X-Key": "v" },
    });
    draft.auth = "auto";
    expect(byoPayload(draft)).not.toHaveProperty("authMode");
  });

  it("explains failures by code", () => {
    const error = { body: { details: { code: "remote_http_private_endpoint" } } };
    expect(errorCode(error)).toBe("remote_http_private_endpoint");
    expect(connectFailure(errorCode(error), "x")).toContain("private network");
    expect(connectFailure(null, "Server said no")).toBe("Server said no");
  });
});

describe("review", () => {
  it("offers Always allow for an agent's call on a connection", () => {
    const item = {
      request: { approvalId: null },
      requestedByAgentId: "ag1",
      connectionId: "c1",
      toolName: "create_issue",
      toolTitle: null,
    } as unknown as ToolActionRequestListItem;
    expect(canAlwaysAllow(item)).toBe(true);
    expect(canAlwaysAllow({ ...item, request: { approvalId: "ap" } } as never)).toBe(false);
  });
});
