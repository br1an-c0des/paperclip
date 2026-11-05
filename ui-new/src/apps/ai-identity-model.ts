import type { AiConnectionAccountIdentity, AiManagedConnectionSummary } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { IDENTITY_TIMEOUT_MS } from "@/api/ai-connections";

/*
 * The account an AI connection signs in as (upstream #18653, the old UI's
 * AiConnectionAccountDetails). The server asks the provider for the account and organization behind
 * one saved credential (`GET ai-connections/:id/identity?grantId=`). Only Claude subscriptions
 * support it, and only while connected; the list's `accountLabel` stands in otherwise.
 */

type Identity = AiConnectionAccountIdentity;

/** Whether Paperclip can ask the provider who this connection signs in as. */
export function canLookUpIdentity(connection: Pick<AiManagedConnectionSummary, "provider" | "method" | "status">) {
  return connection.provider === "anthropic" && connection.method === "subscription" && connection.status === "connected";
}

const CODE_TEXT: Record<NonNullable<Identity["errorCode"]>, string> = {
  unsupported: "This provider doesn't say which account a connection uses.",
  connection_unavailable: "The connection isn't available, so its account can't be checked.",
  authentication_required: "The provider asked to sign in again. Reconnect to check the account.",
  permission_denied: "The provider refused to share the account details.",
  rate_limited: "The provider is limiting requests. Try again in a minute.",
  provider_unavailable: "The provider didn't answer. Try again in a moment.",
  invalid_response: "The provider's answer couldn't be read.",
};

/** What to say about a check that didn't find the account, or null when there's nothing to say. */
export function identityMessage(identity: Identity | undefined, error: unknown): string | null {
  if (error) {
    const name = (error as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") return `The provider didn't answer within ${IDENTITY_TIMEOUT_MS / 1000} seconds.`;
    if (error instanceof ApiError) return error.message;
    return error instanceof Error && error.message ? error.message : "Couldn't check the account.";
  }
  if (!identity || identity.status === "available") return null;
  return identity.message ?? (identity.errorCode ? CODE_TEXT[identity.errorCode] : "The account details aren't available.");
}

/** Whether checking again could help: a failed request, or the provider erring. */
export function identityRetryable(identity: Identity | undefined, error: unknown) {
  return !!error || identity?.status === "error";
}
