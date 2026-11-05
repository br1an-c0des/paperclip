import { describe, expect, it } from "vitest";
import { ApiError, ApiUnavailableError } from "@/api/client";
import { failureKind, keepsLastGood, retryDelay, shouldRetry, TRANSIENT_RETRY_DELAYS_MS, UNKNOWN_RETRY_LIMIT } from "./retry-policy";

const bridge = (status: number, code: string) => new ApiError(code, status, { code, message: code });

describe("plugin data retry policy", () => {
  it("treats a restarting or slow worker, gateway errors and network drops as transient", () => {
    expect(failureKind(bridge(502, "WORKER_UNAVAILABLE"))).toBe("transient");
    expect(failureKind(bridge(500, "TIMEOUT"))).toBe("transient");
    expect(failureKind(new ApiError("Bad gateway", 504, null))).toBe("transient");
    expect(failureKind(new ApiError("Slow down", 429, null))).toBe("transient");
    expect(failureKind(new ApiUnavailableError(200))).toBe("transient");
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("transient");
  });

  it("never retries a client error or a cancelled read", () => {
    expect(failureKind(bridge(400, "INVALID_PARAMS"))).toBe("client");
    expect(shouldRetry(0, bridge(404, "NOT_FOUND"))).toBe(false);
    expect(shouldRetry(0, new DOMException("aborted", "AbortError"))).toBe(false);
  });

  it("retries transient failures through the whole backoff, unexpected ones twice", () => {
    const transient = bridge(502, "WORKER_UNAVAILABLE");
    expect(shouldRetry(TRANSIENT_RETRY_DELAYS_MS.length - 1, transient)).toBe(true);
    expect(shouldRetry(TRANSIENT_RETRY_DELAYS_MS.length, transient)).toBe(false);
    const unknown = new ApiError("Boom", 500, { code: "WORKER_ERROR", message: "Boom" });
    expect(failureKind(unknown)).toBe("unknown");
    expect(shouldRetry(UNKNOWN_RETRY_LIMIT - 1, unknown)).toBe(true);
    expect(shouldRetry(UNKNOWN_RETRY_LIMIT, unknown)).toBe(false);
  });

  it("backs off 1, 2, 4, 8 then 15 seconds", () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  });

  it("keeps the last good data only through a transient failure", () => {
    expect(keepsLastGood(bridge(502, "WORKER_UNAVAILABLE"))).toBe(true);
    expect(keepsLastGood(bridge(403, "FORBIDDEN"))).toBe(false);
    expect(keepsLastGood(new ApiError("Boom", 500, null))).toBe(false);
  });
});
