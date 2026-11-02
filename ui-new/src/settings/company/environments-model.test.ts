import type { Environment, EnvironmentDeleteBlastRadius } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  defaultPatchId,
  agentsOnEnvironment,
  deleteSummary,
  reassignTargets,
  unlistedAgentCount,
  driverLabel,
  effectiveDefaultId,
  emptyEnvironmentForm,
  environmentForm,
  environmentFormProblem,
  environmentPayload,
  environmentSummary,
  sandboxProviders,
  sortEnvironments,
} from "./environments-model";

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
    const sorted = sortEnvironments(
      [env({ id: "b", name: "Box" }), env({ id: "old", name: "Aardvark", status: "archived" }), env({ id: "local", name: "Local", driver: "local" })],
      "local",
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["local", "b", "old"]);
    expect(driverLabel("local")).toBe("This machine");
  });

  it("reads the instance-wide default, falling back to the local environment", () => {
    const environments = [
      env({ id: "box", name: "Box", driver: "ssh" }),
      env({ id: "mine", name: "Mine", driver: "local" }),
      env({ id: "local", name: "Local", driver: "local", metadata: { managedByPaperclip: true } }),
    ];
    expect(effectiveDefaultId("box", environments)).toBe("box");
    expect(effectiveDefaultId(null, environments)).toBe("local");
    // Another organization's environment: this one still runs locally.
    expect(effectiveDefaultId("elsewhere", environments)).toBe("local");
    expect(effectiveDefaultId(null, [env({ id: "box", name: "Box", driver: "ssh" })])).toBeNull();
    expect(defaultPatchId({ id: "box", driver: "ssh" })).toBe("box");
    expect(defaultPatchId({ id: "local", driver: "local" })).toBeNull();
  });

  it("explains a blocked delete", () => {
    expect(deleteSummary(radius({ canDelete: false, deleteBlockedReasons: ["instance_default"] }))).toEqual({
      allowed: false,
      leaseConsent: false,
      lines: ["It's the instance's default environment."],
    });
  });

  it("lets a delete destroy sandboxes kept for reuse, with consent", () => {
    const leased = radius({
      canDelete: false,
      deleteBlockedReasons: ["reusable_sandbox_lease"],
      reusableSandboxLeaseCount: 2,
      reusableSandboxLeaseHolders: [
        { leaseId: "l1", executionWorkspaceId: "w", executionWorkspaceName: "Fix login", issueId: null, issueIdentifier: null, issueTitle: null },
        { leaseId: "l2", executionWorkspaceId: null, executionWorkspaceName: null, issueId: "i", issueIdentifier: "TES-4", issueTitle: "x" },
      ],
    });
    expect(deleteSummary(leased)).toEqual({
      allowed: false,
      leaseConsent: true,
      lines: ["2 sandboxes are kept for reuse (Fix login, TES-4). Close their workspaces first, or destroy them with the delete."],
    });
    expect(deleteSummary(leased, true)).toEqual({ allowed: true, leaseConsent: true, lines: ["2 sandboxes are kept for reuse (Fix login, TES-4). They're destroyed with it."] });
    // Another block stays a block.
    expect(deleteSummary(radius({ canDelete: false, deleteBlockedReasons: ["reusable_sandbox_lease", "instance_default"] }), true).allowed).toBe(false);
  });

  it("finds the agents to move and where they can go", () => {
    const agents = [
      { id: "a", status: "idle", defaultEnvironmentId: "box" },
      { id: "b", status: "terminated", defaultEnvironmentId: "box" },
      { id: "c", status: "paused", defaultEnvironmentId: null },
    ];
    expect(agentsOnEnvironment(agents, "box").map((agent) => agent.id)).toEqual(["a"]);
    const environments = [
      env({ id: "box", name: "Box", driver: "ssh" }),
      env({ id: "other", name: "Other", driver: "ssh" }),
      env({ id: "old", name: "Old", driver: "ssh", status: "archived" }),
      env({ id: "local", name: "Local", driver: "local" }),
    ];
    expect(reassignTargets(environments, "box").map((environment) => environment.id)).toEqual(["other"]);
    expect(unlistedAgentCount(radius({ staticReferences: { ...radius({}).staticReferences, agentDefaultCount: 3 } }), 1)).toBe(2);
  });

  it("lists what a delete affects", () => {
    const summary = deleteSummary(
      radius({
        staticReferences: { ...radius({}).staticReferences, agentDefaultCount: 2, projectSelectionCount: 1 },
        activeRuntimeUse: { activeLeaseCount: 1, activeCustomImageSetupSessionCount: 0, hasActiveRuntimeUse: true },
      }),
    );
    expect(summary).toEqual({ allowed: true, leaseConsent: false, lines: ["2 agents run there by default", "1 project uses it", "It's in use right now."] });
  });
});

describe("the environment form", () => {
  const ssh = env({
    name: "Build box",
    driver: "ssh",
    config: { host: "box.lan", port: 2222, username: "pc", remoteWorkspacePath: "/srv/work", privateKeySecretRef: { type: "secret_ref", secretId: "s1" }, strictHostKeyChecking: false },
  });

  it("reads a saved SSH environment, never its private key", () => {
    const form = environmentForm(ssh);
    expect(form).toMatchObject({ driver: "ssh", sshHost: "box.lan", sshPort: "2222", sshUsername: "pc", sshPrivateKey: "", sshPrivateKeySecretId: "s1", sshStrictHostKeyChecking: false });
  });

  it("sends a pasted key instead of the saved secret, and blanks as null", () => {
    const form = { ...environmentForm(ssh), sshPrivateKey: "  PEM  ", description: " " };
    const payload = environmentPayload(form, { TOKEN: { type: "plain", value: "x" } });
    expect(payload).toMatchObject({ name: "Build box", description: null, driver: "ssh", envVars: { TOKEN: { type: "plain", value: "x" } } });
    expect(payload.config).toMatchObject({ host: "box.lan", port: 2222, privateKey: "PEM", privateKeySecretRef: null, knownHosts: null });
    const picked = environmentPayload(environmentForm(ssh), {});
    expect(picked.config).toMatchObject({ privateKey: null, privateKeySecretRef: { type: "secret_ref", secretId: "s1", version: "latest" } });
  });

  it("keeps a sandbox provider's settings beside its key", () => {
    const sandbox = env({ driver: "sandbox", config: { provider: "e2b", template: "base", streamRunLogs: false } });
    const form = environmentForm(sandbox);
    expect(form).toMatchObject({ driver: "sandbox", sandboxProvider: "e2b", sandboxConfig: { template: "base", streamRunLogs: false } });
    expect(environmentPayload(form, {}).config).toEqual({ provider: "e2b", template: "base", streamRunLogs: false });
    expect(environmentSummary(sandbox, "E2B")).toBe("E2B sandbox · base");
    expect(environmentSummary(ssh)).toBe("pc@box.lan");
  });

  it("says what's missing", () => {
    expect(environmentFormProblem(emptyEnvironmentForm())).toBe("Give the environment a name.");
    expect(environmentFormProblem({ ...emptyEnvironmentForm(), name: "Box", sshHost: "h", sshUsername: "u", sshRemoteWorkspacePath: "/w", sshPort: "70000" })).toMatch(/1 to 65535/);
    expect(environmentFormProblem({ ...emptyEnvironmentForm(), name: "Box", driver: "sandbox", sandboxProvider: "fake" })).toBe("Pick a sandbox provider.");
    expect(environmentFormProblem({ ...environmentForm(ssh) })).toBeNull();
  });

  it("offers run-capable sandbox providers, keeping a saved one whose plugin is gone", () => {
    const capability = (displayName: string, supportsRunExecution: boolean) =>
      ({ displayName, supportsRunExecution, configSchema: { type: "object", properties: { template: { type: "string" } } } }) as never;
    const capabilities = { adapters: [], drivers: {}, sandboxProviders: { fake: capability("Fake", true), e2b: capability("E2B", true), probeOnly: capability("Probe", false) } } as never;
    expect(sandboxProviders(capabilities).map((option) => option.provider)).toEqual(["e2b"]);
    expect(sandboxProviders(capabilities, "daytona").map((option) => option.provider)).toEqual(["e2b", "daytona"]);
  });
});
