import { AGENT_ACCESS_ACTIONS, DEFAULT_AGENT_ACCESS_LEVEL } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  ACTION_WORDS,
  accessSummary,
  actionRows,
  defaultNote,
  lowestLevel,
  overrideOnly,
  storedAccess,
  withAction,
  withLevel,
  withoutOverride,
} from "./access-model";

const row = (rows: ReturnType<typeof actionRows>, action: string) => rows.find((entry) => entry.action === action)!;

describe("access model", () => {
  it("has words for every shared action", () => {
    expect(Object.keys(ACTION_WORDS).sort()).toEqual([...AGENT_ACCESS_ACTIONS].sort());
  });

  it("reads the stored access, or the default level when none is stored", () => {
    expect(storedAccess(undefined)).toEqual({ level: DEFAULT_AGENT_ACCESS_LEVEL });
    expect(storedAccess({})).toEqual({ level: "worker" });
    expect(storedAccess({ access: { level: "nonsense" as never } })).toEqual({ level: "worker" });
    expect(storedAccess({ access: { level: "manager", overrides: { "tasks:delete": true } } })).toEqual({ level: "manager", overrides: { "tasks:delete": true } });
  });

  it("works out each action from the level and the overrides", () => {
    const rows = actionRows({ level: "worker", overrides: { "tasks:assign": true, "tasks:comment": false, "agents:configure": { scope: { agentIds: ["a"] } } } });
    expect(rows.map((entry) => entry.action)).toEqual([...AGENT_ACCESS_ACTIONS]);
    expect(row(rows, "tasks:read")).toMatchObject({ allowed: true, levelDefault: true, override: undefined });
    expect(row(rows, "tasks:comment")).toMatchObject({ allowed: false, levelDefault: true, override: false });
    expect(row(rows, "tasks:assign")).toMatchObject({ allowed: true, levelDefault: false, override: true });
    expect(row(rows, "agents:configure")).toMatchObject({ allowed: true, scoped: true });
    expect(row(rows, "tasks:delete")).toMatchObject({ allowed: false, overrideOnly: true });
  });

  it("says what the level gives, or what a scope or override-only action means", () => {
    const rows = actionRows({ level: "manager", overrides: { "tasks:delete": true, "agents:configure": { scope: {} } } });
    expect(defaultNote(row(rows, "tasks:assign"), "manager")).toBe("Manager has it on.");
    expect(defaultNote(row(rows, "api:raw"), "manager")).toBe("Manager has it off.");
    expect(defaultNote(row(rows, "tasks:delete"), "manager")).toBe("No level includes it.");
    expect(defaultNote(row(actionRows({ level: "admin" }), "tasks:delete"), "admin")).toBe("Off unless turned on here.");
    expect(defaultNote(row(rows, "agents:configure"), "manager")).toBe("Allowed within a scope set through the API.");
  });

  it("knows the lowest level for each action, and that delete is in none", () => {
    expect(lowestLevel("tasks:read")).toBe("read_only");
    expect(lowestLevel("tasks:create")).toBe("worker");
    expect(lowestLevel("labels:manage")).toBe("manager");
    expect(lowestLevel("api:raw")).toBe("admin");
    expect(lowestLevel("tasks:delete")).toBeNull();
    expect(overrideOnly("tasks:delete")).toBe(true);
    expect(overrideOnly("agents:create")).toBe(false);
  });

  it("stores a switch only when it differs from the level", () => {
    expect(withAction({ level: "worker" }, "tasks:assign", true)).toEqual({ level: "worker", overrides: { "tasks:assign": true } });
    expect(withAction({ level: "worker", overrides: { "tasks:assign": true } }, "tasks:assign", false)).toEqual({ level: "worker" });
    expect(withAction({ level: "manager" }, "tasks:assign", false)).toEqual({ level: "manager", overrides: { "tasks:assign": false } });
    // Turning a scoped action off replaces its scope.
    expect(withAction({ level: "admin", overrides: { "tasks:assign": { scope: { x: 1 } } } }, "tasks:assign", false)).toEqual({
      level: "admin",
      overrides: { "tasks:assign": false },
    });
    expect(withoutOverride({ level: "worker", overrides: { "tasks:delete": true, "api:raw": true } }, "tasks:delete")).toEqual({
      level: "worker",
      overrides: { "api:raw": true },
    });
  });

  it("changing the level drops overrides the new level already gives", () => {
    const access = { level: "worker" as const, overrides: { "tasks:assign": true, "tasks:delete": true, "tasks:comment": false, "agents:configure": { scope: {} } } };
    expect(withLevel(access, "manager")).toEqual({ level: "manager", overrides: { "tasks:delete": true, "tasks:comment": false, "agents:configure": { scope: {} } } });
    expect(withLevel({ level: "admin", overrides: { "api:raw": false } }, "manager")).toEqual({ level: "manager" });
  });

  it("sums the access up in a line", () => {
    expect(accessSummary({ level: "manager" })).toBe("Manager.");
    expect(accessSummary({ level: "worker", overrides: { "tasks:delete": true } })).toBe("Worker, with 1 action set for this agent.");
    expect(accessSummary({ level: "read_only", overrides: { "tasks:comment": true, "tasks:create": true } })).toBe("Read only, with 2 actions set for this agent.");
  });
});
