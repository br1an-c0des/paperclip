import { ApiError, ApiUnavailableError } from "@/api/client";

/*
 * How a plugin's data reads retry, as ui/src/plugins/bridge.ts does after upstream's outage work
 * (#15754), with ui/src/lib/query-client.ts's policy:
 *
 * - Transient failures (a worker restarting or timing out, a gateway 502–504, a 408, 425 or 429,
 *   a network drop, a proxy answering without JSON) retry with backoff: 1, 2, 4, 8 and 15 seconds,
 *   about 30 seconds in all.
 * - Unexpected ones (another 5xx, an error with no status) retry twice.
 * - Client errors (4xx) and cancelled reads never retry.
 * - After the retries, a transient failure keeps the last good data for the same read (the
 *   reconnecting notice says why it isn't updating); anything else shows the error.
 *
 * ui-new's ApiError doesn't keep the `Retry-After` header, so the server's window isn't honoured.
 */

export const TRANSIENT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
export const UNKNOWN_RETRY_LIMIT = 2;

const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["WORKER_UNAVAILABLE", "TIMEOUT", "tenant_app_unavailable", "tenant_app_starting"]);

export type FailureKind = "transient" | "unknown" | "client" | "aborted";

function codes(error: ApiError) {
  const body = error.body && typeof error.body === "object" ? (error.body as Record<string, unknown>) : null;
  const details = body?.details && typeof body.details === "object" ? (body.details as Record<string, unknown>) : null;
  return [body?.code, body?.error, details?.code].filter((code): code is string => typeof code === "string");
}

export function failureKind(error: unknown): FailureKind {
  if (error === null || error === undefined) return "unknown";
  const name = (error as { name?: unknown }).name;
  if (name === "AbortError" || name === "CancelledError") return "aborted";
  if (error instanceof ApiUnavailableError) return "transient";
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return "transient";
  if (!(error instanceof ApiError)) return "unknown";
  if (codes(error).some((code) => TRANSIENT_CODES.has(code))) return "transient";
  if (TRANSIENT_STATUSES.has(error.status)) return "transient";
  if (error.status >= 400 && error.status < 500) return "client";
  return "unknown";
}

/** Whether to retry after `failures` failed tries, the latest being `error`. */
export function shouldRetry(failures: number, error: unknown) {
  const kind = failureKind(error);
  if (kind === "transient") return failures < TRANSIENT_RETRY_DELAYS_MS.length;
  if (kind === "unknown") return failures < UNKNOWN_RETRY_LIMIT;
  return false;
}

/** How long to wait before the next try, after `failures` failed tries. */
export function retryDelay(failures: number) {
  return TRANSIENT_RETRY_DELAYS_MS[Math.min(failures, TRANSIENT_RETRY_DELAYS_MS.length - 1)]!;
}

/** Whether a final failure keeps the data last read for the same request. */
export function keepsLastGood(error: unknown) {
  return failureKind(error) === "transient";
}
