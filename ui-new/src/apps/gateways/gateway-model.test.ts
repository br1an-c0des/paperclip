import type { ToolApplication, ToolConnection, ToolMcpGatewayWithTokens, ToolProfileWithDetails } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { ToolActivityEvent } from "@/api/tool-access";
import {
  activityLine,
  allowedToolsLabel,
  defaultTokenName,
  endpointUrl,
  expiryFromDate,
  filledSnippet,
  gatewayApps,
  lastUsed,
  maskedToken,
  scopeLabel,
  tokensLabel,
  tokenStatus,
} from "./gateway-model";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const token = (extra: Record<string, unknown>) => ({ tokenPrefix: "pcgw_ab", revokedAt: null, expiresAt: null, lastUsedAt: null, ...extra });

const gateway = (extra: Partial<ToolMcpGatewayWithTokens> = {}) =>
  ({
    id: "g1",
    name: "CTO agents",
    displaySlug: "cto-agents",
    status: "active",
    contextScopeType: "none",
    contextScopeId: null,
    projectId: null,
    agentId: null,
    endpointPath: "/api/tool-gateway/gateways/pub/mcp",
    tokens: [],
    ...extra,
  }) as unknown as ToolMcpGatewayWithTokens;

describe("tokens", () => {
  it("reads a token's state", () => {
    expect(tokenStatus(token({ revokedAt: "2026-10-01" }), NOW)).toBe("revoked");
    expect(tokenStatus(token({}), NOW)).toBe("active");
    expect(tokenStatus(token({ expiresAt: new Date(NOW - 1).toISOString() }), NOW)).toBe("expired");
    expect(tokenStatus(token({ expiresAt: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toBe("expiring");
    expect(tokenStatus(token({ expiresAt: new Date(NOW + 60 * DAY).toISOString() }), NOW)).toBe("active");
    expect(maskedToken({ tokenPrefix: "pcgw_ab" })).toBe("pcgw_ab•••");
  });

  it("counts a gateway's usable tokens and their last use", () => {
    const g = gateway({
      tokens: [
        token({ lastUsedAt: "2026-10-20T00:00:00Z" }),
        token({ expiresAt: new Date(NOW + DAY).toISOString(), lastUsedAt: "2026-10-27T00:00:00Z" }),
        token({ revokedAt: "2026-10-01" }),
      ] as never,
    });
    expect(tokensLabel(g, NOW)).toBe("2 active · 1 expiring");
    expect(lastUsed(g)).toBe("2026-10-27T00:00:00.000Z");
  });

  it("names a new token and its expiry", () => {
    expect(defaultTokenName({ displaySlug: "cto" }, new Date("2026-10-28T15:30:00Z"))).toBe("cto-202610281530");
    expect(expiryFromDate("2027-01-26")).toBe("2027-01-26T23:59:59.000Z");
    expect(expiryFromDate("")).toBeNull();
  });
});

describe("gateways", () => {
  it("labels its scope", () => {
    expect(scopeLabel(gateway(), new Map(), new Map())).toBe("Organization");
    expect(scopeLabel(gateway({ contextScopeType: "company", contextScopeId: "co" }), new Map(), new Map())).toBe("Organization");
    expect(scopeLabel(gateway({ contextScopeType: "agent", contextScopeId: "a1" }), new Map(), new Map([["a1", "Bob"]]))).toBe("Agent · Bob");
    expect(scopeLabel(gateway({ projectId: "p1" }), new Map([["p1", "Site"]]), new Map())).toBe("Project · Site");
  });

  it("counts what a profile allows", () => {
    const summary = { accessMode: "selected", allowedToolCount: 1, totalToolCount: 9, excludedToolCount: 0 };
    expect(allowedToolsLabel({ summary } as ToolProfileWithDetails)).toBe("1 tool");
    expect(allowedToolsLabel({ summary: { ...summary, accessMode: "all_except", excludedToolCount: 2 } } as ToolProfileWithDetails)).toBe("7 tools");
    expect(allowedToolsLabel({ summary: { ...summary, allowedToolCount: 0 } } as ToolProfileWithDetails)).toBe("No tools allowed");
    expect(allowedToolsLabel(undefined)).toBe("Profile unavailable");
  });

  it("lists the apps its profile includes", () => {
    const profile = {
      entries: [
        { effect: "include", applicationId: "app-1", catalogEntryId: null, toolName: null },
        { effect: "include", applicationId: "app-1", catalogEntryId: "t1", toolName: null },
        { effect: "include", applicationId: null, connectionId: "c2", catalogEntryId: null },
        { effect: "exclude", applicationId: "app-3" },
      ],
    } as unknown as ToolProfileWithDetails;
    const applications = [
      { id: "app-1", name: "Gmail", status: "active" },
      { id: "app-2", name: "Notion", status: "active" },
      { id: "app-3", name: "Slack", status: "active" },
    ] as ToolApplication[];
    const connections = [
      { id: "c1", name: "Gmail", applicationId: "app-1", status: "active", enabled: true, healthStatus: "ok" },
      { id: "c2", name: "notion", applicationId: "app-2", status: "active", enabled: true, healthStatus: "failed", connectionPurpose: "tool" },
    ] as unknown as ToolConnection[];
    expect(gatewayApps(profile, applications, connections).map((row) => [row.name, row.toolCount, row.needsAttention])).toEqual([
      ["Gmail", 1, false],
      ["notion", 0, true],
    ]);
    expect(gatewayApps(undefined, applications, connections)).toEqual([]);
  });

  it("fills a client snippet with this board's address and a token", () => {
    const endpoint = endpointUrl("/api/x/mcp", "https://board.example.com");
    expect(endpoint).toBe("https://board.example.com/api/x/mcp");
    const text = filledSnippet({ mcpServers: { p: { url: "/api/x/mcp", headers: { Authorization: "Bearer pcgw_..." } } } }, { endpointPath: "/api/x/mcp", endpoint, token: "pcgw_secret" });
    expect(JSON.parse(text)).toEqual({ mcpServers: { p: { url: endpoint, headers: { Authorization: "Bearer pcgw_secret" } } } });
  });
});

describe("activityLine", () => {
  it("says who used what, and the facts behind it", () => {
    const line = activityLine({
      agentDisplayName: "Bob",
      toolDisplayName: "Search docs",
      appDisplayName: "Context7",
      normalizedOutcome: "asked_first",
      details: { reasonCode: "approval_required" },
      invocation: {
        id: "inv-1",
        toolName: "query-docs",
        status: "completed",
        policyDecision: "require_approval",
        argumentsSummary: { summary: '{"q":"solid"}' },
        resultSummary: null,
        startedAt: "2026-10-28T12:00:00.000Z",
        completedAt: "2026-10-28T12:00:00.250Z",
        errorCode: null,
        errorMessage: null,
      },
    } as unknown as ToolActivityEvent);
    expect([line.actor, line.tool, line.app, line.outcome.label]).toEqual(["Bob", "Search docs", "Context7", "Asked first"]);
    expect(line.facts).toContainEqual(["Duration", "250 ms"]);
    expect(line.facts).toContainEqual(["Reason", "approval_required"]);
    expect(line.arguments).toBe('{\n  "q": "solid"\n}');
    expect(line.result).toBeNull();
  });
});
