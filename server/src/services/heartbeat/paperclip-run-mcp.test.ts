import { describe, expect, it } from "vitest";
import { paperclipRunMcpServers } from "./paperclip-run-mcp.js";

const base = { authToken: "run-jwt", apiBaseUrl: "http://localhost:3100" };

describe("Paperclip MCP server for a run", () => {
  it("gives a run one paperclip server and no project-tools server, with or without a task", () => {
    // There's no task input: the run tools need the run id in the token, not a task.
    const servers = paperclipRunMcpServers(base);
    expect(servers).toEqual([
      { name: "paperclip", url: "http://localhost:3100/api/mcp/paperclip", token: "run-jwt", connectionId: "paperclip" },
    ]);
    expect(servers.some(server => server.url.endsWith("/api/mcp/project-tools"))).toBe(false);
  });

  it("needs a run token and a configured API URL", () => {
    expect(paperclipRunMcpServers({ ...base, authToken: null })).toEqual([]);
    expect(paperclipRunMcpServers({ ...base, authToken: "" })).toEqual([]);
    expect(paperclipRunMcpServers({ ...base, apiBaseUrl: null })).toEqual([]);
  });
});
