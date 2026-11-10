import type { Agent, AiConnectionList } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  activeRosterCount,
  buildRosterIndex,
  EMPTY_ROSTER_FILTERS,
  matchesRoster,
  pendingSetupHarness,
  rosterCounts,
  rosterFiltersFromSearch,
  rosterSearchPatch,
  rosterValues,
  toggleRosterFilter,
} from "./roster-filters";

function agent(extra: Partial<Omit<Agent, "runtimeConfig">> & { runtimeConfig?: Record<string, unknown> } = {}): Agent {
  return {
    id: "a1",
    name: "Quant",
    status: "idle",
    adapterType: "claude_local",
    adapterConfig: { model: "claude-sonnet-5-5" },
    runtimeConfig: {},
    pauseReason: null,
    metadata: null,
    ...extra,
  } as Agent;
}

const SHARED = { provider: "anthropic", method: "subscription", mode: "shared", grantId: "g1" } as const;

const list = (extra: Partial<AiConnectionList> = {}) =>
  ({
    currentUserId: "u1",
    canManageConnections: true,
    connections: [
      { id: "c1", grantId: "g1", name: "Team Claude" },
      { id: "c2", grantId: "g1", name: "Team Claude" },
      { id: "c3", grantId: "g1", name: "Solo" },
    ],
    pools: [{ id: "p1", name: "Claude pool" }],
    ...extra,
  }) as unknown as AiConnectionList;

describe("rosterValues", () => {
  it("names the model, or the harness default", () => {
    expect(rosterValues(agent())?.model).toEqual({ value: "model:claude-sonnet-5-5", label: "claude-sonnet-5-5" });
    expect(rosterValues(agent({ adapterConfig: { model: "  " } }))?.model).toEqual({ value: "default", label: "Harness default" });
    expect(rosterValues(agent({ adapterConfig: {} }))?.model.label).toBe("Harness default");
  });

  it("reads the status and the harness, with a Runner agent under the harness it runs", () => {
    const values = rosterValues(agent({ status: "paused", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }));
    expect(values?.status).toEqual({ value: "paused", label: "Paused" });
    expect(values?.harness).toEqual({ value: "claude_local", label: "Claude Code" });
  });

  it("derives each connection kind as the old UI does", () => {
    const kind = (extra: Parameters<typeof agent>[0]) => rosterValues(agent(extra))?.connection.value;
    expect(kind({})).toBe("local");
    expect(kind({ adapterType: "process" })).toBe("external");
    expect(kind({ adapterType: "http" })).toBe("external");
    expect(kind({ runtimeConfig: { aiConnection: { provider: "anthropic", method: "subscription", mode: "responsible_user" } } })).toBe("responsible_user");
    expect(kind({ runtimeConfig: { aiConnection: { mode: "router", connectionId: "p1" } } })).toBe("pool:p1");
    expect(kind({ runtimeConfig: { aiConnection: { ...SHARED, connectionId: "c1" } } })).toBe("connection:c1");
    // A malformed binding reads as none, so local credentials.
    expect(kind({ runtimeConfig: { aiConnection: { mode: "shared" } } })).toBe("local");
  });

  it("treats an unsaved Antigravity setup choice as not configured", () => {
    const draft = agent({
      status: "paused",
      pauseReason: "setup",
      adapterType: "process",
      metadata: { setupAdapterPending: true, setupAdapterChoice: { adapterType: "paperclip_runner", runnerProvider: "antigravity", runner: "auto" } },
    });
    expect(pendingSetupHarness(draft)).toBe("antigravity_runtime");
    expect(rosterValues(draft)).toMatchObject({
      harness: { value: "antigravity_runtime", label: "Google Antigravity" },
      model: { value: "unconfigured", label: "Not available yet" },
      connection: { value: "unconfigured", label: "Not configured" },
    });
    expect(pendingSetupHarness({ ...draft, pauseReason: "manual" })).toBeUndefined();
  });

  it("leaves out retired agents and hires waiting for approval", () => {
    expect(rosterValues(agent({ status: "terminated" }))).toBeUndefined();
    expect(rosterValues(agent({ status: "pending_approval" }))).toBeUndefined();
  });
});

describe("buildRosterIndex", () => {
  const agents = [
    agent({ id: "a1", runtimeConfig: { aiConnection: { ...SHARED, connectionId: "c1" } } }),
    agent({ id: "a2", runtimeConfig: { aiConnection: { ...SHARED, connectionId: "c2" } } }),
    agent({ id: "a3", runtimeConfig: { aiConnection: { ...SHARED, connectionId: "c3" } }, adapterConfig: {} }),
    agent({ id: "a4", runtimeConfig: { aiConnection: { mode: "router", connectionId: "p1" } } }),
    agent({ id: "a5", runtimeConfig: { aiConnection: { ...SHARED, connectionId: "gone", grantId: "x" } } }),
    agent({ id: "a6", status: "pending_approval" }),
  ];

  it("names connections and pools, numbering connections that share a name", () => {
    const { options } = buildRosterIndex(agents, list());
    expect(options.connection.map((option) => option.label)).toEqual(["Assigned connection", "Claude pool", "Solo", "Team Claude (1)", "Team Claude (2)"]);
  });

  it("falls back to generic names while the connection list hasn't loaded", () => {
    const { options } = buildRosterIndex(agents);
    expect(options.connection.map((option) => option.label)).toEqual([
      "Assigned connection (1)",
      "Assigned connection (2)",
      "Assigned connection (3)",
      "Assigned connection (4)",
      "Connection pool",
    ]);
  });

  it("offers each value once, sorted, and indexes only filterable agents", () => {
    const { options, byAgentId } = buildRosterIndex(agents, list());
    expect(options.model.map((option) => option.label)).toEqual(["claude-sonnet-5-5", "Harness default"]);
    expect(options.status).toEqual([{ value: "idle", label: "Idle" }]);
    expect(byAgentId.has("a6")).toBe(false);
  });
});

describe("matching and counts", () => {
  const index = buildRosterIndex([
    agent({ id: "a1" }),
    agent({ id: "a2", status: "paused" }),
    agent({ id: "a3", adapterType: "codex_local", adapterConfig: { model: "gpt-5.4" } }),
    agent({ id: "a4", status: "pending_approval" }),
  ]);
  const values = ["a1", "a2", "a3", "a4"].map((id) => index.byAgentId.get(id));

  it("lets every agent through with no filter, and hides unindexed agents behind any filter", () => {
    expect(values.every((entry) => matchesRoster(entry, EMPTY_ROSTER_FILTERS))).toBe(true);
    const filters = { ...EMPTY_ROSTER_FILTERS, harness: "claude_local" };
    expect(values.map((entry) => matchesRoster(entry, filters))).toEqual([true, true, false, false]);
  });

  it("requires every set filter", () => {
    const filters = { ...EMPTY_ROSTER_FILTERS, harness: "claude_local", status: "paused" };
    expect(values.map((entry) => matchesRoster(entry, filters))).toEqual([false, true, false, false]);
    expect(activeRosterCount(filters)).toBe(2);
  });

  it("counts each choice among the agents the other filters let through", () => {
    const counts = rosterCounts(values, { ...EMPTY_ROSTER_FILTERS, harness: "claude_local" });
    expect(counts.status.get("idle")).toBe(1);
    expect(counts.status.get("paused")).toBe(1);
    // The harness's own counts ignore the harness filter.
    expect(counts.harness.get("claude_local")).toBe(2);
    expect(counts.harness.get("codex_local")).toBe(1);
  });
});

describe("the address", () => {
  it("reads each parameter and writes All as none", () => {
    const filters = rosterFiltersFromSearch({ model: "model:gpt-5.4", connection: ["local", "x"], status: "" });
    expect(filters).toEqual({ model: "model:gpt-5.4", status: "", harness: "", connection: "local" });
    expect(rosterSearchPatch(filters)).toEqual({ model: "model:gpt-5.4", status: undefined, harness: undefined, connection: "local" });
  });

  it("toggles a choice back to All", () => {
    const once = toggleRosterFilter(EMPTY_ROSTER_FILTERS, "status", "idle");
    expect(once.status).toBe("idle");
    expect(toggleRosterFilter(once, "status", "idle").status).toBe("");
    expect(toggleRosterFilter(once, "status", "paused").status).toBe("paused");
  });
});
