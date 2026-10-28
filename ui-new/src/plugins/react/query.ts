import { QueryObserver, type QueryKey } from "@tanstack/solid-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { queryClient } from "@/lib/query";

/*
 * A small React reader over the app's one QueryClient, for the SDK's data-backed shared components
 * (IssuesList, the pickers). It shares the cache with the Solid pages, so an agent list the page
 * already has costs nothing, and the live events keep both fresh.
 */

export function useHostQuery<T>(queryKey: QueryKey, queryFn: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const keyHash = JSON.stringify(queryKey);
  const observer = useMemo(
    () => new QueryObserver<T>(queryClient, { queryKey, queryFn: ({ signal }) => queryFn(signal), enabled }),
    // queryFn follows queryKey; a new key is a new observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash, enabled],
  );
  useEffect(() => () => observer.destroy(), [observer]);
  const result = useSyncExternalStore(
    (notify) => observer.subscribe(notify),
    () => observer.getCurrentResult(),
  );
  return { data: result.data, isLoading: result.isLoading, error: result.error as Error | null };
}
