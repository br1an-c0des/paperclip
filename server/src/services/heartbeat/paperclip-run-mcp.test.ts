import { describe, expect, it } from "vitest";
import { isUnifiedRunMcpEnabled, paperclipRunMcpServers } from "./paperclip-run-mcp.js";

const base = { authToken: "run-jwt", apiBaseUrl: "http://localhost:3100", taskBound: true };

describe("Paperclip MCP server for a run", () => {
  it("with the switch on, a run gets one paperclip server and no project-tools server", () => {
    const servers = paperclipRunMcpServers({ ...base, unified: true });
    expect(servers).toEqual([
      { name: "paperclip", url: "http://localhost:3100/api/mcp/paperclip", token: "run-jwt", connectionId: "paperclip" },
    ]);
    expect(servers.some(server => server.url.endsWith("/api/mcp/project-tools"))).toBe(false);
  });

  it("with the switch on, a run that isn't bound to a task still gets the paperclip server", () => {
    expect(paperclipRunMcpServers({ ...base, taskBound: false, unified: true })).toHaveLength(1);
  });

  it("with it off, nothing changes", () => {
    expect(paperclipRunMcpServers({ ...base, unified: false })).toEqual([
      { name: "Paperclip projects", url: "http://localhost:3100/api/mcp/project-tools", token: "run-jwt", connectionId: "paperclip-project-tools" },
    ]);
    expect(paperclipRunMcpServers({ ...base, taskBound: false, unified: false })).toEqual([]);
  });

  it("needs a run token and a configured API URL either way", () => {
    for (const unified of [true, false]) {
      expect(paperclipRunMcpServers({ ...base, authToken: null, unified })).toEqual([]);
      expect(paperclipRunMcpServers({ ...base, apiBaseUrl: null, unified })).toEqual([]);
    }
  });

  it("reads the switch from PAPERCLIP_UNIFIED_RUN_MCP=1, default off", () => {
    expect(isUnifiedRunMcpEnabled({})).toBe(false);
    expect(isUnifiedRunMcpEnabled({ PAPERCLIP_UNIFIED_RUN_MCP: "0" })).toBe(false);
    expect(isUnifiedRunMcpEnabled({ PAPERCLIP_UNIFIED_RUN_MCP: "1" })).toBe(true);
  });
});
