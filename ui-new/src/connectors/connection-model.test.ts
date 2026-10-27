import { describe, expect, it } from "vitest";
import {
  apiKeyInput,
  canMakeDefault,
  canReconnect,
  draftProblem,
  localLoginSupported,
  loginIntent,
  newDraft,
  ownerLabel,
  reconnectDraft,
  usageLimitValue,
  usagePercent,
  type Connection,
} from "./connection-model";

const base: Connection = {
  id: "c1",
  grantId: "g1",
  companyId: "co1",
  provider: "anthropic",
  method: "subscription",
  name: "My Claude subscription",
  ownership: "personal",
  ownerUserId: "me",
  ownerName: "You",
  isDefault: false,
  status: "connected",
};

const list = { currentUserId: "me", canManageConnections: false };

describe("connection rules", () => {
  it("labels the owner", () => {
    expect(ownerLabel(base, "me")).toBe("Personal · You");
    expect(ownerLabel({ ...base, ownerUserId: "ada", ownerName: "Ada" }, "me")).toBe("Personal · Ada");
    expect(ownerLabel({ ...base, ownership: "shared", ownerUserId: undefined }, "me")).toBe("Shared with the company");
  });

  it("offers Make default only on your own connected personal account", () => {
    expect(canMakeDefault(base, "me")).toBe(true);
    expect(canMakeDefault({ ...base, isDefault: true }, "me")).toBe(false);
    expect(canMakeDefault({ ...base, status: "expired" }, "me")).toBe(false);
    expect(canMakeDefault({ ...base, ownerUserId: "ada" }, "me")).toBe(false);
    expect(canMakeDefault({ ...base, ownership: "shared", ownerUserId: undefined }, "me")).toBe(false);
  });

  it("offers Reconnect on failing accounts to their owner, or to managers for shared ones", () => {
    expect(canReconnect(base, list)).toBe(false);
    expect(canReconnect({ ...base, status: "expired" }, list)).toBe(true);
    expect(canReconnect({ ...base, status: "needs_attention" }, list)).toBe(true);
    expect(canReconnect({ ...base, status: "revoked" }, list)).toBe(false);
    expect(canReconnect({ ...base, status: "expired", ownerUserId: "ada" }, list)).toBe(false);
    const shared = { ...base, status: "expired" as const, ownership: "shared" as const, ownerUserId: undefined };
    expect(canReconnect(shared, list)).toBe(false);
    expect(canReconnect(shared, { ...list, canManageConnections: true })).toBe(true);
  });

  it("allows subscription sign-in where the server says so, or on a local_trusted server", () => {
    expect(localLoginSupported(undefined)).toBe(false);
    expect(localLoginSupported({ status: "ok", localAiLoginSupported: false, deploymentMode: "local_trusted" })).toBe(false);
    expect(localLoginSupported({ status: "ok", localAiLoginSupported: true, deploymentMode: "authenticated" })).toBe(true);
    expect(localLoginSupported({ status: "ok", deploymentMode: "local_trusted" })).toBe(true);
  });
});

describe("setup draft", () => {
  it("shares with every agent for managers, and stays personal for others", () => {
    expect(newDraft(true)).toMatchObject({ ownership: "shared", allAgents: true, name: "Company Claude subscription" });
    expect(newDraft(false, "api_key")).toMatchObject({ ownership: "personal", allAgents: false, name: "My Claude API key" });
  });

  it("explains what's missing", () => {
    expect(draftProblem(newDraft(true), true)).toBeNull();
    expect(draftProblem({ ...newDraft(true), name: " " }, true)).toBe("Name the connection.");
    expect(draftProblem({ ...newDraft(true), allAgents: false }, true)).toMatch(/at least one agent/);
    expect(draftProblem({ ...newDraft(true), allAgents: false, agentIds: ["a1"] }, true)).toBeNull();
    expect(draftProblem({ ...newDraft(false), ownership: "shared" }, false)).toMatch(/connection manager/);
    expect(draftProblem(newDraft(false), false)).toBeNull();
  });

  it("builds the sign-in intent and the API-key request", () => {
    const draft = { ...newDraft(true), allAgents: false, agentIds: ["a1", "a2"], name: " Team Claude " };
    expect(loginIntent(draft)).toEqual({
      provider: "anthropic",
      method: "subscription",
      name: "Team Claude",
      ownership: "shared",
      agentIds: ["a1", "a2"],
      allAgents: false,
    });
    expect(apiKeyInput({ ...draft, method: "api_key", apiKey: " sk-ant-1 " })).toEqual({
      provider: "anthropic",
      method: "api_key",
      name: "Team Claude",
      ownership: "shared",
      apiKey: "sk-ant-1",
      agentIds: ["a1", "a2"],
      allAgents: false,
    });
    // Every agent: no agent list is sent alongside.
    expect(loginIntent({ ...draft, allAgents: true }).agentIds).toEqual([]);
  });

  it("reconnects with the account's identity and its ID", () => {
    const draft = reconnectDraft({ ...base, status: "expired" }, false);
    expect(draftProblem(draft, false)).toBeNull();
    expect(loginIntent(draft)).toMatchObject({ name: base.name, ownership: "personal", connectionId: "c1" });
  });
});

describe("usage", () => {
  const limit = {
    id: "l1",
    label: "5h",
    scope: null,
    windowDurationSeconds: 18000,
    resetsAt: null,
    usedPercent: null,
    remainingPercent: null,
    used: null,
    limit: null,
    remaining: null,
    unit: null,
    limitReached: null,
    allowed: null,
  };

  it("describes and measures a limit", () => {
    expect(usageLimitValue({ ...limit, usedPercent: 42 })).toBe("42% used");
    expect(usagePercent({ ...limit, usedPercent: 42 })).toBe(42);
    expect(usageLimitValue({ ...limit, used: 5, limit: 20, unit: "USD" })).toMatch(/\$5.*\$20/);
    expect(usagePercent({ ...limit, used: 5, limit: 20 })).toBe(25);
    expect(usagePercent({ ...limit, remainingPercent: 70 })).toBe(30);
    expect(usageLimitValue(limit)).toBe("Not reported");
    expect(usagePercent(limit)).toBeNull();
  });
});
