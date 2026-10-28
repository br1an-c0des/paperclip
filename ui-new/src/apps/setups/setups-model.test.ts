import type { ConnectionMethodDef, ConnectToolApp, ToolConnection } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  accountStatus,
  aggregatorOf,
  gatewayPayload,
  gatewayProblem,
  identityKinds,
  identityProblem,
  managementUrl,
  newGatewayDraft,
  toolkitSlug,
  withIdentity,
  withService,
  workspaceProblem,
} from "./setups-model";

const method = (fields: Partial<ConnectionMethodDef>) => ({ key: "mcp", auth: "oauth", ...fields }) as ConnectionMethodDef;
const payload = { galleryKey: "notion", connectionMethodKey: "mcp" } as ConnectToolApp;

describe("whose account a connection is", () => {
  it("offers the organization and you by default, the method's own kinds otherwise", () => {
    expect(identityKinds(method({}), { canCreateOrganizationGrant: true } as never)).toEqual(["organization", "user"]);
    expect(identityKinds(method({ grantKinds: ["user", "agent"] } as never), undefined)).toEqual(["user", "agent"]);
  });

  it("leaves out the organization when you can't create it, and everything for a keyless server", () => {
    expect(identityKinds(method({}), { canCreateOrganizationGrant: false } as never)).toEqual(["user"]);
    expect(identityKinds(method({ auth: "none" } as never), undefined)).toEqual([]);
    expect(identityKinds(null, undefined)).toEqual([]);
  });

  it("adds the identity to the request; the organization is the server's default", () => {
    expect(withIdentity(payload, { kind: "organization", agentId: null })).toEqual(payload);
    expect(withIdentity(payload, { kind: "user", agentId: null })).toEqual({ ...payload, grantKind: "user" });
    expect(withIdentity(payload, { kind: "agent", agentId: "a1" })).toEqual({ ...payload, grantKind: "agent", subjectAgentId: "a1" });
    expect(identityProblem({ kind: "agent", agentId: null })).toMatch(/Choose the agent/);
  });
});

describe("Google Workspace services", () => {
  it("adds, changes and removes a service, and wants at least one", () => {
    let selection = withService({}, "gmail", "read");
    selection = withService(selection, "drive", "write");
    expect(selection).toEqual({ gmail: "read", drive: "write" });
    selection = withService(selection, "gmail", null);
    expect(selection).toEqual({ drive: "write" });
    expect(workspaceProblem(selection)).toBeNull();
    expect(workspaceProblem({})).toMatch(/at least one/);
  });
});

describe("aggregator gateways", () => {
  it("starts Composio at its default address and Arcade empty", () => {
    expect(newGatewayDraft("composio").url).toBe("https://connect.composio.dev/mcp");
    expect(gatewayProblem(newGatewayDraft("arcade"))).toMatch(/full MCP address/);
    expect(gatewayProblem(newGatewayDraft("composio"))).toBeNull();
  });

  it("checks the token and headers each sign-in needs", () => {
    const draft = { ...newGatewayDraft("arcade"), url: "https://api.arcade.dev/mcp/gw" };
    expect(gatewayProblem({ ...draft, auth: "bearer" })).toBe("Paste the token.");
    expect(gatewayProblem({ ...draft, auth: "custom_headers" })).toBe("Add at least one header.");
    expect(gatewayProblem({ ...draft, auth: "custom_headers", headers: [{ name: "X", value: "" }] })).toMatch(/name and a value/);
    expect(gatewayProblem({ ...draft, auth: "bearer", token: "t", headers: [{ name: "Arcade-User-ID", value: "me" }] })).toBeNull();
  });

  it("sends the address, sign-in and secrets", () => {
    const draft = { url: " https://api.arcade.dev/mcp/gw ", auth: "bearer" as const, token: " key ", headers: [{ name: "Arcade-User-ID", value: "me" }] };
    expect(gatewayPayload("arcade", method({ key: "remote" }), draft)).toEqual({
      galleryKey: "arcade",
      connectionMethodKey: "remote",
      name: "Arcade",
      link: "https://api.arcade.dev/mcp/gw",
      authMode: "bearer",
      credentialValues: { "credentials.authorization": "key", "headers.Arcade-User-ID": "me" },
    });
    expect(gatewayPayload("composio", null, newGatewayDraft("composio"))).not.toHaveProperty("credentialValues");
  });

  it("recognises a gateway connection by the app it came from", () => {
    const connection = (source: string, transport = "mcp_remote") => ({ transport, config: { sourceTemplateKey: source }, transportConfig: {} }) as unknown as ToolConnection;
    expect(aggregatorOf(connection("composio"))).toBe("composio");
    expect(aggregatorOf(connection("notion"))).toBeNull();
    expect(aggregatorOf(connection("arcade", "stdio"))).toBeNull();
  });

  it("links only to the provider's own dashboard, never an address carrying a secret", () => {
    expect(managementUrl("composio")).toBe("https://dashboard.composio.dev/~/org/connect/apps");
    expect(managementUrl("composio", "https://dashboard.composio.dev/x")).toBe("https://dashboard.composio.dev/x");
    expect(managementUrl("composio", "https://evil.test/x")).toBeNull();
    expect(managementUrl("arcade", "https://app.arcade.dev/?api_key=1")).toBeNull();
  });

  it("reads an account's freshness", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    const fresh = { freshness: "fresh", errorAt: null, checkedAt: "2026-10-28T11:59:00Z" } as never;
    expect(accountStatus(fresh, { status: "ACTIVE" }, now).label).toBe("Connected");
    expect(accountStatus(fresh, { status: "INITIATED" }, now).label).toBe("Waiting for sign-in");
    expect(accountStatus({ ...(fresh as object), checkedAt: "2026-10-28T10:00:00Z" } as never, { status: "ACTIVE" }, now).label).toBe("Not verified");
  });

  it("turns a typed app name into Composio's slug", () => {
    expect(toolkitSlug(" Google Sheets ")).toBe("googlesheets");
  });
});
