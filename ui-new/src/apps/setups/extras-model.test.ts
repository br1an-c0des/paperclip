import type { ConnectionMethodDef, ToolConnection } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  defaultInstructions,
  honchoConfig,
  honchoWorkspace,
  instructionsChanged,
  instructionsConfigured,
  instructionsProblem,
  isHoncho,
  isSheetsRobotConnection,
  isSheetsRobotMethod,
  parseSheetLinks,
  resetInstructions,
  sameInstructions,
  savedInstructions,
  sheetIds,
  sheetsConfig,
  sheetsProblem,
  vercelIdentityKinds,
} from "./extras-model";

const template = { id: "honcho.usage", version: 1, text: "Use Honcho to recall context." };

describe("agent instructions", () => {
  it("reaches agents only once the method's required public fields are filled", () => {
    const methods = [
      {
        key: "cloud",
        tenantFields: [
          { key: "workspaceId", label: "Workspace", type: "text", required: true },
          { key: "token", label: "Token", type: "password", required: true },
        ],
      },
      { key: "local", tenantFields: [] },
    ] as unknown as ConnectionMethodDef[];
    const connection = (config: Record<string, unknown>) => ({ config, transportConfig: null }) as unknown as ToolConnection;
    expect(instructionsConfigured({ methods }, connection({ connectionMethodKey: "cloud", methodConfig: {} }))).toBe(false);
    expect(instructionsConfigured({ methods }, connection({ connectionMethodKey: "cloud", methodConfig: { workspaceId: " w1 " } }))).toBe(true);
    // The first method when none is named; secrets never count.
    expect(instructionsConfigured({ methods }, connection({ methodConfig: { workspaceId: "w1" } }))).toBe(true);
    expect(instructionsConfigured({ methods }, connection({ connectionMethodKey: "local" }))).toBe(true);
    expect(instructionsConfigured(null, connection({}))).toBe(true);
  });

  it("starts a new connection with the app's instruction, on", () => {
    expect(defaultInstructions(template)).toEqual({ enabled: true, text: template.text, template: { id: "honcho.usage", version: 1 } });
    expect(defaultInstructions(undefined)).toBeNull();
  });

  it("reads a connection saved without instructions as the default, turned off", () => {
    expect(savedInstructions({ agentInstructions: null }, template)).toMatchObject({ enabled: false, text: template.text });
    const saved = { enabled: true, text: "Custom", template: { id: "honcho.usage", version: 1 } };
    expect(savedInstructions({ agentInstructions: saved }, template)).toBe(saved);
    expect(savedInstructions({ agentInstructions: null }, null)).toBeNull();
  });

  it("notices edits and an older template version, and resets keeping on or off", () => {
    const value = defaultInstructions(template)!;
    expect(instructionsChanged(value, template)).toBe(false);
    expect(instructionsChanged({ ...value, text: "Edited" }, template)).toBe(true);
    expect(instructionsChanged({ ...value, template: { id: "honcho.usage", version: 0 } }, template)).toBe(true);
    expect(resetInstructions({ ...value, enabled: false, text: "Edited" }, template)).toEqual({ ...value, enabled: false });
  });

  it("holds back empty or overlong text", () => {
    expect(instructionsProblem(null)).toBeNull();
    expect(instructionsProblem({ enabled: true, text: "  " })).toMatch(/Write/);
    expect(instructionsProblem({ enabled: true, text: "x".repeat(2001) })).toMatch(/2000/);
    expect(instructionsProblem({ enabled: false, text: "ok" })).toBeNull();
  });

  it("compares instructions by value", () => {
    const a = defaultInstructions(template)!;
    expect(sameInstructions(a, { ...a, template: { ...a.template! } })).toBe(true);
    expect(sameInstructions(a, { ...a, enabled: false })).toBe(false);
    expect(sameInstructions(null, undefined)).toBe(true);
  });
});

describe("Honcho", () => {
  const connection = {
    config: { sourceTemplateKey: "honcho", methodConfig: { workspaceId: "old", other: 1 } },
    transportConfig: { url: "https://mcp.honcho.dev" },
  } as unknown as ToolConnection;

  it("reads and replaces the workspace, keeping the rest of the config", () => {
    expect(isHoncho(connection)).toBe(true);
    expect(honchoWorkspace(connection)).toBe("old");
    expect(honchoConfig(connection, " new ")).toEqual({
      url: "https://mcp.honcho.dev",
      sourceTemplateKey: "honcho",
      methodConfig: { workspaceId: "new", other: 1 },
    });
  });

  it("finds the workspace in transportConfig on older connections", () => {
    const older = { config: {}, transportConfig: { sourceTemplateKey: "honcho", methodConfig: { workspaceId: "w" } } } as unknown as ToolConnection;
    expect(isHoncho(older)).toBe(true);
    expect(honchoWorkspace(older)).toBe("w");
    expect(honchoWorkspace({ config: {}, transportConfig: {} } as unknown as ToolConnection)).toBe("");
  });
});

describe("Google Sheets robot account", () => {
  it("knows the robot method", () => {
    expect(isSheetsRobotMethod({ slug: "google-sheets" }, { key: "local" })).toBe(true);
    expect(isSheetsRobotMethod({ slug: "google-sheets" }, "paperclip-read")).toBe(false);
    expect(isSheetsRobotMethod({ slug: "notion" }, "local")).toBe(false);
  });

  it("takes sheet ids from pasted links, deduplicated, and counts what isn't a link", () => {
    const links = [
      "https://docs.google.com/spreadsheets/d/abc123/edit",
      "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0,",
      "https://docs.google.com/spreadsheets/d/xyz%2D9/edit).",
      "not-a-link",
      "https://example.com/other",
    ].join("\n");
    expect(parseSheetLinks(links)).toEqual({ ids: ["abc123", "xyz-9"], invalidCount: 2 });
  });

  it("holds back Connect without the robot, a link, or with a bad one", () => {
    expect(sheetsProblem("https://docs.google.com/spreadsheets/d/a/edit", null)).toMatch(/robot/);
    expect(sheetsProblem("", "robot@x.iam.gserviceaccount.com")).toMatch(/at least one/);
    expect(sheetsProblem("nope", "robot@x")).toMatch(/doesn't look/);
    expect(sheetsProblem("https://docs.google.com/spreadsheets/d/a/edit", "robot@x")).toBeNull();
  });

  it("replaces the sheets list and its env variable, keeping the rest", () => {
    expect(sheetsConfig({ sourceTemplateKey: "google-sheets", env: { OTHER: "1" }, allowedSpreadsheetIds: ["a"] }, ["a", "b"])).toEqual({
      sourceTemplateKey: "google-sheets",
      allowedSpreadsheetIds: ["a", "b"],
      env: { OTHER: "1", GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS: "a,b" },
    });
    const connection = { config: { sourceTemplateKey: "google-sheets", connectionMethodKey: "local", allowedSpreadsheetIds: ["a", " ", "b"] } } as unknown as ToolConnection;
    expect(sheetIds(connection)).toEqual(["a", "b"]);
    expect(isSheetsRobotConnection(connection)).toBe(true);
    expect(isSheetsRobotConnection({ config: { sourceTemplateKey: "google-sheets", connectionMethodKey: "paperclip-read" } } as unknown as ToolConnection)).toBe(false);
  });
});

describe("the robot account in the gallery", () => {
  it("offers Google Sheets' robot method beside its remote ones, but no other local command", async () => {
    const { toolMethods, canSetUp } = await import("../apps-model");
    const base = { schemaVersion: 1, name: "X", description: "", categories: ["data"], branding: { logoUrl: "" }, urlPatterns: [] } as const;
    const local = { key: "local", transport: "local_stdio", auth: "none", ownershipModes: ["customer"], whenToUse: "", guidanceMd: "", riskTier: "S3" } as const;
    const remote = { ...local, key: "remote", transport: "mcp_remote", auth: "api_key" } as const;
    const sheets = { ...base, slug: "google-sheets", methods: [remote, local] } as never;
    const other = { ...base, slug: "other", methods: [remote, local] } as never;
    expect(toolMethods(sheets).map((method) => method.key)).toEqual(["remote", "local"]);
    expect(toolMethods(sheets).every(canSetUp)).toBe(true);
    expect(toolMethods(other).map((method) => method.key)).toEqual(["remote"]);
  });
});

describe("whose account, through Vercel", () => {
  const method = (auth: ConnectionMethodDef["auth"], grantKinds?: ConnectionMethodDef["grantKinds"]) =>
    ({ key: "m", auth, transport: "mcp_remote", ownershipModes: ["customer"], whenToUse: "", guidanceMd: "", riskTier: "S2", grantKinds }) as ConnectionMethodDef;

  it("offers the method's choices for OAuth, the organization only for a key", () => {
    expect(vercelIdentityKinds(method("oauth", ["organization", "user", "agent"]), undefined)).toEqual(["organization", "user", "agent"]);
    expect(vercelIdentityKinds(method("api_key", ["organization", "user"]), undefined)).toEqual(["organization"]);
  });

  it("offers nothing when the organization identity isn't yours to make, for a key", () => {
    expect(vercelIdentityKinds(method("api_key"), { canCreateOrganizationGrant: false } as never)).toEqual([]);
    expect(vercelIdentityKinds(method("oauth"), { canCreateOrganizationGrant: false } as never)).toEqual(["user"]);
  });
});
