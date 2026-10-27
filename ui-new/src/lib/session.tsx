import type { AuthSession } from "@paperclipai/shared";
import { Navigate, useLocation, useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createContext, createEffect, createSignal, Match, Show, Switch, useContext, type ParentProps } from "solid-js";
import { accessApi } from "@/api/access";
import { authApi } from "@/api/auth";
import { isTemporaryApiError } from "@/api/client";
import { healthApi, type HealthStatus } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/ui/Button";
import { Splash } from "@/routes/Splash";

/*
 * The session gate in front of every board page, after ui/src/components/CloudAccessGate.tsx:
 *
 * 1. `GET /api/health` says how the instance runs. `local_trusted` instances have no sign-in.
 * 2. On `authenticated` instances, `GET /api/auth/get-session` must return a session, or the user
 *    is sent to `/auth?next=…`.
 * 3. `GET /api/cli-auth/me` must show access to at least one company (or instance admin).
 *
 * While the server is restarting the gate keeps what it has and shows a reconnecting notice, so an
 * outage doesn't unmount the page and lose drafts.
 */

const RECONNECT_INTERVAL_MS = 3_000;

type SessionValue = {
  health: () => HealthStatus | undefined;
  /** The signed-in user, or null on a local_trusted instance. */
  session: () => AuthSession | null;
  userId: () => string | null;
  /** The id tasks use for you: your user id, or `local-board` on a local_trusted instance. */
  youId: () => string | null;
  isAuthenticatedMode: () => boolean;
};

const SessionContext = createContext<SessionValue>();

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionGate>");
  return context;
}

/** The signed-in person's display name: name, then email; "Local board" without sign-in. */
export function useYouName() {
  const session = useSession();
  return () =>
    session.isAuthenticatedMode() ? (session.session()?.user.name ?? session.session()?.user.email ?? "You") : "Local board";
}

/** Signs out, drops every cached query, and goes to the sign-in page. */
export function useSignOut() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await authApi.signOut();
    client.clear();
    navigate("/auth", { replace: true });
  };
}

/** A path from `?next=` that's safe to send the user back to after sign-in. */
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/auth")) return "/";
  return next;
}

export function SessionGate(props: ParentProps) {
  const location = useLocation();

  const health = createQuery(() => ({
    queryKey: queryKeys.health,
    queryFn: healthApi.get,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.error) return isTemporaryApiError(query.state.error) ? RECONNECT_INTERVAL_MS : false;
      const data = query.state.data;
      if (data?.status === "starting") return RECONNECT_INTERVAL_MS;
      return data?.deploymentMode === "authenticated" && data.bootstrapStatus === "bootstrap_pending" ? 2_000 : false;
    },
  }));

  const isAuthenticatedMode = () => health.data?.deploymentMode === "authenticated";
  const isBootstrapPending = () => isAuthenticatedMode() && health.data?.bootstrapStatus === "bootstrap_pending";

  const session = createQuery(() => ({
    queryKey: queryKeys.auth.session,
    queryFn: authApi.getSession,
    enabled: isAuthenticatedMode(),
    retry: false,
    refetchInterval: (query) => (isTemporaryApiError(query.state.error) ? RECONNECT_INTERVAL_MS : false),
  }));

  const access = createQuery(() => ({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: accessApi.currentBoardAccess,
    enabled: isAuthenticatedMode() && !isBootstrapPending() && !!session.data,
    retry: false,
    refetchInterval: (query) => (isTemporaryApiError(query.state.error) ? RECONNECT_INTERVAL_MS : false),
  }));

  const active = () => [health, ...(isAuthenticatedMode() ? [session] : []), ...(session.data ? [access] : [])];
  const reconnecting = () =>
    health.data?.status === "starting" || active().some((query) => isTemporaryApiError(query.error));
  // Keep showing the board through a transport failure if we already had an answer; 401/403 still
  // fail closed.
  const blockingError = () =>
    active().find((query) => query.error && !(query.data !== undefined && isTemporaryApiError(query.error)))?.error;
  const loading = () =>
    health.isLoading ||
    (isAuthenticatedMode() && session.isLoading) ||
    (isAuthenticatedMode() && !isBootstrapPending() && !!session.data && access.isLoading);
  const hasBoardAccess = () =>
    !isAuthenticatedMode() || !!access.data?.isInstanceAdmin || (access.data?.companyIds.length ?? 0) > 0;

  // Once the board has been shown, a server restart shows the reconnecting notice over it instead
  // of replacing it.
  const [opened, setOpened] = createSignal(false);
  createEffect(() => {
    const canAccess =
      !blockingError() && !loading() && !isBootstrapPending() && (!isAuthenticatedMode() || !!session.data) && hasBoardAccess();
    if (canAccess && health.data?.status === "ok") setOpened(true);
  });

  const retry = () => {
    for (const query of active()) if (query.error) void query.refetch();
  };

  const value: SessionValue = {
    health: () => health.data,
    session: () => session.data ?? null,
    userId: () => session.data?.user.id ?? null,
    youId: () => session.data?.user.id ?? (isAuthenticatedMode() ? null : "local-board"),
    isAuthenticatedMode,
  };

  return (
    <Switch fallback={<SessionContext.Provider value={value}>
      <Show when={reconnecting()}>
        <div role="status" class="reconnecting">Connection interrupted. Reconnecting automatically…</div>
      </Show>
      {props.children}
    </SessionContext.Provider>}>
      <Match when={blockingError()}>
        {(error) => (
          <Splash
            title={isTemporaryApiError(error()) ? "Can't reach Paperclip" : "Something went wrong"}
            actions={<Button variant="primary" size="compact" onClick={retry}>Try again</Button>}
          >
            {isTemporaryApiError(error())
              ? "The server isn't answering. Start it with corepack pnpm dev at the repo root; this page retries on its own."
              : String((error() as Error).message ?? error())}
          </Splash>
        )}
      </Match>
      <Match when={loading()}>
        <Splash title="Loading" quiet />
      </Match>
      <Match when={health.data?.status === "starting" && !opened()}>
        <Splash title="Paperclip is starting">This page opens as soon as the server is ready.</Splash>
      </Match>
      <Match when={isBootstrapPending()}>
        <Splash title="This instance isn't set up yet">
          The first admin hasn't been claimed. Finish setup in the classic UI, then come back.
        </Splash>
      </Match>
      <Match when={isAuthenticatedMode() && !session.data}>
        <Navigate href={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} />
      </Match>
      <Match when={!hasBoardAccess()}>
        <Splash title="No access yet">
          You're signed in, but you aren't a member of any company on this instance. Ask an admin for an invite.
        </Splash>
      </Match>
    </Switch>
  );
}
