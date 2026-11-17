import type { LinkPreviewBatchResult, LinkPreviewResult } from "@paperclipai/shared";
import { connectivity } from "@/lib/offline/connectivity";
import { ApiError, errorMessage, readApiJson } from "./client";

/*
 * Link previews (U113, since the 2026-11-10 sync, upstream #20593; U175, upstream #21746): what a
 * GitHub pull request link in a message points at, its title, state (open, draft, merged, closed,
 * or blocked by merge conflicts), author and last update. Both reads are for board users only and
 * answer `private, no-store`, per viewer and company.
 *
 * - `get` (`GET /companies/:companyId/link-preview?url=`) asks GitHub, with the viewer's own
 *   access, when the server's saved status is missing or stale. It's rate-limited per company and
 *   viewer (600 a window); past that it answers 429 with `Retry-After`, which the thrown
 *   `ApiError` carries as `retryAfterMs`.
 * - `cached` (`GET /companies/:companyId/link-previews/cached?url=…&url=…`) reads the saved status
 *   of up to `LINK_PREVIEW_BATCH_LIMIT` (50) links at once and never contacts GitHub. A link
 *   with no saved status is missing from `results`; `maxAgeMs: 0` means stale.
 *
 * Both go through `request` below rather than the shared client, only so a 429's `Retry-After`
 * header reaches the caller; errors and connectivity reports otherwise match client.ts. Each read
 * gives up after six seconds, as the old UI's do: a preview is optional and mustn't hang.
 */

const TIMEOUT_MS = 6_000;
/** When a 429 comes without a usable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

/** A 429's `Retry-After` (seconds or an HTTP date) in milliseconds from `now`. */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (value) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
    const at = Date.parse(trimmed);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      connectivity.reportFailure(error);
      throw error;
    }
    try {
      const body = await readApiJson<unknown>(res);
      if (!res.ok) {
        const error = new ApiError(errorMessage(body, res.status), res.status, body);
        if (res.status === 429) Object.assign(error, { retryAfterMs: parseRetryAfter(res.headers.get("Retry-After")) });
        throw error;
      }
      connectivity.reportSuccess();
      return body as T;
    } catch (error) {
      connectivity.reportFailure(error);
      throw error;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`;

export const linkPreviewsApi = {
  get: (companyId: string, url: string, signal?: AbortSignal) =>
    request<LinkPreviewResult>(`${base(companyId)}/link-preview?${new URLSearchParams({ url })}`, signal),
  cached: (companyId: string, urls: readonly string[], signal?: AbortSignal) =>
    request<LinkPreviewBatchResult>(`${base(companyId)}/link-previews/cached?${new URLSearchParams(urls.map((url) => ["url", url]))}`, signal),
};
