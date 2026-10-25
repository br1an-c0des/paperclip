import { ApiError, readApiJson } from "./client";

/*
 * `GET /api/health`. The response type isn't exported from @paperclipai/shared; this is the subset
 * ui-new reads, matching `HealthStatus` in ui/src/api/health.ts.
 */
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
};
