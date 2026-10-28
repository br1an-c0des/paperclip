import type {
  AdapterEnvironmentTestResult,
  Agent,
  AgentRole,
  AgentRunner,
  AiConnectionList,
  AiRuntimeConnectionBinding,
  Environment,
  EnvironmentProbeResult,
} from "@paperclipai/shared";
import type { AdapterInfo } from "@/api/agents";
import { agentConnection, connectionChoices, providerForHarness, sameBinding, type ConnectionChoice } from "@/org/bulk-model";
import { effortKeyFor, effortOptions, type EffortOption } from "@/tasks/run-overrides";
import { AGENT_PALETTES, canQualifyRunnerEnvironment, harnessLabel, harnessType, probeQualified, roleLabel, runnerCapable, runnerLabel } from "../agent-model";

/*
 * New agent's pure logic (boards N2, N3), after the old UI's hire flow
 * (ui/src/components/new-agent/NewAgentSetup.tsx and AgentBasicsDialog.tsx):
 *
 * 1. Profile. Continue saves a paused setup draft (`POST /companies/:id/agents` with a `setupId`).
 *    The harness isn't chosen yet, so the draft carries a provisional `process` adapter and
 *    `metadata.setupAdapterPending`; the setup hold keeps it from running.
 * 2. Harness and model. Each pick that changes the configuration is saved to the draft
 *    (`PATCH /agents/:id`, harness type plus `runner`), which lets the server prepare the draft's
 *    environment. Test checks it (`POST …/adapters/:type/test-environment`), after qualifying a
 *    sandbox for the Paperclip Runner when that's needed (`POST /environments/:id/probe`).
 * 3. Hire finishes the draft (`POST /companies/:id/agent-hires` with `setupAgentId`). When the
 *    organization approves new agents first, the server answers with an approval, the agent waits
 *    as `pending_approval`, and the request shows in the Inbox.
 *
 * The harness's own config is built here from the old UI's per-harness builders
 * (packages/adapters/*\/src/ui/build-config.ts) for the fields this page sets; the server fills
 * the rest (`applyCreateDefaultsByAdapterType`) and converts a harness to the Paperclip Runner
 * when the runner resolves to it (`resolveNewAgentRunnerForCompany`).
 */

// ---------------------------------------------------------------------------------------------
// Harnesses

/** The harnesses New agent offers, in board N3's order. Gateways, cloud agents, process and HTTP need their own setup. */
export const NEW_AGENT_HARNESSES = [
  "claude_local",
  "codex_local",
  "opencode_local",
  "gemini_local",
  "cursor",
  "pi_local",
  "kimi_local",
  "hermes_local",
  "grok_local",
] as const;

export type HarnessChoice = { type: string; label: string; meta: string };

function liveAgent(agent: Pick<Agent, "status" | "pauseReason">) {
  return agent.status !== "terminated" && agent.pauseReason !== "setup";
}

/**
 * The harnesses to pick from: those the server has loaded and enabled, each with how many agents
 * already use it ("8 agents", "Not used yet"). Until the adapters load, none.
 */
export function harnessChoices(
  adapters: readonly AdapterInfo[] | undefined,
  agents: readonly Pick<Agent, "adapterType" | "adapterConfig" | "status" | "pauseReason">[] | undefined,
): HarnessChoice[] {
  if (!adapters) return [];
  const counts = new Map<string, number>();
  for (const agent of agents ?? []) {
    if (!liveAgent(agent)) continue;
    const harness = harnessType(agent.adapterType, (agent.adapterConfig ?? {}) as Record<string, unknown>);
    counts.set(harness, (counts.get(harness) ?? 0) + 1);
  }
  return NEW_AGENT_HARNESSES.filter((type) => {
    const adapter = adapters.find((entry) => entry.type === type);
    return adapter && adapter.loaded !== false && !adapter.disabled && !adapter.overriddenBuiltin;
  }).map((type) => {
    const count = counts.get(type) ?? 0;
    return { type, label: harnessLabel(type), meta: count === 0 ? "Not used yet" : count === 1 ? "1 agent" : `${count} agents` };
  });
}

/** Harnesses whose model is a `provider/model` id and must be chosen (OpenCode, Pi). */
export function requiresProviderModel(harness: string) {
  return harness === "opencode_local" || harness === "pi_local";
}

// ---------------------------------------------------------------------------------------------
// Runner

/** What the page asks for: "auto" takes the server's recommendation for the harness and environment. */
export type RunnerChoice = "auto" | AgentRunner;

export type RunnerResolution = {
  /** False for harnesses only the legacy runner carries: no runner to show. */
  applies: boolean;
  /** The runner the agent will get. */
  runner: AgentRunner;
  /** What the server recommends here (`defaultRunner`), once the adapters have loaded. */
  recommended: AgentRunner | undefined;
  /** The other runner, when it can carry the harness here too. */
  alternative: AgentRunner | null;
  /** "Claude Code · Paperclip Runner", or just "Gemini CLI". */
  label: string;
};

/**
 * The runner a harness gets, as AgentConfigForm resolves `runner: "auto"` (`resolvedRunner`): the
 * server's `defaultRunner` for the harness in the chosen environment, unless one is picked. The
 * Paperclip Runner counts only while its own adapter is enabled.
 */
export function resolveRunner(harness: string, choice: RunnerChoice, adapters: readonly AdapterInfo[] | undefined): RunnerResolution {
  const name = harnessLabel(harness);
  if (!runnerCapable(harness)) return { applies: false, runner: "legacy", recommended: "legacy", alternative: null, label: name };
  const adapter = adapters?.find((entry) => entry.type === harness);
  const native = adapters?.find((entry) => entry.type === "paperclip_runner");
  const nativeUsable = !!native && !native.disabled && !native.overriddenBuiltin;
  const supported = (adapter?.supportedRunners ?? ["legacy"]).filter((runner) => runner !== "paperclip" || nativeUsable);
  const recommended = adapter?.defaultRunner === "paperclip" && !nativeUsable ? "legacy" : adapter?.defaultRunner;
  const runner = choice === "auto" ? (recommended ?? "legacy") : choice;
  const other: AgentRunner = runner === "paperclip" ? "legacy" : "paperclip";
  return {
    applies: true,
    runner,
    recommended,
    alternative: supported.includes(other) ? other : null,
    label: `${name} · ${runnerLabel(runner)}`,
  };
}

/**
 * Whether Test must first qualify the environment for the Paperclip Runner, as the old UI's
 * `needsClaudeSetupQualification`: Claude Code left on "auto", on a sandbox whose image can be
 * qualified, where the server doesn't recommend the Runner yet.
 */
export function needsRunnerQualification(
  harness: string,
  choice: RunnerChoice,
  recommended: AgentRunner | undefined,
  environment: Pick<Environment, "driver" | "config"> | null | undefined,
) {
  return harness === "claude_local" && choice === "auto" && recommended !== "paperclip" && canQualifyRunnerEnvironment(environment);
}

/** Why a qualification probe failed, or null when it recorded the platform (`probeQualified`). */
export function qualificationProblem(probe: EnvironmentProbeResult) {
  return probeQualified(probe);
}

// ---------------------------------------------------------------------------------------------
// Profile

export type ProfileDraft = {
  name: string;
  role: AgentRole;
  title: string;
  capabilities: string;
  reportsTo: string | null;
  paletteId: string;
};

/**
 * A new profile: the CEO when the company has no agents yet (as the old UI), otherwise a general
 * agent reporting to the CEO, with the first palette no agent wears yet.
 */
export function defaultProfile(agents: readonly Pick<Agent, "id" | "role" | "status" | "appearance">[] | undefined, name = ""): ProfileDraft {
  const live = (agents ?? []).filter((agent) => agent.status !== "terminated");
  const ceo = live.find((agent) => agent.role === "ceo");
  const worn = new Set(live.map((agent) => agent.appearance?.paletteId).filter(Boolean));
  return {
    name,
    role: live.length === 0 ? "ceo" : "general",
    title: "",
    capabilities: "",
    reportsTo: ceo?.id ?? null,
    paletteId: AGENT_PALETTES.find((palette) => !worn.has(palette)) ?? AGENT_PALETTES[0],
  };
}

export function profileFromAgent(agent: Pick<Agent, "name" | "role" | "title" | "capabilities" | "reportsTo" | "appearance">): ProfileDraft {
  return {
    name: agent.name,
    role: agent.role as AgentRole,
    title: agent.title ?? "",
    capabilities: agent.capabilities ?? "",
    reportsTo: agent.reportsTo ?? null,
    paletteId: agent.appearance?.paletteId ?? AGENT_PALETTES[0],
  };
}

export function profileProblem(profile: ProfileDraft): string | null {
  if (!profile.name.trim()) return "Give the agent a name.";
  if (profile.name.trim().length > 100) return "Keep the name under 100 characters.";
  return null;
}

function appearance(paletteId: string) {
  return { schemaVersion: 1, characterVersion: "cap-v1", paletteId };
}

/** The profile's fields as the API takes them. */
function profileFields(profile: ProfileDraft) {
  return {
    name: profile.name.trim(),
    role: profile.role,
    title: profile.title.trim() || null,
    capabilities: profile.capabilities.trim() || null,
    reportsTo: profile.reportsTo,
    appearance: appearance(profile.paletteId),
  };
}

/** Run policy for a new agent, as `buildNewAgentRuntimeConfig({ heartbeatEnabled: false })`: it wakes when there's work. */
export function newAgentRuntimeConfig(): Record<string, unknown> {
  return {
    heartbeat: {
      enabled: false,
      intervalSec: 300,
      wakeOnDemand: true,
      skipTimerWhenNoActionableWork: true,
      cooldownSec: 10,
      maxConcurrentRuns: 20,
    },
  };
}

/**
 * `POST /companies/:id/agents` for Continue: a paused setup draft with the profile and a
 * provisional harness (`process`, which the setup hold keeps from running), as AgentBasicsDialog
 * saves it before a harness is picked.
 */
export function draftCreateRequest(profile: ProfileDraft, setupId: string, provisionalAdapter = "process"): Record<string, unknown> {
  return {
    setupId,
    ...profileFields(profile),
    adapterType: provisionalAdapter,
    metadata: { setupAdapterPending: true },
    runtimeConfig: newAgentRuntimeConfig(),
  };
}

/** The adapter a draft starts on: `process`, or the first offered harness when this instance disables it. */
export function provisionalAdapter(adapters: readonly AdapterInfo[] | undefined) {
  const process = adapters?.find((adapter) => adapter.type === "process");
  if (!process || !process.disabled) return "process";
  return harnessChoices(adapters, [])[0]?.type ?? null;
}

/** The profile changes to save on an existing draft, or null when there are none. */
export function profilePatch(agent: Pick<Agent, "name" | "role" | "title" | "capabilities" | "reportsTo" | "appearance">, profile: ProfileDraft) {
  const next = profileFields(profile);
  const patch: Record<string, unknown> = {};
  if (next.name !== agent.name) patch.name = next.name;
  if (next.role !== agent.role) patch.role = next.role;
  if (next.title !== (agent.title ?? null)) patch.title = next.title;
  if (next.capabilities !== (agent.capabilities ?? null)) patch.capabilities = next.capabilities;
  if (next.reportsTo !== (agent.reportsTo ?? null)) patch.reportsTo = next.reportsTo;
  if (profile.paletteId !== agent.appearance?.paletteId) patch.appearance = next.appearance;
  return Object.keys(patch).length ? patch : null;
}

// ---------------------------------------------------------------------------------------------
// Setup: harness, model, sign-in, environment

export type SetupDraft = {
  /** Empty until one is picked. */
  harness: string;
  /** Empty for the harness's default. */
  model: string;
  /** Empty for Auto. */
  effort: string;
  runner: RunnerChoice;
  /** Empty for the organization default. */
  environmentId: string;
  /** The AI connection, or null for the harness's own sign-in on the machine it runs on. */
  binding: AiRuntimeConnectionBinding | null;
};

export function emptySetup(harness = ""): SetupDraft {
  return { harness, model: "", effort: "", runner: "auto", environmentId: "", binding: null };
}

/** A draft whose harness is picked, after a reload or from Agents: its saved choices. */
export function setupFromAgent(agent: Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig" | "defaultEnvironmentId" | "metadata">): SetupDraft {
  if (agent.metadata?.setupAdapterPending === true) return { ...emptySetup(), environmentId: agent.defaultEnvironmentId ?? "" };
  const config = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  const harness = harnessType(agent.adapterType, config);
  const effort = [config.modelReasoningEffort, config.reasoningEffort, config.effort, config.piThinkingLevel, config.thinking, config.variant].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    harness: (NEW_AGENT_HARNESSES as readonly string[]).includes(harness) ? harness : "",
    model: typeof config.model === "string" ? config.model : "",
    effort: effort ?? "",
    // A draft keeps its runner: the server converted it already.
    runner: runnerCapable(harness) ? (agent.adapterType === "paperclip_runner" ? "paperclip" : "legacy") : "auto",
    environmentId: agent.defaultEnvironmentId ?? "",
    binding: agentConnection(agent) ?? null,
  };
}

/** The thinking-effort choices for a harness, model and runner. Pi on the Paperclip Runner has its own scale. */
export function setupEffortOptions(harness: string, model: string, runner: AgentRunner): EffortOption[] {
  if (harness === "pi_local" && runner === "paperclip") {
    return [
      { value: "off", label: "Off" },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
      { value: "max", label: "Max" },
    ];
  }
  return effortOptions(harness, model || null);
}

/** Where a harness reads its effort from. */
function effortKey(harness: string, runner: AgentRunner) {
  if (harness === "pi_local") return runner === "paperclip" ? "piThinkingLevel" : "thinking";
  return effortKeyFor(harness);
}

/** Saved keys a setup draft keeps when its harness settings are rebuilt: role skills, secrets and instructions. */
const KEPT_KEYS = ["paperclipSkillSync", "env", "instructionsFilePath", "instructionsBundleMode", "instructionsRootPath", "instructionsEntryFile"];

/**
 * The harness's adapter config for the draft's choices, after the old UI's builders: the model,
 * effort, the time limits and permission defaults each builder sets. Keys the server keeps on the
 * draft (skills, secrets, instructions) carry over from `saved`.
 */
export function setupAdapterConfig(setup: SetupDraft, runner: AgentRunner, saved: Record<string, unknown> = {}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of KEPT_KEYS) if (saved[key] !== undefined) config[key] = saved[key];
  const model = setup.model.trim();
  if (model) config.model = model;
  switch (setup.harness) {
    case "claude_local":
      Object.assign(config, { timeoutSec: 0, graceSec: 15, dangerouslySkipPermissions: true });
      if (runner === "legacy") config.maxTurnsPerRun = 1000;
      break;
    case "codex_local":
      Object.assign(config, { timeoutSec: 0, graceSec: 15, search: false, fastMode: false, dangerouslyBypassApprovalsAndSandbox: setup.runner === "legacy" });
      break;
    case "opencode_local":
      Object.assign(config, { timeoutSec: 0, graceSec: 20, dangerouslySkipPermissions: true });
      break;
    case "pi_local":
      Object.assign(config, { timeoutSec: 0, graceSec: 20 });
      break;
    case "gemini_local":
      Object.assign(config, { timeoutSec: 0, graceSec: 15, sandbox: true });
      break;
    case "hermes_local":
      Object.assign(config, { timeoutSec: 1800, persistSession: true });
      break;
    default:
      Object.assign(config, { timeoutSec: 0, graceSec: setup.harness === "grok_local" ? 20 : 15 });
  }
  const key = effortKey(setup.harness, runner);
  if (setup.effort && key) config[key] = setup.effort;
  if (setup.effort && setup.harness === "hermes_local") config.extraArgs = ["--reasoning-effort", setup.effort];
  return config;
}

function withoutConnection(runtime: Record<string, unknown> | null | undefined) {
  const { aiConnection: _drop, ...rest } = (runtime ?? {}) as Record<string, unknown>;
  return rest;
}

/**
 * `PATCH /agents/:id` that saves the harness choices to the draft: the harness type with the
 * runner choice (the server converts it to the Paperclip Runner when that's the runner), the whole
 * adapter config, the environment, and the AI connection in the run policy.
 */
export function setupPatch(
  agent: Pick<Agent, "adapterConfig" | "runtimeConfig" | "metadata">,
  setup: SetupDraft,
  runner: AgentRunner,
): Record<string, unknown> {
  return {
    adapterType: setup.harness,
    ...(runnerCapable(setup.harness) ? { runner: setup.runner } : {}),
    adapterConfig: setupAdapterConfig(setup, runner, (agent.adapterConfig ?? {}) as Record<string, unknown>),
    replaceAdapterConfig: true,
    defaultEnvironmentId: setup.environmentId || null,
    runtimeConfig: { ...withoutConnection(agent.runtimeConfig), ...(setup.binding ? { aiConnection: setup.binding } : {}) },
    metadata: { ...(agent.metadata ?? {}), setupAdapterPending: false },
  };
}

/** What a save would change, to tell whether the draft on the server is current. */
export function setupSignature(setup: SetupDraft) {
  return JSON.stringify([setup.harness, setup.model.trim(), setup.effort, setup.runner, setup.environmentId, setup.binding ?? null]);
}

/** Why the setup can't be tested or hired yet, or null. */
export function setupProblem(setup: SetupDraft): string | null {
  if (!setup.harness) return "Pick a harness.";
  if (requiresProviderModel(setup.harness) && !/^[^/\s]+\/\S+$/.test(setup.model.trim())) {
    return `${harnessLabel(setup.harness)} needs a model in provider/model form, such as openrouter/deepseek/deepseek-v4-flash.`;
  }
  return null;
}

/**
 * `POST /companies/:id/agent-hires` that finishes the draft, as the old UI's `finish()` sends it:
 * the profile, the harness and its config, the environment, the run policy with the connection,
 * and no budget. The runner is sent only when one was picked; "auto" lets the server decide.
 */
export function hireRequest(
  agent: Pick<Agent, "id" | "adapterConfig">,
  profile: ProfileDraft,
  setup: SetupDraft,
  runner: AgentRunner,
): Record<string, unknown> {
  return {
    setupAgentId: agent.id,
    ...profileFields(profile),
    adapterType: setup.harness,
    ...(runnerCapable(setup.harness) && setup.runner !== "auto" ? { runner: setup.runner } : {}),
    adapterConfig: setupAdapterConfig(setup, runner, (agent.adapterConfig ?? {}) as Record<string, unknown>),
    defaultEnvironmentId: setup.environmentId || null,
    runtimeConfig: { ...newAgentRuntimeConfig(), ...(setup.binding ? { aiConnection: setup.binding } : {}) },
    budgetMonthlyCents: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Sign-in

export type SignInChoice = { id: string; name: string; description: string; disabled: boolean; binding: AiRuntimeConnectionBinding | null };

/**
 * The sign-ins a harness can use: its own sign-in on the machine it runs on, then the AI connections
 * for its provider (yours, then the company's shared ones), as the old UI's connection field.
 */
export function signInChoices(harness: string, list: AiConnectionList | undefined): SignInChoice[] {
  const local: SignInChoice = {
    id: "local",
    name: "Its own sign-in",
    description: `${harnessLabel(harness)} uses whatever it's signed in with on the machine it runs on.`,
    disabled: false,
    binding: null,
  };
  const provider = providerForHarness(harness);
  if (!provider) return [local];
  return [local, ...connectionChoices(list, provider).map((choice: ConnectionChoice) => ({ ...choice, binding: choice.binding as AiRuntimeConnectionBinding }))];
}

/** The choice a binding stands for. */
export function selectedSignIn(choices: readonly SignInChoice[], binding: AiRuntimeConnectionBinding | null) {
  if (!binding) return choices[0];
  return choices.find((choice) => choice.binding && sameBinding(choice.binding, binding));
}

/** The sign-in a harness starts with: your own connection for its provider when you have one, else its own sign-in. */
export function defaultBinding(harness: string, list: AiConnectionList | undefined): AiRuntimeConnectionBinding | null {
  const provider = providerForHarness(harness);
  if (!provider || !list) return null;
  const mine = list.connections.find(
    (connection) => connection.provider === provider && connection.ownership === "personal" && connection.ownerUserId === list.currentUserId && connection.isDefault && connection.status === "connected",
  );
  return mine ? { provider, method: mine.method, mode: "responsible_user" } : null;
}

// ---------------------------------------------------------------------------------------------
// Test

const AUTH_MISSING = "adapter_auth_missing";

/** A failing test, or one that found no sign-in, blocks the hire (the old UI's `blocking`). */
export function testBlocks(result: AdapterEnvironmentTestResult) {
  return result.status === "fail" || result.checks.some((check) => check.code === AUTH_MISSING);
}

/** Harnesses whose sign-in the test proves with a "hello" probe. */
const PROBED_HARNESSES = new Set(["claude_local", "codex_local", "grok_local"]);

/**
 * Whether a test lets the hire go ahead, as the old UI's `runTest` decides: nothing blocks, and for
 * Claude Code, Codex and Grok the sign-in was proved (a hello probe or a re-verified key), unless
 * the environment itself needs approving first.
 */
export function testAllowsHire(harness: string, result: AdapterEnvironmentTestResult) {
  if (testBlocks(result)) return false;
  if (!PROBED_HARNESSES.has(harness)) return true;
  return result.checks.some(
    (check) => check.code === "environment_agent_approval_required" || check.code.endsWith("hello_probe_passed") || check.code === "ai_connection_api_key_reverified",
  );
}

export type TestEnvironmentApi = (
  adapterType: string,
  body: { adapterConfig: Record<string, unknown>; agentId?: string; environmentId?: string | null; aiConnection?: unknown; runner?: RunnerChoice },
) => Promise<AdapterEnvironmentTestResult>;

/**
 * Tests the setup, as the old UI's `testAgentSetup`: the harness as it will run, then, for Claude
 * Code, Codex and Grok when that didn't prove the sign-in, the harness's CLI on the legacy runner
 * for its hello probe. The two results are merged, one line per check.
 */
export async function testSetup(
  test: TestEnvironmentApi,
  input: { agentId: string; setup: SetupDraft; runner: AgentRunner; runnerChoice: RunnerChoice; environmentId: string | null; adapterConfig: Record<string, unknown> },
): Promise<AdapterEnvironmentTestResult> {
  const body = {
    ...(runnerCapable(input.setup.harness) && input.runnerChoice !== "auto" ? { runner: input.runnerChoice } : {}),
    agentId: input.agentId,
    ...(input.setup.binding ? { aiConnection: input.setup.binding } : {}),
    adapterConfig: input.adapterConfig,
    environmentId: input.environmentId,
  };
  const runtime = await test(input.setup.harness, body);
  const proved = runtime.checks.some((check) => check.code.includes("hello_probe") || check.code === "ai_connection_api_key_reverified");
  if (
    input.setup.binding?.mode === "router" ||
    runtime.checks.some((check) => check.code.startsWith("environment_agent_")) ||
    testBlocks(runtime) ||
    proved ||
    !PROBED_HARNESSES.has(input.setup.harness)
  ) {
    return runtime;
  }
  const provider = await test(input.setup.harness, { ...body, runner: "legacy", adapterConfig: { ...input.adapterConfig, engine: "cli" } });
  const checks = [...new Map([...runtime.checks, ...provider.checks].map((check) => [check.code, check])).values()];
  return {
    adapterType: runtime.adapterType,
    testedAt: provider.testedAt,
    status: provider.status === "fail" ? "fail" : runtime.status === "warn" || provider.status === "warn" ? "warn" : "pass",
    checks,
  };
}

/** "Passed: harness found, signed in, model available", or what went wrong first. */
export function testSummary(result: AdapterEnvironmentTestResult) {
  if (result.status === "pass") return "Passed: harness found, signed in, model available";
  const first = result.checks.find((check) => check.level === "error") ?? result.checks.find((check) => check.level === "warn");
  if (result.status === "warn") return `Passed with warnings${first ? `: ${first.message}` : ""}`;
  return `Failed${first ? `: ${first.message}` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// Drafts and the preview

/** A paused setup draft that hasn't been hired yet. */
export function isSetupDraft(agent: Pick<Agent, "status" | "pauseReason">) {
  return agent.pauseReason === "setup" && agent.status !== "terminated";
}

/** Agents saved at Continue and not finished, newest first, to pick up again. */
export function unfinishedDrafts<T extends Pick<Agent, "status" | "pauseReason" | "createdAt">>(agents: readonly T[] | undefined): T[] {
  return (agents ?? []).filter(isSetupDraft).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Whether the server is still preparing the draft's environment after a save. */
export function preparing(agent: Pick<Agent, "pauseReason" | "lifecycleState" | "lifecycleError"> | undefined) {
  return !!agent && agent.pauseReason === "setup" && (agent.lifecycleState === "preparing" || agent.lifecycleState === "pausing") && !agent.lifecycleError;
}

/** The preview card's line under the name: "Researcher · reports to CEO". */
export function previewLine(profile: ProfileDraft, managerName: string | null | undefined) {
  const role = profile.title.trim() || roleLabel(profile.role);
  return managerName ? `${role} · reports to ${managerName}` : role;
}

/** Where the hire went: straight on, or to the Inbox for approval. */
export function hireOutcome(response: { agent: Pick<Agent, "status">; approval: unknown }) {
  return response.approval || response.agent.status === "pending_approval" ? "approval" : "hired";
}

/**
 * The old UI's `/agents/new?…` parameters: `setupAgentId` resumes a draft, `createdAgentId` is a
 * finished hire (its page), `name` and `adapterType` (with `runnerProvider` for a Paperclip Runner
 * link) prefill the profile and harness.
 */
export function legacyHireParams(search: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = search[key];
    return typeof value === "string" && value ? value : undefined;
  };
  let harness = one("adapterType");
  if (harness === "paperclip_runner") {
    const provider = one("runnerProvider") ?? "codex";
    harness = ({ codex: "codex_local", claude: "claude_local", opencode: "opencode_local", pi: "pi_local" } as Record<string, string>)[provider];
  }
  return {
    setupAgentId: one("setupAgentId"),
    createdAgentId: one("createdAgentId"),
    name: one("name"),
    harness: harness && (NEW_AGENT_HARNESSES as readonly string[]).includes(harness) ? harness : undefined,
  };
}
