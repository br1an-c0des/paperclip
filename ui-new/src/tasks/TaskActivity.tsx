import type { IssueComment, IssueStatus } from "@paperclipai/shared";
import { createInfiniteQuery, createMutation, createQuery, keepPreviousData, useQueryClient } from "@tanstack/solid-query";
import { Ellipsis, Search, Square, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { commentsApi } from "@/api/comments";
import { heartbeatsApi } from "@/api/heartbeats";
import { interactionsApi } from "@/api/interactions";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery } from "@/lib/company-data";
import { RequestCard } from "@/requests/RequestCard";
import { taskRequests } from "@/requests/request-model";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { commentInputs, type CommentInput } from "./activity-format";
import { Composer } from "./composer/Composer";
import { QueuedMessages, queuedIds, useQueuedComments } from "./composer/QueuedMessages";
import {
  CATCH_UP_PAGE,
  catchUpComments,
  expandHistory,
  historyExpanded,
  historyFrom,
  mergeActivity,
  mergeComments,
  mergeRuns,
  windowThread,
  type ActivityWindow,
  type CommentWindow,
  type RunWindow,
} from "./history-window";
import { MessageBody } from "./MessageBody";
import { useTaskPeople } from "./people";
import { StatusChip } from "./TaskDetails";
import { duration, stampLabel, type ThreadFilter } from "./thread-model";
import "./TaskActivity.css";

/*
 * The task panel's Activity section (board 3): the thread, oldest first, with comments as cards,
 * changes and finished runs as compact lines between them, agents' requests and the task's
 * approvals as request cards (board 15), and the live run as a card at the foot with Stop. Runs
 * open in the run modal ("View run").
 *
 * It opens on the latest of the task's history and the task row alone (history-window.ts), and
 * reads the rest when the reader asks: "Show earlier activity", a search, or a filter. From then on
 * older comments load in pages.
 *
 * Under the thread: the messages queued for the agent's next turn, with steer and interrupt, then
 * the composer (mentions, files, work mode, reassigning, run settings, reopening).
 */

const COMMENT_PAGE_SIZE = 50;

const FILTERS: { value: ThreadFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "comments", label: "Comments" },
  { value: "changes", label: "Changes" },
];

export function TaskActivity(props: { taskId: string; title?: string }) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const people = useTaskPeople();
  const liveRuns = useLiveRunsQuery();
  const [filter, setFilter] = createSignal<ThreadFilter>("all");
  const [searching, setSearching] = createSignal(false);
  const [search, setSearch] = createSignal("");
  let log: HTMLDivElement | undefined;

  const expanded = () => historyExpanded(props.taskId);

  // The windows of recent history: what the section first paints from.
  const recentComments = createQuery(() => {
    const taskId = props.taskId;
    const key = queryKeys.issues.section(taskId, "comments", "recent");
    return {
      queryKey: key,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const snapshot = await issuesApi.recentComments(taskId, signal);
        return catchUpComments(
          client.getQueryData<CommentWindow>(key),
          snapshot,
          (after) => issuesApi.listComments(taskId, { order: "asc", limit: CATCH_UP_PAGE, after: after ?? undefined }, signal),
          signal,
        );
      },
      enabled: !expanded(),
    };
  });
  const recentEvents = createQuery(() => {
    const taskId = props.taskId;
    const key = queryKeys.issues.section(taskId, "activity", "recent");
    return {
      queryKey: key,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        mergeActivity(client.getQueryData<ActivityWindow>(key), await issuesApi.recentActivity(taskId, signal)),
      enabled: !expanded(),
    };
  });
  const recentRuns = createQuery(() => {
    const taskId = props.taskId;
    const key = queryKeys.issues.section(taskId, "runs", "recent");
    return {
      queryKey: key,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        mergeRuns(client.getQueryData<RunWindow>(key), await issuesApi.recentRuns(taskId, signal), () => issuesApi.runs(taskId, signal)),
      enabled: !expanded(),
    };
  });

  // The full history, once asked for. The windows keep showing until it arrives.
  const comments = createInfiniteQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "comments"),
    queryFn: ({ pageParam, signal }) => issuesApi.listComments(props.taskId, { limit: COMMENT_PAGE_SIZE, after: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: IssueComment[]) => (last.length < COMMENT_PAGE_SIZE ? undefined : last[last.length - 1]?.id),
    enabled: expanded(),
  }));
  const events = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "activity"),
    queryFn: ({ signal }) => issuesApi.activity(props.taskId, signal),
    enabled: expanded(),
  }));
  const runs = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "runs"),
    queryFn: ({ signal }) => issuesApi.runs(props.taskId, signal),
    enabled: expanded(),
  }));

  const pagedComments = () => comments.data?.pages.flat();
  const shownComments = createMemo(() => mergeComments(recentComments.data?.comments ?? [], pagedComments() ?? []));
  // What the comments shown did to the run. The full activity has it; the recent window asks for it.
  const inputIds = createMemo(() => shownComments().map((comment) => comment.id).sort());
  const inputFacts = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "activity", "comment-inputs", inputIds().join(",")),
    queryFn: ({ signal }) => issuesApi.commentInputs(props.taskId, inputIds(), signal),
    enabled: !expanded() && inputIds().length > 0,
    placeholderData: keepPreviousData,
  }));
  const shownEvents = () => (expanded() && events.data ? events.data : (recentEvents.data?.events ?? []));
  const shownRuns = () => (expanded() && runs.data ? runs.data : (recentRuns.data?.runs ?? []));
  const inputs = createMemo(() => commentInputs([...shownEvents(), ...(expanded() ? [] : (inputFacts.data ?? []))]));
  // Where the loaded history stops: the latest point every source holds everything from.
  const from = createMemo(() => {
    const paged = pagedComments();
    const oldestPaged = comments.hasNextPage && paged?.length ? paged[paged.length - 1]!.createdAt : null;
    return historyFrom(
      paged ? (oldestPaged ? new Date(oldestPaged).toISOString() : null) : recentComments.data?.from,
      expanded() && events.data ? null : recentEvents.data?.from,
      expanded() && runs.data ? null : recentRuns.data?.from,
    );
  });

  // The task row is enough for the thread and the composer; the full task is used once it's cached.
  const fullTask = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
    enabled: false,
  }));
  const coreTask = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "core"),
    queryFn: ({ signal }) => issuesApi.getCore(props.taskId, signal),
    enabled: !fullTask.data,
  }));
  const task = () => fullTask.data ?? coreTask.data;
  const interactions = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "interactions"),
    queryFn: ({ signal }) => interactionsApi.list(props.taskId, signal),
    // While a request waits on its workspace, poll until it can be answered (as the old UI does).
    refetchInterval: (query) => (query.state.data?.some((item) => item.status === "pending" && item.acceptanceBlocker) ? 2_000 : false),
  }));
  const approvals = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "approvals"),
    queryFn: ({ signal }) => approvalsApi.forIssue(props.taskId, signal),
  }));
  const live = createMemo(() => (liveRuns.data ?? []).filter((run) => run.issueId === props.taskId));
  const queue = useQueuedComments(() => props.taskId, () => live().length > 0 || !!task()?.assigneeAgentId);

  const names = {
    agent: (id: string) => people.agent(id)?.name,
    person: (id: string) => people.personName(id),
    youId: () => people.youId(),
  };
  const requests = createMemo(() => {
    const current = task();
    return taskRequests(
      { interactions: interactions.data ?? [], approvals: approvals.data ?? [] },
      {
        youId: people.youId(),
        agentName: (id) => people.agent(id)?.name,
        personName: (id) => people.personName(id),
        task: current ? { id: current.id, identifier: current.identifier, title: current.title } : null,
      },
    );
  });
  const thread = createMemo(() =>
    windowThread({
      comments: shownComments(),
      events: shownEvents(),
      runs: shownRuns(),
      requests: requests(),
      hiddenCommentIds: queuedIds(queue.data),
      names,
      from: from(),
      filter: filter(),
      search: search(),
    }),
  );
  // First paint waits for the windows only; the full history fills in behind them.
  const loading = () =>
    expanded()
      ? (comments.isPending && !recentComments.data) || (events.isPending && !recentEvents.data) || (runs.isPending && !recentRuns.data)
      : recentComments.isPending || recentEvents.isPending || recentRuns.isPending;
  const error = () =>
    (expanded() ? (comments.error ?? events.error) : (recentComments.error ?? recentEvents.error)) as Error | null;

  // A search or a filter needs the whole history.
  createEffect(on([filter, search], ([chosen, text]) => (chosen !== "all" || text.trim()) && expandHistory(props.taskId), { defer: true }));

  // Opening the section, and new entries arriving at the foot, keep the newest in view. Older
  // entries loading above don't move the reader.
  const toBottom = () => queueMicrotask(() => log?.scrollTo({ top: log.scrollHeight }));
  createEffect(on(() => [props.taskId, loading()], () => !loading() && toBottom()));
  createEffect(
    on(
      () => `${thread()[thread().length - 1]?.key ?? ""}:${live().length}`,
      (now, before) => before !== undefined && now !== before && toBottom(),
    ),
  );

  const stop = async (runId: string) => {
    try {
      await heartbeatsApi.cancel(runId);
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't stop the run", body: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <section class="ta" aria-label="Activity">
      <div class="tsec-head">
        <h2 class="disp">Activity</h2>
        <Show when={props.title}>
          <span class="ta-title">{props.title}</span>
        </Show>
        <div class="tsec-head-tools">
          <button
            type="button"
            class="btn btn--icon btn--ghost btn--compact"
            aria-label={searching() ? "Close search" : "Search activity"}
            aria-pressed={searching()}
            onClick={() => {
              setSearching(!searching());
              if (!searching()) setSearch("");
            }}
          >
            {searching() ? <X size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
          </button>
          <Segmented label="Show" options={FILTERS} value={filter()} onChange={setFilter} />
        </div>
      </div>
      <Show when={searching()}>
        <div class="ta-search">
          <TextInput
            type="search"
            value={search()}
            ref={(element) => queueMicrotask(() => element.focus())}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search this task's activity"
            aria-label="Search this task's activity"
          />
        </div>
      </Show>

      <div class="ta-log" role="log" aria-label="Task thread" ref={log}>
        <Switch>
          <Match when={loading()}>
            <p class="ta-muted">Loading activity…</p>
          </Match>
          <Match when={error()}>
            {(failed) => <p class="ta-muted">The activity couldn't be loaded: {failed().message}</p>}
          </Match>
          <Match when={true}>
            <Show when={!thread().some((item) => item.kind !== "gap") && live().length === 0}>
              <p class="ta-muted">{search() || filter() !== "all" ? "Nothing matches." : "No activity yet."}</p>
            </Show>
            <For each={thread()}>
              {(item) => (
                <Switch>
                  <Match when={item.kind === "gap"}>
                    <Show
                      when={expanded()}
                      fallback={
                        <button type="button" class="ta-more" onClick={() => expandHistory(props.taskId)}>
                          Show earlier activity
                        </button>
                      }
                    >
                      <button
                        type="button"
                        class="ta-more"
                        disabled={comments.isFetchingNextPage || !comments.hasNextPage}
                        onClick={() => void comments.fetchNextPage()}
                      >
                        {comments.hasNextPage && !comments.isFetchingNextPage ? "Load earlier comments" : "Loading earlier activity…"}
                      </button>
                    </Show>
                  </Match>
                  <Match when={item.kind === "lines" && item}>
                    {(group) => (
                      <ul class="ta-lines">
                        <For each={group().lines}>
                          {(line) => (
                            <li data-tone={line.tone}>
                              <span class="ta-dot" aria-hidden="true" />
                              <span class="ta-line">
                                <b>{line.actor}</b>{" "}
                                <Show when={line.status} fallback={line.text}>
                                  {(status) => (
                                    <>
                                      moved status <Show when={status().from}>{(from) => <StatusChip status={from()} small />}</Show>
                                      <Show when={status().from}> → </Show>
                                      <StatusChip status={status().to as IssueStatus} small />
                                      <Show when={line.text}>, {line.text}</Show>
                                    </>
                                  )}
                                </Show>
                                <Show when={line.count}>{(count) => <span class="ta-count"> ×{count()}</span>}</Show>
                              </span>
                              <Show when={line.runId}>
                                {(runId) => (
                                  <button type="button" class="ta-view-run" onClick={() => commands.openRunModal(runId())}>
                                    View run
                                  </button>
                                )}
                              </Show>
                              <time class="ta-time" datetime={line.at.toISOString()}>
                                {stampLabel(line.at)}
                              </time>
                            </li>
                          )}
                        </For>
                      </ul>
                    )}
                  </Match>
                  <Match when={item.kind === "comment" && item}>
                    {(entry) => <Comment taskId={props.taskId} comment={entry().comment} input={inputs().get(entry().comment.id)} people={people} />}
                  </Match>
                  <Match when={item.kind === "request" && item}>{(entry) => <RequestCard request={entry().request} taskId={props.taskId} people={people} inThread />}</Match>
                </Switch>
              )}
            </For>
            <For each={live()}>
              {(run) => (
                <article class="ta-live" aria-label="Live run">
                  <Capsule gradient="ion" size="tiny" live />
                  <span class="ta-live-who">
                    {run.agentName} {run.status === "queued" ? "is about to start" : "is working"}
                  </span>
                  <span class="ta-muted">
                    Run {run.id.slice(0, 8)}
                    <Show when={run.startedAt}>{(start) => <> · {duration(start(), new Date())}</>}</Show>
                  </span>
                  <Button size="compact" class="ta-live-view" onClick={() => commands.openRunModal(run.id)}>
                    View run
                  </Button>
                  <Button size="compact" onClick={() => void stop(run.id)}>
                    <Square size={12} aria-hidden="true" />
                    Stop
                  </Button>
                </article>
              )}
            </For>
            <Show when={queue.data}>{(found) => <QueuedMessages taskId={props.taskId} queue={found()} />}</Show>
          </Match>
        </Switch>
      </div>
      <Show when={task()}>
        {(found) => (
          <div class="ta-compose">
            <Composer task={found()} liveRunId={live()[0]?.id ?? null} />
          </div>
        )}
      </Show>
    </section>
  );
}

function Comment(props: { taskId: string; comment: IssueComment; input?: CommentInput; people: ReturnType<typeof useTaskPeople> }) {
  const client = useQueryClient();
  const commands = useCommands();
  const remove = createMutation(() => ({
    mutationFn: () => commentsApi.remove(props.taskId, props.comment.id),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "comments") }),
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't delete the comment", body: error.message }),
  }));
  const agentId = () => props.comment.authorAgentId ?? props.comment.derivedAuthorAgentId ?? null;
  const agent = () => props.people.agent(agentId());
  const userId = () => props.comment.authorUserId;
  const you = () => userId() !== null && userId() === props.people.youId();
  const name = () => {
    if (agent()) return agent()!.name;
    if (props.comment.authorType === "system") return "Paperclip";
    const id = userId();
    return id ? (you() ? "You" : props.people.personName(id)) : "Someone";
  };
  const notice = () => props.comment.presentation?.kind === "system_notice";
  return (
    <article class="ta-comment" classList={{ "ta-comment--notice": notice() }} data-tone={props.comment.presentation?.tone}>
      <div class="ta-comment-head">
        <Switch fallback={<InitialsDisc name={name()} seed={userId() ?? name()} size={22} you={you()} />}>
          <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={24} />}</Match>
        </Switch>
        <span class="ta-author">{name()}</span>
        <Show when={agent()}>
          <span class="ta-tag">agent</span>
        </Show>
        <Show when={props.comment.presentation?.title}>{(title) => <span class="ta-tag">{title()}</span>}</Show>
        <Show when={props.input?.steeredRunId}>
          {(runId) => (
            <button type="button" class="ta-tag ta-tag--run" title="Sent into the run while it was going. Open the run." onClick={() => commands.openRunModal(runId())}>
              steered the run
            </button>
          )}
        </Show>
        <Show when={props.input?.interruptedRunId}>
          {(runId) => (
            <button type="button" class="ta-tag ta-tag--run" title="Stopped the run to start a new one. Open the stopped run." onClick={() => commands.openRunModal(runId())}>
              interrupted the run
            </button>
          )}
        </Show>
        <Show when={props.input?.reopened}>
          <span class="ta-tag">reopened the task</span>
        </Show>
        <time class="ta-time" datetime={new Date(props.comment.createdAt).toISOString()}>
          {stampLabel(props.comment.createdAt)}
        </time>
        <Show when={you() && !props.comment.deletedAt}>
          <Menu placement="bottom-end">
            <Menu.Trigger class="ta-comment-menu" aria-label="Comment actions" disabled={remove.isPending}>
              <Ellipsis size={15} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Content label="Comment actions" width={200}>
              <Menu.Item danger onSelect={() => remove.mutate()}>
                Delete comment
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </Show>
      </div>
      <Show when={!props.comment.deletedAt} fallback={<p class="ta-muted">This comment was deleted.</p>}>
        <MessageBody source={props.comment.body} />
      </Show>
    </article>
  );
}
