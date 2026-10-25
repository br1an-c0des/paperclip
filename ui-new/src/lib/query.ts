import { QueryClient } from "@tanstack/solid-query";
import { isTemporaryApiError } from "@/api/client";

/*
 * The query layer: one QueryClient for the app, with the old UI's defaults (ui/src/main.tsx).
 * Live events (lib/live-events.ts) keep it fresh by invalidating keys, so most queries don't poll.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      // Retry outages a few times; a 4xx is an answer, not a blip.
      retry: (failureCount, error) => isTemporaryApiError(error) && failureCount < 3,
    },
  },
});
