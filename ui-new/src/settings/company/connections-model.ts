import type {
  AgentObservabilityCapture,
  AgentObservabilitySettings,
  AiManagedConnectionSummary,
  DecisionModelSettings,
  DecisionResult,
  FastResponseSettings,
  PromptInjectionPreventionSettings,
  UpdateAgentObservabilityRequest,
  UpdateDecisionModel,
  UpdateFastResponse,
  UpdatePromptInjectionPrevention,
} from "@paperclipai/shared";
import type { Tone } from "@/ui/Status";

/*
 * Connections (board 23): the models Paperclip itself runs on a shared AI connection (the decision
 * model, fast responses and the prompt injection check), and run telemetry (agent observability).
 * Each card edits a draft and saves it as a set, as the old UI's sections do, since these settings
 * change what every agent gets.
 */

export const DEFAULT_FAST_RESPONSE_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_INJECTION_MODEL = "openai/gpt-oss-safeguard-20b";

/** A connection's status as a pill: Working, or what's wrong. */
export function connectionStatus(connection: Pick<AiManagedConnectionSummary, "status"> | undefined): { label: string; tone: Tone } {
  switch (connection?.status) {
    case "connected":
      return { label: "Working", tone: "green" };
    case "expired":
      return { label: "Expired", tone: "red" };
    case "revoked":
      return { label: "Revoked", tone: "red" };
    case "needs_attention":
      return { label: "Needs attention", tone: "amber" };
    default:
      return { label: "Unavailable", tone: "red" };
  }
}

/** The connection a draft points at, among the choices; undefined when it isn't one of them. */
export function chosen<T extends Pick<AiManagedConnectionSummary, "grantId">>(choices: readonly T[], grantId: string | null | undefined) {
  return grantId ? choices.find((choice) => choice.grantId === grantId) : undefined;
}

// Decision model -------------------------------------------------------------------------------

export function decisionDraft(settings: DecisionModelSettings): Required<UpdateDecisionModel> {
  return { enabled: settings.enabled, connectionId: settings.connectionId, grantId: settings.grantId, allowBackground: settings.allowBackground };
}

export function decisionDirty(settings: DecisionModelSettings, draft: Required<UpdateDecisionModel>) {
  const before = decisionDraft(settings);
  return before.enabled !== draft.enabled || before.grantId !== draft.grantId || before.allowBackground !== draft.allowBackground;
}

const DECISION_FAILURES: Record<string, string> = {
  not_configured: "Choose and save a connection first.",
  disabled: "Turn decisions on and save before testing.",
  connection_unavailable: "The connection is unavailable. Reconnect it and try again.",
  access_denied: "This connection isn't shared with you.",
  incompatible_connection: "Choose an OpenAI or OpenRouter API connection.",
  budget_blocked: "A budget stops this request. Check Budgets.",
  provider_auth_failed: "The provider rejected the connection. Reconnect it and try again.",
  provider_rate_limited: "The provider is rate limited. Try again later.",
  timeout: "The provider didn't answer in time.",
  refused: "The model declined the test.",
  responsible_user_missing: "Nobody is responsible for this call. Set a default owner under General.",
  background_disabled: "Background decisions are off.",
};

/** What a decision test says: passed, or why not. */
export function decisionTestSummary(result: DecisionResult): { ok: boolean; text: string } {
  if (result.status === "succeeded") return { ok: true, text: "Passed. The usage was recorded; test answers aren't saved." };
  const code = result.status === "unavailable" ? result.reason : result.errorCode;
  return { ok: false, text: DECISION_FAILURES[code] ?? "The test couldn't finish. Check its entry in Costs." };
}

// Fast responses -------------------------------------------------------------------------------

export function fastDraft(settings: FastResponseSettings): Required<UpdateFastResponse> {
  return {
    enabled: settings.enabled,
    connectionId: settings.connectionId,
    grantId: settings.grantId,
    model: settings.model,
    allowSponsored: settings.allowSponsored ?? true,
  };
}

export function fastDirty(settings: FastResponseSettings, draft: Required<UpdateFastResponse>) {
  return JSON.stringify(fastDraft(settings)) !== JSON.stringify(draft);
}

/** The model a newly picked connection starts with: the default on OpenRouter, else its first routed model. */
export function fastModelFor(connection: AiManagedConnectionSummary): string | null {
  if (connection.provider === "openrouter" || connection.routing?.kind === "openrouter") return DEFAULT_FAST_RESPONSE_MODEL;
  const routing = connection.routing as { models?: { id: string }[] } | undefined;
  return routing?.models?.[0]?.id ?? null;
}

/** Why the draft can't be saved, if it can't. */
export function fastProblem(draft: Required<UpdateFastResponse>, connection: AiManagedConnectionSummary | undefined): string | null {
  if (!draft.enabled) return null;
  if (!draft.connectionId) return "Choose a connection before turning fast responses on.";
  if (!draft.model?.trim()) return "Enter the model to use.";
  if (connection?.status !== "connected") return "The chosen connection isn't working.";
  return null;
}

// Prompt injection check -----------------------------------------------------------------------

export function injectionDraft(settings: PromptInjectionPreventionSettings): UpdatePromptInjectionPrevention {
  return { enabled: settings.enabled, connectionId: settings.connectionId, grantId: settings.grantId, model: settings.model };
}

export function injectionDirty(settings: PromptInjectionPreventionSettings, draft: UpdatePromptInjectionPrevention) {
  return JSON.stringify(injectionDraft(settings)) !== JSON.stringify(draft);
}

export function injectionProblem(draft: UpdatePromptInjectionPrevention, connection: AiManagedConnectionSummary | undefined): string | null {
  const model = draft.model.trim();
  if (!model) return "Enter the model to use.";
  if (model.startsWith("openrouter/")) return "Use the OpenRouter model ID without the openrouter/ prefix.";
  if (draft.enabled && !draft.connectionId) return "Choose a shared OpenRouter connection before turning the model check on.";
  if (draft.enabled && connection?.status !== "connected") return "The chosen connection isn't working.";
  return null;
}

// Run telemetry ---------------------------------------------------------------------------------

export const DEFAULT_CAPTURE: AgentObservabilityCapture = { userPrompts: true, assistantResponses: true, toolDetails: true, toolContent: true };

export const CAPTURE_LABELS: readonly { key: keyof AgentObservabilityCapture; label: string }[] = [
  { key: "userPrompts", label: "Prompts" },
  { key: "assistantResponses", label: "Agent replies" },
  { key: "toolContent", label: "Tool output and content" },
  { key: "toolDetails", label: "Extra tool details (Claude Code)" },
];

export type HeaderRow = { id: number; originalName: string | null; name: string; value: string };

export type TelemetryDraft = {
  provider: "otlp" | "braintrust";
  endpoint: string;
  projectId: string;
  /** A new Braintrust API key; empty keeps the saved one. */
  apiKey: string;
  headers: HeaderRow[];
  enabled: boolean;
  capture: AgentObservabilityCapture;
};

let nextHeaderId = 1;
export function headerRow(name = "", originalName: string | null = null): HeaderRow {
  return { id: nextHeaderId++, originalName, name, value: "" };
}

/** A draft from the saved settings; with none saved, a new OTLP setup like the board's. */
export function telemetryDraft(settings: AgentObservabilitySettings | null): TelemetryDraft {
  const destination = settings?.destination;
  return {
    provider: destination?.provider ?? "otlp",
    endpoint: destination?.provider === "otlp" ? destination.endpointBaseUrl : "",
    projectId: destination?.provider === "braintrust" ? destination.projectId : "",
    apiKey: "",
    headers: destination?.provider === "otlp" ? settings!.headerNames.map((name) => headerRow(name, name)) : [],
    enabled: settings?.enabled ?? true,
    capture: { ...(settings?.capture ?? DEFAULT_CAPTURE) },
  };
}

function headerNames(rows: readonly HeaderRow[]) {
  return rows.map((row) => row.name.trim().toLowerCase()).sort();
}

/** Whether the headers changed: a value typed, a header renamed, added or removed. */
export function headersChanged(settings: AgentObservabilitySettings | null, draft: TelemetryDraft) {
  if (draft.provider !== "otlp") return false;
  const saved = settings?.destination.provider === "otlp" ? [...settings.headerNames].sort() : [];
  return draft.headers.some((row) => row.value || (row.originalName !== null && row.originalName !== row.name.trim().toLowerCase())) ||
    JSON.stringify(headerNames(draft.headers)) !== JSON.stringify(saved);
}

export function telemetryDirty(settings: AgentObservabilitySettings | null, draft: TelemetryDraft) {
  const before = telemetryDraft(settings);
  if (!settings) return Boolean(draft.endpoint.trim() || draft.projectId.trim() || draft.apiKey || draft.headers.length);
  return (
    before.provider !== draft.provider ||
    before.enabled !== draft.enabled ||
    JSON.stringify(before.capture) !== JSON.stringify(draft.capture) ||
    (draft.provider === "otlp" ? before.endpoint !== draft.endpoint.trim() : before.projectId !== draft.projectId.trim()) ||
    Boolean(draft.apiKey) ||
    headersChanged(settings, draft)
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Saved header values belong to their endpoint's origin; a new origin needs them typed again. */
export function needsFreshHeaders(settings: AgentObservabilitySettings | null, draft: TelemetryDraft) {
  if (draft.provider !== "otlp" || settings?.destination.provider !== "otlp" || settings.headerNames.length === 0) return false;
  return originOf(settings.destination.endpointBaseUrl) !== originOf(draft.endpoint.trim());
}

/** The request that saves the draft, or what's wrong with it. */
export function telemetryRequest(
  settings: AgentObservabilitySettings | null,
  draft: TelemetryDraft,
  enabled = draft.enabled,
): { request: UpdateAgentObservabilityRequest } | { problem: string } {
  const common = { expectedRevision: settings?.revision ?? null, enabled, capture: { ...draft.capture } };
  const providerChanged = !settings || settings.destination.provider !== draft.provider;
  if (draft.provider === "braintrust") {
    const projectId = draft.projectId.trim();
    if (!UUID.test(projectId)) return { problem: "Enter the Braintrust project ID (a UUID)." };
    const replace = providerChanged || Boolean(draft.apiKey) || (!settings?.credentialsConfigured && enabled);
    if (replace && !draft.apiKey.trim()) return { problem: "Enter the Braintrust API key." };
    return {
      request: {
        ...common,
        destination: { provider: "braintrust", projectId },
        credentials: replace ? { mode: "replace", apiKey: draft.apiKey.trim() } : { mode: "keep" },
      },
    };
  }
  const endpoint = draft.endpoint.trim();
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { problem: "Enter the collector's base URL, such as https://otel.example.com:4318." };
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return { problem: "Use an HTTP or HTTPS URL without a username, query or fragment." };
  }
  if (/\/v1\/(logs|traces|metrics)\/?$/i.test(url.pathname)) return { problem: "Enter the base URL, without /v1/logs or /v1/traces." };
  const names = headerNames(draft.headers);
  if (names.some((name) => !name)) return { problem: "Give every header a name, or remove it." };
  if (new Set(names).size !== names.length) return { problem: "Header names must be different." };
  const fresh = needsFreshHeaders(settings, draft);
  if (fresh && draft.headers.some((row) => !row.value)) return { problem: "The endpoint moved to a new address: type every header value again, or remove the header." };
  if (draft.headers.some((row) => row.originalName === null && !row.value)) return { problem: "Enter a value for each new header." };
  const replace = providerChanged || fresh || headersChanged(settings, draft);
  return {
    request: {
      ...common,
      destination: { provider: "otlp", endpointBaseUrl: endpoint },
      credentials: replace
        ? { mode: "replace", headers: draft.headers.map((row) => ({ name: row.name.trim(), ...(row.value ? { value: row.value } : {}) })) }
        : { mode: "keep" },
    },
  };
}

/** The status pill: Not set up, Sending, Off, or the last test's outcome. */
export function telemetryStatus(settings: AgentObservabilitySettings | null): { label: string; tone: Tone | null } {
  if (!settings) return { label: "Not set up", tone: null };
  if (!settings.enabled) return { label: "Off", tone: null };
  if (settings.lastTest?.status === "failed") return { label: "Last test failed", tone: "red" };
  if (settings.lastTest?.status === "partial") return { label: "Some test records rejected", tone: "amber" };
  return { label: "Sending", tone: "green" };
}
