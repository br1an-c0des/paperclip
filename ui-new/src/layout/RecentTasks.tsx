import type { CompactIssue } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/solid-query";
import { ChevronRight } from "lucide-solid";
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, type Accessor } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { TaskStatusCapsule } from "@/ui/Status";
import type { RecentTask } from "./nav-model";
import { useRecentUnfolded } from "./nav-prefs";
import {
  hasSubtasks,
  nextSubtaskPage,
  readRecentSubtasks,
  RECENT_SUBTASK_PAGE_SIZE,
  recentTaskTree,
  recentViewerKey,
  subtaskView,
  type SubtaskRow,
} from "./recent-subtasks";

/*
 * The nav's Recent tasks (Nav.tsx) with foldable subtasks (U167, upstream #21649). A recent task
 * with subtasks has a fold button at its end in the identifier's place: how many direct subtasks it
 * has, how many of those are unread for you (the run-tone count chat badges use), and a chevron.
 * Unfolded, its subtasks list under it, ten at a time with Show more, their identifiers in the
 * row's tooltip; a subtask or recent task
 * unread for you is bold with the run-tone dot the Inbox uses. recent-subtasks.ts has the rules,
 * including how live events refresh only the groups they name.
 */

/** Lists keyed by id, so a refetch's new objects update rows in place (focus and hover stay). */
function byIdRows<T extends { id: string }>(items: Accessor<readonly T[]>) {
  const map = createMemo(() => new Map(items().map((item) => [item.id, item] as const)));
  const ids = createMemo(() => items().map((item) => item.id), [], { equals: (a, b) => a.join() === b.join() });
  return { ids, get: (id: string) => map().get(id) };
}

const taskHref = (base: string, task: { id: string; identifier: string | null }) => `${base}/issues/${encodeURIComponent(task.identifier ?? task.id)}`;

function UnreadDot() {
  return <span class="recent-dot" role="img" aria-label="Unread" />;
}

export function RecentTasks(props: { tasks: RecentTask[]; base: string }) {
  const unfolded = useRecentUnfolded(() => props.tasks.map((task) => task.id));
  const tree = createMemo(() => recentTaskTree(props.tasks, unfolded.set()));
  const top = byIdRows(() => tree().top);
  return (
    <For each={top.ids()}>
      {(id) => (
        <Show when={top.get(id)}>
          {(task) => (
            <RecentTaskItem
              task={task()}
              base={props.base}
              unfolded={unfolded.set().has(id) && hasSubtasks(task())}
              pinned={tree().nested.get(id) ?? []}
              onToggle={() => unfolded.toggle(id)}
            />
          )}
        </Show>
      )}
    </For>
  );
}

function RecentTaskItem(props: { task: RecentTask; base: string; unfolded: boolean; pinned: RecentTask[]; onToggle: () => void }) {
  const groupId = createUniqueId();
  const count = () => props.task.subtaskCount ?? 0;
  const unread = () => props.task.unreadSubtaskCount ?? 0;
  const label = () => `Subtasks of ${props.task.title}: ${count()}${unread() > 0 ? `, ${unread()} unread` : ""}`;
  return (
    <div class="recent-item">
      <div class="recent-row" classList={{ "recent-row--parent": hasSubtasks(props.task), "recent-row--unread-subs": hasSubtasks(props.task) && unread() > 0 }}>
        <A
          class="navi navi--task"
          classList={{ "navi--unread": !!props.task.isUnreadForMe }}
          href={taskHref(props.base, props.task)}
          title={props.task.identifier ? `${props.task.identifier} · ${props.task.title}` : props.task.title}
        >
          <TaskStatusCapsule task={props.task} size="row" />
          <span class="navi-label">{props.task.title}</span>
          <Show when={props.task.isUnreadForMe}>
            <UnreadDot />
          </Show>
          <Show when={!hasSubtasks(props.task)}>
            <span class="navi-note mono">{props.task.identifier}</span>
          </Show>
        </A>
        <Show when={hasSubtasks(props.task)}>
          <button
            type="button"
            class="recent-fold"
            aria-expanded={props.unfolded}
            aria-controls={props.unfolded ? groupId : undefined}
            aria-label={label()}
            title={props.unfolded ? "Hide subtasks" : "Show subtasks"}
            onClick={() => props.onToggle()}
          >
            <Show when={unread() > 0}>
              <span class="recent-fold-unread" aria-hidden="true">
                {unread() > 99 ? "99+" : unread()}
              </span>
            </Show>
            <span class="recent-fold-count" aria-hidden="true">
              {count()}
            </span>
            <ChevronRight size={14} stroke-width={2.4} aria-hidden="true" class="recent-fold-caret" />
          </button>
        </Show>
      </div>
      <Show when={props.unfolded}>
        <RecentSubtasks id={groupId} parent={props.task} pinned={props.pinned} base={props.base} />
      </Show>
    </div>
  );
}

/** An unfolded parent's subtasks, read while it's unfolded; folding cancels the read and drops extra pages. */
function RecentSubtasks(props: { id: string; parent: RecentTask; pinned: RecentTask[]; base: string }) {
  const company = useCompany();
  const session = useSession();
  const client = useQueryClient();
  const [showAll, setShowAll] = createSignal(false);
  const key = () => queryKeys.recentSubtasks(company().id, recentViewerKey(session.youId()), props.parent.id);
  const query = createInfiniteQuery(() => ({
    queryKey: key(),
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) => {
      const companyId = company().id;
      const parentId = props.parent.id;
      return readRecentSubtasks(signal, () => issuesApi.subtaskPage(companyId, parentId, { limit: RECENT_SUBTASK_PAGE_SIZE, afterId: pageParam }, signal));
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: CompactIssue[]) => nextSubtaskPage(last),
    staleTime: 30_000,
    retry: false,
  }));

  /** Back to the first page: cancel first, so a next page still coming can't bring the rest back. */
  const firstPageOnly = (queryKey: readonly unknown[]) =>
    void client.cancelQueries({ queryKey, exact: true }).then(() =>
      client.setQueryData<InfiniteData<CompactIssue[], string | undefined>>(queryKey, (data) =>
        data && data.pages.length > 1 ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
      ),
    );
  onCleanup(() => firstPageOnly(key()));

  const view = createMemo(() =>
    subtaskView({
      parentId: props.parent.id,
      companyId: company().id,
      pages: query.data?.pages,
      pinned: props.pinned,
      showAll: showAll(),
      count: props.parent.subtaskCount ?? 0,
      unread: props.parent.unreadSubtaskCount ?? 0,
    }),
  );
  const rows = byIdRows(() => view().rows);
  const showMore = () => {
    setShowAll(true);
    if (!view().loadedHidden && query.hasNextPage) void query.fetchNextPage();
  };
  const showLess = () => {
    setShowAll(false);
    firstPageOnly(key());
  };
  const loaded = () => query.data?.pages.reduce((total, page) => total + page.length, 0) ?? 0;

  return (
    <div id={props.id} class="recent-subtasks" role="group" aria-label={`Subtasks of ${props.parent.title}`}>
      <For each={rows.ids()}>
        {(id) => <Show when={rows.get(id)}>{(row) => <SubtaskLink row={row()} base={props.base} />}</Show>}
      </For>
      <Show when={query.isPending && rows.ids().length === 0}>
        <p class="recent-sub-note" role="status">
          Loading subtasks…
        </p>
      </Show>
      <Show when={query.isError}>
        <p class="recent-sub-note">
          Couldn't load subtasks.{" "}
          <button type="button" class="recent-sub-more" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>
            Retry
          </button>
        </p>
      </Show>
      <Show when={query.isSuccess && rows.ids().length === 0}>
        <p class="recent-sub-note">No subtasks you can see.</p>
      </Show>
      <Show when={!query.isError && view().remaining > 0 && loaded() > 0 && (view().loadedHidden || query.hasNextPage)}>
        <button type="button" class="recent-sub-more" disabled={query.isFetchingNextPage} onClick={showMore}>
          {query.isFetchingNextPage ? "Loading…" : `Show ${view().remaining} more`}
          <Show when={view().hiddenUnread > 0}>
            <span class="recent-sub-unread"> · {view().hiddenUnread} unread</span>
          </Show>
        </button>
      </Show>
      <Show when={showAll() && loaded() > RECENT_SUBTASK_PAGE_SIZE}>
        <button type="button" class="recent-sub-more" onClick={showLess}>
          Show less
        </button>
      </Show>
    </div>
  );
}

function SubtaskLink(props: { row: SubtaskRow; base: string }) {
  return (
    <A
      class="navi navi--task navi--subtask"
      classList={{ "navi--unread": !!props.row.isUnreadForMe }}
      href={taskHref(props.base, props.row)}
      title={props.row.identifier ? `${props.row.identifier} · ${props.row.title}` : props.row.title}
    >
      <TaskStatusCapsule task={props.row} size="tiny" />
      <span class="navi-label">{props.row.title}</span>
      <Show when={props.row.isUnreadForMe}>
        <UnreadDot />
      </Show>
    </A>
  );
}
