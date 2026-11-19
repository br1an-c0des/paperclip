import type { McpConnection } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { actAsChoices, ASSISTANTS, assistantRows, connectionAccessLine, connectionAccessOf, connectionAccessPatch, invitation, setupSteps, setupUrl } from "./assistant-model";

const SERVER = "https://paperclip.example.com/mcp";

describe("assistant setup", () => {
  it("invites an assistant to this organization's setup page", () => {
    expect(setupUrl(SERVER, "co-1")).toBe("https://paperclip.example.com/mcp/setup?company=co-1");
    expect(invitation(SERVER, { id: "co-1", name: "Acme" })).toBe(
      "Connect to my Acme Paperclip organization using the instructions at https://paperclip.example.com/mcp/setup?company=co-1. Start authorization, give me the approval link, and verify the connection after I approve.",
    );
  });

  it("gives every assistant steps, quoting the address for shells", () => {
    for (const assistant of ASSISTANTS) expect(setupSteps(SERVER, assistant).length).toBeGreaterThan(0);
    expect(setupSteps("https://x/it's", "codex")[0]!.code).toBe(`codex mcp add paperclip --url 'https://x/it'"'"'s'`);
    expect(JSON.parse(setupSteps(SERVER, "opencode")[0]!.code!).mcp.paperclip.oauth.scope).toBe("paperclip:read paperclip:write paperclip:configure offline_access");
  });
});

describe("assistantRows", () => {
  const row = (extra: Partial<McpConnection>) =>
    ({ id: "m", companyId: "co-1", clientName: "Codex", companyName: "Acme", scopes: ["paperclip:read"], createdAt: "", revokedAt: null, ...extra }) as McpConnection;

  it("keeps your live assistant connections in this organization", () => {
    const rows = assistantRows(
      [row({ id: "a" }), row({ id: "b", revokedAt: "2026-10-01" }), row({ id: "c", companyId: "co-2" }), row({ id: "d", scopes: ["paperclip:agent"] })],
      "co-1",
    );
    expect(rows.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("says who a connection acts as and its level", () => {
    expect(connectionAccessLine({ actAsAgent: null, accessLevel: "manager", accessOverrides: {} })).toBe("Acts as you · Manager");
    expect(connectionAccessLine({ actAsAgent: { id: "a", name: "Ada" }, accessLevel: "worker", accessOverrides: { "tasks:delete": true } })).toBe(
      "Acts as Ada · Worker at most · 1 action set",
    );
  });

  it("edits a connection's access as an agent's, and sends it whole", () => {
    expect(connectionAccessOf({ accessLevel: "admin", accessOverrides: {} })).toEqual({ level: "admin" });
    // An older server without the field reads as the connection default.
    expect(connectionAccessOf({ accessLevel: undefined as never, accessOverrides: undefined as never })).toEqual({ level: "manager" });
    expect(connectionAccessPatch({ level: "worker" })).toEqual({ accessLevel: "worker", accessOverrides: {} });
    expect(connectionAccessPatch({ level: "worker", overrides: { "api:raw": true } })).toEqual({ accessLevel: "worker", accessOverrides: { "api:raw": true } });
  });

  it("offers you, then the agents you may configure, keeping the current one", () => {
    expect(actAsChoices({ actAsAgent: null, actAsAgentChoices: [{ id: "a", name: "Ada" }] })).toEqual([
      { id: null, name: "You" },
      { id: "a", name: "Ada" },
    ]);
    expect(actAsChoices({ actAsAgent: { id: "b", name: "Bea" }, actAsAgentChoices: [{ id: "a", name: "Ada" }] }).map((choice) => choice.name)).toEqual(["You", "Bea", "Ada"]);
  });
});
