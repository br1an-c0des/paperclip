import type { Agent, AiManagedConnectionSummary, AppDefinition } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  agentsUsingPool,
  emptyConfig,
  memberOf,
  moveMember,
  pickable,
  poolApp,
  poolPluginKey,
  poolProblem,
  poolSlug,
  toggleMember,
  withProfile,
} from "./pool-model";

const account = (over: Partial<AiManagedConnectionSummary> = {}): AiManagedConnectionSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  grantId: "g1",
  companyId: "c1",
  provider: "anthropic",
  method: "subscription",
  name: "Claude",
  ownership: "shared",
  isDefault: false,
  status: "connected",
  ...over,
});

describe("pool identity", () => {
  it("hex-encodes the plugin key into the gallery slug, as the shared package does", () => {
    expect(poolSlug("ab")).toBe("ai-router-6162");
  });

  it("reads the plugin key from a connection's config", () => {
    expect(poolPluginKey({ config: { aiRouter: { pluginKey: "acme.pool" } } })).toBe("acme.pool");
    expect(poolPluginKey({ config: { aiRouter: "x" } })).toBeNull();
    expect(poolPluginKey(null)).toBeNull();
  });

  it("stands in for a plugin the gallery no longer offers", () => {
    const app = poolApp([], "acme.pool");
    expect(app.aiConnectionRouter?.pluginKey).toBe("acme.pool");
    expect(app.availability?.available).toBe(false);
    const offered = { slug: "x", name: "Rotation", aiConnectionRouter: { pluginKey: "acme.pool" } } as AppDefinition;
    expect(poolApp([offered], "acme.pool").name).toBe("Rotation");
  });
});

describe("members", () => {
  it("binds a shared connection as shared and a personal one as delegated, with the provider's harness", () => {
    expect(memberOf(account(), "m1")).toMatchObject({
      id: "m1",
      binding: { mode: "shared", provider: "anthropic", connectionId: account().id, grantId: "g1" },
      profile: { provider: "acpx", acpxAgent: "claude" },
    });
    expect(memberOf(account({ ownership: "personal", provider: "openai" }), "m2")).toMatchObject({
      binding: { mode: "delegated" },
      profile: { provider: "codex" },
    });
  });

  it("adds a connection once and only when connected", () => {
    const one = toggleMember([], account(), true);
    expect(one).toHaveLength(1);
    expect(toggleMember(one, account(), true)).toHaveLength(1);
    expect(toggleMember(one, account(), false)).toHaveLength(0);
    expect(pickable([], account({ status: "expired" }))).toBe(false);
    expect(pickable(one, account({ grantId: "other" }))).toBe(false);
    expect(pickable(one, account())).toBe(true);
  });

  it("moves members within bounds", () => {
    const a = memberOf(account(), "a");
    const b = memberOf(account({ id: "22222222-2222-4222-8222-222222222222" }), "b");
    expect(moveMember([a, b], 1, -1).map((m) => m.id)).toEqual(["b", "a"]);
    expect(moveMember([a, b], 0, -1).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("drops an empty effort", () => {
    const a = memberOf(account(), "a");
    const withEffort = withProfile([a], "a", { effort: " high " });
    expect(withEffort[0]!.profile.effort).toBe("high");
    expect("effort" in withProfile(withEffort, "a", { effort: "" })[0]!.profile).toBe(false);
  });
});

describe("poolProblem", () => {
  it("needs a name, a member and a whole threshold", () => {
    expect(poolProblem(emptyConfig())).toMatch(/at least one/);
    const config = { ...emptyConfig(), members: [memberOf(account(), "a")] };
    expect(poolProblem(config)).toBeNull();
    expect(poolProblem({ ...config, thresholdPercent: 0 })).toMatch(/threshold/);
    expect(poolProblem({ ...config, name: " " })).toMatch(/name/);
  });
});

describe("agentsUsingPool", () => {
  it("lists live agents bound to the pool, by name", () => {
    const agents = [
      { id: "1", name: "Zed", status: "idle", runtimeConfig: { aiConnection: { mode: "router", connectionId: "p" } } },
      { id: "2", name: "Ann", status: "idle", runtimeConfig: { aiConnection: { mode: "router", connectionId: "p" } } },
      { id: "3", name: "Old", status: "terminated", runtimeConfig: { aiConnection: { mode: "router", connectionId: "p" } } },
      { id: "4", name: "Other", status: "idle", runtimeConfig: { aiConnection: { mode: "shared", connectionId: "p" } } },
    ] as unknown as Agent[];
    expect(agentsUsingPool(agents, "p").map((agent) => agent.name)).toEqual(["Ann", "Zed"]);
  });
});
