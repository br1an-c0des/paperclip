import { describe, expect, it } from "vitest";
import { interruptionReason, providerFailureFacts, providerFailureOf, providerFailureTitle, providerName, type ProviderFailure } from "./provider-failure";

const failure: ProviderFailure = {
  schema: "paperclip.provider-failure.v1",
  provider: "anthropic",
  phase: "startup",
  category: "rate_limit",
  message: "Too many requests",
  httpStatus: 429,
  providerCode: "rate_limit_error",
  requestId: "req_123",
  retryability: "transient",
};

describe("provider failures", () => {
  it("names the provider and what went wrong", () => {
    expect(providerFailureTitle(failure)).toBe("Claude: Rate limit reached");
    expect(providerFailureTitle({ ...failure, provider: "openai", category: "quota_exhausted" })).toBe("OpenAI: Usage allowance exhausted");
    expect(providerName("kimi")).toBe("Kimi");
  });

  it("says when it failed and what the provider answered", () => {
    expect(providerFailureFacts(failure)).toBe("Failed before work started · HTTP 429 · rate_limit_error");
    expect(providerFailureFacts({ ...failure, phase: "turn", httpStatus: undefined, providerCode: undefined })).toBe("Failed during work");
  });

  it("reads only the shape the server writes", () => {
    expect(providerFailureOf(failure)).toEqual(failure);
    expect(providerFailureOf({ ...failure, category: "nonsense" })).toBeNull();
    expect(providerFailureOf(undefined)).toBeNull();
  });

  it("sums up an interruption's reason for a row", () => {
    expect(interruptionReason({ providerFailure: failure })).toBe("Claude: Rate limit reached");
    expect(interruptionReason({ workspaceFailure: { message: "Disk full" } })).toBe("Couldn't prepare the task folders: Disk full");
    expect(interruptionReason({})).toBeNull();
    expect(interruptionReason(null)).toBeNull();
  });
});
