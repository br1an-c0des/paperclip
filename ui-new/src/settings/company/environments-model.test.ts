import type { Environment, EnvironmentDeleteBlastRadius } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  defaultPatchId,
  agentsOnEnvironment,
  deleteSummary,
  destroyedSandboxesNote,
  keptSandboxes,
  leaseConsentLabel,
  reusableLeaseLine,
  reassignTargets,
  unlistedAgentCount,
  driverLabel,
  draftTestBlock,
  machinePatch,
  networkPatch,
  editScope,
  isManagedPluginEnvironment,
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

  it("tells a managed plugin row from the managed sandbox and the local slot (#19490)", () => {
    const plugin = env({
      id: "plug",
      name: "Remote host",
      driver: "plugin",
      config: { pluginKey: "example.remote-host-plugin", driverKey: "tasks", driverConfig: {} },
      metadata: { managedByPaperclip: true, managedPluginEnvironment: "example.remote-host-plugin:tasks" },
    });
    const sandbox = env({ id: "sb", name: "Paperclip", driver: "sandbox", config: { provider: "daytona" }, metadata: { managedByPaperclip: true } });
    const local = env({ id: "local", name: "Local", driver: "local", metadata: { managedByPaperclip: true } });
    expect(isManagedPluginEnvironment(plugin)).toBe(true);
    expect(isManagedPluginEnvironment(sandbox)).toBe(false);
    // Its variables are hidden and locked; the managed sandbox's and the local slot's are the organization's.
    expect(editScope(plugin)).toBe("none");
    expect(editScope(sandbox)).toBe("variables");
    expect(editScope(local)).toBe("variables");
    // A plugin row someone made: no form for its plugin settings, so only its variables.
    expect(editScope(env({ driver: "plugin", config: { pluginKey: "p", driverKey: "d" } }))).toBe("variables");
    expect(editScope(env({ driver: "ssh" }))).toBe("all");
    expect(environmentSummary(plugin)).toBe("example.remote-host-plugin · tasks");
    // Never picked as the local fallback default; an instance default that names it is kept.
    expect(effectiveDefaultId(null, [plugin, local])).toBe("local");
    expect(effectiveDefaultId("plug", [plugin, local])).toBe("plug");
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
        { leaseId: "l1", leasePolicy: "reuse_by_environment", executionWorkspaceId: "w", executionWorkspaceName: "Fix login", issueId: null, issueIdentifier: null, issueTitle: null },
        { leaseId: "l2", leasePolicy: "reuse_by_environment", executionWorkspaceId: null, executionWorkspaceName: null, issueId: "i", issueIdentifier: "TES-4", issueTitle: "x" },
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
    expect(leaseConsentLabel(leased)).toBe("Destroy the sandboxes kept for reuse. Work left in them is lost.");
    expect(destroyedSandboxesNote(2, leased)).toBe("Destroyed 2 sandboxes kept for reuse.");
    expect(destroyedSandboxesNote(0, leased)).toBeNull();
  });

  describe("a failed run's workspace copy (retain_on_failure)", () => {
    const holder = (leaseId: string, leasePolicy: string, issueIdentifier: string) => ({
      leaseId,
      leasePolicy,
      executionWorkspaceId: null,
      executionWorkspaceName: null,
      issueId: leaseId,
      issueIdentifier,
      issueTitle: null,
    });
    const kept = (...holders: ReturnType<typeof holder>[]) =>
      radius({ canDelete: false, deleteBlockedReasons: ["reusable_sandbox_lease"], reusableSandboxLeaseCount: holders.length, reusableSandboxLeaseHolders: holders });

    it("warns that destroying one of several loses its files", () => {
      const mixed = kept(holder("l1", "reuse_by_environment", "TES-1"), holder("l2", "retain_on_failure", "TES-2"), holder("l3", "reuse_by_environment", "TES-3"));
      expect(keptSandboxes(mixed)).toEqual({ total: 3, recovery: 1 });
      expect(reusableLeaseLine(mixed)).toBe("3 sandboxes are kept (TES-1, TES-2, TES-3).");
      expect(deleteSummary(mixed).lines).toEqual([
        "3 sandboxes are kept (TES-1, TES-2, TES-3). Close their workspaces first, or destroy them with the delete.",
        "1 of them is a failed run's workspace copy kept for file recovery; destroying it loses the files only it holds.",
      ]);
      expect(deleteSummary(mixed, true)).toEqual({
        allowed: true,
        leaseConsent: true,
        lines: [
          "3 sandboxes are kept (TES-1, TES-2, TES-3). They're destroyed with it.",
          "1 of them is a failed run's workspace copy kept for file recovery; destroying it loses the files only it holds.",
        ],
      });
      expect(leaseConsentLabel(mixed)).toBe("Destroy the kept sandboxes, including a failed run's workspace copy. Work and files left in them are lost.");
      expect(destroyedSandboxesNote(3, mixed)).toBe("Destroyed 3 sandboxes.");
    });

    it("agrees in number when several are copies", () => {
      const two = kept(holder("l1", "retain_on_failure", "TES-1"), holder("l2", "retain_on_failure", "TES-2"), holder("l3", "reuse_by_environment", "TES-3"));
      expect(deleteSummary(two, true).lines[1]).toBe("2 of them are failed runs' workspace copies kept for file recovery; destroying them loses the files only they hold.");
      expect(leaseConsentLabel(two)).toContain("including 2 failed runs' workspace copies");
    });

    it("names a lone copy as what it is, and doesn't send the person to close its workspace", () => {
      const one = kept(holder("l1", "retain_on_failure", "TES-9"));
      expect(deleteSummary(one).lines).toEqual([
        "A failed run's workspace copy is kept for file recovery (TES-9). Destroy it with the delete to go ahead.",
        "Destroying it loses the files only it holds.",
      ]);
      expect(deleteSummary(one, true).lines).toEqual([
        "A failed run's workspace copy is kept for file recovery (TES-9). It's destroyed with it.",
        "Destroying it loses the files only it holds.",
      ]);
      const both = kept(holder("l1", "retain_on_failure", "TES-1"), holder("l2", "retain_on_failure", "TES-2"));
      expect(deleteSummary(both).lines).toEqual([
        "2 failed runs' workspace copies are kept for file recovery (TES-1, TES-2). Destroy them with the delete to go ahead.",
        "Destroying them loses the files only they hold.",
      ]);
      expect(leaseConsentLabel(one)).toBe("Destroy the failed run's workspace copy. The files only it holds are lost.");
      expect(leaseConsentLabel(both)).toBe("Destroy the failed runs' workspace copies. The files only they hold are lost.");
    });

    it("names the kept sandboxes when another block stands", () => {
      const blocked = { ...kept(holder("l1", "retain_on_failure", "TES-9")), deleteBlockedReasons: ["instance_default", "reusable_sandbox_lease"] as EnvironmentDeleteBlastRadius["deleteBlockedReasons"] };
      expect(deleteSummary(blocked, true)).toEqual({
        allowed: false,
        leaseConsent: false,
        lines: ["It's the instance's default environment.", "A failed run's workspace copy is kept for file recovery (TES-9)."],
      });
    });
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

  it("starts new SSH environments on the agent's AI account, and reads saved ones without the field as host auth (U157)", () => {
    const fresh = { ...emptyEnvironmentForm(), name: "Box", sshHost: "h", sshUsername: "u", sshRemoteWorkspacePath: "/w" };
    expect(fresh.sshUseHostAuth).toBe(false);
    expect(environmentPayload(fresh, {}).config).toMatchObject({ useHostAuth: false, network: "direct" });
    expect(environmentForm(ssh).sshUseHostAuth).toBe(true);
    expect(environmentPayload(environmentForm(ssh), {}).config).toMatchObject({ useHostAuth: true });
    expect(environmentForm(env({ driver: "ssh", config: { ...ssh.config, useHostAuth: false } })).sshUseHostAuth).toBe(false);
    expect(environmentForm(env({ driver: "ssh", config: { ...ssh.config, useHostAuth: true } })).sshUseHostAuth).toBe(true);
  });

  it("saves a Tailscale machine by its tailnet and stable id (U156)", () => {
    const saved = env({
      driver: "ssh",
      config: { ...ssh.config, network: "tailscale", tailscaleConnectionId: "n1", tailscaleDeviceId: "d1", host: "100.64.0.9", useHostAuth: false },
    });
    const form = environmentForm(saved);
    expect(form).toMatchObject({ sshNetwork: "tailscale", tailscaleConnectionId: "n1", tailscaleDeviceId: "d1", sshHost: "100.64.0.9" });
    expect(environmentPayload(form, {}).config).toMatchObject({ network: "tailscale", tailscaleConnectionId: "n1", tailscaleDeviceId: "d1", host: "100.64.0.9" });
    expect(environmentSummary(saved)).toBe("pc@100.64.0.9 via Tailscale");
    const direct = environmentPayload({ ...form, ...networkPatch("direct"), sshHost: "box.lan" }, {}).config!;
    expect(direct).toMatchObject({ network: "direct", host: "box.lan" });
    expect(direct).not.toHaveProperty("tailscaleConnectionId");
    expect(direct).not.toHaveProperty("tailscaleDeviceId");
  });

  it("starts a new environment on a tailnet from Connections", () => {
    expect(emptyEnvironmentForm({ tailscaleConnectionId: "n1" })).toMatchObject({ sshNetwork: "tailscale", tailscaleConnectionId: "n1", tailscaleDeviceId: "" });
    expect(emptyEnvironmentForm()).toMatchObject({ sshNetwork: "direct", tailscaleConnectionId: "" });
  });

  it("clears the route when the network or machine changes", () => {
    expect(networkPatch("tailscale")).toEqual({
      sshNetwork: "tailscale",
      tailscaleConnectionId: "",
      tailscaleDeviceId: "",
      sshHost: "",
      sshPrivateKey: "",
      sshPrivateKeySecretId: "",
      sshKnownHosts: "",
    });
    expect(machinePatch({ connectionId: "n1", deviceId: "d2", host: "100.64.0.2" })).toMatchObject({
      tailscaleConnectionId: "n1",
      tailscaleDeviceId: "d2",
      sshHost: "100.64.0.2",
      sshPrivateKeySecretId: "",
      sshKnownHosts: "",
    });
  });

  it("needs a tailnet and machine, and tests a Tailscale draft only once it's saved", () => {
    const base = { ...emptyEnvironmentForm({ tailscaleConnectionId: "n1" }), name: "Box", sshUsername: "u", sshRemoteWorkspacePath: "/w" };
    expect(environmentFormProblem({ ...base, tailscaleConnectionId: "" })).toBe("Pick a Tailscale network.");
    expect(environmentFormProblem(base)).toBe("Pick a Tailscale machine.");
    expect(environmentFormProblem({ ...base, tailscaleDeviceId: "d1", sshHost: "100.64.0.1" })).toBeNull();
    expect(draftTestBlock(base)).toMatch(/Save it first/);
    expect(draftTestBlock(emptyEnvironmentForm())).toBeNull();
    expect(draftTestBlock({ ...base, driver: "sandbox" })).toBeNull();
  });

  it("offers run-capable sandbox providers, keeping a saved one whose plugin is gone", () => {
    const capability = (displayName: string, supportsRunExecution: boolean) =>
      ({ displayName, supportsRunExecution, configSchema: { type: "object", properties: { template: { type: "string" } } } }) as never;
    const capabilities = { adapters: [], drivers: {}, sandboxProviders: { fake: capability("Fake", true), e2b: capability("E2B", true), probeOnly: capability("Probe", false) } } as never;
    expect(sandboxProviders(capabilities).map((option) => option.provider)).toEqual(["e2b"]);
    expect(sandboxProviders(capabilities, "daytona").map((option) => option.provider)).toEqual(["e2b", "daytona"]);
  });
});
