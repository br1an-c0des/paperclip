import type { Agent, AgentConfigRevision, AgentRole, AgentRunner, BudgetOverview, BudgetPolicySummary, BudgetPolicyUpsertInput, Environment } from "@paperclipai/shared";
import type { AdapterInfo, AgentRunSummary } from "@/api/agents";
import { parseDollars, type BudgetDraft } from "@/projects/settings/settings-model";
import { effortKeyFor, effortOptions, type EffortOption } from "@/tasks/run-overrides";

/*
 * The agent page's pure logic: which harness and runner an agent uses and how to name them, the
 * settings sections and their addresses, the Model and runtime draft and the patch it saves, the
 * memory an agent's harness has, and small formatting helpers.
 *
 * Mirrored from the shared package (ui-new imports it with `import type` only), checked at each
 * upstream sync:
 * - `agentHarnessType`, `agentRunner` and `paperclipRunnerProfileForHarness`
 *   (packages/shared/src/agent-runner.ts);
 * - `AGENT_ROLE_LABELS` and `AGENT_PALETTE_IDS` (constants.ts, agent-appearance.ts);
 * - the old UI's `buildAgentUpdatePatch` (ui/src/lib/agent-config-patch.ts).
 */

// ---------------------------------------------------------------------------------------------
// Harness and runner

/** The harness an agent runs in, whatever runner carries it: `paperclip_runner` with `provider: "acpx", acpxAgent: "claude"` is Claude Code. */
export function harnessType(adapterType: string, config: Record<string, unknown> = {}): string {
  if (adapterType !== "paperclip_runner") return adapterType;
  if (config.provider === undefined || config.provider === "codex") return "codex_local";
  if (config.provider === "opencode") return "opencode_local";
  if (config.provider === "acpx") {
    const agent = String(config.acpxAgent ?? "claude");
    return ({ codex: "codex_local", claude: "claude_local", grok: "grok_local", cursor: "cursor", pi: "pi_local" } as Record<string, string>)[agent] ?? `acpx:${agent}`;
  }
  return String(config.provider);
}

export function agentRunner(adapterType: string): AgentRunner {
  return adapterType === "paperclip_runner" ? "paperclip" : "legacy";
}

/** Harnesses the Paperclip Runner can carry. */
export const RUNNER_HARNESSES = new Set(["codex_local", "claude_local", "pi_local", "opencode_local"]);

export function runnerCapable(harness: string) {
  return RUNNER_HARNESSES.has(harness);
}

const HARNESS_LABELS: Record<string, string> = {
  claude_local: "Claude Code",
  codex_local: "Codex",
  gemini_local: "Gemini CLI",
  grok_local: "Grok Build",
  kimi_local: "Kimi Code",
  hermes_local: "Hermes",
  hermes_gateway: "Hermes Gateway",
  opencode_local: "OpenCode",
  pi_local: "Pi",
  cursor: "Cursor",
  cursor_cloud: "Cursor Cloud",
  openclaw_gateway: "OpenClaw Gateway",
  acpx_local: "ACPX (retired)",
  process: "Process",
  http: "HTTP",
  copilot: "GitHub Copilot",
  "acpx:copilot": "GitHub Copilot",
  openai_dot: "OpenAI Dot",
  muse: "Muse",
  grok_bot: "Grok Bot",
};

export function harnessLabel(harness: string) {
  return HARNESS_LABELS[harness] ?? harness.replace(/^acpx:/, "").replace(/_local$/, "").replace(/_/g, " ");
}

export function runnerLabel(runner: AgentRunner) {
  return runner === "paperclip" ? "Paperclip Runner" : "Legacy runner";
}

/** What runs the agent: the harness and, for harnesses that have a choice, the runner. */
export type RuntimeIdentity = {
  harness: string;
  harnessLabel: string;
  runner: AgentRunner;
  /** False for harnesses only the legacy runner carries (process, HTTP, Gemini…): there's no choice to show. */
  runnerApplies: boolean;
  /** "Claude Code · Paperclip Runner", "Codex · Legacy runner", or just "Process". */
  label: string;
};

export function runtimeIdentity(agent: Pick<Agent, "adapterType" | "adapterConfig">): RuntimeIdentity {
  const config = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  const harness = harnessType(agent.adapterType, config);
  const runner = agentRunner(agent.adapterType);
  // A Runner agent always names its runner; a legacy one only when the harness could use the Runner.
  const runnerApplies = runner === "paperclip" || runnerCapable(harness);
  const name = harnessLabel(harness);
  return { harness, harnessLabel: name, runner, runnerApplies, label: runnerApplies ? `${name} · ${runnerLabel(runner)}` : name };
}

/**
 * What the Model and runtime section offers about the runner, from the adapters list
 * (`supportedRunners`, `defaultRunner`) for the agent's environment, as AgentConfigForm decides it:
 *
 * - `upgrade`: a legacy agent whose harness the Runner supports here by default; saving with
 *   `runner: "paperclip"` switches it.
 * - `qualify`: the same, on a sandbox environment the Runner must first be qualified on
 *   (`POST /agents/:id/qualify-runner`); the switch happens if the probe confirms it.
 * - `legacy-available`: a Runner agent whose harness also runs on the legacy runner.
 * - `none`: no choice (unsupported harness, adapters not loaded, or disabled).
 */
export type RunnerOffer = { kind: "upgrade" | "qualify" | "legacy-available" | "none"; reason?: string };

export function runnerOffer(
  agent: Pick<Agent, "adapterType" | "adapterConfig">,
  adapters: readonly AdapterInfo[] | undefined,
  environment: Pick<Environment, "driver" | "config" | "status"> | null | undefined,
): RunnerOffer {
  const identity = runtimeIdentity(agent);
  if (!runnerCapable(identity.harness) || !adapters) return { kind: "none" };
  const harness = adapters.find((adapter) => adapter.type === identity.harness);
  const native = adapters.find((adapter) => adapter.type === "paperclip_runner");
  if (!harness || harness.disabled || harness.overriddenBuiltin) return { kind: "none", reason: "harness-unavailable" };
  if (identity.runner === "paperclip") {
    return harness.supportedRunners?.includes("legacy") ? { kind: "legacy-available" } : { kind: "none" };
  }
  if (!native || native.disabled || native.overriddenBuiltin) return { kind: "none", reason: "runner-disabled" };
  if (harness.defaultRunner === "paperclip" && harness.supportedRunners?.includes("paperclip")) return { kind: "upgrade" };
  if (environment?.status === "active" && canQualifyRunnerEnvironment(environment)) return { kind: "qualify" };
  return { kind: "none", reason: "not-supported-here" };
}

/** A sandbox with an immutable image (or a Daytona snapshot) can be qualified for the Runner (ui/src/lib/qualify-claude-setup.ts). */
export function canQualifyRunnerEnvironment(environment: Pick<Environment, "driver" | "config"> | null | undefined) {
  const config = (environment?.config ?? {}) as Record<string, unknown>;
  const immutableImage = typeof config.image === "string" && /^[^\s@]+@sha256:[a-f0-9]{64}$/.test(config.image) && !config.snapshot;
  const daytonaSnapshot = config.provider === "daytona" && typeof config.snapshot === "string" && !!config.snapshot.trim() && !config.image;
  return environment?.driver === "sandbox" && (immutableImage || daytonaSnapshot) && !config.template && !config.templateRef;
}

/** Whether a qualify-runner probe confirmed the platform, as `qualifyRunnerEnvironment` checks it. */
export function probeQualified(probe: { ok: boolean; summary?: string; details: Record<string, unknown> | null }): string | null {
  const details = probe.details ?? {};
  if (probe.ok === true && details.platformQualificationRecorded === true && typeof details.leaseId === "string" && details.leaseId) return null;
  return typeof details.platformQualificationDiagnostic === "string"
    ? details.platformQualificationDiagnostic
    : probe.summary || "The environment's platform qualification couldn't be confirmed. Retry the probe.";
}

// ---------------------------------------------------------------------------------------------
// Sections

export type AgentSectionKey =
  | "profile"
  | "instructions"
  | "memory"
  | "skills"
  | "runtime"
  | "tools"
  | "secrets"
  | "budget"
  | "permissions"
  | "keys"
  | "history";

/** Board 26's rail, with Memory (decision 5, option 4) under Agent. */
export const AGENT_SECTIONS: ({ heading: string } | { key: AgentSectionKey; label: string })[] = [
  { heading: "Agent" },
  { key: "profile", label: "Profile" },
  { key: "instructions", label: "Instructions" },
  { key: "memory", label: "Memory" },
  { key: "skills", label: "Skills" },
  { heading: "How it runs" },
  { key: "runtime", label: "Model and runtime" },
  { key: "tools", label: "Tools and channels" },
  { key: "secrets", label: "Secrets and variables" },
  { key: "budget", label: "Budget" },
  { heading: "Governance" },
  { key: "permissions", label: "Permissions and trust" },
  { key: "keys", label: "API keys" },
  { key: "history", label: "History" },
];

/** The old UI's tab names, so its links (`/agents/:id/configuration`, `…/api-keys`) keep working. */
const SECTION_ALIASES: Record<string, AgentSectionKey> = {
  profile: "profile",
  instructions: "instructions",
  prompts: "instructions",
  memory: "memory",
  skills: "skills",
  runtime: "runtime",
  configure: "runtime",
  configuration: "runtime",
  tools: "tools",
  channels: "tools",
  secrets: "secrets",
  budget: "budget",
  budgets: "budget",
  costs: "budget",
  permissions: "permissions",
  trust: "permissions",
  keys: "keys",
  "api-keys": "keys",
  history: "history",
  revisions: "history",
};

/**
 * What an address under `/agents/:key` shows. The agent's own address (and the old `overview`
 * tab) is its chat, board 12's home; `settings` opens Profile. Unknown names are null.
 */
export function agentView(rest: string): { view: "chat" } | { view: "settings"; section: AgentSectionKey } | null {
  const first = rest.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  if (first === "" || first === "overview" || first === "dashboard" || first === "chat") return { view: "chat" };
  if (first === "settings") {
    const second = rest.replace(/^\/+|\/+$/g, "").split("/")[1] ?? "";
    const section = second ? SECTION_ALIASES[second] : "profile";
    return section ? { view: "settings", section } : null;
  }
  const section = SECTION_ALIASES[first];
  return section ? { view: "settings", section } : null;
}

// ---------------------------------------------------------------------------------------------
// Labels

const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO",
  cto: "CTO",
  cmo: "CMO",
  cfo: "CFO",
  security: "Security",
  engineer: "Engineer",
  designer: "Designer",
  pm: "PM",
  qa: "QA",
  devops: "DevOps",
  researcher: "Researcher",
  general: "General",
};

export const AGENT_ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value: value as AgentRole, label }));

export function roleLabel(role: string) {
  return ROLE_LABELS[role as AgentRole] ?? role;
}

/** The 17 ClipLab palettes (packages/shared/src/agent-appearance.ts `AGENT_PALETTE_IDS`). */
export const AGENT_PALETTES = [
  "bubblegum-sky",
  "pink-lemonade",
  "orchid-peach",
  "coral-mint",
  "lime-lagoon",
  "arctic-blue",
  "solar-flare",
  "violet-ember",
  "deep-tide",
  "coral-current",
  "golden-hour",
  "tangerine-cobalt",
  "electric-grove",
  "flamingo-jade",
  "cherry-pop",
  "turquoise-cherry",
  "ultraviolet-tide",
] as const;

export function paletteLabel(id: string) {
  return id.replace(/-/g, " ").replace(/^./, (char) => char.toUpperCase());
}

/** "$38.20". */
export function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "18.1k", "1.2M". */
export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

export function toNumber(value: string | number | null | undefined) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** The current calendar month in UTC, as the budget counts it: `from` its first day, `to` now. */
export function monthRange(now: Date = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

/** The model's label from the catalog, or its id. */
export function modelLabel(model: string | null | undefined, catalog: readonly { id: string; label: string }[] | undefined) {
  if (!model) return null;
  return catalog?.find((entry) => entry.id === model)?.label ?? model;
}

/** The header's line under the name: role or title, manager, harness and runner, model, spend. */
export function headerSummary(input: {
  agent: Pick<Agent, "role" | "title" | "adapterType" | "adapterConfig" | "spentMonthlyCents" | "budgetMonthlyCents">;
  managerName?: string | null;
  modelLabel?: string | null;
}) {
  const parts: string[] = [];
  parts.push(input.agent.title?.trim() || roleLabel(input.agent.role));
  if (input.managerName) parts.push(`reports to ${input.managerName}`);
  parts.push(runtimeIdentity(input.agent).label);
  if (input.modelLabel) parts.push(input.modelLabel);
  const spent = formatCents(input.agent.spentMonthlyCents ?? 0);
  parts.push(input.agent.budgetMonthlyCents > 0 ? `${spent} of ${formatCents(input.agent.budgetMonthlyCents)} this month` : `${spent} spent this month`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Profile

/** A trimmed text edit as a patch, or null when nothing changed. Empty becomes null where allowed. */
export function textEdit(key: "name" | "title" | "capabilities", current: string | null | undefined, draft: string) {
  const next = draft.trim();
  if (next === (current ?? "").trim()) return null;
  if (key === "name") return next ? { name: next } : null;
  return { [key]: next || null };
}

/** Managers an agent can report to: anyone but itself and the agents below it. */
export function managerCandidates<T extends Pick<Agent, "id" | "reportsTo" | "status">>(agents: readonly T[], agentId: string): T[] {
  const below = new Set<string>([agentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const agent of agents) {
      if (agent.reportsTo && below.has(agent.reportsTo) && !below.has(agent.id)) {
        below.add(agent.id);
        grew = true;
      }
    }
  }
  return agents.filter((agent) => !below.has(agent.id) && agent.status !== "terminated");
}

// ---------------------------------------------------------------------------------------------
// Model and runtime

export type RuntimeDraft = {
  model: string;
  effort: string;
  /** null: keep the agent's runner. */
  runner: AgentRunner | null;
  environmentId: string;
  chrome: boolean;
  wakeOnDemand: boolean;
  heartbeatEnabled: boolean;
  intervalSec: string;
  cooldownSec: string;
  maxConcurrentRuns: string;
  timeoutMin: string;
  graceSec: string;
  continueEnabled: boolean;
  continueAttempts: string;
  continueDelaySec: string;
  providerTrace: boolean;
  command: string;
  extraArgs: string;
  promptTemplate: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Where the agent keeps its thinking effort, or null when its harness takes none here. */
export function runtimeEffortKey(agent: Pick<Agent, "adapterType" | "adapterConfig">): string | null {
  const identity = runtimeIdentity(agent);
  if (agent.adapterType === "paperclip_runner") return identity.harness === "claude_local" || identity.harness === "codex_local" ? "modelReasoningEffort" : null;
  return effortKeyFor(agent.adapterType);
}

/** The effort choices for the agent's harness and a model. */
export function runtimeEffortOptions(agent: Pick<Agent, "adapterType" | "adapterConfig">, model: string): EffortOption[] {
  if (!runtimeEffortKey(agent)) return [];
  const identity = runtimeIdentity(agent);
  const adapter = agent.adapterType === "paperclip_runner" ? identity.harness : agent.adapterType;
  return effortOptions(adapter, model || null, agent.adapterConfig as Record<string, unknown>);
}

/** Harnesses whose runs take the local command settings (command, arguments, prompt template, timeouts). */
const LOCAL_HARNESSES = new Set([
  "claude_local",
  "codex_local",
  "gemini_local",
  "grok_local",
  "kimi_local",
  "hermes_local",
  "opencode_local",
  "pi_local",
  "cursor",
]);

/** Which Model and runtime fields the agent's harness and runner have. */
export function runtimeFields(agent: Pick<Agent, "adapterType" | "adapterConfig">) {
  const identity = runtimeIdentity(agent);
  const local = LOCAL_HARNESSES.has(identity.harness) || agent.adapterType === "paperclip_runner";
  const legacyLocal = local && identity.runner === "legacy";
  return {
    model: local || agent.adapterType === "cursor_cloud",
    effort: runtimeEffortKey(agent) !== null,
    /** Claude Code's `chrome` option, which only the legacy runner reads. */
    browser: agent.adapterType === "claude_local",
    timeouts: local || agent.adapterType === "process",
    command: legacyLocal || agent.adapterType === "process",
    promptTemplate: local,
  };
}

/** Where the command's arguments live: `args` for a process agent, `extraArgs` for a harness. */
export function argsKey(adapterType: string) {
  return adapterType === "process" ? "args" : "extraArgs";
}

function argsText(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(", ");
  return typeof value === "string" ? value : "";
}

export function runtimeDraft(agent: Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig" | "defaultEnvironmentId">): RuntimeDraft {
  const config = record(agent.adapterConfig);
  const runtime = record(agent.runtimeConfig);
  const heartbeat = record(runtime.heartbeat);
  const continuation = record(heartbeat.maxTurnContinuation);
  const effortKey = runtimeEffortKey(agent);
  const effort = effortKey ? (config[effortKey] ?? (agent.adapterType === "paperclip_runner" || agent.adapterType === "codex_local" ? config.reasoningEffort ?? config.effort : undefined)) : undefined;
  const timeoutSec = num(config.timeoutSec, 0);
  return {
    model: typeof config.model === "string" ? config.model : "",
    effort: typeof effort === "string" ? effort : "",
    runner: null,
    environmentId: agent.defaultEnvironmentId ?? "",
    chrome: config.chrome === true,
    wakeOnDemand: heartbeat.wakeOnDemand !== false,
    heartbeatEnabled: heartbeat.enabled === true,
    intervalSec: String(num(heartbeat.intervalSec, 300)),
    cooldownSec: String(num(heartbeat.cooldownSec, 10)),
    maxConcurrentRuns: String(num(heartbeat.maxConcurrentRuns, 20)),
    timeoutMin: timeoutSec === 0 ? "0" : String(Math.round((timeoutSec / 60) * 100) / 100),
    graceSec: String(num(config.graceSec, 15)),
    continueEnabled: continuation.enabled !== false,
    continueAttempts: String(num(continuation.maxAttempts, 2)),
    continueDelaySec: String(Math.round(num(continuation.delayMs, 1000) / 1000)),
    providerTrace: record(runtime.debug).providerTrace === "raw",
    command: typeof config.command === "string" ? config.command : "",
    extraArgs: argsText(config[argsKey(agent.adapterType)]),
    promptTemplate: typeof config.promptTemplate === "string" ? config.promptTemplate : "",
  };
}

/** The fields that differ from the saved settings. */
export function runtimeChanges(base: RuntimeDraft, draft: RuntimeDraft): (keyof RuntimeDraft)[] {
  return (Object.keys(draft) as (keyof RuntimeDraft)[]).filter((key) => draft[key] !== base[key]);
}

const INTEGER = /^\d+$/;

/** Why the draft can't be saved, or null. */
export function runtimeProblem(draft: RuntimeDraft): string | null {
  const whole = (value: string, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    if (!INTEGER.test(value.trim())) return `${label} must be a whole number.`;
    const number = Number(value);
    if (number < min || number > max) return max === Number.MAX_SAFE_INTEGER ? `${label} must be at least ${min}.` : `${label} must be between ${min} and ${max}.`;
    return null;
  };
  if (draft.heartbeatEnabled) {
    const problem = whole(draft.intervalSec, "The heartbeat interval", 30);
    if (problem) return problem;
  }
  if (!/^\d+(\.\d+)?$/.test(draft.timeoutMin.trim())) return "The timeout must be a number of minutes; 0 means no limit.";
  return (
    whole(draft.cooldownSec, "The cooldown") ??
    whole(draft.maxConcurrentRuns, "Runs at once", 1, 100) ??
    whole(draft.graceSec, "The grace period") ??
    (draft.continueEnabled ? (whole(draft.continueAttempts, "Follow-up runs", 0, 10) ?? whole(draft.continueDelaySec, "The gap between follow-up runs", 0, 300)) : null)
  );
}

function omitUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/**
 * The `PATCH /agents/:id` body for a Model and runtime draft, as the old UI's
 * `buildAgentUpdatePatch` builds it: the whole adapter config with the changes applied
 * (`replaceAdapterConfig`, so a cleared field is removed; redacted secrets are restored by the
 * server), the whole runtime config with the heartbeat and debug changes merged in (the server
 * replaces it, so the AI connection must travel along), the environment, and the runner.
 * Returns null when nothing changed.
 */
export function buildRuntimePatch(
  agent: Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig" | "defaultEnvironmentId">,
  draft: RuntimeDraft,
  base: RuntimeDraft = runtimeDraft(agent),
): Record<string, unknown> | null {
  const changed = new Set(runtimeChanges(base, draft));
  if (changed.size === 0) return null;
  const patch: Record<string, unknown> = {};
  const config: Record<string, unknown> = {};
  const effortKey = runtimeEffortKey(agent);

  if (changed.has("model")) config.model = draft.model.trim() || undefined;
  if (changed.has("effort") && effortKey) config[effortKey] = draft.effort || undefined;
  if (changed.has("chrome")) config.chrome = draft.chrome;
  if (changed.has("timeoutMin")) config.timeoutSec = Math.round(Number(draft.timeoutMin) * 60);
  if (changed.has("graceSec")) config.graceSec = Number(draft.graceSec);
  if (changed.has("command")) config.command = draft.command.trim() || undefined;
  if (changed.has("extraArgs")) {
    const args = draft.extraArgs.split(",").map((item) => item.trim()).filter(Boolean);
    config[argsKey(agent.adapterType)] = args.length ? args : undefined;
  }
  if (changed.has("promptTemplate")) config.promptTemplate = draft.promptTemplate.trim() ? draft.promptTemplate : undefined;
  if (Object.keys(config).length > 0) {
    patch.adapterConfig = omitUndefined({ ...record(agent.adapterConfig), ...config });
    patch.replaceAdapterConfig = true;
  }

  const heartbeat: Record<string, unknown> = {};
  if (changed.has("wakeOnDemand")) heartbeat.wakeOnDemand = draft.wakeOnDemand;
  if (changed.has("heartbeatEnabled")) heartbeat.enabled = draft.heartbeatEnabled;
  if (changed.has("intervalSec")) heartbeat.intervalSec = Number(draft.intervalSec);
  if (changed.has("cooldownSec")) heartbeat.cooldownSec = Number(draft.cooldownSec);
  if (changed.has("maxConcurrentRuns")) heartbeat.maxConcurrentRuns = Number(draft.maxConcurrentRuns);
  const existingRuntime = record(agent.runtimeConfig);
  const existingHeartbeat = record(existingRuntime.heartbeat);
  if (changed.has("continueEnabled") || changed.has("continueAttempts") || changed.has("continueDelaySec")) {
    heartbeat.maxTurnContinuation = {
      ...record(existingHeartbeat.maxTurnContinuation),
      enabled: draft.continueEnabled,
      maxAttempts: Number(draft.continueAttempts),
      delayMs: Number(draft.continueDelaySec) * 1000,
    };
  }
  if (Object.keys(heartbeat).length > 0 || changed.has("providerTrace")) {
    const runtime: Record<string, unknown> = { ...existingRuntime };
    if (Object.keys(heartbeat).length > 0) runtime.heartbeat = { ...existingHeartbeat, ...heartbeat };
    if (changed.has("providerTrace")) {
      const debug = omitUndefined({ ...record(existingRuntime.debug), providerTrace: draft.providerTrace ? "raw" : undefined });
      if (Object.keys(debug).length) runtime.debug = debug;
      else delete runtime.debug;
    }
    patch.runtimeConfig = runtime;
  }

  if (changed.has("environmentId")) patch.defaultEnvironmentId = draft.environmentId || null;
  if (changed.has("runner") && draft.runner && draft.runner !== agentRunner(agent.adapterType)) patch.runner = draft.runner;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** "Every 5 minutes", for the heartbeat menu. */
export const HEARTBEAT_INTERVALS = [
  { sec: 300, label: "Every 5 minutes" },
  { sec: 900, label: "Every 15 minutes" },
  { sec: 1800, label: "Every 30 minutes" },
  { sec: 3600, label: "Every hour" },
  { sec: 14400, label: "Every 4 hours" },
  { sec: 86400, label: "Every day" },
];

export function intervalLabel(sec: number) {
  const known = HEARTBEAT_INTERVALS.find((entry) => entry.sec === sec);
  if (known) return known.label;
  if (sec % 3600 === 0) return `Every ${sec / 3600} hours`;
  if (sec % 60 === 0) return `Every ${sec / 60} minutes`;
  return `Every ${sec} seconds`;
}

// ---------------------------------------------------------------------------------------------
// Revisions

/** "Revision 14, saved Oct 18 by you": the latest configuration revision. */
export function latestRevision(revisions: readonly AgentConfigRevision[] | undefined) {
  if (!revisions?.length) return null;
  const sorted = [...revisions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { number: revisions.length, revision: sorted[0]! };
}

/** Top-level keys a revision changed, in plain words. */
export function changedKeyLabel(key: string) {
  return (
    ({
      adapterConfig: "harness settings",
      adapterType: "harness",
      runtimeConfig: "run policy",
      defaultEnvironmentId: "environment",
      reportsTo: "manager",
      budgetMonthlyCents: "budget",
      capabilities: "description",
      appearance: "avatar",
    } as Record<string, string>)[key] ?? key
  );
}

/** The adapter-config keys that differ between a revision's before and after, for the history list. */
export function revisionConfigChanges(revision: Pick<AgentConfigRevision, "beforeConfig" | "afterConfig">) {
  const before = record(revision.beforeConfig.adapterConfig);
  const after = record(revision.afterConfig.adapterConfig);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

// ---------------------------------------------------------------------------------------------
// Memory (decision 5, option 4)

export type MemoryKind = "agent-files" | "session-only" | "none" | "unknown";

/**
 * Which memory applies to the agent's harness and runner (decision 5):
 * - `claude_local` and the Paperclip Runner keep the agent's folder (`AGENT_HOME`, the instructions
 *   bundle), so `para-memory-files` notes in MEMORY.md, memory/ and life/ last between runs. Claude
 *   Code's own auto memory also runs for `claude_local`, outside the API.
 * - Claude through the Runner, in the default isolated mode, also has auto memory, but only for
 *   one session.
 * - Agents without an instructions folder (Claude Managed, process, HTTP) remember nothing between
 *   sessions unless they're given a memory connector.
 */
export function memoryFor(agent: Pick<Agent, "adapterType" | "adapterConfig">, supportsInstructionsBundle: boolean | undefined): {
  kind: MemoryKind;
  claudeAutoMemory: "home" | "per-session" | null;
} {
  const identity = runtimeIdentity(agent);
  const claude = identity.harness === "claude_local";
  const claudeAutoMemory = claude ? (identity.runner === "paperclip" && record(agent.adapterConfig).homeMode !== "preconfigured" ? "per-session" : "home") : null;
  if (supportsInstructionsBundle === undefined) return { kind: "unknown", claudeAutoMemory };
  if (supportsInstructionsBundle || identity.runner === "paperclip") return { kind: "agent-files", claudeAutoMemory };
  return { kind: "none", claudeAutoMemory };
}

/** Whether a file in the agent's folder is one of the memory files `para-memory-files` keeps. */
export function isMemoryFile(path: string) {
  return path === "MEMORY.md" || path.startsWith("memory/") || path.startsWith("life/");
}

// ---------------------------------------------------------------------------------------------
// Permissions

/** Why the agent may assign tasks, after the old UI's permissions tab. */
export function taskAssignHelp(source: string) {
  switch (source) {
    case "ceo_role":
      return "On for every CEO agent.";
    case "agent_creator":
      return "On while it can hire agents.";
    case "explicit_grant":
      return "Granted to it directly.";
    case "simple_default":
      return "On for every agent, by the company's defaults.";
    default:
      return "Give tasks to other agents and people.";
  }
}

// ---------------------------------------------------------------------------------------------
// Budget

/** The agent's spend policies (billed cents), from the company's budget overview. */
export function agentPolicies(overview: BudgetOverview | undefined, agentId: string) {
  return (overview?.policies ?? []).filter((policy) => policy.scopeType === "agent" && policy.scopeId === agentId && policy.metric === "billed_cents");
}

/**
 * The upserts that save an agent's budget draft, as the project budget's: one policy per window, a
 * zero amount turns one off, and switching window turns the old one off. The server keeps the
 * agent's `budgetMonthlyCents` in step with its monthly policy.
 */
export function agentBudgetRequests(agentId: string, policies: readonly BudgetPolicySummary[], draft: BudgetDraft): BudgetPolicyUpsertInput[] {
  const amount = parseDollars(draft.amount);
  if (amount === null) return [];
  const scope = { scopeType: "agent" as const, scopeId: agentId, metric: "billed_cents" as const };
  const requests: BudgetPolicyUpsertInput[] = [];
  const existing = policies.find((policy) => policy.windowKind === draft.windowKind);
  if (amount > 0) requests.push({ ...scope, windowKind: draft.windowKind, amount, warnPercent: draft.warnPercent, hardStopEnabled: draft.hardStop });
  else if (existing && existing.amount > 0) requests.push({ ...scope, windowKind: draft.windowKind, amount: 0 });
  for (const policy of policies) {
    if (policy.windowKind !== draft.windowKind && policy.amount > 0) requests.push({ ...scope, windowKind: policy.windowKind, amount: 0 });
  }
  return requests;
}

// ---------------------------------------------------------------------------------------------
// Skills

/** The agent's desired skills with one added or removed; pinned versions stay as they are. */
export function skillToggle(desired: readonly { key: string; versionId: string | null }[], key: string, on: boolean) {
  const rest = desired.filter((entry) => entry.key !== key);
  if (!on) return rest.map((entry) => ({ ...entry }));
  const existing = desired.find((entry) => entry.key === key);
  return [...rest.map((entry) => ({ ...entry })), existing ? { ...existing } : { key, versionId: null }];
}

// ---------------------------------------------------------------------------------------------
// Runs

const OPEN_RUN = new Set(["queued", "running", "scheduled_retry"]);

/** Spend and tokens in the agent's recent runs, newest first, from the run list. */
export function runUsage(runs: readonly AgentRunSummary[] | undefined) {
  const list = runs ?? [];
  let input = 0;
  let cached = 0;
  let output = 0;
  let costUsd = 0;
  let failed = 0;
  for (const run of list) {
    input += toNumber(run.inputTokens);
    cached += toNumber(run.cachedInputTokens);
    output += toNumber(run.outputTokens);
    costUsd += toNumber(run.costUsd);
    if (run.status === "failed" || run.status === "timed_out") failed += 1;
  }
  return { count: list.length, open: list.filter((run) => OPEN_RUN.has(run.status)).length, failed, input, cached, output, costUsd };
}
