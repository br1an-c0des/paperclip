import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ApiUnavailableError, errorMessage, isTemporaryApiError } from "./client";

function respond(status: number, body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(status === 204 ? null : body, { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON", async () => {
    respond(200, '{"ok":true}');
    await expect(api.get("/health")).resolves.toEqual({ ok: true });
  });

  it("throws ApiError with the server's message", async () => {
    respond(404, '{"error":"Company not found"}');
    const error = await api.get("/companies/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: "Company not found" });
  });

  it("treats an HTML answer as the server being unavailable", async () => {
    respond(200, "<!doctype html><title>Starting</title>");
    await expect(api.get("/health")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("returns undefined for 204", async () => {
    respond(204, "");
    await expect(api.delete("/x")).resolves.toBeUndefined();
  });
});

describe("isTemporaryApiError", () => {
  it("retries outages but not refusals", () => {
    expect(isTemporaryApiError(new ApiUnavailableError(200))).toBe(true);
    expect(isTemporaryApiError(new ApiError("Bad gateway", 502, null))).toBe(true);
    expect(isTemporaryApiError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTemporaryApiError(new ApiError("Unauthorized", 401, null))).toBe(false);
    expect(isTemporaryApiError(new Error("Failed to fetch"))).toBe(false);
  });
});

describe("errorMessage", () => {
  it("reads the shapes the server uses", () => {
    expect(errorMessage({ error: "Flat" }, 400)).toBe("Flat");
    expect(errorMessage({ error: { message: "Nested" } }, 400)).toBe("Nested");
    expect(errorMessage({ message: "Message" }, 400)).toBe("Message");
    expect(errorMessage(null, 500)).toBe("Request failed: 500");
  });

  it("reads an OAuth error's description rather than its code (U150)", () => {
    expect(errorMessage({ error: "invalid_grant", error_description: "This code is expired, already decided, or invalid." }, 400)).toBe(
      "This code is expired, already decided, or invalid.",
    );
    expect(errorMessage({ error: "invalid_grant", error_description: " " }, 400)).toBe("invalid_grant");
    // A sentence in `error` is already readable.
    expect(errorMessage({ error: "Agent not found", error_description: "Other" }, 404)).toBe("Agent not found");
  });
});
