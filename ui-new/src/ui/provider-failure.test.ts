import { describe, expect, it } from "vitest";
import {
  providerFailureFacts,
  providerFailureOf,
  providerFailureTitle,
  providerName,
  providerRetryLine,
  runProviderFailure,
  type ProviderFailure,
} from "./provider-failure";

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
    expect(providerName("moonshot")).toBe("Kimi");
    expect(providerName("openrouter")).toBe("OpenRouter");
    expect(providerName("mistral")).toBe("Mistral");
  });

  it("says when it failed and what the provider answered", () => {
    expect(providerFailureFacts(failure)).toBe("Failed before work started · HTTP 429 · rate_limit_error");
    expect(providerFailureFacts({ ...failure, phase: "turn", httpStatus: undefined, providerCode: undefined })).toBe("Failed during work");
  });

  it("reads only the shape the server writes", () => {
    expect(providerFailureOf(failure)).toEqual(failure);
    expect(providerFailureOf({ ...failure, category: "nonsense" })).toBeNull();
    expect(providerFailureOf({ ...failure, schema: "other" })).toBeNull();
    expect(providerFailureOf(undefined)).toBeNull();
  });

  it("reads a run's failure from its result", () => {
    expect(runProviderFailure({ providerFailure: failure })).toEqual(failure);
    expect(runProviderFailure({})).toBeNull();
    expect(runProviderFailure(null)).toBeNull();
  });

  it("says when it can be tried again, by whether it clears by itself", () => {
    const now = new Date(2026, 10, 5, 9, 0, 0);
    const retryAt = new Date(2026, 10, 5, 10, 30, 0).toISOString();
    expect(providerRetryLine(failure, now)).toBeNull();
    expect(providerRetryLine({ ...failure, retryAt: "soon" }, now)).toBeNull();
    expect(providerRetryLine({ ...failure, retryAt }, now)).toBe("Clears after Today 10:30:00 am");
    expect(providerRetryLine({ ...failure, retryAt, retryability: "requires_action" }, now)).toBe("Can retry after Today 10:30:00 am");
  });
});
