/*
 * A small fetch wrapper for the Paperclip API (`/api`, proxied to the server in dev). Mirrors
 * `ui/src/api/client.ts`: JSON in and out, cookies included, `ApiError` for HTTP errors, and
 * `ApiUnavailableError` when a proxy or restarting server answers without JSON.
 *
 * Request de-duplication is left to the query layer (TanStack Query shares one fetch per key).
 */

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** A proxy or restarting server answered without usable JSON. */
export class ApiUnavailableError extends Error {
  status: number;

  constructor(status: number) {
    super("Paperclip is temporarily unavailable. Please try again in a moment.");
    this.name = "ApiUnavailableError";
    this.status = status;
  }
}

/** True for outages worth retrying: no JSON, a 502–504, or a network failure. */
export function isTemporaryApiError(error: unknown): boolean {
  if (error instanceof ApiUnavailableError) return true;
  if (error instanceof ApiError) return [502, 503, 504].includes(error.status);
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

export async function readApiJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // An HTML fallback can arrive with status 200 during a deployment.
    if (response.ok || response.status >= 500) throw new ApiUnavailableError(response.status);
    return null as T;
  }
}

export function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as { error?: unknown; message?: unknown };
    if (typeof record.error === "string" && record.error) return record.error;
    if (record.error && typeof record.error === "object") {
      const nested = record.error as { message?: unknown };
      if (typeof nested.message === "string" && nested.message) return nested.message;
    }
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return `Request failed: ${status}`;
}

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await readApiJson<unknown>(res);
  if (!res.ok) throw new ApiError(errorMessage(body, res.status), res.status, body);
  return body as T;
}

const json = (data: unknown) => (data === undefined ? undefined : JSON.stringify(data));

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { method: "GET", signal: options?.signal, headers: options?.headers, cache: "no-store" }),
  post: <T>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "POST", body: json(data ?? {}), signal: options?.signal, headers: options?.headers }),
  postForm: <T>(path: string, form: FormData, options?: RequestOptions) =>
    request<T>(path, { method: "POST", body: form, signal: options?.signal, headers: options?.headers }),
  put: <T>(path: string, data: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "PUT", body: json(data), signal: options?.signal, headers: options?.headers }),
  patch: <T>(path: string, data: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "PATCH", body: json(data), signal: options?.signal, headers: options?.headers }),
  delete: <T>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "DELETE", body: json(data), signal: options?.signal, headers: options?.headers }),
};
