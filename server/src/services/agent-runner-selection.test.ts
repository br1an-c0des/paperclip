// Runner selection on the live path: claude_local staying on the legacy runner, and the
// environment company check. Codex, Cursor, Pi, OpenCode, Grok, Kubernetes, SSH, sandbox and the
// Claude-to-Paperclip-Runner translation are in agent-runner-selection.dormant.test.ts (opt-in tier).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ disabled: [] as string[], overridden: new Set<string>(), settings: {} as Record<string, unknown>, getEnvironment: vi.fn(), bindings: vi.fn(), activeTemplate: vi.fn().mockResolvedValue(null), secretPaths: vi.fn().mockResolvedValue(new Set(["apiKey"])), managedEnvironment: vi.fn(), kubernetesEnvironment: vi.fn(), ensureKubernetesEnvironment: vi.fn(), ssh: vi.fn(), resolveEnvironment: vi.fn(), sandboxQualification: vi.fn(), pluginByKey: vi.fn() }));
vi.mock("../adapters/registry.js", () => ({ findActiveServerAdapter: (type: string) => ({ type }), hasActiveAdapterOverride: (type: string) => state.overridden.has(type), waitForExternalAdapters: async () => {} }));
vi.mock("./adapter-plugin-store.js", () => ({ getDisabledAdapterTypes: () => state.disabled }));
vi.mock("./adapter-settings.js", async (original) => ({
  ...await original(),
  adapterSettingsService: () => ({ getDisabledTypes: async () => state.disabled }),
}));
vi.mock("./instance-settings.js", () => ({ instanceSettingsService: () => ({ get: async () => state.settings }) }));
vi.mock("./environments.js", () => ({ environmentService: () => ({ getById: state.getEnvironment, listBoundCompanyIds: state.bindings, findManagedSandboxEnvironment: state.managedEnvironment, findKubernetesEnvironment: state.kubernetesEnvironment, ensureKubernetesEnvironment: state.ensureKubernetesEnvironment }) }));
vi.mock("./environment-custom-images.js", () => ({ environmentCustomImageService: () => ({ getActiveTemplate: state.activeTemplate }) }));
vi.mock("./environment-probe.js", () => ({ readSandboxPlatformQualification: state.sandboxQualification }));
vi.mock("./environment-config.js", async () => ({
  parseEnvironmentDriverConfig: (await vi.importActual<typeof import("./environment-config.js")>("./environment-config.js")).parseEnvironmentDriverConfig,
  resolveEnvironmentDriverConfigForRuntime: state.resolveEnvironment,
  resolveSandboxProviderSecretRefPaths: state.secretPaths,
}));
vi.mock("./plugin-registry.js", () => ({ pluginRegistryService: () => ({ getByKey: state.pluginByKey }) }));
vi.mock("@paperclipai/adapter-utils/ssh", () => ({ runSshCommand: state.ssh }));
import { agentRunnerAvailability, resolveNewAgentRunner, resolveNewAgentRunnerForCompany } from "./agent-runner-selection.js";
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const originalArchitecture = Object.getOwnPropertyDescriptor(process, "arch")!;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); Object.defineProperty(process, "platform", originalPlatform); Object.defineProperty(process, "arch", originalArchitecture); });

describe("server-owned Codex runner selection", () => {
  beforeEach(() => { state.activeTemplate.mockReset().mockResolvedValue(null); });
  beforeEach(() => { state.disabled = []; state.overridden.clear(); state.settings = {}; state.getEnvironment.mockReset(); state.bindings.mockReset().mockResolvedValue([]); state.managedEnvironment.mockReset(); state.kubernetesEnvironment.mockReset().mockResolvedValue(null); state.ensureKubernetesEnvironment.mockReset(); state.ssh.mockReset().mockResolvedValue({ stdout: "Linux\nx86_64\n" }); state.sandboxQualification.mockReset().mockResolvedValue(null); state.resolveEnvironment.mockReset().mockResolvedValue({ driver: "ssh", config: {} }); });
  it("rejects a foreign environment before resolving credentials or probing its platform", async () => {
    state.getEnvironment.mockResolvedValue({ id: "foreign", driver: "ssh", status: "active", config: {} });
    state.bindings.mockResolvedValue(["another-company"]);
    await expect(resolveNewAgentRunnerForCompany({} as never, "company", { adapterType: "codex_local", defaultEnvironmentId: "foreign" })).rejects.toMatchObject({ status: 403, details: { code: "environment_company_mismatch" } });
    expect(state.resolveEnvironment).not.toHaveBeenCalled(); expect(state.ssh).not.toHaveBeenCalled();
  });
});

describe("Claude runner defaults", () => {
  const mac = { driver: "local", platform: "darwin", architecture: "arm64" };
  beforeEach(() => { state.disabled = []; state.overridden.clear(); });
  it.each(["x64", "arm64"])("keeps incompatible Linux Claude %s targets legacy", architecture => {
    for (const libc of ["musl", "unknown"] as const) {
      expect(agentRunnerAvailability("claude_local", { driver: "local", platform: "linux", architecture, libc }).defaultRunner).toBe("legacy");
    }
    expect(agentRunnerAvailability("claude_local", { driver: "local", platform: "linux", architecture, libc: "glibc", glibcVersion: "2.17" }).defaultRunner).toBe("legacy");
  });
  it("keeps a new Claude agent on the classic runner with its engine when no runner is chosen", async () => {
    const adapterConfig = { model: "claude-sonnet-5", engine: "cli", effort: "high" };
    expect(agentRunnerAvailability("claude_local", mac)).toEqual({ supportedRunners: ["paperclip", "legacy"], defaultRunner: "legacy" });
    for (const runner of [undefined, "auto" as const]) {
      expect(resolveNewAgentRunner({ adapterType: "claude_local", target: mac, adapterConfig, runner })).toEqual({ adapterType: "claude_local", adapterConfig });
      await expect(resolveNewAgentRunnerForCompany({} as never, "company", { adapterType: "claude_local", adapterConfig, runner }))
        .resolves.toEqual({ adapterType: "claude_local", adapterConfig });
    }
  });
  it("still converts a new Claude agent to the Paperclip Runner when it's chosen", () => {
    const converted = resolveNewAgentRunner({ adapterType: "claude_local", target: mac, runner: "paperclip", adapterConfig: { model: "claude-sonnet-5", engine: "cli" } });
    expect(converted.adapterType).toBe("paperclip_runner");
    expect(converted.adapterConfig).toMatchObject({ provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5" });
    expect(converted.adapterConfig).not.toHaveProperty("engine");
  });
  it("preserves explicit models and Legacy choices", () => {
    const legacy = { adapterType: "claude_local", target: mac, runner: "legacy" as const, adapterConfig: { model: "custom", chrome: true } };
    expect(resolveNewAgentRunner(legacy)).toEqual({ adapterType: legacy.adapterType, adapterConfig: legacy.adapterConfig });
    expect(resolveNewAgentRunner({ adapterType: "claude_local", target: mac, adapterConfig: { model: "custom" } }).adapterConfig.model).toBe("custom");
  });
  it("retains saved native Claude and allows an explicit compatible Legacy switch", () => {
    const saved = { adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude", model: "custom", acpxPermissionMode: "approve-all", lifecycleMode: "per_turn" } };
    expect(resolveNewAgentRunner(saved)).toEqual(saved);
    expect(resolveNewAgentRunner({ ...saved, runner: "legacy" })).toEqual({ adapterType: "claude_local", adapterConfig: { model: "custom", dangerouslySkipPermissions: true } });
    expect(() => resolveNewAgentRunner({ ...saved, runner: "legacy", adapterConfig: { ...saved.adapterConfig, acpxPermissionMode: "deny-all" } })).toThrow("cannot honor");
  });
  it("rejects invalid effort and unknown platform defaults", () => {
    expect(() => resolveNewAgentRunner({ adapterType: "claude_local", target: mac, runner: "paperclip", adapterConfig: { effort: "ultra" } })).toThrow("Claude effort");
    expect(agentRunnerAvailability("claude_local", { driver: "sandbox" }).defaultRunner).toBe("legacy");
  });
  it("keeps unqualified targets and overrides legacy", () => {
    expect(agentRunnerAvailability("claude_local", { driver: "local", platform: "win32", architecture: "x64" }).defaultRunner).toBe("legacy");
    state.overridden.add("claude_local");
    expect(agentRunnerAvailability("claude_local", mac).defaultRunner).toBe("legacy");
    state.overridden.clear(); state.disabled = ["claude_local"];
    expect(() => resolveNewAgentRunner({ adapterType: "claude_local", target: mac })).toThrow("Claude is disabled");
  });
});
