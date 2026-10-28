import { ApiError, readApiJson } from "./client";

/*
 * `GET /api/health`. The response type isn't exported from @paperclipai/shared; this is the subset
 * ui-new reads, matching `HealthStatus` in ui/src/api/health.ts.
 */
/** On a development server (`pnpm dev`): whether it needs a restart to pick up backend changes. */
export type DevServerHealthStatus = {
  enabled: true;
  restartRequired: boolean;
  reason: "backend_changes" | "pending_migrations" | "backend_changes_and_pending_migrations" | null;
  lastChangedAt: string | null;
  changedPathCount: number;
  changedPathsSample: string[];
  pendingMigrations: string[];
  autoRestartEnabled: boolean;
  activeRunCount: number;
  waitingForIdle: boolean;
  lastRestartAt: string | null;
};

export type HealthStatus = {
  status: "ok" | "starting";
  version?: string;
  commit?: string | null;
  deploymentMode?: "local_trusted" | "authenticated";
  deploymentExposure?: "private" | "public";
  authReady?: boolean;
  bootstrapStatus?: "ready" | "bootstrap_pending";
  bootstrapInviteActive?: boolean;
  hiddenSettings?: string[];
  devServer?: DevServerHealthStatus;
};

export const healthApi = {
  get: async (): Promise<HealthStatus> => {
    const res = await fetch("/api/health", {
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await readApiJson<HealthStatus & { error?: string }>(res);
    if (!res.ok) throw new ApiError(body?.error ?? `Failed to load health (${res.status})`, res.status, body);
    return body;
  },
  /** Asks a development server to restart (`POST /api/health/dev-server/restart`). */
  requestDevServerRestart: async (): Promise<void> => {
    const res = await fetch("/api/health/dev-server/restart", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? `Couldn't request a restart (${res.status})`, res.status, body);
    }
  },
};
