import { readProviderFailure, type ProviderFailure } from "@paperclipai/shared";
import { clockTime, dayLabel } from "@/runs/run-model";

/*
 * A model provider's refusal (upstream #18622): the provider refused or failed the request, as
 * opposed to Paperclip or the harness. The server writes it in the `paperclip.provider-failure.v1`
 * shape in two places, an interrupted task's `interruption.providerFailure` and a run's
 * `resultJson.providerFailure`. `readProviderFailure` (from shared) checks it, so a malformed one
 * shows as an ordinary interruption or error. One reader and one notice (ProviderFailureNotice.tsx)
 * serve both the task panel and the run modal, worded after the old UI's ProviderFailureNotice
 * (ui/src/components/ProviderFailureNotice.tsx).
 */

export type { ProviderFailure };

const CATEGORY_LABELS: Record<ProviderFailure["category"], string> = {
  rate_limit: "Rate limit reached",
  quota_exhausted: "Usage allowance exhausted",
  authentication: "Authentication failed",
  permission: "Access denied",
  model_unavailable: "Model unavailable",
  invalid_request: "Request rejected",
  overloaded: "Provider at capacity",
  timeout: "Provider timed out",
  unknown: "Provider error",
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  moonshot: "Kimi",
  openrouter: "OpenRouter",
};

/** The failure, checked, or null for none or one that isn't in the shape the server writes. */
export function providerFailureOf(value: unknown): ProviderFailure | null {
  return readProviderFailure(value);
}

/** A run's failure, from its `resultJson`. */
export function runProviderFailure(resultJson: Record<string, unknown> | null | undefined): ProviderFailure | null {
  return readProviderFailure(resultJson?.providerFailure);
}

/** "Claude", "OpenAI", or the provider's own id with a capital. */
export function providerName(provider: string) {
  return PROVIDER_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** "Claude: Rate limit reached". */
export function providerFailureTitle(failure: ProviderFailure) {
  return `${providerName(failure.provider)}: ${CATEGORY_LABELS[failure.category] ?? CATEGORY_LABELS.unknown}`;
}

/** "Failed before work started · HTTP 429 · rate_limit_error": when it failed and what the provider said. */
export function providerFailureFacts(failure: ProviderFailure) {
  return [
    failure.phase === "startup" ? "Failed before work started" : "Failed during work",
    failure.httpStatus ? `HTTP ${failure.httpStatus}` : null,
    failure.providerCode ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * When the provider said it could be tried again: "Clears after Today 10:00:00 am" for a limit that
 * lifts by itself, "Can retry after …" when someone has to act first. Null when it gave no time.
 */
export function providerRetryLine(failure: ProviderFailure, now: Date = new Date()) {
  if (!failure.retryAt || Number.isNaN(Date.parse(failure.retryAt))) return null;
  const lead = failure.retryability === "transient" ? "Clears after" : "Can retry after";
  return `${lead} ${dayLabel(failure.retryAt, now)} ${clockTime(failure.retryAt)}`;
}
