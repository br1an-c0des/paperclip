import { LINK_PREVIEW_BATCH_LIMIT, type LinkPreviewBatchResult, type LinkPreviewResult, type LinkPreviewTarget } from "@paperclipai/shared";
import type { QueryClient } from "@tanstack/solid-query";
import { queryKeys } from "@/api/queryKeys";
import { errorStatus } from "@/lib/offline/errors";

/*
 * Pull request status on page load (U175, upstream #21746, after the old UI's
 * lib/link-preview-page-loader.ts and lib/link-preview-query.ts). Each status mark on the page
 * registers its link here (LinkPreview.tsx), so a mark shows its state without anyone hovering:
 *
 * 1. **Saved status.** Links not in the query cache yet (a reload restores current ones,
 *    persisted-cache.ts) are read from the server's saved status, `link-previews/cached`, which
 *    never contacts GitHub: one request per batch of at most `LINK_PREVIEW_BATCH_LIMIT` (50) links
 *    and about 6,000 characters of query string, as soon as they mount. A saved status counts even
 *    when stale (`maxAgeMs: 0`): it shows at once and the refresh below replaces it.
 * 2. **Refresh on idle.** Once the page has loaded, is visible, and no other read is in flight,
 *    links still without a current status are read from GitHub (`link-preview`) on browser idle,
 *    three at a time, once per mount. A current status isn't read again.
 * 3. **Limits.** At most 200 distinct links per page are tracked; more are left to their cards.
 *    A 429 pauses every preview read for this company and viewer (the server's limit is per
 *    company and viewer) for its `Retry-After`: hovers then show what's known without asking, and
 *    the refresh picks up again after the wait, with the link that was refused.
 * 4. **Failures keep what's known.** A failed read keeps the last preview, marked current for a
 *    minute (or the `Retry-After`), so the mark doesn't fall back to unknown and the card doesn't
 *    ask again straight away. A failed saved-status read is quiet: the refresh still runs.
 *
 * The card (LinkPreview.tsx) reads through `linkPreviewQueryOptions` too, so a hover and the
 * refresh share one request per link.
 */

export const MAX_PAGE_LINK_PREVIEWS = 200;
export const PAGE_CONCURRENCY = 3;
/** How long a failed read counts as current, so it isn't asked again at once. */
export const FAILED_MAX_AGE_MS = 60_000;
/** The saved-status read's query-string budget, well inside a proxy's URL limit. */
const BATCH_URL_BUDGET = 6_000;
/** How many links without a saved status are remembered, so a remounted one isn't read again. */
const UNSAVED_MEMORY = 1_000;

/**
 * How long a failed read says to wait: a 429's `Retry-After` (api/link-previews.ts puts it on the
 * error as `retryAfterMs`), a minute if it gave none, or null for any other failure.
 */
export function retryAfterOf(error: unknown): number | null {
  if (errorStatus(error) !== 429) return null;
  const wait = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof wait === "number" && Number.isFinite(wait) && wait >= 0 ? wait : FAILED_MAX_AGE_MS;
}

/** Who reads previews, and how: one per company and viewer. `pausedUntil` is shared by every read through it. */
export interface LinkPreviewSource {
  companyId: string;
  userId: string | null;
  load(target: LinkPreviewTarget): Promise<LinkPreviewResult>;
  readCached(targets: LinkPreviewTarget[]): Promise<LinkPreviewBatchResult>;
  /** Until when (epoch ms) reads wait, after a 429. */
  pausedUntil: number;
}

/** The hover card and the page refresh share the key and the read, so one request serves both. */
export function linkPreviewQueryOptions(client: QueryClient, source: LinkPreviewSource, target: LinkPreviewTarget) {
  const queryKey = queryKeys.linkPreview(source.companyId, source.userId, target.canonicalUrl);
  return {
    queryKey,
    queryFn: async (): Promise<LinkPreviewResult> => {
      const last = client.getQueryData<LinkPreviewResult>(queryKey)?.preview ?? null;
      const wait = source.pausedUntil - Date.now();
      if (wait > 0) return { preview: last, maxAgeMs: wait };
      try {
        return await source.load(target);
      } catch (error) {
        const retryAfter = retryAfterOf(error);
        if (retryAfter === null) return { preview: last, maxAgeMs: FAILED_MAX_AGE_MS };
        source.pausedUntil = Math.max(source.pausedUntil, Date.now() + retryAfter);
        return { preview: last, maxAgeMs: Math.max(retryAfter, 1_000) };
      }
    },
    staleTime: (query: { state: { data?: LinkPreviewResult } }) => query.state.data?.maxAgeMs ?? FAILED_MAX_AGE_MS,
    gcTime: 5 * 60_000,
    // Optional detail: no automatic retries, which would spend the viewer's rate limit.
    retry: false as const,
    refetchOnMount: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
  };
}

/** When the page counts as loaded and idle; swapped out in tests. */
export interface LinkPreviewPageEnvironment {
  loaded(): boolean;
  onLoad(callback: () => void): () => void;
  idle(callback: () => void): () => void;
  later(callback: () => void, ms: number): () => void;
}

export const browserLinkPreviewEnvironment: LinkPreviewPageEnvironment = {
  loaded: () => document.readyState === "complete" && document.visibilityState !== "hidden",
  onLoad: (callback) => {
    window.addEventListener("load", callback);
    document.addEventListener("visibilitychange", callback);
    return () => {
      window.removeEventListener("load", callback);
      document.removeEventListener("visibilitychange", callback);
    };
  },
  idle: (callback) => {
    // Let input, paint and the page's own reads finish first.
    let cancel = () => {};
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(callback, { timeout: 2_000 });
        cancel = () => window.cancelIdleCallback(id);
      } else {
        const id = setTimeout(callback, 0);
        cancel = () => clearTimeout(id);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      cancel();
    };
  },
  later: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

type Entry = { target: LinkPreviewTarget; count: number; hydrated: boolean; attempted: boolean };

export type LinkPreviewPageLoader = ReturnType<typeof createLinkPreviewPageLoader>;

/** One per company and viewer. Work grows with the distinct links mounted, never with time. */
export function createLinkPreviewPageLoader(
  client: QueryClient,
  source: LinkPreviewSource,
  environment: LinkPreviewPageEnvironment = browserLinkPreviewEnvironment,
) {
  const links = new Map<string, Entry>();
  // A saved-status read still pending, by its sorted links: a link that remounts meanwhile shares it.
  const pending = new Map<string, Promise<LinkPreviewBatchResult>>();
  // Links the server had no saved status for: a message that redraws its links doesn't ask again.
  const unsaved = new Set<string>();
  let disposed = false;
  let hydrationTimer: ReturnType<typeof setTimeout> | undefined;
  let hydrating = false;
  let active = 0;
  let cancelIdle: (() => void) | undefined;
  let cancelResume: (() => void) | undefined;

  const isPreviewKey = (key: readonly unknown[]) => key[0] === "link-preview";
  const busy = () => client.isFetching({ predicate: (query) => !isPreviewKey(query.queryKey) }) > 0;
  const options = (target: LinkPreviewTarget) => linkPreviewQueryOptions(client, source, target);
  const current = (target: LinkPreviewTarget) => {
    const state = client.getQueryState<LinkPreviewResult>(options(target).queryKey);
    return !!state?.data && !state.isInvalidated && state.dataUpdatedAt + state.data.maxAgeMs > Date.now();
  };

  function scheduleIdle() {
    if (disposed || cancelIdle || hydrating || active >= PAGE_CONCURRENCY) return;
    if (![...links.values()].some((link) => link.hydrated && !link.attempted)) return;
    const wait = source.pausedUntil - Date.now();
    if (wait > 0) {
      // Rate-limited: come back once the server's wait is over.
      cancelResume ??= environment.later(() => {
        cancelResume = undefined;
        scheduleIdle();
      }, wait);
      return;
    }
    if (!environment.loaded() || busy()) return;
    cancelIdle = environment.idle(() => {
      cancelIdle = undefined;
      if (disposed || !environment.loaded() || busy() || source.pausedUntil > Date.now()) return scheduleIdle();
      for (const link of links.values()) {
        if (!link.hydrated || link.attempted) continue;
        if (current(link.target)) {
          // A current status needs no read, and takes no slot.
          link.attempted = true;
          continue;
        }
        if (active >= PAGE_CONCURRENCY) break;
        link.attempted = true;
        active++;
        void client
          .fetchQuery(options(link.target))
          .catch(() => {})
          .finally(() => {
            active--;
            // Refused or held back by the rate limit: try this link again after the wait.
            if (source.pausedUntil > Date.now()) link.attempted = false;
            scheduleIdle();
          });
      }
    });
  }

  function readCached(targets: LinkPreviewTarget[]) {
    const key = JSON.stringify(targets.map((target) => target.canonicalUrl).sort());
    let read = pending.get(key);
    if (!read) {
      read = source.readCached(targets).finally(() => pending.delete(key));
      pending.set(key, read);
    }
    return read;
  }

  function scheduleHydration() {
    if (disposed || hydrating || hydrationTimer !== undefined) return;
    hydrationTimer = setTimeout(() => {
      hydrationTimer = undefined;
      for (const link of links.values()) {
        if (link.hydrated) continue;
        if (unsaved.has(link.target.canonicalUrl) || client.getQueryData(options(link.target).queryKey) !== undefined) link.hydrated = true;
      }
      const batch: Entry[] = [];
      let size = 0;
      for (const link of links.values()) {
        if (link.hydrated) continue;
        const cost = encodeURIComponent(link.target.canonicalUrl).length + 5;
        if (batch.length >= LINK_PREVIEW_BATCH_LIMIT || size + cost > BATCH_URL_BUDGET) break;
        batch.push(link);
        size += cost;
      }
      if (!batch.length) return scheduleIdle();
      hydrating = true;
      const startedAt = Date.now();
      for (const link of batch) link.hydrated = true;
      void readCached(batch.map((link) => link.target))
        .then(({ results }) => {
          if (disposed) return;
          for (const link of batch) {
            const mounted = links.get(link.target.canonicalUrl);
            const saved = results?.[link.target.canonicalUrl];
            if (!saved) {
              if (unsaved.size >= UNSAVED_MEMORY) unsaved.clear();
              unsaved.add(link.target.canonicalUrl);
            }
            if (!mounted || !saved) continue;
            mounted.hydrated = true;
            const key = options(link.target).queryKey;
            const state = client.getQueryState<LinkPreviewResult>(key);
            // Never replace a read that finished, or is under way, since this one started,
            // nor a preview that stays current longer than the saved one.
            if (
              state?.fetchStatus !== "fetching" &&
              (!state || state.dataUpdatedAt <= startedAt) &&
              (!state?.data || state.dataUpdatedAt + state.data.maxAgeMs <= Date.now() + saved.maxAgeMs)
            ) {
              client.setQueryData(key, saved);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          hydrating = false;
          scheduleHydration();
          scheduleIdle();
        });
    }, 0);
  }

  // Another read settling may be the moment the page goes quiet.
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (!isPreviewKey(event.query.queryKey)) scheduleIdle();
  });
  const offLoad = environment.onLoad(scheduleIdle);

  return {
    /** Tracks a mounted link until the returned function is called. */
    register(target: LinkPreviewTarget): () => void {
      if (disposed) return () => {};
      let link = links.get(target.canonicalUrl);
      if (!link && links.size < MAX_PAGE_LINK_PREVIEWS) {
        link = { target, count: 0, hydrated: false, attempted: false };
        links.set(target.canonicalUrl, link);
      }
      if (!link) return () => {};
      const entry = link;
      entry.count++;
      scheduleHydration();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--entry.count === 0 && links.get(target.canonicalUrl) === entry) links.delete(target.canonicalUrl);
        if (!links.size) {
          cancelIdle?.();
          cancelIdle = undefined;
        }
      };
    },
    dispose() {
      disposed = true;
      clearTimeout(hydrationTimer);
      cancelIdle?.();
      cancelResume?.();
      unsubscribe();
      offLoad();
      links.clear();
    },
  };
}
