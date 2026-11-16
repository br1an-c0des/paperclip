import { resolveClaudeModel } from "@paperclipai/adapter-claude-local";
import { PAPERCLIP_RUNNER_DEFAULT_MODELS } from "@paperclipai/adapter-utils/paperclip-runner-permissions";
import type { HarnessField } from "./harness-model";

/*
 * Switching a legacy agent to Paperclip Runner: what its adapter config becomes, before saving.
 *
 * `PATCH /agents/:id` with `runner: "paperclip"` takes the agent's legacy config (its own, or the
 * patch's `adapterConfig` with `replaceAdapterConfig`) and translates it for the Runner
 * (server/src/services/agent-runner-selection.ts, `resolveAgentRunner` and the `resolve*RunnerConfig`
 * functions): legacy-only keys are removed, a few are carried over under the Runner's keys (effort,
 * permission mode, thinking level), the Runner's defaults are filled in, and any Runner keys already
 * in the config pass through. A setting the Runner can't honor fails the whole save ("Paperclip Runner
 * cannot honor these settings", `incompatible(...)`). The route then merges in the transition
 * defaults (`paperclipRunnerTransitionConfig`, routes/agents.ts `resolvePaperclipRunnerAdapterTransition`).
 *
 * `runnerPreview` mirrors that translation, so the form can show the Runner's settings before the
 * switch is saved, and `runnerSwitchConfig` builds the legacy-shaped config the switch sends: the
 * settings the Runner can't honor taken out (shown as dropped instead of failing the save), and the
 * Runner settings edited in the form added. Mirrored from the server; check it at each upstream sync.
 */

type Config = Record<string, unknown>;

export type RunnerHarness = "claude_local" | "codex_local" | "opencode_local" | "pi_local" | "grok_local";

/** A legacy setting the Runner config won't have. */
export type DroppedSetting = {
  key: string;
  label: string;
  /** `unsupported`: the server would refuse the switch with it, so the switch leaves it out. `unused`: the Runner has no use for it. */
  why: "unsupported" | "unused";
};

export type RunnerPreview = {
  /** The adapter config the Runner agent will have, as the server saves it. */
  config: Config;
  dropped: DroppedSetting[];
  /** Runner settings the switch sets to values the legacy setup didn't have (defaults, or values carried under a new key). */
  changed: { key: string; label: string; value: unknown }[];
  /** Why the switch can't be saved as it is, or null. */
  problem: string | null;
};

type Translation = { config: Config; unsupported: string[]; problem?: string };

/** Truthy in the server's "is it set" sense: not undefined, false, "", 0 or an empty list. */
function set(value: unknown) {
  return value !== undefined && value !== false && value !== "" && value !== 0 && !(Array.isArray(value) && value.length === 0);
}

/** Set, for the Pi and OpenCode checks, which also count `false` and `0` as set. */
function given(value: unknown) {
  return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
}

function without(config: Config, keys: readonly string[]) {
  const next = { ...config };
  for (const key of keys) delete next[key];
  return next;
}

function record(value: unknown): Config {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Config) : {};
}

/** `normalizeClaudeRunnerOptions` (packages/shared runner-configuration-warnings.ts): ignored on the Runner, with a warning. */
const CLAUDE_IGNORED = ["maxTurnsPerRun", "chrome", "warmHandleIdleMs", "acpWarmHandleIdleMs"];
/** `claudeRunnerUnsupportedSettings` (native-runtime/provider-profile.ts), less the ignored and permission keys handled apart. */
const CLAUDE_UNSUPPORTED = [
  "agentCommand",
  "acpAgentCommand",
  "stateDir",
  "acpStateDir",
  "extraArgs",
  "args",
  "filesystemScope",
  "filesystemExtraPaths",
  "filesystemSandboxCommand",
  "networkScope",
  "networkAllowlist",
];
const ACPX_PERMISSIONS_FROM_LEGACY = ["approve-all", "approve-reads", "deny-all"];

function claude(input: Config): Translation {
  const unsupported: string[] = [];
  let config = without(input, CLAUDE_IGNORED);
  const legacyPermission = [input.permissionMode, input.acpPermissionMode].find((value) => typeof value === "string" && value.trim()) as string | undefined;
  if (legacyPermission !== undefined) {
    const mode = legacyPermission.trim();
    if (!ACPX_PERMISSIONS_FROM_LEGACY.includes(mode) || (input.acpxPermissionMode !== undefined && input.acpxPermissionMode !== mode)) {
      unsupported.push(...["permissionMode", "acpPermissionMode"].filter((key) => input[key] !== undefined));
    } else config.acpxPermissionMode = mode;
  }
  for (const key of ["permissionMode", "acpPermissionMode"]) {
    if (input[key] !== undefined && typeof input[key] !== "string" && !unsupported.includes(key)) unsupported.push(key);
  }
  config = without(config, ["permissionMode", "acpPermissionMode"]);
  unsupported.push(...CLAUDE_UNSUPPORTED.filter((key) => set(config[key])));
  if (config.command && config.command !== "claude") unsupported.push("command");
  if (config.mode && config.mode !== "persistent") unsupported.push("mode");
  if (config.acpMode && config.acpMode !== "persistent") unsupported.push("acpMode");
  if (config.engine && !["auto", "cli", "acp"].includes(String(config.engine))) unsupported.push("engine");
  if (config.nonInteractivePermissions && config.nonInteractivePermissions !== "deny") unsupported.push("nonInteractivePermissions");
  if (config.acpNonInteractivePermissions && config.acpNonInteractivePermissions !== "deny") unsupported.push("acpNonInteractivePermissions");
  if (config.dangerouslySkipPermissions === false) unsupported.push("dangerouslySkipPermissions");
  if (config.model !== undefined && typeof config.model !== "string") unsupported.push("model");
  const effort = input.modelReasoningEffort ?? input.reasoningEffort ?? input.effort;
  config = without(config, ["engine", "command", "mode", "acpMode", "nonInteractivePermissions", "acpNonInteractivePermissions", "dangerouslySkipPermissions", "effort", "reasoningEffort"]);
  // With no model set, the server reads the model from the agent's env, which must be plain text.
  const env = record(input.env);
  const modelEnv: Config = { ...env };
  let problem: string | undefined;
  if (!(typeof input.model === "string" && input.model.trim())) {
    for (const key of ["ANTHROPIC_MODEL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_BEDROCK_BASE_URL"]) {
      const binding = env[key];
      if (binding === undefined || typeof binding === "string") continue;
      const plain = record(binding);
      if (plain.type === "plain" && typeof plain.value === "string") modelEnv[key] = plain.value;
      else problem = `Pick a model first: ${key} comes from a secret, which the switch can't read.`;
    }
  }
  const model = resolveClaudeModel(input.model, modelEnv);
  if (!model && !problem) problem = "Pick a model first: Claude on Bedrock or Vertex has no default model on the Runner.";
  return {
    unsupported,
    problem,
    config: {
      ...config,
      ...(effort === undefined || effort === "" ? {} : { modelReasoningEffort: effort }),
      provider: "acpx",
      acpxAgent: "claude",
      model,
      acpxPermissionMode: config.acpxPermissionMode ?? "approve-all",
    },
  };
}

const CODEX_UNSUPPORTED = [
  "agentCommand",
  "acpAgentCommand",
  "stateDir",
  "acpStateDir",
  "warmHandleIdleMs",
  "acpWarmHandleIdleMs",
  "extraArgs",
  "args",
  "search",
  "fastMode",
  "variant",
  "filesystemScope",
  "filesystemExtraPaths",
  "filesystemSandboxCommand",
  "networkScope",
  "networkAllowlist",
  "permissionMode",
  "acpPermissionMode",
  "maxTurns",
  "disableWebSearch",
  "outputInactivityTimeoutMs",
  "terminalResultCleanupGraceMs",
];

function codex(input: Config): Translation {
  const unsupported = CODEX_UNSUPPORTED.filter((key) => set(input[key]));
  if (input.command && input.command !== "codex") unsupported.push("command");
  for (const key of ["mode", "acpMode"]) if (input[key] && input[key] !== "persistent") unsupported.push(key);
  if (input.engine && input.engine !== "cli" && input.engine !== "acp") unsupported.push("engine");
  for (const key of ["nonInteractivePermissions", "acpNonInteractivePermissions"]) if (input[key] && input[key] !== "deny") unsupported.push(key);
  if (input.dangerouslyBypassApprovalsAndSandbox === false) unsupported.push("dangerouslyBypassApprovalsAndSandbox");
  if (input.dangerouslyBypassSandbox === false) unsupported.push("dangerouslyBypassSandbox");
  if (input.model !== undefined && typeof input.model !== "string") unsupported.push("model");
  const network = record(input.env).PAPERCLIP_CODEX_ACP_NETWORK_ACCESS;
  const binding = record(network);
  const problem =
    input.engine !== "cli" && (network === "false" || (binding.type === "plain" && binding.value === "false") || binding.type === "secret_ref" || binding.type === "user_secret_ref")
      ? "Remove PAPERCLIP_CODEX_ACP_NETWORK_ACCESS from the environment variables first: the Runner can't turn network access off that way."
      : undefined;
  const effort = input.modelReasoningEffort ?? input.reasoningEffort ?? input.effort;
  const config = without(input, [
    "engine",
    "command",
    "extraArgs",
    "args",
    "agentCommand",
    "acpAgentCommand",
    "mode",
    "acpMode",
    "nonInteractivePermissions",
    "acpNonInteractivePermissions",
    "stateDir",
    "acpStateDir",
    "warmHandleIdleMs",
    "acpWarmHandleIdleMs",
    "dangerouslyBypassApprovalsAndSandbox",
    "dangerouslyBypassSandbox",
    "fastMode",
    "reasoningEffort",
    "effort",
  ]);
  return {
    unsupported,
    problem,
    config: {
      ...config,
      provider: "codex",
      model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : PAPERCLIP_RUNNER_DEFAULT_MODELS.codex,
      codexPermissionMode: input.codexPermissionMode ?? "never",
      ...(effort === undefined ? {} : { modelReasoningEffort: effort }),
    },
  };
}

function opencode(input: Config): Translation {
  const unsupported = ["extraArgs", "args", "variant", "modelReasoningEffort", "reasoningEffort", "effort"].filter((key) => given(input[key]));
  if (input.command && input.command !== "opencode") unsupported.push("command");
  if (input.dangerouslySkipPermissions !== undefined && input.dangerouslySkipPermissions !== true) unsupported.push("dangerouslySkipPermissions");
  if (input.model !== undefined && typeof input.model !== "string") unsupported.push("model");
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const config = without(input, ["command", "extraArgs", "args", "variant", "modelReasoningEffort", "reasoningEffort", "effort", "dangerouslySkipPermissions"]);
  return {
    unsupported,
    problem: !model.includes("/") || model.endsWith("/") ? "Pick a model first: OpenCode on the Runner needs a provider/model." : undefined,
    config: { ...config, provider: "opencode", model, opencodePermissionMode: input.opencodePermissionMode ?? "allow" },
  };
}

function pi(input: Config): Translation {
  const unsupported = ["extraArgs", "args", "modelReasoningEffort", "reasoningEffort", "effort"].filter((key) => given(input[key]));
  if (input.command && input.command !== "pi") unsupported.push("command");
  if (input.model !== undefined && typeof input.model !== "string") unsupported.push("model");
  if (input.stdoutLogMode !== undefined && input.stdoutLogMode !== "compact") unsupported.push("stdoutLogMode");
  const thinking = input.piThinkingLevel ?? input.thinking;
  if (thinking !== undefined && !["off", "low", "high", "max"].includes(String(thinking))) unsupported.push(input.thinking !== undefined ? "thinking" : "piThinkingLevel");
  if (input.piThinkingLevel !== undefined && input.thinking !== undefined && input.piThinkingLevel !== input.thinking) unsupported.push("thinking");
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const config = without(input, ["command", "extraArgs", "args", "thinking", "stdoutLogMode"]);
  return {
    unsupported: [...new Set(unsupported)],
    problem: /^[^/\s]+\/\S+$/.test(model) ? undefined : "Pick a model first: Pi on the Runner needs a provider/model.",
    config: {
      ...config,
      provider: "acpx",
      acpxAgent: "pi",
      model,
      piThinkingLevel: thinking ?? "low",
      acpxPermissionMode: input.acpxPermissionMode ?? "approve-all",
      lifecycleMode: input.lifecycleMode ?? "per_turn",
    },
  };
}

function grok(input: Config): Translation {
  const unsupported = ["extraArgs", "args", "permissionMode", "maxTurns"].filter((key) => input[key] !== undefined && input[key] !== "" && input[key] !== 0 && !(Array.isArray(input[key]) && (input[key] as unknown[]).length === 0));
  if (input.command && input.command !== "grok") unsupported.push("command");
  if (input.alwaysApprove !== undefined && input.alwaysApprove !== true) unsupported.push("alwaysApprove");
  if (input.disableWebSearch !== undefined && typeof input.disableWebSearch !== "boolean") unsupported.push("disableWebSearch");
  if (input.model !== undefined && typeof input.model !== "string") unsupported.push("model");
  const effort = input.reasoningEffort ?? input.modelReasoningEffort ?? input.effort;
  const config = without(input, ["command", "extraArgs", "args", "alwaysApprove", "maxTurns", "permissionMode", "reasoningEffort", "modelReasoningEffort", "effort"]);
  const model = typeof input.model === "string" ? input.model.trim() : "";
  return {
    unsupported,
    config: {
      ...config,
      provider: "acpx",
      acpxAgent: "grok",
      disableWebSearch: input.disableWebSearch ?? true,
      model: model && model !== "grok-build" ? model : "grok-4.7",
      ...(effort === undefined || effort === "" ? {} : { reasoningEffort: effort }),
      acpxPermissionMode: input.acpxPermissionMode ?? "approve-all",
      lifecycleMode: input.lifecycleMode ?? "per_turn",
    },
  };
}

const TRANSLATE: Record<RunnerHarness, (config: Config) => Translation> = {
  claude_local: claude,
  codex_local: codex,
  opencode_local: opencode,
  pi_local: pi,
  grok_local: grok,
};

/** Legacy keys the translation carries over under a Runner key, so they aren't listed as dropped. */
const CARRIED: Record<RunnerHarness, Record<string, string[]>> = {
  claude_local: { modelReasoningEffort: ["effort", "reasoningEffort"], acpxPermissionMode: ["permissionMode", "acpPermissionMode"] },
  codex_local: { modelReasoningEffort: ["reasoningEffort", "effort"] },
  opencode_local: {},
  pi_local: { piThinkingLevel: ["thinking"] },
  grok_local: { reasoningEffort: ["modelReasoningEffort", "effort"] },
};

/** The keys that name the Runner's harness rather than a setting. */
const IDENTITY_KEYS = new Set(["provider", "acpxAgent"]);

const LABELS: Record<string, string> = {
  model: "Model",
  command: "Command",
  extraArgs: "Extra arguments",
  args: "Arguments",
  chrome: "Browser access",
  effort: "Thinking effort",
  reasoningEffort: "Thinking effort",
  modelReasoningEffort: "Thinking effort",
  variant: "Thinking effort",
  thinking: "Thinking level",
  piThinkingLevel: "Thinking level",
  maxTurnsPerRun: "Turns per run",
  maxTurns: "Turns per run",
  dangerouslySkipPermissions: "Skip permission prompts",
  dangerouslyBypassApprovalsAndSandbox: "Bypass the sandbox",
  dangerouslyBypassSandbox: "Bypass the sandbox",
  search: "Web search",
  fastMode: "Fast mode",
  engine: "Execution engine",
  agentCommand: "ACP server command",
  acpAgentCommand: "ACP server command",
  mode: "ACP session mode",
  acpMode: "ACP session mode",
  nonInteractivePermissions: "ACP non-interactive permissions",
  acpNonInteractivePermissions: "ACP non-interactive permissions",
  stateDir: "ACP state directory",
  acpStateDir: "ACP state directory",
  warmHandleIdleMs: "ACP warm process idle ms",
  acpWarmHandleIdleMs: "ACP warm process idle ms",
  permissionMode: "Permission mode",
  acpPermissionMode: "Permission mode",
  alwaysApprove: "Always approve",
  disableWebSearch: "Turn off web search",
  stdoutLogMode: "Log mode",
  acpxPermissionMode: "ACPX permission mode",
  codexPermissionMode: "Codex permission mode",
  opencodePermissionMode: "OpenCode permission mode",
  lifecycleMode: "Runner lifecycle",
};

/** A config key's name in the form: the field's label, or a plain name for the keys the form edits elsewhere. */
export function settingLabel(key: string, fields: readonly HarnessField[] = []) {
  return fields.find((field) => field.key === key)?.label ?? LABELS[key] ?? key;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The Runner config a legacy config becomes when the switch is saved, as the server translates it,
 * with the settings the Runner can't honor left out (they'd fail the save) and listed as dropped.
 * `fields` names the settings (the legacy harness's and the Runner's fields).
 */
export function runnerPreview(harness: RunnerHarness, legacy: Config, fields: readonly HarnessField[] = []): RunnerPreview {
  const translate = TRANSLATE[harness];
  // The server refuses the first unsupported setting it meets; leave them all out and translate again.
  let cleaned = { ...legacy };
  let result = translate(cleaned);
  const unsupported = new Set<string>();
  for (let pass = 0; pass < 3 && result.unsupported.length > 0; pass++) {
    for (const key of result.unsupported) unsupported.add(key);
    cleaned = without(cleaned, result.unsupported);
    result = translate(cleaned);
  }
  const carried = CARRIED[harness];
  const carriedFrom = new Set(Object.values(carried).flat());
  const dropped: DroppedSetting[] = [
    ...[...unsupported].map((key) => ({ key, label: settingLabel(key, fields), why: "unsupported" as const })),
    ...Object.keys(cleaned)
      .filter((key) => set(cleaned[key]) && !(key in result.config) && !carriedFrom.has(key))
      .map((key) => ({ key, label: settingLabel(key, fields), why: "unused" as const })),
  ];
  const changed = Object.keys(result.config)
    .filter((key) => !IDENTITY_KEYS.has(key) && !same(result.config[key], legacy[key]))
    .filter((key) => !(carried[key] ?? []).some((source) => same(cleaned[source], result.config[key])))
    .map((key) => ({ key, label: settingLabel(key, fields), value: result.config[key] }));
  return { config: result.config, dropped, changed, problem: result.problem ?? null };
}

/**
 * The adapter config the switch sends with `runner: "paperclip"` (with `replaceAdapterConfig`): the
 * legacy config the form holds, less the settings the Runner can't honor, plus the Runner settings
 * edited in the form (undefined clears one). The server translates the rest as it always does. A
 * Runner setting set here replaces the legacy setting it would otherwise be carried over from, so the
 * two can't disagree.
 */
export function runnerSwitchConfig(harness: RunnerHarness, legacy: Config, preview: Pick<RunnerPreview, "dropped">, runnerEntries: Config): Config {
  const replaced = Object.keys(runnerEntries).flatMap((key) => CARRIED[harness][key] ?? []);
  const config = without(legacy, [...preview.dropped.filter((entry) => entry.why === "unsupported").map((entry) => entry.key), ...replaced]);
  for (const [key, value] of Object.entries(runnerEntries)) {
    if (value === undefined) delete config[key];
    else config[key] = value;
  }
  return config;
}
