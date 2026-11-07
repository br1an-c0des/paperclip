/*
 * Which failed requests fix themselves, and which writes may have landed anyway. A trimmed copy of
 * ui/src/api/errors.ts (#15754) and `classifySendFailure` in ui/src/lib/pending-send.ts (#17960).
 *
 * The checks read `status`, `body` and `name` rather than importing the API client's error
 * classes, so the client can use this module without an import cycle, and a hand-rolled fetch
 * (the health probe) classifies the same way.
 */

export type ErrorKind = "transient" | "auth" | "forbidden" | "not_found" | "conflict" | "invalid" | "aborted" | "unknown";

/** Statuses a proxy or a restarting server answers with; the same request can work later. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504]);
/** Codes that mean "temporarily unavailable" whatever status they come with (the Cloud gateway's). */
const TRANSIENT_CODES = new Set(["tenant_app_unavailable", "tenant_app_starting", "WORKER_UNAVAILABLE", "TIMEOUT"]);
/** Of those, the ones that say the whole server is unreachable, not one busy route. */
const CONNECTIVITY_STATUSES = new Set([502, 503, 504]);
const CONNECTIVITY_CODES = new Set(["tenant_app_unavailable", "tenant_app_starting"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function errorStatus(error: unknown): number | null {
  const status = record(error)?.status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/** Every code the server put on an error: `body.error`, `body.code` and `body.details.code`. */
export function errorCodes(error: unknown): string[] {
  const body = record(record(error)?.body);
  const codes = [text(record(error)?.code), text(body?.error), text(body?.code), text(record(body?.details)?.code)];
  return [...new Set(codes.filter((code): code is string => code !== null))];
}

function isAbort(error: unknown) {
  const name = record(error)?.name;
  return name === "AbortError" || name === "CancelledError";
}

/** A dropped connection. Browsers word it differently; other TypeErrors are bugs, not outages. */
function isNetworkFailure(error: unknown) {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

function isUnavailable(error: unknown) {
  return record(error)?.name === "ApiUnavailableError";
}

export function classifyError(error: unknown): ErrorKind {
  if (error === null || error === undefined) return "unknown";
  if (isAbort(error)) return "aborted";
  if (isUnavailable(error) || isNetworkFailure(error)) return "transient";
  if (errorCodes(error).some((code) => TRANSIENT_CODES.has(code))) return "transient";
  const status = errorStatus(error);
  if (status === null) return "unknown";
  if (TRANSIENT_STATUSES.has(status)) return "transient";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 409 || status === 412) return "conflict";
  if (status >= 400 && status < 500) return "invalid";
  return "unknown";
}

export function isTransientError(error: unknown) {
  return classifyError(error) === "transient";
}

/**
 * A transient error that means the server as a whole can't be reached (a dropped connection, a
 * proxy's 502–504, the gateway's "app unavailable"), as opposed to one busy route (a 429, a plugin
 * worker restarting). Only these start the connection check (connectivity.ts).
 */
export function isConnectivityError(error: unknown) {
  if (isUnavailable(error) || isNetworkFailure(error)) return true;
  const codes = errorCodes(error);
  if (codes.some((code) => CONNECTIVITY_CODES.has(code))) return true;
  const status = errorStatus(error);
  if (status === null || !CONNECTIVITY_STATUSES.has(status)) return false;
  return !codes.some((code) => TRANSIENT_CODES.has(code));
}

/**
 * What a failed write means for its queued copy:
 *
 * - `pending`: not delivered, or not known to be. Keep it and send it again with the same key. That
 *   covers outages and lost answers: any 5xx can come after the server committed.
 * - `rejected`: the server said no. Sending the same request again can't help.
 */
export type SendFailure = "pending" | "rejected";

export function classifySendFailure(error: unknown): SendFailure {
  if (error instanceof UncertainWriteError) return "pending";
  const kind = classifyError(error);
  if (kind === "transient") return "pending";
  if (kind === "unknown" && (errorStatus(error) ?? 500) >= 500) return "pending";
  return "rejected";
}

/** The server answered, but not with the receipt a write expects: it may or may not have landed. */
export class UncertainWriteError extends Error {
  constructor(message = "Paperclip didn't confirm this was saved.") {
    super(message);
    this.name = "UncertainWriteError";
  }
}

/** Copy for a failed read or write, without raw codes ("tenant_app_unavailable") or "Request failed: 500". */
export function describeError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const kind = classifyError(error);
  if (kind === "transient") return "Paperclip is temporarily unavailable. Please try again in a moment.";
  if (kind === "auth") return "Your session has ended. Sign in again to continue.";
  const message = error instanceof Error ? error.message.trim() : "";
  // A code or a bare word ("forbidden", "tenant_app_unavailable") isn't a reason a person can read.
  const raw = !message || /^Request failed: \d+$/.test(message) || !/\s/.test(message);
  if (!raw) return message;
  if (kind === "forbidden") return "You don't have permission to see this.";
  if (kind === "not_found") return "This doesn't exist, or was moved.";
  if (kind === "conflict") return "This changed since it was loaded. Refresh and try again.";
  return fallback;
}
