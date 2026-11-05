import { readBoardBootstrap, type AuthSession, type BoardBootstrapSession } from "@paperclipai/shared";
import { ApiError, errorMessage, readApiJson } from "./client";

/*
 * Better Auth endpoints under `/api/auth`, as ui/src/api/auth.ts uses them. A signed-out session is
 * `null` (401), not an error. Better Auth answers a failed sign-in or sign-up with `{ code, message }`;
 * `authErrorCode` reads the code back off the thrown `ApiError`.
 *
 * The session may carry `boardBootstrap`: your companies and board access, read with it, so the board
 * can open without asking for them again (`src/lib/session.tsx`). It's kept only as
 * `readBoardBootstrap` passes it, for this account; a malformed one, or one for another account, is
 * dropped and the ordinary reads run.
 */

export function asSession(value: unknown): BoardBootstrapSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.session && record.user) {
    const { boardBootstrap: raw, ...session } = record as AuthSession & { boardBootstrap?: unknown };
    const userId = (session.user as { id?: unknown }).id;
    const boardBootstrap = typeof userId === "string" && raw !== undefined ? readBoardBootstrap(raw, userId) : undefined;
    return boardBootstrap ? { ...session, boardBootstrap } : session;
  }
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
  getSession: async (): Promise<BoardBootstrapSession | null> => {
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

  /** Creates an account and signs it in (authenticated mode only; the server may turn sign-up off). */
  signUpEmail: (input: { name: string; email: string; password: string }) => authPost("/sign-up/email", input),

  signOut: () => authPost("/sign-out", {}),
};

/** Better Auth's error code (`USER_ALREADY_EXISTS…`, `INVALID_EMAIL_OR_PASSWORD`), when there is one. */
export function authErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return null;
  const body = error.body as { code?: unknown; error?: unknown };
  if (typeof body.code === "string" && body.code) return body.code;
  const nested = body.error && typeof body.error === "object" ? (body.error as { code?: unknown }).code : undefined;
  return typeof nested === "string" && nested ? nested : null;
}
