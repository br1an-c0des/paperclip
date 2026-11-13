import type { AttentionItem } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { inboxApi } from "@/api/inbox";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { groupFeed } from "./inbox-model";

/*
 * The nav's Inbox count (decision 24): what's waiting on you, exactly as the Inbox's Needs you tab
 * holds it — active items you haven't cleared or snoozed, alerts left out. It reads the Inbox's own
 * feed query, so the Nav, the phone dock and the Inbox share one cache: triage in the Inbox patches
 * that cache at once (`use-inbox.ts`), and the live events and answered cards refresh it.
 *
 * The feed's `deskBadgeCount` isn't this count. Since upstream #20959 it counts the current cards
 * routed to the signed-in person ("For you", the same as `viewCounts.mine`), and the old UI's nav
 * shows it from the `view=mine` feed. The Inbox reads the whole feed (the default `all` view), so in
 * a company with several people the two differ; personal routing is U133 in the build plan. Nor is
 * it `GET …/attention/summary`'s: its counts by kind leave cleared and snoozed items out, but keep
 * requests on the aging shelf, which Needs you folds away (decision 39), and it doesn't say how
 * many those are.
 */

export function needsYouCount(items: readonly AttentionItem[]) {
  return groupFeed(items).needs.length;
}

/** The feed query the Inbox, the project dashboard and the nav share. */
export function useAttentionFeed() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.inbox.feed(company().id),
    queryFn: ({ signal }) => inboxApi.feed(company().id, signal),
    refetchOnWindowFocus: true,
  }));
}

/** How many items wait on you; undefined until the feed loads. */
export function useNeedsYouCount() {
  const feed = useAttentionFeed();
  return () => (feed.data ? needsYouCount(feed.data.items) : undefined);
}
