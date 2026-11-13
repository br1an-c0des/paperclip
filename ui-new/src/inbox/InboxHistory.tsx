import type { DecisionHistoryItem, DecisionHistoryPage } from "@paperclipai/shared";
import { createInfiniteQuery } from "@tanstack/solid-query";
import { Check, ChevronDown } from "lucide-solid";
import { createMemo, For, Show, type Accessor } from "solid-js";
import { attentionApi } from "@/api/attention";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { updatedLabel } from "@/tasks/list-model";
import type { TaskPeople } from "@/tasks/people";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { Capsule, TonePill } from "@/ui/Status";
import {
  decidedBy,
  filtersActive,
  HISTORY_OUTCOMES,
  historyItems,
  historyKey,
  historyQuery,
  outcomeTone,
  type HistoryFilters,
  type HistoryOutcome,
  type HistorySort,
} from "./history-model";
import { activityGroups } from "./inbox-model";

/*
 * The Inbox's History tab: what was decided on tasks, newest first, a page of 40 at a time with
 * Load more (`history-model.ts`). Each row names the outcome, the request, its task (which opens in
 * the task modal), who asked and who decided, and when. The filters sit in the bar; the Inbox's
 * search box searches the history on the server.
 */

export function useDecisionHistory(filters: Accessor<HistoryFilters>, enabled: Accessor<boolean>) {
  const company = useCompany();
  const history = createInfiniteQuery(() => ({
    queryKey: queryKeys.inbox.history(company().id, historyKey(filters())),
    queryFn: ({ pageParam, signal }) => attentionApi.history(company().id, historyQuery(filters(), pageParam ?? undefined), signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page: DecisionHistoryPage) => page.nextCursor ?? undefined,
    enabled: enabled(),
  }));
  const items = createMemo(() => historyItems(history.data?.pages));
  return { history, items };
}

export type DecisionHistory = ReturnType<typeof useDecisionHistory>;

/** A filter button that shows its current pick, and the menu of picks. */
function Pick<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  const current = () => props.options.find((option) => option.value === props.value)?.label ?? props.options[0]?.label;
  return (
    <Menu>
      <Menu.Trigger as={Button} size="compact" class="ibx-pick" aria-label={`${props.label}: ${current()}`}>
        <span class="ibx-pick-label">{props.label}</span>
        <b>{current()}</b>
        <ChevronDown size={14} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label={props.label} width={240}>
        <For each={props.options}>
          {(option) => (
            <Menu.Item onSelect={() => props.onChange(option.value)} hint={option.value === props.value ? <Check size={14} aria-hidden="true" /> : undefined}>
              {option.label}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

const SORTS: readonly { value: HistorySort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

export function HistoryBar(props: { filters: HistoryFilters; people: TaskPeople; onChange: (change: Partial<HistoryFilters>) => void }) {
  const projects = useProjectsQuery();
  const agents = createMemo(() => [{ value: "", label: "All agents" }, ...props.people.assignableAgents().map((agent) => ({ value: agent.id, label: agent.name }))]);
  const projectOptions = createMemo(() => [
    { value: "", label: "All projects" },
    ...(projects.data ?? []).filter((project) => !project.archivedAt).map((project) => ({ value: project.id, label: project.name })),
  ]);
  return (
    <>
      <Pick label="Outcome" value={props.filters.outcome} options={HISTORY_OUTCOMES} onChange={(outcome: HistoryOutcome) => props.onChange({ outcome })} />
      <Pick label="Asked by" value={props.filters.agentId} options={agents()} onChange={(agentId) => props.onChange({ agentId })} />
      <Pick label="Project" value={props.filters.projectId} options={projectOptions()} onChange={(projectId) => props.onChange({ projectId })} />
      <Pick label="Sort" value={props.filters.sort} options={SORTS} onChange={(sort) => props.onChange({ sort })} />
      <Show when={filtersActive({ ...props.filters, search: "" })}>
        <Button size="compact" variant="quiet" onClick={() => props.onChange({ outcome: "", agentId: "", projectId: "" })}>
          Clear filters
        </Button>
      </Show>
    </>
  );
}

export function HistoryList(props: {
  data: DecisionHistory;
  filters: HistoryFilters;
  people: TaskPeople;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (item: DecisionHistoryItem) => void;
}) {
  const groups = createMemo(() =>
    props.filters.sort === "newest"
      ? activityGroups(props.data.items(), (item) => item.resolvedAt)
      : [{ key: "all", label: "", items: props.data.items() }],
  );
  const history = () => props.data.history;
  return (
    <Show
      when={!history().isError || history().data}
      fallback={
        <div class="ibx-empty card">
          Couldn't load the decision history. {history().error?.message}{" "}
          <Button size="compact" variant="quiet" onClick={() => void history().refetch()}>
            Try again
          </Button>
        </div>
      }
    >
      <Show when={history().data} fallback={<p class="ibx-empty card">Loading decisions…</p>}>
        <Show
          when={props.data.items().length > 0}
          fallback={
            <p class="ibx-empty card">
              {filtersActive(props.filters) ? "No decisions match these filters." : "Nothing decided yet. Questions and proposals answered on tasks show up here."}
            </p>
          }
        >
          <For each={groups()}>
            {(group) => (
              <section class="ibx-group" aria-labelledby={group.label ? `ibx-hist-${group.key}` : undefined} aria-label={group.label ? undefined : "Decisions"}>
                <Show when={group.label}>
                  <h2 class="ibx-sub" id={`ibx-hist-${group.key}`}>
                    {group.label} <span class="ibx-sub-count">{group.items.length}</span>
                  </h2>
                </Show>
                <ul class="ibx-rows" aria-label={group.label || "Decisions"}>
                  <For each={group.items}>
                    {(item) => <HistoryRow item={item} people={props.people} selected={props.selectedId === item.id} onSelect={() => props.onSelect(item.id)} onOpen={() => props.onOpen(item)} />}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <Show when={history().hasNextPage}>
            <div class="ibx-more">
              <Button size="compact" disabled={history().isFetchingNextPage} onClick={() => void history().fetchNextPage()}>
                {history().isFetchingNextPage ? "Loading…" : "Load more decisions"}
              </Button>
            </div>
          </Show>
          <Show when={history().isError}>
            <p class="ibx-note" role="alert">
              Couldn't load more. {history().error?.message}
            </p>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

/** A decision: the outcome, what was asked, its task, who asked and decided, when. */
function HistoryRow(props: { item: DecisionHistoryItem; people: TaskPeople; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const tone = () => outcomeTone(props.item);
  const by = () =>
    decidedBy(props.item, { youId: props.people.youId(), person: props.people.personName, agent: (id) => props.people.agent(id)?.name });
  const meta = () => [props.item.agentName ? `Asked by ${props.item.agentName}` : null, by() ? `decided by ${by()}` : null].filter(Boolean).join(", ");
  return (
    <li
      class="ibx-row ibx-hist"
      classList={{ "ibx-row--selected": props.selected }}
      data-inbox-item={props.item.id}
      tabindex="-1"
      onFocusIn={() => props.onSelect()}
      onPointerDown={() => props.onSelect()}
    >
      <Show when={tone()} fallback={<span class="ibx-hist-outcome">{props.item.label}</span>}>
        {(found) => (
          <TonePill tone={found()} compact icon={<Capsule gradient={found() === "green" ? "lagoon" : found() === "amber" ? "ember" : "tide"} size="tiny" />}>
            {props.item.label}
          </TonePill>
        )}
      </Show>
      <button type="button" class="ibx-task-open" onClick={() => props.onOpen()}>
        <span class="ibx-row-title">{props.item.title}</span>
        <Show when={props.item.issueTitle && props.item.title !== props.item.issueTitle}>
          <span class="ibx-hist-task">{props.item.issueTitle}</span>
        </Show>
      </button>
      <Show when={props.item.issueIdentifier}>
        <span class="ibx-row-task mono">{props.item.issueIdentifier}</span>
      </Show>
      <Show when={meta()}>
        <span class="ibx-task-meta">{meta()}</span>
      </Show>
      <time class="ibx-row-when" datetime={props.item.resolvedAt} title={new Date(props.item.resolvedAt).toLocaleString()}>
        {updatedLabel(props.item.resolvedAt)}
      </time>
    </li>
  );
}
