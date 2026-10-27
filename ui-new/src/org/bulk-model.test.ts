import type { Agent, AiConnectionList, AiManagedConnectionSummary, AiProviderRouting } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  agentConnection,
  alreadyApplied,
  bulkDisabledReason,
  catalogPlan,
  changesAgent,
  commonModels,
  connectionChoices,
  connectionName,
  harnessGroups,
  mapBulk,
  modelProblems,
  runtimeHarness,
  runtimePatch,
  sameBinding,
} from "./bulk-model";

const SHARED = { provider: "anthropic", method: "subscription", mode: "shared", connectionId: "c1", grantId: "g1" } as const;

function agent(extra: Partial<Omit<Agent, "runtimeConfig">> & { runtimeConfig?: Record<string, unknown> } = {}): Agent {
  return {
    id: "a1",
    name: "Quant",
    status: "idle",
    adapterType: "claude_local",
    adapterConfig: { model: "claude-sonnet-5-5" },
    runtimeConfig: {},
    defaultEnvironmentId: null,
    ...extra,
  } as Agent;
}

function connection(extra: Partial<AiManagedConnectionSummary>): AiManagedConnectionSummary {
  return {
    id: "c1",
    grantId: "g1",
    companyId: "co",
    provider: "anthropic",
    method: "subscription",
    name: "Company Claude",
    ownership: "shared",
    isDefault: false,
    status: "connected",
    ...extra,
  };
}

describe("runtimeHarness", () => {
  it("groups Paperclip Runner agents with the harness they run", () => {
    expect(runtimeHarness("claude_local")).toBe("claude_local");
    expect(runtimeHarness("cursor")).toBe("cursor_local");
    expect(runtimeHarness("paperclip_runner", { provider: "acpx", acpxAgent: "claude" })).toBe("claude_local");
    expect(runtimeHarness("paperclip_runner", { provider: "acpx", acpxAgent: "copilot" })).toBe("copilot_runtime");
    expect(runtimeHarness("paperclip_runner", {})).toBe("codex_local");
    expect(runtimeHarness("paperclip_runner", { provider: "opencode" })).toBe("opencode_local");
  });

  it("names a group as the agent page names its harness, whichever runner carries it", () => {
    const groups = harnessGroups([
      agent({ id: "r", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }),
      agent({ id: "l", adapterType: "claude_local" }),
      agent({ id: "c", adapterType: "codex_local" }),
    ]);
    expect(groups.map((group) => [group.label, group.agents.map((entry) => entry.id)])).toEqual([
      ["Claude Code", ["r", "l"]],
      ["Codex", ["c"]],
    ]);
  });
});

describe("agentConnection and sameBinding", () => {
  it("reads only well-formed bindings", () => {
    expect(agentConnection(agent({ runtimeConfig: { aiConnection: SHARED } }))).toEqual(SHARED);
    expect(agentConnection(agent({ runtimeConfig: { aiConnection: { mode: "router", connectionId: "p1" } } }))).toEqual({ mode: "router", connectionId: "p1" });
    expect(agentConnection(agent({ runtimeConfig: { aiConnection: { mode: "shared", provider: "anthropic", method: "subscription" } } }))).toBeUndefined();
    expect(agentConnection(agent({ runtimeConfig: { aiConnection: "nope" } }))).toBeUndefined();
  });

  it("compares bindings whatever their key order", () => {
    expect(sameBinding(SHARED, { grantId: "g1", connectionId: "c1", mode: "shared", method: "subscription", provider: "anthropic" })).toBe(true);
    expect(sameBinding(SHARED, undefined)).toBe(false);
    expect(sameBinding(undefined, undefined)).toBe(true);
  });
});

describe("bulkDisabledReason", () => {
  it("allows managed harnesses only", () => {
    expect(bulkDisabledReason(agent())).toBeUndefined();
    expect(bulkDisabledReason(agent({ adapterType: "process", adapterConfig: {} }))).toMatch(/outside Paperclip/);
    expect(bulkDisabledReason(agent({ status: "pending_approval" }))).toMatch(/hired/);
    expect(bulkDisabledReason(agent({ runtimeConfig: { aiConnection: { mode: "router", connectionId: "p1" } } }))).toMatch(/pool/);
  });
});

describe("runtimePatch", () => {
  it("sends only what changes, with what the preview showed as expected", () => {
    const current = agent({ runtimeConfig: { aiConnection: SHARED } });
    expect(runtimePatch(current, { model: "claude-opus-5-5" })).toEqual({
      harness: "claude_local",
      model: "claude-opus-5-5",
      expected: { model: "claude-sonnet-5-5", aiConnection: SHARED },
    });
    const responsible = { provider: "anthropic", method: "subscription", mode: "responsible_user" } as const;
    expect(runtimePatch(current, { binding: responsible })).toEqual({
      harness: "claude_local",
      aiConnection: responsible,
      expected: { model: "claude-sonnet-5-5", aiConnection: SHARED },
    });
  });

  it("skips agents that already have the settings", () => {
    const current = agent({ runtimeConfig: { aiConnection: SHARED } });
    expect(runtimePatch(current, { model: "claude-sonnet-5-5", binding: { ...SHARED } })).toBeNull();
    expect(changesAgent(current, {})).toBe(false);
  });

  it("uses the harness behind a Runner agent and no expected connection when there's none", () => {
    const runner = agent({ adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } });
    expect(runtimePatch(runner, { model: "claude-opus-5-5" })).toEqual({
      harness: "claude_local",
      model: "claude-opus-5-5",
      expected: { model: null, aiConnection: null },
    });
  });

  it("knows when a retry finds the change already saved", () => {
    expect(alreadyApplied(agent({ adapterConfig: { model: "claude-opus-5-5" } }), "claude_local", { model: "claude-opus-5-5" })).toBe(true);
    expect(alreadyApplied(agent(), "claude_local", { model: "claude-opus-5-5" })).toBe(false);
    expect(alreadyApplied(agent({ adapterConfig: { model: "claude-opus-5-5" } }), "codex_local", { model: "claude-opus-5-5" })).toBe(false);
  });
});

describe("connections", () => {
  const list: AiConnectionList = {
    currentUserId: "u1",
    canManageConnections: true,
    connections: [
      connection({}),
      connection({ id: "c2", grantId: "g2", name: "Expired one", status: "expired" }),
      connection({ id: "c3", grantId: "g3", name: "My Claude", ownership: "personal", ownerUserId: "u1", isDefault: true, method: "api_key" }),
      connection({ id: "c4", grantId: "g4", name: "OpenAI", provider: "openai" }),
    ],
  };

  it("offers the responsible user's connection, then the provider's shared ones", () => {
    const choices = connectionChoices(list, "anthropic");
    expect(choices.map((choice) => [choice.id, choice.disabled])).toEqual([
      ["responsible_user", false],
      ["c1", false],
      ["c2", true],
    ]);
    expect(choices[0]!.binding).toEqual({ provider: "anthropic", method: "api_key", mode: "responsible_user" });
    expect(choices[0]!.description).toContain("My Claude");
    expect(choices[1]!.binding).toEqual(SHARED);
  });

  it("names a binding", () => {
    expect(connectionName(undefined)).toBe("Local credentials");
    expect(connectionName(SHARED, list)).toBe("Company Claude");
    expect(connectionName({ ...SHARED, connectionId: "gone" }, list)).toBe("Assigned connection");
    expect(connectionName({ mode: "router", connectionId: "p" })).toBe("Connection pool");
  });
});

describe("model catalogs", () => {
  it("asks the harness for its models, or uses the connection's fixed list", () => {
    expect(catalogPlan({ harness: "claude_local", binding: undefined, routing: undefined, agent: { id: "a", defaultEnvironmentId: "env" } })).toEqual({
      kind: "request",
      type: "claude_local",
      options: { environmentId: "env" },
      restricted: false,
      stripOpenRouter: false,
    });
    const routing: AiProviderRouting = { kind: "openrouter", protocol: "chat", auth: "bearer", models: [{ id: "anthropic/claude" }] };
    expect(catalogPlan({ harness: "opencode_local", binding: undefined, routing, agent: { id: "a", defaultEnvironmentId: null } })).toEqual({
      kind: "fixed",
      restricted: true,
      models: [{ id: "openrouter/anthropic/claude", label: "anthropic/claude" }],
    });
    const openRouter = catalogPlan({ harness: "claude_local", binding: { provider: "openrouter", method: "api_key", mode: "responsible_user" }, routing: undefined, agent: { id: "a", defaultEnvironmentId: null } });
    expect(openRouter).toMatchObject({ kind: "request", type: "opencode_local", restricted: true, stripOpenRouter: true });
  });

  it("keeps only models every restricted agent can use", () => {
    const m = (id: string) => ({ id, label: id });
    const catalogs = [
      { agentId: "a", models: [m("x"), m("y")], restricted: false },
      { agentId: "b", models: [m("y"), m("z")], restricted: true },
    ];
    expect(commonModels(catalogs)).toEqual({ models: [m("y"), m("z")], allowCustom: false });
    expect(commonModels([catalogs[0]!]).allowCustom).toBe(true);
    expect(modelProblems([agent({ id: "b", name: "B" })], catalogs, {})).toEqual([
      { agentId: "b", name: "B", message: "claude-sonnet-5-5 isn't available on this connection. Choose another model." },
    ]);
    expect(modelProblems([agent({ id: "b", name: "B" })], catalogs, { model: "y" })).toEqual([]);
  });
});

describe("harnessGroups and mapBulk", () => {
  it("groups the selection by harness", () => {
    const groups = harnessGroups([
      agent({ id: "1" }),
      agent({ id: "2", adapterType: "codex_local" }),
      agent({ id: "3", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }),
    ]);
    expect(groups.map((group) => [group.harness, group.agents.map((entry) => entry.id)])).toEqual([
      ["claude_local", ["1", "3"]],
      ["codex_local", ["2"]],
    ]);
  });

  it("settles every item, a few at a time, keeping each failure its own", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapBulk([1, 2, 3, 4, 5, 6], async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      if (value === 3) throw new Error("nope");
      return value * 2;
    }, 2);
    expect(peak).toBe(2);
    expect(results.map((result) => (result.status === "fulfilled" ? result.value : "x"))).toEqual([2, 4, "x", 8, 10, 12]);
  });
});
