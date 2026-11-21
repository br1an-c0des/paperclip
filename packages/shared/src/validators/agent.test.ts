import { describe, expect, it } from "vitest";
import { createAgentSchema, updateAgentSchema } from "./agent.js";

describe("agent update schema", () => {
  it.each(["paused", "idle", "terminated"])("accepts lifecycle status request %s", status => {
    expect(updateAgentSchema.parse({ status })).toEqual({ status });
  });
  it.each(["active", "running", "error", "pending_approval"])("rejects direct status write %s", status => {
    const result = updateAgentSchema.safeParse({ name: "Renamed", status });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["status"] }),
    ]));
  });
  it.each([{ spentMonthlyCents: 0 }, { name: "Renamed", spentMonthlyCents: 10 }])("rejects spend totals: %j", payload => {
    const result = updateAgentSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["spentMonthlyCents"] }),
    ]));
  });
  it("accepts profile and budget limit changes", () => {
    expect(updateAgentSchema.parse({ name: "Renamed", budgetMonthlyCents: 100 })).toEqual({ name: "Renamed", budgetMonthlyCents: 100 });
  });
});

describe("runtimeConfig.github", () => {
  it.each([true, false])("accepts useServerLogin %s on create and update", useServerLogin => {
    const runtimeConfig = { github: { useServerLogin } };
    expect(updateAgentSchema.parse({ runtimeConfig })).toEqual({ runtimeConfig });
    expect(createAgentSchema.parse({ name: "Builder", adapterType: "claude_local", runtimeConfig }).runtimeConfig).toEqual(runtimeConfig);
  });
  it("keeps it beside the other runtime settings", () => {
    const runtimeConfig = { heartbeat: { enabled: false }, github: {} };
    expect(updateAgentSchema.parse({ runtimeConfig })).toEqual({ runtimeConfig });
  });
  it.each([{ useServerLogin: "yes" }, { useServerLogin: true, token: "x" }, "on"])("rejects %j", github => {
    const result = updateAgentSchema.safeParse({ runtimeConfig: { github } });
    expect(result.success).toBe(false);
  });
});
