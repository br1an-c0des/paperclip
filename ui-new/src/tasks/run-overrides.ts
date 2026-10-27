import type { IssueAssigneeAdapterOverrides } from "@paperclipai/shared";

/*
 * Which model and thinking effort a task's runs can be given, per adapter: the one mirrored table
 * that New task and the composer share (decision 13, option 2 until upstream serves the lists).
 *
 * It copies upstream's task composer (ui/src/components/task-chat/composer-run-settings.ts) and the
 * adapter packages it reads at runtime:
 *
 * - claudeLocalReasoningEffortsForModel (packages/adapters/claude-local/src/index.ts)
 * - codexLocalReasoningEffortsForModel (packages/adapters/codex-local/src/index.ts)
 * - grokLocalReasoningEffortsForModel and DEFAULT_GROK_LOCAL_MODEL (grok-local)
 * - KIMI_SUPPORTED_EFFORTS, EFFORT_CAPABLE_MODELS and DEFAULT_KIMI_LOCAL_MODEL (kimi-local)
 *
 * The typecheck can't catch a change to those, so the upstream sync checks them by hand.
 * Not mirrored: Codex fast mode, and the router-pool and OpenRouter catalog variants of the runner.
 */

/** Adapters whose runs a task can override (decision 13). */
export const OVERRIDE_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "opencode_local",
  "pi_local",
  "kimi_local",
  "gemini_local",
  "cursor",
  "cursor_cloud",
  "grok_local",
  "hermes_local",
  "paperclip_runner",
]);

type AgentLike = { adapterType: string; adapterConfig: Record<string, unknown> };

export function supportsOverrides(adapterType: string | null | undefined) {
  return !!adapterType && OVERRIDE_ADAPTERS.has(adapterType);
}

/** As `supportsComposerModel`: the runner's Muse provider takes no model. */
export function agentSupportsOverrides(agent: AgentLike | null | undefined) {
  if (!agent || !supportsOverrides(agent.adapterType)) return false;
  return !(agent.adapterType === "paperclip_runner" && agent.adapterConfig.provider === "muse");
}

/** Where an adapter reads its effort from, or null when it takes none. */
export function effortKeyFor(adapterType: string | null | undefined): string | null {
  switch (adapterType) {
    case "codex_local":
    case "paperclip_runner":
      return "modelReasoningEffort";
    case "claude_local":
    case "kimi_local":
      return "effort";
    case "grok_local":
      return "reasoningEffort";
    case "pi_local":
      return "thinking";
    case "opencode_local":
      return "variant";
    default:
      return null;
  }
}

export type EffortOption = { value: string; label: string };

const EFFORT_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  ultra: "Ultra",
};

const CODEX_DEFAULT = ["minimal", "low", "medium", "high", "xhigh"];
const CODEX_MAX = ["low", "medium", "high", "xhigh", "max"];
const CODEX_ULTRA = [...CODEX_MAX, "ultra"];
const CODEX_BY_MODEL: Record<string, string[]> = {
  "gpt-6-astra": CODEX_ULTRA,
  "gpt-6.1-sol": CODEX_ULTRA,
  "gpt-6-sol": CODEX_ULTRA,
  "gpt-5.6-sol": CODEX_ULTRA,
  "gpt-5.6-terra": CODEX_ULTRA,
  "gpt-6-luna": CODEX_MAX,
  "gpt-5.6-luna": CODEX_MAX,
};

function codexEfforts(model: string) {
  return CODEX_BY_MODEL[model.trim().toLowerCase()] ?? CODEX_DEFAULT;
}

function claudeEfforts(model: string) {
  const id = model.trim().replace(/\[1m\]$/, "").replace(/^(?:(?:us|eu|apac|global)\.)?anthropic\./, "");
  if (!id) return ["low", "medium", "high"];
  if (/^claude-haiku-/.test(id)) return [];
  if (/^claude-(?:opus-5(?:-5)?|opus-4-[78]|sonnet-5(?:-5)?|fable-5(?:-1)?)$/.test(id)) return ["low", "medium", "high", "xhigh", "max"];
  if (/^claude-(?:opus|sonnet)-4-6(?:-v1)?$/.test(id)) return ["low", "medium", "high", "max"];
  return ["low", "medium", "high"];
}

const GROK_DEFAULT_MODEL = "grok-build";
const KIMI_DEFAULT_MODEL = "kimi-code/kimi-for-coding";
const KIMI_EFFORT_MODELS = new Set([KIMI_DEFAULT_MODEL, "kimi-code/k3", "kimi-code/k3-256k"]);

/**
 * The effort choices for an adapter and model, after `composerEfforts`. `model` is the chosen
 * model, or else the agent's own. Kimi needs its CLI engine, and the runner its Codex provider, so
 * those read the agent's config.
 */
export function effortOptions(adapterType: string, model: string | null, adapterConfig: Record<string, unknown> = {}): EffortOption[] {
  const chosen = (model ?? "").trim();
  let values: string[] = [];
  switch (adapterType) {
    case "claude_local":
      values = claudeEfforts(chosen);
      break;
    case "codex_local":
      values = codexEfforts(chosen);
      break;
    case "paperclip_runner":
      values = String(adapterConfig.provider ?? "codex") === "codex" ? codexEfforts(chosen) : [];
      break;
    case "grok_local": {
      const id = chosen || GROK_DEFAULT_MODEL;
      values = id === "grok-4.7" || id === "grok-4.6" ? ["low", "medium", "high", "xhigh"] : ["low", "medium", "high"];
      break;
    }
    case "pi_local":
      values = ["off", "minimal", "low", "medium", "high", "xhigh"];
      break;
    case "kimi_local": {
      const engine = typeof adapterConfig.engine === "string" ? adapterConfig.engine.trim().toLowerCase() : "";
      values = engine === "cli" && KIMI_EFFORT_MODELS.has(chosen || KIMI_DEFAULT_MODEL) ? ["low", "high", "max"] : [];
      break;
    }
    case "opencode_local":
      values = ["minimal", "low", "medium", "high", "xhigh", "max"];
      break;
  }
  return values.map((value) => ({ value, label: EFFORT_LABELS[value] ?? value }));
}

/** The agent's own model and effort, as its adapter config states them. */
export function agentRunDefaults(adapterType: string, adapterConfig: Record<string, unknown>) {
  const read = (key: string | null) => (key && typeof adapterConfig[key] === "string" ? (adapterConfig[key] as string) : null);
  const effort =
    adapterType === "codex_local" || adapterType === "paperclip_runner"
      ? (read("modelReasoningEffort") ?? read("reasoningEffort") ?? read("effort"))
      : read(effortKeyFor(adapterType));
  return { model: read("model"), effort };
}

/** A new task's overrides: only what was chosen, under the adapter's own keys. */
export function buildAdapterOverrides(adapterType: string | null | undefined, model: string | null, effort: string | null) {
  if (!adapterType || !supportsOverrides(adapterType)) return null;
  const adapterConfig: Record<string, unknown> = {};
  if (model) adapterConfig.model = model;
  const key = effortKeyFor(adapterType);
  if (effort && key) adapterConfig[key] = effort;
  return Object.keys(adapterConfig).length > 0 ? { adapterConfig } : null;
}

/** What the composer chose for the task's next runs. null: the agent's own setting. */
export type RunSettings = { model: string | null; effort: string | null };

const RUN_KEYS = ["model", "modelReasoningEffort", "reasoningEffort", "effort", "thinking", "variant", "fastMode"];

/** The model and effort a task's overrides already set, after `readComposerRunSettings`. */
export function readRunSettings(overrides: IssueAssigneeAdapterOverrides | null | undefined, adapterType: string | null | undefined): RunSettings {
  const config = (overrides?.adapterConfig ?? {}) as Record<string, unknown>;
  const key = effortKeyFor(adapterType);
  const effort =
    key && (config[key] ?? (adapterType === "codex_local" || adapterType === "paperclip_runner" ? (config.reasoningEffort ?? config.effort) : undefined));
  return {
    model: typeof config.model === "string" ? config.model : null,
    effort: typeof effort === "string" ? effort : null,
  };
}

/**
 * The task's overrides after a message that sets run settings, after `mergeComposerRunSettings`:
 * the previous model and effort keys go, the new ones come in under the adapter's key, and other
 * keys stay unless the message also reassigns the task.
 */
export function mergeRunOverrides(
  previous: IssueAssigneeAdapterOverrides | null | undefined,
  adapterType: string | null | undefined,
  settings: RunSettings,
  reassigned = false,
): IssueAssigneeAdapterOverrides | null {
  const config: Record<string, unknown> = { ...(reassigned ? {} : (previous?.adapterConfig as Record<string, unknown> | undefined)) };
  for (const key of RUN_KEYS) delete config[key];
  if (settings.model) config.model = settings.model;
  const key = effortKeyFor(adapterType);
  if (settings.effort && key) config[key] = settings.effort;
  const useProjectWorkspace = reassigned ? undefined : previous?.useProjectWorkspace;
  const hasConfig = Object.keys(config).length > 0;
  if (!hasConfig && useProjectWorkspace === undefined) return null;
  return {
    ...(hasConfig ? { adapterConfig: config } : {}),
    ...(useProjectWorkspace !== undefined ? { useProjectWorkspace } : {}),
  } as IssueAssigneeAdapterOverrides;
}
