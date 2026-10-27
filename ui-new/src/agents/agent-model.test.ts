import type { AgentConfigRevision, BudgetPolicySummary } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { AdapterInfo } from "@/api/agents";
import {
  agentBudgetRequests,
  agentView,
  buildRuntimePatch,
  canQualifyRunnerEnvironment,
  changedKeyLabel,
  harnessType,
  headerSummary,
  intervalLabel,
  isMemoryFile,
  latestRevision,
  managerCandidates,
  memoryFor,
  probeQualified,
  revisionConfigChanges,
  runnerOffer,
  runtimeDraft,
  runtimeIdentity,
  runtimeProblem,
  runUsage,
  skillToggle,
  textEdit,
} from "./agent-model";

/** An agent with only the fields the model reads. */
function agent(adapterType: string, adapterConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    adapterType,
    adapterConfig,
    runtimeConfig: {},
    defaultEnvironmentId: null,
    role: "general",
    title: null,
    spentMonthlyCents: 0,
    budgetMonthlyCents: 0,
    ...extra,
  } as never;
}

/** Bob: Claude Code through the Paperclip Runner. */
const bob = () =>
  agent(
    "paperclip_runner",
    { provider: "acpx", acpxAgent: "claude", model: "claude-opus-5-5", env: { SECRET: { type: "secret_ref", secretId: "s1" } } },
    {
      runtimeConfig: {
        aiConnection: { id: "conn-1" },
        heartbeat: { enabled: false, intervalSec: 300, wakeOnDemand: true, maxTurnContinuation: { enabled: true, maxAttempts: 2, delayMs: 1000, note: "kept" } },
      },
    },
  );

function adapter(type: string, extra: Partial<AdapterInfo> = {}): AdapterInfo {
  return {
    type,
    label: type,
    source: "builtin",
    disabled: false,
    capabilities: { supportsInstructionsBundle: true, supportsSkills: true, supportsLocalAgentJwt: true, supportsAcp: false },
    ...extra,
  };
}

describe("harness and runner", () => {
  it("reads the harness through the Paperclip Runner's provider", () => {
    expect(harnessType("paperclip_runner", { provider: "acpx", acpxAgent: "claude" })).toBe("claude_local");
    expect(harnessType("paperclip_runner", { provider: "acpx" })).toBe("claude_local");
    expect(harnessType("paperclip_runner", { provider: "codex" })).toBe("codex_local");
    expect(harnessType("paperclip_runner", {})).toBe("codex_local");
    expect(harnessType("paperclip_runner", { provider: "opencode" })).toBe("opencode_local");
    expect(harnessType("paperclip_runner", { provider: "acpx", acpxAgent: "copilot" })).toBe("acpx:copilot");
    expect(harnessType("claude_local", { provider: "ignored" })).toBe("claude_local");
  });

  it("labels the harness with its runner where there's a choice", () => {
    expect(runtimeIdentity(bob()).label).toBe("Claude Code · Paperclip Runner");
    expect(runtimeIdentity(agent("claude_local")).label).toBe("Claude Code · Legacy runner");
    expect(runtimeIdentity(agent("codex_local")).label).toBe("Codex · Legacy runner");
    const process = runtimeIdentity(agent("process"));
    expect(process.label).toBe("Process");
    expect(process.runnerApplies).toBe(false);
    expect(runtimeIdentity(agent("gemini_local")).label).toBe("Gemini CLI");
  });

  it("offers the Runner only where the adapters list allows it", () => {
    const legacyClaude = agent("claude_local");
    const runner = adapter("paperclip_runner");
    const upgradeable = adapter("claude_local", { supportedRunners: ["legacy", "paperclip"], defaultRunner: "paperclip" });
    expect(runnerOffer(legacyClaude, [upgradeable, runner], null)).toEqual({ kind: "upgrade" });
    expect(runnerOffer(legacyClaude, undefined, null)).toEqual({ kind: "none" });
    expect(runnerOffer(legacyClaude, [upgradeable, adapter("paperclip_runner", { disabled: true })], null)).toEqual({ kind: "none", reason: "runner-disabled" });
    expect(runnerOffer(legacyClaude, [adapter("claude_local", { disabled: true }), runner], null)).toEqual({ kind: "none", reason: "harness-unavailable" });

    const legacyHere = adapter("claude_local", { supportedRunners: ["legacy"], defaultRunner: "legacy" });
    expect(runnerOffer(legacyClaude, [legacyHere, runner], null)).toEqual({ kind: "none", reason: "not-supported-here" });
    const sandbox = { driver: "sandbox", status: "active", config: { image: `ghcr.io/acme/agent@sha256:${"a".repeat(64)}` } } as never;
    expect(runnerOffer(legacyClaude, [legacyHere, runner], sandbox)).toEqual({ kind: "qualify" });

    expect(runnerOffer(bob(), [upgradeable, runner], null)).toEqual({ kind: "legacy-available" });
    expect(runnerOffer(bob(), [adapter("claude_local", { supportedRunners: ["paperclip"] }), runner], null)).toEqual({ kind: "none" });
    expect(runnerOffer(agent("process"), [adapter("process"), runner], null)).toEqual({ kind: "none" });
  });

  it("qualifies only sandboxes pinned to an image digest or a Daytona snapshot", () => {
    expect(canQualifyRunnerEnvironment({ driver: "sandbox", config: { image: `img@sha256:${"0".repeat(64)}` } } as never)).toBe(true);
    expect(canQualifyRunnerEnvironment({ driver: "sandbox", config: { image: "img:latest" } } as never)).toBe(false);
    expect(canQualifyRunnerEnvironment({ driver: "sandbox", config: { provider: "daytona", snapshot: "snap-1" } } as never)).toBe(true);
    expect(canQualifyRunnerEnvironment({ driver: "local", config: {} } as never)).toBe(false);
    expect(canQualifyRunnerEnvironment(null)).toBe(false);
  });

  it("reads a qualify probe", () => {
    expect(probeQualified({ ok: true, details: { platformQualificationRecorded: true, leaseId: "l1" } })).toBeNull();
    expect(probeQualified({ ok: true, details: { platformQualificationDiagnostic: "No node" } })).toBe("No node");
    expect(probeQualified({ ok: false, summary: "Timed out", details: null })).toBe("Timed out");
  });
});

describe("agentView", () => {
  it("sends the agent's own address to the chat", () => {
    expect(agentView("")).toEqual({ view: "chat" });
    expect(agentView("overview")).toEqual({ view: "chat" });
    expect(agentView("dashboard/")).toEqual({ view: "chat" });
  });

  it("maps sections and the old UI's tab names", () => {
    expect(agentView("runtime")).toEqual({ view: "settings", section: "runtime" });
    expect(agentView("configuration")).toEqual({ view: "settings", section: "runtime" });
    expect(agentView("prompts")).toEqual({ view: "settings", section: "instructions" });
    expect(agentView("api-keys")).toEqual({ view: "settings", section: "keys" });
    expect(agentView("budgets")).toEqual({ view: "settings", section: "budget" });
    expect(agentView("permissions")).toEqual({ view: "settings", section: "permissions" });
    expect(agentView("settings")).toEqual({ view: "settings", section: "profile" });
    expect(agentView("settings/trust")).toEqual({ view: "settings", section: "permissions" });
  });

  it("returns null for unknown names", () => {
    expect(agentView("nowhere")).toBeNull();
    expect(agentView("settings/nowhere")).toBeNull();
  });
});

describe("profile", () => {
  it("builds text patches only for real changes", () => {
    expect(textEdit("name", "Bob", " Bob ")).toBeNull();
    expect(textEdit("name", "Bob", "")).toBeNull();
    expect(textEdit("name", "Bob", "Robert")).toEqual({ name: "Robert" });
    expect(textEdit("title", "Lead", "")).toEqual({ title: null });
    expect(textEdit("capabilities", null, "Writes code")).toEqual({ capabilities: "Writes code" });
  });

  it("leaves the agent, its reports and retired agents out of the managers", () => {
    const agents = [
      { id: "ceo", reportsTo: null, status: "idle" },
      { id: "bob", reportsTo: "ceo", status: "idle" },
      { id: "report", reportsTo: "bob", status: "idle" },
      { id: "deep", reportsTo: "report", status: "idle" },
      { id: "peer", reportsTo: "ceo", status: "idle" },
      { id: "gone", reportsTo: null, status: "terminated" },
    ] as never[] as { id: string; reportsTo: string | null; status: string }[];
    expect(managerCandidates(agents as never, "bob").map((entry: { id: string }) => entry.id)).toEqual(["ceo", "peer"]);
  });

  it("summarizes the header line", () => {
    expect(headerSummary({ agent: bob(), modelLabel: "Claude Opus 5.5" })).toBe("General · Claude Code · Paperclip Runner · Claude Opus 5.5 · $0.00 spent this month");
    expect(headerSummary({ agent: agent("process", {}, { title: "Builder", spentMonthlyCents: 1250, budgetMonthlyCents: 5000 }), managerName: "Ada" })).toBe(
      "Builder · reports to Ada · Process · $12.50 of $50.00 this month",
    );
  });
});

describe("model and runtime", () => {
  it("returns no patch when nothing changed", () => {
    expect(buildRuntimePatch(bob(), runtimeDraft(bob()))).toBeNull();
  });

  it("sends the whole adapter config with replaceAdapterConfig for a model change", () => {
    const draft = { ...runtimeDraft(bob()), model: "claude-sonnet-5" };
    const patch = buildRuntimePatch(bob(), draft)!;
    expect(patch.replaceAdapterConfig).toBe(true);
    expect(patch.adapterConfig).toEqual({ provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-5", env: { SECRET: { type: "secret_ref", secretId: "s1" } } });
    expect(patch.runtimeConfig).toBeUndefined();
    expect(patch.runner).toBeUndefined();
  });

  it("removes a cleared adapter field", () => {
    const withCommand = agent("claude_local", { command: "claude", model: "m" });
    const patch = buildRuntimePatch(withCommand, { ...runtimeDraft(withCommand), command: "  " })!;
    expect(patch.adapterConfig).toEqual({ model: "m" });
  });

  it("keeps the AI connection and other run policy when the heartbeat changes", () => {
    const draft = { ...runtimeDraft(bob()), heartbeatEnabled: true, intervalSec: "900", continueAttempts: "3" };
    const patch = buildRuntimePatch(bob(), draft)!;
    expect(patch.adapterConfig).toBeUndefined();
    expect(patch.runtimeConfig).toEqual({
      aiConnection: { id: "conn-1" },
      heartbeat: { enabled: true, intervalSec: 900, wakeOnDemand: true, maxTurnContinuation: { enabled: true, maxAttempts: 3, delayMs: 1000, note: "kept" } },
    });
  });

  it("turns provider tracing on and off without losing other debug settings", () => {
    const traced = agent("claude_local", {}, { runtimeConfig: { debug: { providerTrace: "raw", other: 1 } } });
    expect(buildRuntimePatch(traced, { ...runtimeDraft(traced), providerTrace: false })!.runtimeConfig).toEqual({ debug: { other: 1 } });
    const plain = agent("claude_local");
    expect(buildRuntimePatch(plain, { ...runtimeDraft(plain), providerTrace: true })!.runtimeConfig).toEqual({ debug: { providerTrace: "raw" } });
  });

  it("converts the timeout to seconds and sends the environment and runner", () => {
    const legacy = agent("claude_local");
    const patch = buildRuntimePatch(legacy, { ...runtimeDraft(legacy), timeoutMin: "1.5", environmentId: "env-1", runner: "paperclip" })!;
    expect((patch.adapterConfig as Record<string, unknown>).timeoutSec).toBe(90);
    expect(patch.defaultEnvironmentId).toBe("env-1");
    expect(patch.runner).toBe("paperclip");
  });

  it("keeps a process agent's arguments in args", () => {
    const process = agent("process", { command: "echo", args: ["ok"] });
    const draft = runtimeDraft(process);
    expect(draft.extraArgs).toBe("ok");
    expect(buildRuntimePatch(process, { ...draft, extraArgs: "ok, again" })!.adapterConfig).toEqual({ command: "echo", args: ["ok", "again"] });
    const claude = agent("claude_local", { extraArgs: ["--verbose"] });
    expect(buildRuntimePatch(claude, { ...runtimeDraft(claude), extraArgs: "" })!.adapterConfig).toEqual({});
  });

  it("doesn't send a runner the agent already has", () => {
    expect(buildRuntimePatch(bob(), { ...runtimeDraft(bob()), runner: "paperclip" })).toBeNull();
  });

  it("checks the numbers before saving", () => {
    const draft = runtimeDraft(bob());
    expect(runtimeProblem(draft)).toBeNull();
    expect(runtimeProblem({ ...draft, heartbeatEnabled: true, intervalSec: "10" })).toBe("The heartbeat interval must be at least 30.");
    expect(runtimeProblem({ ...draft, maxConcurrentRuns: "0" })).toBe("Runs at once must be between 1 and 100.");
    expect(runtimeProblem({ ...draft, cooldownSec: "2.5" })).toBe("The cooldown must be a whole number.");
    expect(runtimeProblem({ ...draft, timeoutMin: "soon" })).toMatch(/minutes/);
    expect(runtimeProblem({ ...draft, continueEnabled: false, continueAttempts: "x" })).toBeNull();
  });

  it("names heartbeat intervals", () => {
    expect(intervalLabel(300)).toBe("Every 5 minutes");
    expect(intervalLabel(7200)).toBe("Every 2 hours");
    expect(intervalLabel(120)).toBe("Every 2 minutes");
    expect(intervalLabel(45)).toBe("Every 45 seconds");
  });
});

describe("revisions", () => {
  const revision = (createdAt: string, before: Record<string, unknown>, after: Record<string, unknown>) =>
    ({ id: createdAt, createdAt, beforeConfig: { adapterConfig: before }, afterConfig: { adapterConfig: after } }) as unknown as AgentConfigRevision;

  it("numbers the latest revision by count", () => {
    const latest = latestRevision([revision("2026-10-26T10:00:00Z", {}, {}), revision("2026-10-27T10:00:00Z", {}, {})]);
    expect(latest?.number).toBe(2);
    expect(latest?.revision.createdAt).toBe("2026-10-27T10:00:00Z");
    expect(latestRevision([])).toBeNull();
  });

  it("lists the adapter keys a revision changed", () => {
    expect(revisionConfigChanges(revision("x", { model: "a", effort: "low", same: 1 }, { model: "b", same: 1, chrome: true }))).toEqual(["chrome", "effort", "model"]);
    expect(changedKeyLabel("adapterConfig")).toBe("harness settings");
    expect(changedKeyLabel("name")).toBe("name");
  });
});

describe("memory", () => {
  it("says which memory applies", () => {
    expect(memoryFor(bob(), true)).toEqual({ kind: "agent-files", claudeAutoMemory: "per-session" });
    expect(memoryFor(agent("paperclip_runner", { provider: "acpx", acpxAgent: "claude", homeMode: "preconfigured" }), true).claudeAutoMemory).toBe("home");
    expect(memoryFor(agent("claude_local"), true)).toEqual({ kind: "agent-files", claudeAutoMemory: "home" });
    expect(memoryFor(agent("process"), false)).toEqual({ kind: "none", claudeAutoMemory: null });
    expect(memoryFor(agent("process"), undefined).kind).toBe("unknown");
  });

  it("recognises the memory files", () => {
    expect(isMemoryFile("MEMORY.md")).toBe(true);
    expect(isMemoryFile("memory/2026-10-27.md")).toBe(true);
    expect(isMemoryFile("life/projects/a.md")).toBe(true);
    expect(isMemoryFile("AGENTS.md")).toBe(false);
  });
});

describe("budget", () => {
  const policy = (windowKind: "calendar_month_utc" | "lifetime", amount: number) =>
    ({ scopeType: "agent", scopeId: "bob", metric: "billed_cents", windowKind, amount }) as BudgetPolicySummary;
  const scope = { scopeType: "agent", scopeId: "bob", metric: "billed_cents" };

  it("sets a monthly budget on the agent", () => {
    expect(agentBudgetRequests("bob", [], { amount: "25", windowKind: "calendar_month_utc", warnPercent: 80, hardStop: true })).toEqual([
      { ...scope, windowKind: "calendar_month_utc", amount: 2500, warnPercent: 80, hardStopEnabled: true },
    ]);
  });

  it("turns a budget off, and the old window off when switching", () => {
    expect(agentBudgetRequests("bob", [policy("calendar_month_utc", 2500)], { amount: "0", windowKind: "calendar_month_utc", warnPercent: 80, hardStop: true })).toEqual([
      { ...scope, windowKind: "calendar_month_utc", amount: 0 },
    ]);
    expect(agentBudgetRequests("bob", [policy("calendar_month_utc", 2500)], { amount: "100", windowKind: "lifetime", warnPercent: 90, hardStop: false })).toEqual([
      { ...scope, windowKind: "lifetime", amount: 10000, warnPercent: 90, hardStopEnabled: false },
      { ...scope, windowKind: "calendar_month_utc", amount: 0 },
    ]);
  });

  it("sends nothing for an amount it can't read", () => {
    expect(agentBudgetRequests("bob", [], { amount: "lots", windowKind: "lifetime", warnPercent: 80, hardStop: true })).toEqual([]);
  });
});

describe("skills and runs", () => {
  it("adds and removes a skill, keeping pinned versions", () => {
    const desired = [
      { key: "a", versionId: "v1" },
      { key: "b", versionId: null },
    ];
    expect(skillToggle(desired, "c", true)).toEqual([...desired, { key: "c", versionId: null }]);
    expect(skillToggle(desired, "a", false)).toEqual([{ key: "b", versionId: null }]);
    expect(skillToggle(desired, "a", true)).toEqual([{ key: "b", versionId: null }, { key: "a", versionId: "v1" }]);
  });

  it("adds up run usage", () => {
    const usage = runUsage([
      { status: "succeeded", inputTokens: 100, cachedInputTokens: "50", outputTokens: 10, costUsd: "0.5" },
      { status: "failed", inputTokens: null, cachedInputTokens: 0, outputTokens: 5, costUsd: 0.25 },
      { status: "running", inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, costUsd: null },
    ] as never);
    expect(usage).toEqual({ count: 3, open: 1, failed: 1, input: 101, cached: 50, output: 15, costUsd: 0.75 });
  });
});
