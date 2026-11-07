import { QueryClient } from "@tanstack/solid-query";
import { isTemporaryApiError } from "@/api/client";
import { installQueryConnectivity } from "./offline/connectivity";

/*
 * The query layer: one QueryClient for the app, with the old UI's defaults (ui/src/main.tsx).
 * Live events (lib/live-events.ts) keep it fresh by invalidating keys, so most queries don't poll.
 *
 * While the app is offline (lib/offline/connectivity.ts) reads pause and keep their data, and the
 * open ones refetch when it's back. Mutations never pause: one that can't reach the server fails at
 * once, and the writes worth keeping go through the write queue instead (lib/offline/).
 */

installQueryConnectivity();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      // Retry outages a few times; a 4xx is an answer, not a blip.
      retry: (failureCount, error) => isTemporaryApiError(error) && failureCount < 3,
    },
    mutations: {
      networkMode: "always",
    },
  },
});
