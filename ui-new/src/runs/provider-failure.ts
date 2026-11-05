import { readProviderFailure, type ProviderFailure } from "@paperclipai/shared";

/*
 * A provider's own failure on a run (`resultJson.providerFailure`, upstream #18622): the model
 * provider refused or failed the request, as opposed to Paperclip or the harness. Read with the
 * shared package's `readProviderFailure`, which drops anything that isn't a valid
 * `paperclip.provider-failure.v1` record. Worded after the old UI's ProviderFailureNotice.
 */

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

const PROVIDER_NAMES: Record<string, string> = { anthropic: "Claude", openai: "OpenAI", google: "Google", xai: "xAI", moonshot: "Kimi" };

export type ProviderFailureNotice = {
  /** "Claude: Rate limit reached". */
  title: string;
  message: string;
  /** "Failed during work · HTTP 429 · rate_limit_error". */
  detail: string;
  requestId: string | null;
  /** When the provider said to try again, as an ISO time. */
  retryAt: string | null;
  /** True when it clears on its own; false when someone has to act (sign in, top up, change model). */
  transient: boolean;
};

export function providerFailureNotice(resultJson: Record<string, unknown> | null | undefined): ProviderFailureNotice | null {
  const failure = readProviderFailure(resultJson?.providerFailure);
  if (!failure) return null;
  const provider = PROVIDER_NAMES[failure.provider] ?? failure.provider;
  const detail = [
    failure.phase === "startup" ? "Failed before work started" : "Failed during work",
    failure.httpStatus ? `HTTP ${failure.httpStatus}` : "",
    failure.providerCode ?? "",
  ].filter(Boolean);
  return {
    title: `${provider}: ${CATEGORY_LABELS[failure.category]}`,
    message: failure.message,
    detail: detail.join(" · "),
    requestId: failure.requestId ?? null,
    retryAt: failure.retryAt ?? null,
    transient: failure.retryability === "transient",
  };
}
