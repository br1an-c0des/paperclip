import type { AgentWakeupResponse, HeartbeatRun, HeartbeatRunEvent, ProviderTraceFrame, ProviderTraceMetadata } from "@paperclipai/shared";
import { api, ApiError, errorMessage, readApiJson, type RequestOptions } from "./client";

/*
 * One run, for the run modal (boards 16–18): the run itself, its events (the `adapter.invoke` event
 * holds what Paperclip sent the harness), its stored log, and its provider trace. The calls mirror
 * ui/src/api/heartbeats.ts; the live list and Stop stay in heartbeats.ts.
 */

/**
 * `GET /heartbeat-runs/:id`. The server returns the whole run row, so it also carries fields the
 * shared type leaves out; these are the ones ui-new reads.
 */
export type RunDetail = Omit<HeartbeatRun, "startedAt" | "finishedAt" | "createdAt" | "updatedAt" | "lastOutputAt"> & {
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastOutputAt: string | null;
  runtimeMode?: "legacy" | "native";
  retryExhaustedReason?: string | null;
};

/** A slice of the stored log: newline-delimited `{ ts, stream, chunk, seq }` records. */
export type RunLogSlice = {
  runId: string;
  store: string;
  logRef: string;
  content: string;
  /** Present when there's more to read from this offset. */
  nextOffset?: number;
};

/** `GET /heartbeat-runs/:id/provider-trace`: metadata and entries, frames with bodies redacted. */
export type ProviderTraceInspection = {
  trace: ProviderTraceMetadata | null;
  entries: ProviderTraceEntry[];
};

/** A trace entry. Frames come redacted: `parsed` holds the JSON with bodies withheld. */
export type ProviderTraceEntry = Record<string, unknown> & {
  kind?: string;
  frameId?: number;
  timestamp?: string;
  direction?: ProviderTraceFrame["direction"];
  transport?: string;
  provider?: string;
  byteLength?: number;
  digest?: string;
  parsed?: unknown;
  withheldPaths?: string[];
  exactAvailable?: boolean;
};

export const runsApi = {
  get: (runId: string, signal?: AbortSignal) => api.get<RunDetail>(`/heartbeat-runs/${runId}`, { signal }),
  events: (runId: string, afterSeq = 0, limit = 200, options?: RequestOptions) =>
    api.get<HeartbeatRunEvent[]>(`/heartbeat-runs/${runId}/events?afterSeq=${afterSeq}&limit=${limit}`, options),
  log: (runId: string, offset = 0, limitBytes = 256_000, options?: RequestOptions) =>
    api.get<RunLogSlice>(`/heartbeat-runs/${runId}/log?offset=${offset}&limitBytes=${limitBytes}`, options),
  /** Instance admins only. The server logs each view as activity. */
  providerTrace: (runId: string, signal?: AbortSignal) =>
    api.get<ProviderTraceInspection>(`/heartbeat-runs/${runId}/provider-trace`, { signal }),
  /** Whether runs have a trace, without opening it (instance admins only). */
  providerTraceMetadata: (companyId: string, runIds: string[], signal?: AbortSignal) =>
    api.get<ProviderTraceMetadata[]>(
      `/companies/${companyId}/provider-traces?${new URLSearchParams({ runIds: runIds.slice(0, 100).join(",") })}`,
      { signal },
    ),
  /** The exact bytes of one frame. Logged as activity. */
  revealProviderTraceFrame: (runId: string, frameId: number) =>
    api.post<ProviderTraceFrame>(`/heartbeat-runs/${runId}/provider-trace/frames/${frameId}/reveal`, {}),
  deleteProviderTrace: (runId: string) => api.delete<{ ok: true }>(`/heartbeat-runs/${runId}/provider-trace`),
  /** The whole trace as NDJSON. */
  downloadProviderTrace: async (runId: string): Promise<Blob> => {
    const response = await fetch(`/api/heartbeat-runs/${runId}/provider-trace/download`, {
      credentials: "include",
      headers: { Accept: "application/x-ndjson" },
    });
    if (!response.ok) {
      const body = await readApiJson<unknown>(response).catch(() => null);
      throw new ApiError(errorMessage(body, response.status), response.status, body);
    }
    return response.blob();
  },
  /**
   * Wakes the agent again for the same task with a raw provider trace (decision 4), as the old UI's
   * "Re-run with provider trace" does.
   */
  rerunWithProviderTrace: (run: Pick<RunDetail, "agentId" | "companyId" | "contextSnapshot">) => {
    const context = run.contextSnapshot ?? {};
    const payload: Record<string, unknown> = {};
    for (const key of ["issueId", "taskId", "taskKey"] as const) {
      if (typeof context[key] === "string" && context[key]) payload[key] = context[key];
    }
    return api.post<AgentWakeupResponse>(
      `/agents/${encodeURIComponent(run.agentId)}/wakeup?companyId=${encodeURIComponent(run.companyId)}`,
      {
        source: "on_demand",
        triggerDetail: "manual",
        reason: "rerun_with_provider_trace",
        payload,
        debug: { providerTrace: "raw" },
      },
    );
  },
};
