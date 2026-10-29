import type { ConnectionGrantsResponse, ToolConnectionAccessSummary, ToolConnectionTestAgent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  appPanel,
  browserUseGrants,
  cleanParameters,
  costCap,
  decisionFor,
  isTerminal,
  railwayGrants,
  resultError,
  resultText,
  sortTestAgents,
} from "./test-call-model";

describe("test calls", () => {
  it("orders agents by rank, then name", () => {
    const agents = [
      { id: "b", name: "Bee", orgDepth: 1 },
      { id: "c", name: "Ceo", orgDepth: 0 },
      { id: "a", name: "Ant", orgDepth: 1 },
    ] as ToolConnectionTestAgent[];
    expect(sortTestAgents(agents).map((agent) => agent.id)).toEqual(["c", "a", "b"]);
  });

  it("reads the action's decision by its upstream or gateway name; unknown is off", () => {
    const access = { tools: [{ toolName: "search", gatewayToolName: "app__search", decision: "ask_first" }] } as unknown as ToolConnectionAccessSummary;
    expect(decisionFor(access, { toolName: "search" })).toBe("ask_first");
    expect(decisionFor(access, { toolName: "app__search" })).toBe("ask_first");
    expect(decisionFor(access, { toolName: "other" })).toBe("off");
    expect(decisionFor(undefined, { toolName: "search" })).toBe("off");
  });

  it("stops polling once the call settles", () => {
    expect(isTerminal("waiting")).toBe(false);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("expired")).toBe(true);
  });

  it("shows MCP text, else JSON, and spots error results", () => {
    expect(resultText({ content: [{ type: "text", text: "hello" }, { type: "image" }] })).toBe("hello");
    expect(resultText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(resultText(undefined)).toBe("No result.");
    expect(resultError({ isError: true, content: "nope" })).toBe("nope");
    expect(resultError({ data: { isError: true } })).toMatch(/error result/);
    expect(resultError({ content: "fine" })).toBeNull();
  });

  it("sends only the inputs filled in", () => {
    expect(cleanParameters({ a: "", b: 0, c: [], d: undefined, e: "x", f: false })).toEqual({ b: 0, e: "x", f: false });
  });
});

describe("app panels", () => {
  const grants = {
    currentUserId: "me",
    capabilities: { canConfigure: true },
    grants: [
      { id: "mine", kind: "user", subjectUserId: "me", status: "active", createdByUserId: "me" },
      { id: "theirs", kind: "user", subjectUserId: "you", status: "active", createdByUserId: "you" },
      { id: "org", kind: "organization", subjectUserId: null, status: "active", createdByUserId: "you", capabilities: { canEditAudience: true } },
      { id: "old", kind: "organization", subjectUserId: null, status: "revoked", createdByUserId: "me" },
    ],
  } as unknown as ConnectionGrantsResponse;

  it("knows which apps have a panel", () => {
    expect(appPanel("railway")).toBe("railway");
    expect(appPanel("browser-use-cloud")).toBe("browser-use-cloud");
    expect(appPanel("linear")).toBeNull();
  });

  it("lets Railway keys go on your own or shared authorizations", () => {
    const { owned, eligible } = railwayGrants(grants);
    expect(owned.map((grant) => grant.id)).toEqual(["mine", "org", "old"]);
    expect(eligible.map((grant) => grant.id)).toEqual(["mine", "org"]);
  });

  it("lets Browser Use settings go on credentials you own or a shared one you manage", () => {
    expect(browserUseGrants(grants).map((grant) => grant.id)).toEqual(["mine", "org"]);
  });

  it("takes an empty or positive cost cap", () => {
    expect(costCap("")).toEqual({ ok: true, value: null });
    expect(costCap("2.5")).toEqual({ ok: true, value: 2.5 });
    expect(costCap("0").ok).toBe(false);
    expect(costCap("abc").ok).toBe(false);
  });
});
