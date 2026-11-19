import { describe, expect, it } from "vitest";
import { CONNECTION_INTENT_AGENT_GUIDANCE, CONNECTION_REQUEST_TOOL_DESCRIPTION, CONNECTION_RUNTIME_TOOL_NAMES, CONNECTIONS_SEARCH_TOOL_DESCRIPTION } from "./connection-intent-guidance.js";
describe("connection result guidance", () => {
  it("delegates route decisions to trusted tool output instead of a provider decision tree", () => {
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("follow the returned `instruction`");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("Respect recorded declines and provider choices");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).not.toMatch(/Composio|Arcade|Executor|Zapier/);
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).not.toMatch(/https?:\/\/|bearer/);
  });
  it("retains waiting, credential, and arbitrary URL boundaries", () => {
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("yield without retrying or polling");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("never ask for credentials in comments");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("arbitrary MCP URLs");
  });
  it("offers the raw API tools only to agents that have them", () => {
    // search_api/call_api need api:raw (admin agents); the rest are pointed at access requests and the board.
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).not.toMatch(/Use `search_api`|Use `search_api` and `call_api`/);
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).not.toContain("Standard agents can manage connections");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("which only some agents have");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("`paperclip_search_api`/`paperclip_call_api`");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("Without them, don't work around it: use `connection_request`");
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("ask the board on your task");
    expect(CONNECTIONS_SEARCH_TOOL_DESCRIPTION).toContain("search_api/call_api if you have them");
  });
  it("binds a request card to the person it is addressed to", () => {
    expect(CONNECTION_INTENT_AGENT_GUIDANCE).toContain("Only that person can complete or decline it");
  });
  it("describes exact questions and saved selection proof", () => {
    expect(CONNECTIONS_SEARCH_TOOL_DESCRIPTION).toContain("exact providerQuestion");
    expect(CONNECTION_REQUEST_TOOL_DESCRIPTION).toContain("saved provider-selection interaction ID");
    expect(CONNECTION_RUNTIME_TOOL_NAMES).toEqual(["connections_search","connection_request"]);
  });
});
