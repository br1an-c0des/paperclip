import type { AttentionItem } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { inboxApi } from "@/api/inbox";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { groupFeed } from "./inbox-model";
import { filterByView } from "./routing-model";

/*
 * The nav's Inbox count (decision 24, U133): what's waiting on you, exactly as Needs you's For you
 * view holds it — requests routed to you (`audience` is you), active, not archived or snoozed, not
 * on the aging shelf, alerts left out. It reads the Inbox's own feed query, so the Nav, the phone
 * dock and the Inbox share one cache: triage, claims and transfers in the Inbox patch that cache at
 * once (`use-inbox.ts`), and the live events and answered cards refresh it.
 *
 * Since upstream #20959 the feed's `deskBadgeCount` also counts For you (`viewCounts.mine`), and
 * this follows it, with two differences kept on purpose: it leaves out the aging shelf, which Needs
 * you folds away (decision 39), and alerts routed to you (a budget stop for its budget owner),
 * which sit in Alerts. Requests with obligation evidence count once there and per card here. Nor is
 * it `GET …/attention/summary`'s: that keeps the aging shelf too.
 */

export function needsYouCount(items: readonly AttentionItem[], youId: string | null) {
  return filterByView(groupFeed(items).needs, "mine", youId).length;
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

/** How many requests wait on you; undefined until the feed loads. */
export function useNeedsYouCount() {
  const feed = useAttentionFeed();
  const session = useSession();
  return () => (feed.data ? needsYouCount(feed.data.items, session.youId()) : undefined);
}
