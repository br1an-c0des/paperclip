import { createInfiniteQuery } from "@tanstack/solid-query";
import { ChevronRight } from "lucide-solid";
import { createMemo, For, Show, type JSX } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { toolAccessApi, type ToolActivityEvent, type ToolActivityFilter } from "@/api/tool-access";
import { dateTime } from "@/agents/shared";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { CardState, StatePill } from "../advanced/parts";
import { activityLine } from "./gateway-model";

/*
 * Tool calls from the audit (`GET /tool-gateway/audit`): a gateway's Activity tab and an agent's
 * recent calls. Each row says who used which tool in which app and what happened; opening it shows
 * the call's facts and its redacted arguments and result. Pages of 25, newest first.
 */

export function ToolActivity(props: { filter: Omit<ToolActivityFilter, "cursor">; empty: JSX.Element; pageSize?: number }) {
  const company = useCompany();
  const query = createInfiniteQuery(() => ({
    queryKey: queryKeys.tools.activity(company().id, JSON.stringify(props.filter)),
    queryFn: ({ pageParam, signal }) =>
      toolAccessApi.activity(company().id, { ...props.filter, limit: props.pageSize ?? 25, cursor: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  }));
  const events = createMemo(() => query.data?.pages.flatMap((page) => page.events) ?? []);
  return (
    <Show when={query.isSuccess} fallback={<CardState loading={query.isPending} error={query.error} what="tool calls" onRetry={() => void query.refetch()} />}>
      <Show when={events().length > 0} fallback={<p class="ap-empty">{props.empty}</p>}>
        <div>
          <For each={events()}>{(event) => <EventRow event={event} />}</For>
        </div>
        <Show when={query.hasNextPage}>
          <div class="tl-more">
            <Button size="compact" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage ? "Loading…" : "Show more"}
            </Button>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

function EventRow(props: { event: ToolActivityEvent }) {
  const line = createMemo(() => activityLine(props.event));
  return (
    <details class="tl-event">
      <summary>
        <ChevronRight size={14} aria-hidden="true" />
        <span class="tl-event-text">
          <b>{line().actor}</b> used <b>{line().tool}</b> in {line().app}
        </span>
        <StatePill tone={line().outcome.tone}>{line().outcome.label}</StatePill>
        <span class="tl-event-when">{dateTime(props.event.createdAt)}</span>
      </summary>
      <div class="tl-event-body">
        <Show when={line().facts.length > 0} fallback={<p class="cx-note">No more detail was recorded for this call.</p>}>
          <dl class="tl-facts">
            <For each={line().facts}>
              {([label, value]) => (
                <div>
                  <dt>{label}</dt>
                  <dd class="mono">{value}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
        <Show when={line().arguments}>
          {(text) => (
            <div>
              <h5>Arguments (redacted)</h5>
              <pre class="tl-pre mono">{text()}</pre>
            </div>
          )}
        </Show>
        <Show when={line().result}>
          {(text) => (
            <div>
              <h5>Result (redacted)</h5>
              <pre class="tl-pre mono">{text()}</pre>
            </div>
          )}
        </Show>
      </div>
    </details>
  );
}
