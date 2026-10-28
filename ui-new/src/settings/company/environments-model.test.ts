import type { Environment, EnvironmentDeleteBlastRadius } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { deleteSummary, driverLabel, isInstanceDefault, sortEnvironments } from "./environments-model";

function env(overrides: Partial<Environment>): Environment {
  return {
    id: "e",
    name: "E",
    description: null,
    driver: "ssh",
    status: "active",
    config: {},
    envVars: {},
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function radius(overrides: Partial<EnvironmentDeleteBlastRadius>): EnvironmentDeleteBlastRadius {
  return {
    environmentId: "e",
    canDelete: true,
    deleteBlockedReasons: [],
    staticReferences: {
      isManagedLocal: false,
      isInstanceDefault: false,
      agentDefaultCount: 0,
      executionWorkspaceSelectionCount: 0,
      issueSelectionCount: 0,
      projectSelectionCount: 0,
      secretBindingCount: 0,
    },
    activeRuntimeUse: { activeLeaseCount: 0, activeCustomImageSetupSessionCount: 0, hasActiveRuntimeUse: false },
    pendingCleanupLeaseCount: 0,
    reusableSandboxLeaseCount: 0,
    reusableSandboxLeaseHolders: [],
    ...overrides,
  };
}

describe("environments", () => {
  it("puts the default first and archived last", () => {
    const sorted = sortEnvironments([
      env({ id: "b", name: "Box" }),
      env({ id: "old", name: "Aardvark", status: "archived" }),
      env({ id: "local", name: "Local", driver: "local", metadata: { defaultForInstance: true } }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["local", "b", "old"]);
    expect(isInstanceDefault(sorted[0]!)).toBe(true);
    expect(driverLabel("local")).toBe("This machine");
  });

  it("explains a blocked delete", () => {
    expect(deleteSummary(radius({ canDelete: false, deleteBlockedReasons: ["instance_default"] }))).toEqual({
      allowed: false,
      lines: ["It's the instance's default environment."],
    });
  });

  it("lists what a delete affects", () => {
    const summary = deleteSummary(
      radius({
        staticReferences: { ...radius({}).staticReferences, agentDefaultCount: 2, projectSelectionCount: 1 },
        activeRuntimeUse: { activeLeaseCount: 1, activeCustomImageSetupSessionCount: 0, hasActiveRuntimeUse: true },
      }),
    );
    expect(summary).toEqual({ allowed: true, lines: ["2 agents run there by default", "1 project uses it", "It's in use right now."] });
  });
});
