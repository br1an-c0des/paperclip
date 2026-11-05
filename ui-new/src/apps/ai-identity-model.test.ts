import type { AiConnectionAccountIdentity } from "@paperclipai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiConnectionsApi } from "@/api/ai-connections";
import { ApiError } from "@/api/client";
import { canLookUpIdentity, identityMessage, identityRetryable } from "./ai-identity-model";

const identity = (over: Partial<AiConnectionAccountIdentity> = {}): AiConnectionAccountIdentity => ({
  connectionId: "c1",
  grantId: "g1",
  status: "available",
  checkedAt: "2026-11-05T10:00:00Z",
  accountLabel: "brian@example.com",
  organizationLabel: "Acme",
  ...over,
});

describe("AI connection account identity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("looks up connected Claude subscriptions only", () => {
    expect(canLookUpIdentity({ provider: "anthropic", method: "subscription", status: "connected" })).toBe(true);
    expect(canLookUpIdentity({ provider: "anthropic", method: "api_key", status: "connected" })).toBe(false);
    expect(canLookUpIdentity({ provider: "anthropic", method: "subscription", status: "expired" })).toBe(false);
    expect(canLookUpIdentity({ provider: "openai", method: "subscription", status: "connected" })).toBe(false);
  });

  it("says nothing when the account was found", () => {
    expect(identityMessage(identity(), null)).toBeNull();
    expect(identityRetryable(identity(), null)).toBe(false);
  });

  it("explains a provider failure, and offers to check again only when that could help", () => {
    const failed = identity({ status: "error", accountLabel: null, errorCode: "rate_limited" });
    expect(identityMessage(failed, null)).toMatch(/limiting requests/);
    expect(identityRetryable(failed, null)).toBe(true);
    const unsupported = identity({ status: "unavailable", accountLabel: null, errorCode: "unsupported" });
    expect(identityRetryable(unsupported, null)).toBe(false);
    expect(identityMessage(identity({ status: "error", message: "Anthropic is down." }), null)).toBe("Anthropic is down.");
  });

  it("names the 20-second limit when the provider doesn't answer", () => {
    expect(identityMessage(undefined, new DOMException("timed out", "TimeoutError"))).toMatch(/20 seconds/);
    expect(identityMessage(undefined, new ApiError("Connection not found", 404, null))).toBe("Connection not found");
    expect(identityRetryable(undefined, new Error("offline"))).toBe(true);
  });

  it("reads the identity for one credential with a timeout", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(identity()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    await aiConnectionsApi.accountIdentity("co1", "c1", "g 1");
    expect(fetch.mock.calls[0]![0]).toBe("/api/companies/co1/ai-connections/c1/identity?grantId=g%201");
  });
});
