import { readProviderFailure, type ProviderFailure } from "@paperclipai/shared";

/*
 * A provider's refusal, as the server reports it since the 2026-11-03 sync (upstream #18622): an
 * interrupted task's `interruption.providerFailure`, and a run's `resultJson.providerFailure`. The
 * server writes it in the `paperclip.provider-failure.v1` shape; `readProviderFailure` (from shared)
 * checks it, so a malformed one shows as an ordinary interruption. Words after the old UI's
 * ProviderFailureNotice (ui/src/components/ProviderFailureNotice.tsx).
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

const PROVIDER_NAMES: Record<string, string> = { anthropic: "Claude", openai: "OpenAI" };

/** The failure, checked, or null for none or one that isn't in the shape the server writes. */
export function providerFailureOf(value: unknown): ProviderFailure | null {
  return readProviderFailure(value);
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
 * What stopped an interrupted task, in a line for a row's tooltip: the provider's refusal, or the
 * task's folders that couldn't be prepared (`workspaceFailure`, upstream #18770). Null for neither.
 */
export function interruptionReason(interruption: { providerFailure?: unknown; workspaceFailure?: { message: string } | null } | null | undefined) {
  const failure = providerFailureOf(interruption?.providerFailure);
  if (failure) return providerFailureTitle(failure);
  const workspace = interruption?.workspaceFailure?.message;
  return workspace ? `Couldn't prepare the task folders: ${workspace}` : null;
}
