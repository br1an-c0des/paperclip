import type { AdapterConfigSchema, ConfigFieldSchema } from "@paperclipai/adapter-utils";
import type { Agent } from "@paperclipai/shared";
import type { AdapterInfo } from "@/api/agents";
import { harnessLabel, runnerCapable } from "./agent-model";

/*
 * Harness-specific settings and changing the harness, for Model and runtime (board 26), after the
 * old UI's per-adapter config fields (ui/src/adapters/<type>/config-fields.tsx) and its schema-driven
 * fields (schema-config-fields.tsx).
 *
 * A harness that declares its settings (`GET /adapters/:type/config-schema`: Claude Code's, Codex's
 * and Gemini's ACP engine, Hermes Gateway, external harnesses) gets those fields. The built-in
 * harnesses' other options, which the old UI hand-wrote, are listed here in the same shape. Fields
 * the section already edits (model, effort, command, arguments, prompt, timeouts, browser) are left
 * out. Values are kept as text or a switch while editing and turned back into config on save.
 *
 * `ADAPTER_AGNOSTIC_KEYS` mirrors packages/shared/src/constants.ts (ui-new imports the shared
 * package with `import type` only); check it at each upstream sync.
 */

export type HarnessField = ConfigFieldSchema;
export type ExtraValue = string | boolean;
export type ExtrasDraft = Record<string, ExtraValue>;

/** Keys a harness change keeps, as the old UI's `buildAgentUpdatePatch` does. */
export const ADAPTER_AGNOSTIC_KEYS = [
  "env",
  "promptTemplate",
  "instructionsFilePath",
  "cwd",
  "timeoutSec",
  "graceSec",
  "bootstrapPromptTemplate",
  "paperclipSkillSync",
] as const;

/** Keys Model and runtime edits elsewhere, or that only the server sets. */
const COVERED = new Set([
  // A Runner agent's provider and ACP agent are its harness: Change harness switches them.
  "provider",
  "acpxAgent",
  "model",
  "effort",
  "modelReasoningEffort",
  "reasoningEffort",
  "variant",
  "thinking",
  "command",
  "args",
  "extraArgs",
  "promptTemplate",
  "bootstrapPromptTemplate",
  "timeoutSec",
  "graceSec",
  "chrome",
  "env",
  "instructionsFilePath",
  "instructionsRootPath",
  "instructionsEntryFile",
  "instructionsBundleMode",
]);

/** The legacy harnesses' own options the old UI drew by hand (they have no schema for them). */
const LEGACY_FIELDS: Record<string, HarnessField[]> = {
  claude_local: [
    { key: "dangerouslySkipPermissions", label: "Skip permission prompts", type: "toggle", default: true, hint: "Runs unattended by approving the harness's permission prompts." },
    { key: "maxTurnsPerRun", label: "Turns per run", type: "number", hint: "The most tool calls one run may make. Empty uses the harness's limit." },
  ],
  codex_local: [
    { key: "dangerouslyBypassApprovalsAndSandbox", label: "Bypass the sandbox", type: "toggle", default: true, hint: "Runs Codex without sandbox limits. Needed to reach files and the network." },
    { key: "search", label: "Web search", type: "toggle", default: false, hint: "Lets Codex search the web during runs." },
    { key: "fastMode", label: "Fast mode", type: "toggle", default: false, hint: "Faster replies that use credits and tokens much faster. Supported on recent GPT models." },
  ],
  opencode_local: [
    { key: "dangerouslySkipPermissions", label: "Skip permission prompts", type: "toggle", default: true, hint: "Runs unattended by approving the harness's permission prompts." },
  ],
};

/** Harnesses without a schema whose connection settings the old UI drew by hand. */
const OUTSIDE_FIELDS: Record<string, HarnessField[]> = {
  http: [{ key: "url", label: "Webhook URL", type: "text", required: true, hint: "Paperclip sends each wake to this URL." }],
  openclaw_gateway: [
    { key: "url", label: "Gateway URL", type: "text", required: true, hint: "The OpenClaw gateway's ws:// or wss:// address." },
    { key: "agentId", label: "Agent ID", type: "text", hint: "The OpenClaw agent to wake. Empty uses the gateway's default." },
    {
      key: "sessionKeyStrategy",
      label: "Sessions",
      type: "select",
      default: "issue",
      options: [
        { value: "issue", label: "One per task" },
        { value: "run", label: "One per run" },
        { value: "fixed", label: "One fixed session" },
      ],
    },
    { key: "sessionKey", label: "Session key", type: "text", hint: "The fixed session's key.", meta: { visibleWhen: { key: "sessionKeyStrategy", value: "fixed" } } },
    { key: "role", label: "Role", type: "text", default: "operator" },
    { key: "scopes", label: "Scopes", type: "text", hint: "Separated by commas, such as operator.admin.", meta: { list: true } },
    { key: "paperclipApiUrl", label: "Paperclip API URL", type: "text", hint: "The address OpenClaw reaches Paperclip at, if it isn't this one." },
    { key: "waitTimeoutMs", label: "Wait timeout (ms)", type: "number" },
    { key: "disableDeviceAuth", label: "Turn off device sign-in", type: "toggle", default: false },
    { key: "autoPairOnFirstConnect", label: "Pair on first connect", type: "toggle", default: true },
  ],
};

/**
 * The fields to show for an agent: its harness's schema, then the hand-written ones the schema
 * doesn't name. Paperclip Runner agents get only the schema (the Runner manages the rest).
 */
export function harnessFields(adapterType: string, schema: AdapterConfigSchema | null | undefined): HarnessField[] {
  const declared = (schema?.fields ?? []).filter(
    (field) => !COVERED.has(field.key) && !(field.type === "select" && /permissionMode/i.test(field.key) && (field.options?.length ?? 0) <= 1),
  );
  const own = [...(LEGACY_FIELDS[adapterType] ?? []), ...(OUTSIDE_FIELDS[adapterType] ?? [])].filter(
    (field) => !declared.some((entry) => entry.key === field.key),
  );
  return [...declared, ...own];
}

/** Whether a field holds a secret, shown masked and sent only when retyped. */
export function isSecretField(field: HarnessField) {
  return field.meta?.secret === true || /(apikey|token|password|secret)$/i.test(field.key);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A field's value as the form edits it: a switch, or text (numbers, lists and objects as text). */
export function fieldValue(field: HarnessField, config: Record<string, unknown>): ExtraValue {
  const value = config[field.key];
  if (field.type === "toggle") return typeof value === "boolean" ? value : field.default === true;
  if (isSecretField(field)) return "";
  if (value === undefined || value === null) return field.type === "select" ? String(field.default ?? field.options?.[0]?.value ?? "") : "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function extrasDraft(fields: readonly HarnessField[], config: Record<string, unknown>): ExtrasDraft {
  return Object.fromEntries(fields.map((field) => [field.key, fieldValue(field, config)]));
}

/**
 * Whether a field shows, from its `visibleWhen`: another field's value in the draft, or in the saved
 * config for keys edited elsewhere (a Runner agent's `provider`). A key set in neither counts as
 * empty, so a Codex Runner agent doesn't show the Cursor-only `acpxSessionMode`.
 */
export function fieldVisible(field: HarnessField, draft: ExtrasDraft, config: Record<string, unknown> = {}) {
  const when = record(field.meta?.visibleWhen);
  if (typeof when.key !== "string") return true;
  const actual = String((when.key in draft ? draft[when.key] : config[when.key]) ?? "");
  if (typeof when.value === "string") return actual === when.value;
  if (Array.isArray(when.values)) return when.values.includes(actual);
  if (Array.isArray(when.notValues)) return !when.notValues.includes(actual);
  return true;
}

/** The keys whose values differ from the saved ones. */
export function extrasChanges(base: ExtrasDraft, draft: ExtrasDraft) {
  return Object.keys(draft).filter((key) => draft[key] !== base[key]);
}

/**
 * The adapter-config entries for the changed fields (undefined clears one), or a problem. A number
 * must be a number; text that held an object must still be a JSON object; a list is split on commas.
 */
export function extrasConfig(
  fields: readonly HarnessField[],
  base: ExtrasDraft,
  draft: ExtrasDraft,
  config: Record<string, unknown>,
): { entries: Record<string, unknown> } | { problem: string } {
  const entries: Record<string, unknown> = {};
  for (const key of extrasChanges(base, draft)) {
    const field = fields.find((entry) => entry.key === key);
    if (!field) continue;
    const value = draft[key];
    if (field.type === "toggle") {
      entries[key] = value === true;
      continue;
    }
    const text = String(value).trim();
    if (!text) {
      if (field.required) return { problem: `${field.label} can't be empty.` };
      entries[key] = undefined;
      continue;
    }
    if (field.type === "number") {
      if (!/^-?\d+(\.\d+)?$/.test(text)) return { problem: `${field.label} must be a number.` };
      entries[key] = Number(text);
    } else if (field.meta?.list === true || Array.isArray(config[key])) {
      entries[key] = text.split(",").map((item) => item.trim()).filter(Boolean);
    } else if (config[key] && typeof config[key] === "object") {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { problem: `${field.label} must be a JSON object.` };
        entries[key] = parsed;
      } catch {
        return { problem: `${field.label} isn't valid JSON.` };
      }
    } else {
      entries[key] = field.type === "textarea" ? String(value) : text;
    }
  }
  return { entries };
}

// ---------------------------------------------------------------------------------------------
// Changing the harness

/** Harnesses that are setup flows of their own, or retired, and not offered as a change. */
const NOT_OFFERED = new Set(["paperclip_runner", "acpx_local", "openai_dot", "muse", "grok_bot"]);

/** The harnesses an agent can move to: registered, loaded and turned on, other than its own. */
export function harnessChangeChoices(adapters: readonly AdapterInfo[] | undefined, current: string) {
  return (adapters ?? [])
    .filter((adapter) => !NOT_OFFERED.has(adapter.type) && adapter.type !== current && !adapter.disabled && adapter.loaded !== false && !adapter.overridePaused)
    .map((adapter) => ({ type: adapter.type, label: harnessLabel(adapter.type) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The `PATCH /agents/:id` body that moves an agent to another harness, as the old form saves it:
 * the new type, a fresh adapter config keeping only the harness-agnostic keys (instructions, env,
 * prompt, timeouts) plus the chosen model, the server's runner recommendation for harnesses the
 * Runner can carry, and the AI connection dropped when it's for another provider.
 */
export function harnessChangePatch(
  agent: Pick<Agent, "adapterConfig" | "runtimeConfig">,
  next: string,
  model: string,
  keepConnection: boolean,
): Record<string, unknown> {
  const existing = record(agent.adapterConfig);
  const adapterConfig: Record<string, unknown> = {};
  for (const key of ADAPTER_AGNOSTIC_KEYS) if (existing[key] !== undefined) adapterConfig[key] = existing[key];
  if (model.trim()) adapterConfig.model = model.trim();
  const patch: Record<string, unknown> = { adapterType: next, adapterConfig, replaceAdapterConfig: true };
  if (runnerCapable(next)) patch.runner = "auto";
  const runtime = record(agent.runtimeConfig);
  if (!keepConnection && runtime.aiConnection !== undefined) {
    const { aiConnection: _dropped, ...rest } = runtime;
    patch.runtimeConfig = rest;
  }
  return patch;
}
