import type { AuthSession } from "@paperclipai/shared";
import { ApiError, errorMessage, readApiJson } from "./client";

/*
 * Better Auth endpoints under `/api/auth`, as ui/src/api/auth.ts uses them. A signed-out session is
 * `null` (401), not an error.
 */

function asSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.session && record.user) return value as AuthSession;
  // Some responses wrap the session in `data`.
  return record.data ? asSession(record.data) : null;
}

async function authPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readApiJson<unknown>(res);
  if (!res.ok) throw new ApiError(errorMessage(payload, res.status), res.status, payload);
  return payload;
}

export const authApi = {
  getSession: async (): Promise<AuthSession | null> => {
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await readApiJson<unknown>(res);
    if (res.status === 401) return null;
    if (!res.ok) throw new ApiError(errorMessage(payload, res.status), res.status, payload);
    return asSession(payload);
  },

  signInEmail: (input: { email: string; password: string }) => authPost("/sign-in/email", input),

  signOut: () => authPost("/sign-out", {}),
};
