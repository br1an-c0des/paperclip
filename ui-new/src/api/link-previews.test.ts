import { afterEach, describe, expect, it, vi } from "vitest";
import { linkPreviewsApi, parseRetryAfter } from "./link-previews";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("link preview reads (U175)", () => {
  it("parses Retry-After as seconds or a date, a minute without one", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:30 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(30_000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("Wed, 21 Oct 2026 07:29:00 GMT"))).toBe(0);
    expect(parseRetryAfter(null)).toBe(60_000);
    expect(parseRetryAfter("soon")).toBe(60_000);
  });

  it("reads saved status for several links in one request", async () => {
    const fetch = respond(200, { results: {} });
    await linkPreviewsApi.cached("co 1", ["https://github.com/a/b/pull/1", "https://github.com/a/b/pull/2"]);
    const url = new URL(String(fetch.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toBe("/api/companies/co%201/link-previews/cached");
    expect(url.searchParams.getAll("url")).toEqual(["https://github.com/a/b/pull/1", "https://github.com/a/b/pull/2"]);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });
  });

  it("puts a 429's Retry-After on the error", async () => {
    respond(429, { error: "Link preview rate limit exceeded" }, { "Retry-After": "12" });
    const error = await linkPreviewsApi.get("co1", "https://github.com/a/b/pull/1").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "ApiError", status: 429, retryAfterMs: 12_000, message: "Link preview rate limit exceeded" });
  });

  it("answers the preview", async () => {
    respond(200, { preview: null, maxAgeMs: 0 });
    expect(await linkPreviewsApi.get("co1", "https://github.com/a/b/pull/1")).toEqual({ preview: null, maxAgeMs: 0 });
  });
});
