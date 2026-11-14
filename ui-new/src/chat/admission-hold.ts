import type { ExecutionProjection } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { queryKeys } from "@/api/queryKeys";
import { runsApi } from "@/api/runs";
import { createQueueWait } from "@/runs/QueueWait";
import type { QueueWait } from "@/runs/queue-wait";
import { admissionHold, holdRefreshInterval, liveRunHold, readsHold } from "./admission";

/*
 * A live run's named hold, for the places that read the company's live runs (the chat's Activity
 * column, a task's live run line) (decision 50, U120).
 *
 * The company's live runs carry each run's execution projection (`execution`), so a row that has
 * the field is read as it is. Only a row without it (an older server, or a caller that passes just
 * an id and status) reads the run detail while it's queued, under `queryKeys.runs.detail`, the key
 * the chat's reply card and the run modal read, so they share one request. `heartbeat.run.queued`
 * and `heartbeat.run.status` events refresh that key (lib/live-events.tsx); a 15-second fallback
 * covers a hold that changes without one. Once the row starts or leaves the list, the read stops.
 */

type LiveRow = {
  id: string;
  status: string;
  startedAt?: string | null;
  createdAt?: string | null;
  execution?: ExecutionProjection | null;
};

function useRunDetailForHold(live: () => LiveRow | null | undefined) {
  return createQuery(() => {
    const run = live();
    return {
      queryKey: queryKeys.runs.detail(run?.id ?? ""),
      queryFn: ({ signal }) => runsApi.get(run!.id, signal),
      enabled: readsHold(run) && run!.execution === undefined,
      refetchInterval: (query) => holdRefreshInterval(query.state.data),
    };
  });
}

export function useQueuedHold(live: () => LiveRow | null | undefined): () => string | null {
  const detail = useRunDetailForHold(live);
  return () => {
    const run = live();
    if (run && run.execution !== undefined) return readsHold(run) ? admissionHold(run) : null;
    return liveRunHold(run, detail.data);
  };
}

/**
 * What a live run waits for (U151, runs/queue-wait.ts): the agent's line, a named hold, or "Waiting
 * to start" once a queued run's 30-second startup grace has passed. Null while it works.
 */
export function useQueueWait(live: () => LiveRow | null | undefined): () => QueueWait | null {
  const detail = useRunDetailForHold(live);
  return createQueueWait(() => {
    const run = live();
    if (!run) return null;
    if (run.execution !== undefined || !readsHold(run)) return run;
    return { ...run, execution: detail.data?.status === "queued" ? detail.data.execution : null };
  });
}
