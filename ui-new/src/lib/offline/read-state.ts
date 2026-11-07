import { connectivity } from "./connectivity";
import { describeError } from "./errors";

/*
 * What a read with nothing to show says (U51, after #15754's QueryView states). A read never
 * just says "Loading…" forever:
 *
 * - loading: "Loading…", or, while the app is offline and the read waits for the server, that it
 *   fills in when Paperclip is back;
 * - failed: why, in plain words (errors.ts `describeError`), never a raw code;
 * - loaded and empty: the screen's own empty text.
 *
 * A read that has data keeps showing it through a failed refresh; only one with nothing to show
 * reports the failure.
 */

export const OFFLINE_WAITING = "Can't reach Paperclip. This loads when it's back.";

/** "Loading…", or that it waits for the connection while the app is offline. */
export function loadingText(loading = "Loading…") {
  return connectivity.status() === "offline" ? OFFLINE_WAITING : loading;
}

type ReadLike = { data: unknown; error: unknown; isPending: boolean; fetchStatus: "fetching" | "paused" | "idle" };

/**
 * The note for a read: loading, failed, or the screen's empty text. `failed` words the failure for
 * this screen ("Couldn't load the runs."), followed by the reason. A read that's turned off (not
 * fetching, nothing loaded) shows the empty text.
 */
export function readNote(query: ReadLike, empty: string, options: { loading?: string; failed?: string } = {}): string {
  if (query.data === undefined && query.error) {
    const reason = describeError(query.error);
    return options.failed ? `${options.failed} ${reason}` : reason;
  }
  if (query.isPending && query.fetchStatus !== "idle") return loadingText(options.loading);
  return empty;
}
