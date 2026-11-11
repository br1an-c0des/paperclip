import { createQuery } from "@tanstack/solid-query";
import { queryKeys } from "@/api/queryKeys";
import { runsApi } from "@/api/runs";
import { holdRefreshInterval, liveRunHold, readsHold } from "./admission";

/*
 * A live run's named hold, for the places that read the company's live runs (the chat's Activity
 * column, a task's live run line), which don't carry the execution projection (decision 50, U120).
 *
 * While the row is queued it reads the run detail under `queryKeys.runs.detail`, the key the chat's
 * reply card and the run modal read, so they share one request. `heartbeat.run.queued` and
 * `heartbeat.run.status` events refresh that key (lib/live-events.tsx); a 15-second fallback covers
 * a hold that changes without one. Once the row starts or leaves the list, the read stops.
 */
export function useQueuedHold(live: () => { id: string; status: string } | null | undefined): () => string | null {
  const detail = createQuery(() => {
    const run = live();
    return {
      queryKey: queryKeys.runs.detail(run?.id ?? ""),
      queryFn: ({ signal }) => runsApi.get(run!.id, signal),
      enabled: readsHold(run),
      refetchInterval: (query) => holdRefreshInterval(query.state.data),
    };
  });
  return () => liveRunHold(live(), detail.data);
}
