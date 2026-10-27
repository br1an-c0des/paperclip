import type {
  AgentWakeupResponse,
  ChatFailedRunRetryResponse,
  HeartbeatRun,
  HeartbeatRunEvent,
  ProviderTraceFrame,
  ProviderTraceMetadata,
} from "@paperclipai/shared";
import { api, ApiError, errorMessage, readApiJson, type RequestOptions } from "./client";

/*
 * One run, for the run modal (boards 16–18): the run itself, its events (the `adapter.invoke` event
 * holds what Paperclip sent the harness), its stored log, its provider trace, and waking the agent
 * again (Retry, Resume, Rerun with trace). The calls mirror ui/src/api/heartbeats.ts and agents.ts;
 * the live list and Stop stay in heartbeats.ts.
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

/**
 * A row of the company's run list (`GET /companies/:id/heartbeat-runs`). With `summary=true` the
 * server leaves out the log and trims the result to its summary; the usage and cost fields come
 * from that result, as numeric strings, or null when the harness reported none. Fields the server
 * redacts for a run the viewer can't read are optional.
 */
export type RunSummary = Pick<HeartbeatRun, "id" | "agentId" | "status" | "invocationSource"> & {
  issueId?: string | null;
  triggerDetail?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  error?: string | null;
  inputTokens?: string | number | null;
  cachedInputTokens?: string | number | null;
  outputTokens?: string | number | null;
  costUsd?: string | number | null;
  contextSnapshot?: Record<string, unknown> | null;
};

export type RunListOptions = {
  /** Only this agent's runs. */
  agentId?: string;
  /** At most this many, newest first; the server caps it at 1000 and defaults to its own limit. */
  limit?: number;
  /** Rows without their logs (`summary=true`), as every run list in ui-new reads them. */
  summary?: boolean;
};

export const runsApi = {
  /** The company's latest runs, newest first. */
  list: (companyId: string, options: RunListOptions = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options.agentId) params.set("agentId", options.agentId);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.summary) params.set("summary", "true");
    const query = params.toString();
    return api.get<RunSummary[]>(`/companies/${encodeURIComponent(companyId)}/heartbeat-runs${query ? `?${query}` : ""}`, { signal });
  },
  get:(runId: string, signal?: AbortSignal) => api.get<RunDetail>(`/heartbeat-runs/${runId}`, { signal }),
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
    return api.post<AgentWakeupResponse>(wakeupPath(run), {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "rerun_with_provider_trace",
      payload,
      debug: { providerTrace: "raw" },
    });
  },
  /**
   * Retries a failed or timed-out run with the same request, as the old UI's Retry does. A task can
   * accept the retry before a run exists (`actionId`, no `runId` yet).
   */
  retry: (run: Pick<RunDetail, "id" | "agentId" | "companyId">) =>
    api.post<AgentWakeupResponse | ChatFailedRunRetryResponse>(wakeupPath(run), {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "retry_failed_run",
      failedRunId: run.id,
    }),
  /** Picks up a run whose process was lost (run-model.ts `resumePayload` builds the payload). */
  resume: (run: Pick<RunDetail, "agentId" | "companyId">, payload: Record<string, string>) =>
    api.post<AgentWakeupResponse>(wakeupPath(run), {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "resume_process_lost_run",
      payload,
    }),
};

function wakeupPath(run: Pick<RunDetail, "agentId" | "companyId">) {
  return `/agents/${encodeURIComponent(run.agentId)}/wakeup?companyId=${encodeURIComponent(run.companyId)}`;
}

/**
 * The URL path of a run, under the company prefix: the old UI's run route
 * (`/:companyPrefix/agents/:agentId/runs/:runId`), which ui-new opens as the run modal.
 */
export function runPath(prefix: string, agentKey: string, runId: string) {
  return `/${prefix}/agents/${encodeURIComponent(agentKey)}/runs/${runId}`;
}
