import { describe, expect, it } from "vitest";
import { providerFailureNotice } from "./provider-failure";

const failure = {
  schema: "paperclip.provider-failure.v1",
  provider: "anthropic",
  phase: "turn",
  category: "rate_limit",
  message: "Number of requests has exceeded your rate limit.",
  providerCode: "rate_limit_error",
  httpStatus: 429,
  requestId: "req_011",
  retryAt: "2026-11-05T10:00:00.000Z",
  retryability: "transient",
};

describe("providerFailureNotice", () => {
  it("names the provider and what went wrong", () => {
    expect(providerFailureNotice({ providerFailure: failure })).toEqual({
      title: "Claude: Rate limit reached",
      message: "Number of requests has exceeded your rate limit.",
      detail: "Failed during work · HTTP 429 · rate_limit_error",
      requestId: "req_011",
      retryAt: "2026-11-05T10:00:00.000Z",
      transient: true,
    });
  });

  it("keeps an unknown provider's own name and leaves out what it didn't say", () => {
    const notice = providerFailureNotice({
      providerFailure: { schema: failure.schema, provider: "openrouter", phase: "startup", category: "authentication", message: "Bad key", retryability: "requires_action" },
    });
    expect(notice).toMatchObject({ title: "openrouter: Authentication failed", detail: "Failed before work started", requestId: null, retryAt: null, transient: false });
  });

  it("ignores anything that isn't a valid provider failure", () => {
    expect(providerFailureNotice(null)).toBeNull();
    expect(providerFailureNotice({})).toBeNull();
    expect(providerFailureNotice({ providerFailure: { ...failure, schema: "other" } })).toBeNull();
    expect(providerFailureNotice({ providerFailure: { ...failure, category: "nope" } })).toBeNull();
  });
});
