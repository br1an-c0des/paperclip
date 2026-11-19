import { describe, expect, it } from "vitest";
import {
  AGENT_ACCESS_LEVELS,
  agentAccessSchema,
  capAgentAccess,
  hasAgentAccess,
  resolveAgentAccess,
} from "./agent-access.js";

describe("agent access", () => {
  it("resolves a missing access to worker", () => {
    const access = resolveAgentAccess(undefined);
    expect(access["tasks:update_own"]).toBe(true);
    expect(access["tasks:update_any"]).toBe(false);
    expect(resolveAgentAccess(null)).toEqual(resolveAgentAccess({ level: "worker" }));
  });

  it("no level grants tasks:delete", () => {
    for (const level of AGENT_ACCESS_LEVELS) {
      expect(resolveAgentAccess({ level })["tasks:delete"]).toBe(false);
    }
  });

  it("admin includes api:raw, manager doesn't", () => {
    expect(resolveAgentAccess({ level: "admin" })["api:raw"]).toBe(true);
    expect(resolveAgentAccess({ level: "manager" })["api:raw"]).toBe(false);
  });

  it("an override replaces the level value", () => {
    expect(resolveAgentAccess({ level: "admin", overrides: { "api:raw": false } })["api:raw"]).toBe(false);
    expect(resolveAgentAccess({ level: "worker", overrides: { "tasks:delete": true } })["tasks:delete"]).toBe(true);
  });

  it("a scoped override is kept", () => {
    const access = resolveAgentAccess({
      level: "worker",
      overrides: { "tasks:assign": { scope: { projectIds: ["p"] } } },
    });
    expect(access["tasks:assign"]).toEqual({ scope: { projectIds: ["p"] } });
  });

  it("cap intersects", () => {
    const capped = capAgentAccess(resolveAgentAccess({ level: "admin" }), resolveAgentAccess({ level: "manager" }));
    expect(capped["agents:configure"]).toBe(false);
    expect(capped["tasks:update_any"]).toBe(true);

    const scoped = { scope: { projectIds: ["p"] } };
    const capScoped = { scope: { projectIds: ["q"] } };
    expect(capAgentAccess(
      resolveAgentAccess({ level: "worker", overrides: { "tasks:assign": scoped } }),
      resolveAgentAccess({ level: "worker", overrides: { "tasks:assign": capScoped } }),
    )["tasks:assign"]).toEqual(scoped);
    expect(capAgentAccess(
      resolveAgentAccess({ level: "manager" }),
      resolveAgentAccess({ level: "worker", overrides: { "tasks:assign": capScoped } }),
    )["tasks:assign"]).toEqual(capScoped);
  });

  it("hasAgentAccess with an array is any-of", () => {
    const worker = resolveAgentAccess({ level: "worker" });
    expect(hasAgentAccess(worker, "tasks:update_any")).toBe(false);
    expect(hasAgentAccess(worker, ["tasks:update_own", "tasks:update_any"])).toBe(true);
    expect(hasAgentAccess(worker, ["tasks:update_any", "tasks:delete"])).toBe(false);
    expect(hasAgentAccess(
      resolveAgentAccess({ level: "worker", overrides: { "tasks:assign": { scope: {} } } }),
      "tasks:assign",
    )).toBe(true);
  });

  it("the schema rejects unknown actions and levels", () => {
    expect(agentAccessSchema.safeParse({ level: "manager", overrides: { "tasks:delete": true } }).success).toBe(true);
    expect(agentAccessSchema.safeParse({ level: "worker", overrides: { "tasks:assign": { scope: { projectIds: ["p"] } } } }).success).toBe(true);
    expect(agentAccessSchema.safeParse({ level: "owner" }).success).toBe(false);
    expect(agentAccessSchema.safeParse({ level: "worker", overrides: { "tasks:nuke": true } }).success).toBe(false);
    expect(agentAccessSchema.safeParse({ level: "worker", extra: 1 }).success).toBe(false);
  });
});
