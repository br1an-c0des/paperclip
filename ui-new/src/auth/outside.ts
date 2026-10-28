import { createQuery } from "@tanstack/solid-query";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";

/*
 * Health and session for a page outside the session gate (invites, claims, CLI and MCP approval):
 * these pages must open for someone signed out, and decide for themselves what needs a session.
 * A local_trusted instance always has the local board's session.
 */
export function useOutsideSession() {
  const health = createQuery(() => ({ queryKey: queryKeys.health, queryFn: healthApi.get, retry: false }));
  const session = createQuery(() => ({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false }));
  return {
    health,
    session,
    loading: () => health.isLoading || session.isLoading,
    authenticated: () => health.data?.deploymentMode === "authenticated",
    local: () => health.data?.deploymentMode === "local_trusted",
    signedIn: () => !!session.data,
    /** The signed-in person's name, then email. */
    who: () => session.data?.user.name?.trim() || session.data?.user.email?.trim() || "this account",
  };
}
