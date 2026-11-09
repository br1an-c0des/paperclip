import type { AdapterEnvironmentTestResult, AiConnectionList } from "@paperclipai/shared";
import { describe, expect, it, vi } from "vitest";
import type { AdapterInfo } from "@/api/agents";
import {
  boundedCheck,
  SETUP_CHECK_TIMEOUT_MESSAGE,
  antigravityCandidate,
  defaultBinding,
  defaultProfile,
  draftCreateRequest,
  emptySetup,
  harnessChoices,
  hireOutcome,
  hireRequest,
  kimiKeySecrets,
  legacyHireParams,
  needsRunnerQualification,
  preparing,
  previewLine,
  profilePatch,
  profileProblem,
  provisionalAdapter,
  resolveRunner,
  selectedSignIn,
  setupAdapterConfig,
  setupEffortOptions,
  setupFromAgent,
  setupPatch,
  setupProblem,
  setupSignature,
  signInChoices,
  testAllowsHire,
  testBlocks,
  testSetup,
  unfinishedDrafts,
  type ProfileDraft,
  type SetupDraft,
} from "./new-agent-model";

function adapter(type: string, extra: Partial<AdapterInfo> = {}): AdapterInfo {
  return {
    type,
    label: type,
    source: "builtin",
    disabled: false,
    loaded: true,
    supportedRunners: ["legacy"],
    defaultRunner: "legacy",
    capabilities: { supportsInstructionsBundle: true, supportsSkills: true, supportsLocalAgentJwt: true, supportsAcp: false },
    ...extra,
  };
}

const ADAPTERS = [
  adapter("claude_local", { supportedRunners: ["paperclip", "legacy"], defaultRunner: "paperclip" }),
  adapter("codex_local", { supportedRunners: ["paperclip", "legacy"], defaultRunner: "legacy" }),
  adapter("gemini_local"),
  adapter("cursor", { disabled: true }),
  adapter("paperclip_runner"),
  adapter("process"),
];

const profile: ProfileDraft = {
  name: "  Throwaway hire check ",
  role: "researcher",
  title: "",
  capabilities: "Prices options.",
  reportsTo: "ceo-1",
  paletteId: "golden-hour",
};

function setup(extra: Partial<SetupDraft> = {}): SetupDraft {
  return { ...emptySetup("claude_local"), ...extra };
}

function result(status: "pass" | "warn" | "fail", codes: string[] = []): AdapterEnvironmentTestResult {
  return {
    adapterType: "claude_local",
    status,
    testedAt: "2026-10-27T10:00:00.000Z",
    checks: codes.map((code) => ({ code, level: status === "fail" ? "error" : "info", message: code })),
  } as AdapterEnvironmentTestResult;
}

describe("bounded setup checks", () => {
  it("gives up on a stalled check and passes a prompt one through", async () => {
    vi.useFakeTimers();
    try {
      const stalled = boundedCheck(() => new Promise<never>(() => {}), 1000);
      const caught = stalled.catch((cause: Error) => cause.message);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(caught).resolves.toBe(SETUP_CHECK_TIMEOUT_MESSAGE);
      await expect(boundedCheck(async () => "ok", 1000)).resolves.toBe("ok");
      await expect(boundedCheck(async () => Promise.reject(new Error("no")), 1000)).rejects.toThrow("no");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("harness choices", () => {
  it("offers the loaded, enabled harnesses in board order, with how many agents use each", () => {
    const agents = [
      { adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" }, status: "idle", pauseReason: null },
      { adapterType: "claude_local", adapterConfig: {}, status: "running", pauseReason: null },
      { adapterType: "claude_local", adapterConfig: {}, status: "terminated", pauseReason: null },
      { adapterType: "codex_local", adapterConfig: {}, status: "paused", pauseReason: "setup" },
    ] as never[];
    expect(harnessChoices(ADAPTERS, agents)).toEqual([
      { type: "claude_local", label: "Claude Code", meta: "2 agents" },
      { type: "codex_local", label: "Codex", meta: "Not used yet" },
      { type: "gemini_local", label: "Gemini CLI", meta: "Not used yet" },
    ]);
    expect(harnessChoices(undefined, agents)).toEqual([]);
  });

  it("starts drafts on process, or the first harness when process is disabled", () => {
    expect(provisionalAdapter(ADAPTERS)).toBe("process");
    expect(provisionalAdapter([...ADAPTERS.filter((entry) => entry.type !== "process"), adapter("process", { disabled: true })])).toBe("claude_local");
  });
});

describe("runner defaulting", () => {
  it("takes the server's recommendation on auto and names the runner", () => {
    expect(resolveRunner("claude_local", "auto", ADAPTERS)).toEqual({
      applies: true,
      runner: "paperclip",
      recommended: "paperclip",
      alternative: "legacy",
      label: "Claude Code · Paperclip Runner",
    });
    expect(resolveRunner("codex_local", "auto", ADAPTERS)).toMatchObject({ runner: "legacy", alternative: "paperclip", label: "Codex · Legacy runner" });
  });

  it("keeps an explicit pick", () => {
    expect(resolveRunner("claude_local", "legacy", ADAPTERS)).toMatchObject({ runner: "legacy", label: "Claude Code · Legacy runner", alternative: "paperclip" });
  });

  it("falls back to the legacy runner while the adapters load, or when the Runner is disabled", () => {
    expect(resolveRunner("claude_local", "auto", undefined)).toMatchObject({ runner: "legacy", recommended: undefined, alternative: null });
    const off = ADAPTERS.map((entry) => (entry.type === "paperclip_runner" ? { ...entry, disabled: true } : entry));
    expect(resolveRunner("claude_local", "auto", off)).toMatchObject({ runner: "legacy", recommended: "legacy", alternative: null });
  });

  it("has no runner for harnesses only the legacy runner carries", () => {
    expect(resolveRunner("gemini_local", "auto", ADAPTERS)).toEqual({ applies: false, runner: "legacy", recommended: "legacy", alternative: null, label: "Gemini CLI" });
  });

  it("qualifies a sandbox first only for Claude on auto when the Runner isn't recommended yet", () => {
    const sandbox = { driver: "sandbox" as const, config: { image: `repo/img@sha256:${"a".repeat(64)}` } };
    expect(needsRunnerQualification("claude_local", "auto", "legacy", sandbox)).toBe(true);
    expect(needsRunnerQualification("claude_local", "auto", "paperclip", sandbox)).toBe(false);
    expect(needsRunnerQualification("claude_local", "legacy", "legacy", sandbox)).toBe(false);
    expect(needsRunnerQualification("claude_local", "auto", "legacy", { driver: "local" as const, config: {} })).toBe(false);
  });
});

describe("profile", () => {
  it("makes the first agent the CEO, and later ones general agents under the CEO in an unworn palette", () => {
    expect(defaultProfile([])).toMatchObject({ role: "ceo", reportsTo: null, paletteId: "bubblegum-sky" });
    const agents = [{ id: "ceo-1", role: "ceo", status: "idle", appearance: { paletteId: "bubblegum-sky" } }] as never[];
    expect(defaultProfile(agents, "Ada")).toMatchObject({ name: "Ada", role: "general", reportsTo: "ceo-1", paletteId: "pink-lemonade" });
  });

  it("needs a name", () => {
    expect(profileProblem({ ...profile, name: "  " })).toBe("Give the agent a name.");
    expect(profileProblem(profile)).toBeNull();
  });

  it("saves Continue as a paused setup draft on a provisional harness", () => {
    expect(draftCreateRequest(profile, "setup-1")).toEqual({
      setupId: "setup-1",
      name: "Throwaway hire check",
      role: "researcher",
      title: null,
      capabilities: "Prices options.",
      reportsTo: "ceo-1",
      appearance: { schemaVersion: 1, characterVersion: "cap-v1", paletteId: "golden-hour" },
      adapterType: "process",
      metadata: { setupAdapterPending: true },
      runtimeConfig: {
        heartbeat: { enabled: false, intervalSec: 300, wakeOnDemand: true, skipTimerWhenNoActionableWork: true, cooldownSec: 10, maxConcurrentRuns: 20 },
      },
    });
  });

  it("patches only what changed on an existing draft", () => {
    const saved = {
      name: "Throwaway hire check",
      role: "researcher",
      title: null,
      capabilities: "Prices options.",
      reportsTo: "ceo-1",
      appearance: { paletteId: "golden-hour" },
    } as never;
    expect(profilePatch(saved, profile)).toBeNull();
    expect(profilePatch(saved, { ...profile, title: "Analyst", paletteId: "cherry-pop", reportsTo: null })).toEqual({
      title: "Analyst",
      reportsTo: null,
      appearance: { schemaVersion: 1, characterVersion: "cap-v1", paletteId: "cherry-pop" },
    });
  });

  it("sums the profile up for the preview", () => {
    expect(previewLine(profile, "CEO")).toBe("Researcher · reports to CEO");
    expect(previewLine({ ...profile, title: "Head of options" }, null)).toBe("Head of options");
  });
});

describe("draft to request", () => {
  it("builds each harness's config with its effort key and defaults", () => {
    expect(setupAdapterConfig(setup({ model: "claude-opus-5-5", effort: "high" }), "paperclip")).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
      timeoutSec: 0,
      graceSec: 15,
      dangerouslySkipPermissions: true,
    });
    expect(setupAdapterConfig(setup(), "legacy")).toMatchObject({ maxTurnsPerRun: 1000 });
    expect(setupAdapterConfig(setup({ harness: "codex_local", effort: "xhigh", runner: "legacy" }), "legacy")).toMatchObject({
      modelReasoningEffort: "xhigh",
      dangerouslyBypassApprovalsAndSandbox: true,
    });
    // The Paperclip Runner refuses `false` (agent_runner_config_incompatible) and drops the key itself.
    expect(setupAdapterConfig(setup({ harness: "codex_local" }), "paperclip")).toMatchObject({ dangerouslyBypassApprovalsAndSandbox: true });
    expect(setupAdapterConfig(setup({ harness: "pi_local", effort: "high" }), "paperclip")).toMatchObject({ piThinkingLevel: "high" });
    expect(setupAdapterConfig(setup({ harness: "pi_local", effort: "high" }), "legacy")).toMatchObject({ thinking: "high" });
    expect(setupAdapterConfig(setup({ harness: "opencode_local", effort: "low" }), "paperclip")).toMatchObject({ variant: "low" });
  });

  it("keeps the draft's skills, secrets and instructions but drops the provisional harness's keys", () => {
    const saved = { paperclipSkillSync: { desiredSkills: ["a"] }, env: { KEY: { type: "plain", value: "x" } }, command: "echo", provider: "acpx" };
    expect(setupAdapterConfig(setup(), "paperclip", saved)).toEqual({
      paperclipSkillSync: { desiredSkills: ["a"] },
      env: { KEY: { type: "plain", value: "x" } },
      timeoutSec: 0,
      graceSec: 15,
      dangerouslySkipPermissions: true,
    });
  });

  it("saves the harness choices as the harness type with the runner choice", () => {
    const binding = { provider: "anthropic" as const, method: "subscription" as const, mode: "responsible_user" as const };
    const draft = { adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false }, aiConnection: { mode: "router", connectionId: "old" } }, metadata: { setupAdapterPending: true } } as never;
    expect(setupPatch(draft, setup({ environmentId: "env-1", binding }), "paperclip")).toEqual({
      adapterType: "claude_local",
      runner: "auto",
      adapterConfig: { timeoutSec: 0, graceSec: 15, dangerouslySkipPermissions: true },
      replaceAdapterConfig: true,
      defaultEnvironmentId: "env-1",
      runtimeConfig: { heartbeat: { enabled: false }, aiConnection: binding },
      metadata: { setupAdapterPending: false },
    });
    // Its own sign-in clears the connection; a harness without a runner choice sends none.
    const local = setupPatch(draft, setup({ harness: "gemini_local" }), "legacy");
    expect(local.runtimeConfig).toEqual({ heartbeat: { enabled: false } });
    expect(local).not.toHaveProperty("runner");
    expect(local.defaultEnvironmentId).toBeNull();
  });

  it("finishes the draft with the profile and config, sending the runner only when one was picked", () => {
    const draft = { id: "agent-1", adapterConfig: {} } as never;
    const body = hireRequest(draft, profile, setup({ model: "claude-opus-5-5" }), "paperclip");
    expect(body).toMatchObject({
      setupAgentId: "agent-1",
      name: "Throwaway hire check",
      role: "researcher",
      reportsTo: "ceo-1",
      adapterType: "claude_local",
      adapterConfig: { model: "claude-opus-5-5" },
      defaultEnvironmentId: null,
      budgetMonthlyCents: 0,
    });
    expect(body).not.toHaveProperty("runner");
    expect(body.runtimeConfig).not.toHaveProperty("aiConnection");
    expect(hireRequest(draft, profile, setup({ runner: "legacy" }), "legacy")).toMatchObject({ runner: "legacy" });
  });

  it("restores a saved draft's choices, and nothing for one whose harness isn't picked", () => {
    const saved = {
      adapterType: "paperclip_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "claude", model: "claude-opus-5-5", modelReasoningEffort: "high" },
      runtimeConfig: { aiConnection: { provider: "anthropic", method: "subscription", mode: "responsible_user" } },
      defaultEnvironmentId: "env-1",
      metadata: {},
    } as never;
    expect(setupFromAgent(saved)).toEqual({
      harness: "claude_local",
      model: "claude-opus-5-5",
      effort: "high",
      runner: "paperclip",
      environmentId: "env-1",
      binding: { provider: "anthropic", method: "subscription", mode: "responsible_user" },
      secretId: "",
    });
    expect(setupFromAgent({ adapterType: "process", adapterConfig: {}, runtimeConfig: {}, defaultEnvironmentId: null, metadata: { setupAdapterPending: true } } as never)).toEqual(emptySetup());
  });

  it("changes the signature only when a saved choice changes", () => {
    expect(setupSignature(setup({ model: "x " }))).toBe(setupSignature(setup({ model: "x" })));
    expect(setupSignature(setup())).not.toBe(setupSignature(setup({ runner: "legacy" })));
  });

  it("needs a harness, and a provider/model for OpenCode and Pi", () => {
    expect(setupProblem(emptySetup())).toBe("Pick a harness.");
    expect(setupProblem(setup({ harness: "opencode_local", model: "deepseek" }))).toMatch(/provider\/model/);
    expect(setupProblem(setup({ harness: "pi_local", model: "openrouter/deepseek/v4" }))).toBeNull();
    expect(setupProblem(setup())).toBeNull();
  });

  it("gives Pi on the Paperclip Runner its own effort scale", () => {
    expect(setupEffortOptions("pi_local", "", "paperclip").map((option) => option.value)).toEqual(["off", "low", "high", "max"]);
    expect(setupEffortOptions("pi_local", "", "legacy").map((option) => option.value)).toContain("minimal");
    expect(setupEffortOptions("gemini_local", "", "legacy")).toEqual([]);
  });
});

describe("sign-in", () => {
  const list = {
    currentUserId: "me",
    canManageConnections: true,
    connections: [
      { id: "c1", grantId: "g1", provider: "anthropic", method: "subscription", ownership: "personal", ownerUserId: "me", isDefault: true, status: "connected", name: "My Claude" },
      { id: "c2", grantId: "g2", provider: "anthropic", method: "api_key", ownership: "shared", ownerUserId: null, isDefault: false, status: "connected", name: "Team key" },
    ],
  } as unknown as AiConnectionList;

  it("offers the harness's own sign-in, then your connection and the shared ones", () => {
    const choices = signInChoices("claude_local", list);
    expect(choices.map((choice) => choice.id)).toEqual(["local", "responsible_user", "c2"]);
    expect(signInChoices("kimi_local", list).map((choice) => choice.id)).toEqual(["local"]);
    expect(selectedSignIn(choices, null)?.id).toBe("local");
    expect(selectedSignIn(choices, { provider: "anthropic", method: "api_key", mode: "shared", connectionId: "c2", grantId: "g2" })?.id).toBe("c2");
  });

  it("starts on your own connection when you have one", () => {
    expect(defaultBinding("claude_local", list)).toEqual({ provider: "anthropic", method: "subscription", mode: "responsible_user" });
    expect(defaultBinding("codex_local", list)).toBeNull();
    expect(defaultBinding("claude_local", undefined)).toBeNull();
  });
});

describe("test", () => {
  it("blocks on a failure or a missing sign-in", () => {
    expect(testBlocks(result("fail"))).toBe(true);
    expect(testBlocks(result("warn", ["adapter_auth_missing"]))).toBe(true);
    expect(testBlocks(result("pass"))).toBe(false);
  });

  it("lets Claude, Codex and Grok hire only once the sign-in is proved", () => {
    expect(testAllowsHire("claude_local", result("pass"))).toBe(false);
    expect(testAllowsHire("claude_local", result("pass", ["claude_hello_probe_passed"]))).toBe(true);
    expect(testAllowsHire("codex_local", result("warn", ["environment_agent_approval_required"]))).toBe(true);
    expect(testAllowsHire("gemini_local", result("pass"))).toBe(true);
  });

  it("adds the CLI's hello probe on the legacy runner when the first test didn't prove the sign-in", async () => {
    const test = vi
      .fn()
      .mockResolvedValueOnce(result("pass", ["runner_ready"]))
      .mockResolvedValueOnce({ ...result("warn", ["claude_hello_probe_passed"]), testedAt: "later" });
    const merged = await testSetup(test, {
      agentId: "agent-1",
      setup: setup(),
      runner: "paperclip",
      runnerChoice: "auto",
      environmentId: "env-1",
      adapterConfig: { model: "m" },
    });
    expect(test).toHaveBeenNthCalledWith(1, "claude_local", { agentId: "agent-1", adapterConfig: { model: "m" }, environmentId: "env-1" });
    expect(test).toHaveBeenNthCalledWith(2, "claude_local", { agentId: "agent-1", adapterConfig: { model: "m", engine: "cli" }, environmentId: "env-1", runner: "legacy" });
    expect(merged.status).toBe("warn");
    expect(merged.testedAt).toBe("later");
    expect(merged.checks.map((check) => check.code)).toEqual(["runner_ready", "claude_hello_probe_passed"]);
  });

  it("stops after one test for other harnesses or a failure", async () => {
    const test = vi.fn().mockResolvedValue(result("fail", ["broken"]));
    await testSetup(test, { agentId: "a", setup: setup(), runner: "legacy", runnerChoice: "legacy", environmentId: null, adapterConfig: {} });
    expect(test).toHaveBeenCalledTimes(1);
    expect(test.mock.calls[0]![1]).toMatchObject({ runner: "legacy" });
  });
});

describe("drafts and outcome", () => {
  it("lists unfinished setup drafts, newest first", () => {
    const agents = [
      { id: "a", status: "paused", pauseReason: "setup", createdAt: "2026-10-01" },
      { id: "b", status: "idle", pauseReason: null, createdAt: "2026-10-02" },
      { id: "c", status: "paused", pauseReason: "setup", createdAt: "2026-10-03" },
      { id: "d", status: "terminated", pauseReason: "setup", createdAt: "2026-10-04" },
    ] as never[];
    expect(unfinishedDrafts(agents).map((agent: { id: string }) => agent.id)).toEqual(["c", "a"]);
  });

  it("knows when the environment is still being prepared", () => {
    expect(preparing({ pauseReason: "setup", lifecycleState: "preparing", lifecycleError: null } as never)).toBe(true);
    expect(preparing({ pauseReason: "setup", lifecycleState: "preparing", lifecycleError: "boom" } as never)).toBe(false);
    expect(preparing({ pauseReason: "setup", lifecycleState: "paused", lifecycleError: null } as never)).toBe(false);
  });

  it("tells a hire waiting for approval from one that went straight on", () => {
    expect(hireOutcome({ agent: { status: "pending_approval" }, approval: { id: "ap" } })).toBe("approval");
    expect(hireOutcome({ agent: { status: "idle" }, approval: null })).toBe("hired");
  });

  it("reads the old UI's hire links", () => {
    expect(legacyHireParams({ setupAgentId: "a1", name: "Ada", adapterType: "paperclip_runner", runnerProvider: "claude" })).toEqual({
      setupAgentId: "a1",
      createdAgentId: undefined,
      name: "Ada",
      harness: "claude_local",
    });
    expect(legacyHireParams({ adapterType: "http" }).harness).toBeUndefined();
    expect(legacyHireParams({ createdAgentId: "a2" }).createdAgentId).toBe("a2");
    expect(legacyHireParams({ adapterType: "paperclip_runner", runnerProvider: "kimi" }).harness).toBe("kimi_runtime");
    expect(legacyHireParams({ adapterType: "paperclip_runner", runnerProvider: "antigravity" }).harness).toBe("antigravity_runtime");
  });
});

describe("Runner-only harnesses (Kimi Code, Google Antigravity)", () => {
  const candidate = adapter("paperclip_runner", { candidateHarnesses: [{ agent: "antigravity", model: "gemini-3.5-pro" }] });
  const types = (adapters: AdapterInfo[], nativeRunner = true) => harnessChoices(adapters, [], { nativeRunner }).map((choice) => choice.type);

  it("offers Kimi Code on the Runner while the Paperclip Runner setting is on", () => {
    expect(types(ADAPTERS)).toContain("kimi_runtime");
    expect(types(ADAPTERS, false)).not.toContain("kimi_runtime");
    expect(types(ADAPTERS.map((entry) => (entry.type === "paperclip_runner" ? { ...entry, disabled: true } : entry)))).not.toContain("kimi_runtime");
  });

  it("offers Google Antigravity only with an operator's authorization, as a preview", () => {
    expect(types(ADAPTERS)).not.toContain("antigravity_runtime");
    const adapters = [...ADAPTERS.filter((entry) => entry.type !== "paperclip_runner"), candidate];
    expect(types(adapters, false)).toEqual(["claude_local", "codex_local", "gemini_local", "antigravity_runtime"]);
    expect(harnessChoices(adapters, [], {}).find((choice) => choice.type === "antigravity_runtime")).toEqual({ type: "antigravity_runtime", label: "Google Antigravity", meta: "Preview · Not used yet" });
    expect(antigravityCandidate(adapters)).toEqual({ agent: "antigravity", model: "gemini-3.5-pro" });
    expect(antigravityCandidate(ADAPTERS)).toBeNull();
  });

  it("counts Runner Kimi agents apart from the Kimi Code CLI", () => {
    const agents = [
      { adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "kimi" }, status: "idle", pauseReason: null },
      { adapterType: "kimi_local", adapterConfig: {}, status: "idle", pauseReason: null },
    ] as never;
    const choices = harnessChoices([...ADAPTERS, adapter("kimi_local")], agents, { nativeRunner: true });
    expect(choices.find((choice) => choice.type === "kimi_runtime")?.meta).toBe("1 agent");
    expect(choices.find((choice) => choice.type === "kimi_local")?.meta).toBe("1 agent");
  });

  it("saves them as the Paperclip Runner with their ACPX profile", () => {
    expect(resolveRunner("kimi_runtime", "auto", ADAPTERS)).toMatchObject({ applies: false, runner: "paperclip", label: "Kimi Code · Paperclip Runner" });
    const kimi = { ...emptySetup("kimi_runtime"), model: "kimi-code/k3", secretId: "sec-1" };
    const patch = setupPatch({ adapterConfig: { env: { OTHER: "x" } }, runtimeConfig: {}, metadata: { setupAdapterPending: true } } as never, kimi, "paperclip");
    expect(patch.adapterType).toBe("paperclip_runner");
    expect(patch).not.toHaveProperty("runner");
    expect(patch.adapterConfig).toEqual({
      env: { OTHER: "x", KIMI_API_KEY: { type: "secret_ref", secretId: "sec-1", version: "latest" } },
      model: "kimi-code/k3",
      timeoutSec: 0,
      graceSec: 15,
      provider: "acpx",
      acpxAgent: "kimi",
      codexPermissionMode: "never",
      opencodePermissionMode: "allow",
      acpxPermissionMode: "approve-all",
      lifecycleMode: "per_turn",
    });
    const hire = hireRequest({ id: "a1", adapterConfig: {} } as never, profile, { ...emptySetup("antigravity_runtime"), model: "gemini-3.5-pro" }, "paperclip");
    expect(hire).toMatchObject({ adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "antigravity", model: "gemini-3.5-pro" } });
  });

  it("needs an exact model, and Kimi its key", () => {
    expect(setupProblem({ ...emptySetup("kimi_runtime"), secretId: "s" })).toBe("Enter the exact Kimi model ID.");
    expect(setupProblem({ ...emptySetup("kimi_runtime"), model: "kimi-code/k3" })).toMatch(/KIMI_API_KEY/);
    expect(setupProblem({ ...emptySetup("kimi_runtime"), model: "kimi-code/k3", secretId: "s" })).toBeNull();
    expect(setupProblem({ ...emptySetup("antigravity_runtime"), model: "auto" })).toMatch(/exact Google Antigravity model/);
    expect(setupProblem({ ...emptySetup("antigravity_runtime"), model: "gemini-3.5-pro" })).toBeNull();
  });

  it("reopens a saved Runner draft as its choice, with its key", () => {
    const saved = setupFromAgent({
      adapterType: "paperclip_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "kimi", model: "kimi-code/k3", env: { KIMI_API_KEY: { type: "secret_ref", secretId: "sec-9", version: "latest" } } },
      runtimeConfig: {},
      defaultEnvironmentId: null,
      metadata: {},
    } as never);
    expect(saved).toMatchObject({ harness: "kimi_runtime", model: "kimi-code/k3", runner: "auto", secretId: "sec-9" });
  });

  it("signs Antigravity in with a Google connection, and lists Kimi key secrets", () => {
    expect(signInChoices("antigravity_runtime", { connections: [], currentUserId: "u1" } as never).map((choice) => (choice.binding && "provider" in choice.binding ? choice.binding.provider : "local"))).toEqual(["local", "google"]);
    expect(signInChoices("kimi_runtime", undefined)).toHaveLength(1);
    const secrets = [
      { id: "a", key: "OTHER", name: "Another", status: "active" },
      { id: "b", key: "KIMI_API_KEY", name: "Kimi", status: "active" },
      { id: "c", key: "KIMI_API_KEY", name: "Old Kimi", status: "disabled" },
    ] as never[];
    expect(kimiKeySecrets(secrets).map((secret: { id: string }) => secret.id)).toEqual(["b", "a"]);
  });

  it("tests them as the Paperclip Runner", async () => {
    const test = vi.fn().mockResolvedValue(result("pass"));
    await testSetup(test, { agentId: "a1", setup: { ...emptySetup("kimi_runtime"), model: "kimi-code/k3" }, runner: "paperclip", runnerChoice: "auto", environmentId: null, adapterConfig: {} });
    expect(test).toHaveBeenCalledWith("paperclip_runner", expect.not.objectContaining({ runner: expect.anything() }));
  });
});
