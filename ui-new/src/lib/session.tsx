import type { AuthSession, BoardBootstrapSession } from "@paperclipai/shared";
import { Navigate, useLocation, useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { createContext, createEffect, createSignal, Match, Switch, useContext, type ParentProps } from "solid-js";
import { accessApi, boardAccessFromBootstrap } from "@/api/access";
import { authApi } from "@/api/auth";
import { isTemporaryApiError } from "@/api/client";
import { companiesFromBootstrap } from "@/api/companies";
import { healthApi, type HealthStatus } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { BootstrapPending } from "@/auth/BootstrapPending";
import { Button } from "@/ui/Button";
import { Splash } from "@/routes/Splash";
import { clearPersistedQueries } from "./offline/persisted-cache";
import { SyncBanner } from "./offline/SyncBanner";
import { WriteQueueProvider } from "./offline/WriteQueueProvider";

/*
 * The session gate in front of every board page, after ui/src/components/CloudAccessGate.tsx:
 *
 * 1. `GET /api/health` says how the instance runs. `local_trusted` instances have no sign-in.
 * 2. On `authenticated` instances, `GET /api/auth/get-session` must return a session, or the user
 *    is sent to `/auth?next=…`.
 * 3. `GET /api/cli-auth/me` must show access to at least one company (or instance admin).
 *
 * A signed-in session may carry `boardBootstrap` (your companies and board access, read with it).
 * Each session read that has one puts both into their caches before the gate asks for them, so the
 * board opens without the two reads; the companies list is keyed by account, and board access is
 * replaced outright, so access cached for another account (or since revoked) doesn't stay. Without
 * one (an older server, a failed bootstrap, or a local_trusted instance, which has no session read)
 * the ordinary reads run. Later reads and live events refresh both as before.
 *
 * While the server is restarting the gate keeps what it has and shows a reconnecting notice, so an
 * outage doesn't unmount the page and lose drafts. Its three reads keep polling while the app is
 * offline (`networkMode: "always"`), since they're how it notices the server is back. A reload
 * while the server is down opens on the session, companies and access saved from the last visit
 * (offline/persisted-cache.ts).
 *
 * Inside the gate sits the write queue (offline/): writes that couldn't reach the server, sent as
 * the signed-in user once the gate has checked that user with the server since the page loaded.
 * The connection notice (SyncBanner) says when the server is out of reach and what's waiting.
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

/**
 * Seeds the companies list and board access from a session's bootstrap, as fresh as the session.
 * A read of either already on its way is cancelled first, so an older answer can't land over it.
 */
export async function seedBoardBootstrap(client: QueryClient, session: BoardBootstrapSession | null) {
  const bootstrap = session?.boardBootstrap;
  if (!session || !bootstrap) return;
  const companies = queryKeys.companies.list(session.user.id);
  const access = queryKeys.access.currentBoardAccess;
  await Promise.all([client.cancelQueries({ queryKey: companies, exact: true }), client.cancelQueries({ queryKey: access, exact: true })]);
  const updatedAt = Date.now();
  client.setQueryData(companies, companiesFromBootstrap(bootstrap), { updatedAt });
  client.setQueryData(access, boardAccessFromBootstrap(bootstrap, session), { updatedAt });
}

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

/** Signs out, drops every cached query (and the reads saved for offline), and goes to the sign-in page. */
export function useSignOut() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await authApi.signOut();
    clearPersistedQueries(client);
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
  const client = useQueryClient();

  const health = createQuery(() => ({
    queryKey: queryKeys.health,
    queryFn: healthApi.get,
    retry: false,
    networkMode: "always",
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
    queryFn: async () => {
      const value = await authApi.getSession();
      await seedBoardBootstrap(client, value);
      return value;
    },
    enabled: isAuthenticatedMode(),
    retry: false,
    networkMode: "always",
    refetchInterval: (query) => (isTemporaryApiError(query.state.error) ? RECONNECT_INTERVAL_MS : false),
  }));

  const access = createQuery(() => ({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: accessApi.currentBoardAccess,
    enabled: isAuthenticatedMode() && !isBootstrapPending() && !!session.data,
    retry: false,
    networkMode: "always",
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

  // Writes go out only once this page has heard from the server who's signed in: a session saved
  // from the last visit shows the board, but doesn't speak for the user.
  const mountedAt = Date.now();
  const verified = () =>
    health.dataUpdatedAt >= mountedAt &&
    !health.error &&
    (!isAuthenticatedMode() || (!!session.data && session.dataUpdatedAt >= mountedAt && !session.error));

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
      <WriteQueueProvider userId={value.youId} verified={verified}>
        <SyncBanner reconnecting={reconnecting()} />
        {props.children}
      </WriteQueueProvider>
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
        <BootstrapPending
          claimAvailable={health.data?.deploymentExposure === "private"}
          activeInvite={health.data?.bootstrapInviteActive}
          session={session.data}
        />
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
