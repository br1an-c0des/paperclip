import type { IssueComment, IssueStatus } from "@paperclipai/shared";
import { createInfiniteQuery, createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
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
import { Composer } from "./composer/Composer";
import { QueuedMessages, queuedIds, useQueuedComments } from "./composer/QueuedMessages";
import { MessageBody } from "./MessageBody";
import { useTaskPeople } from "./people";
import { StatusChip } from "./TaskDetails";
import { buildThread, duration, stampLabel, type ThreadFilter } from "./thread-model";
import "./TaskActivity.css";

/*
 * The task panel's Activity section (board 3): the thread, oldest first, with comments as cards,
 * changes and finished runs as compact lines between them, agents' requests and the task's
 * approvals as request cards (board 15), and the live run as a card at the foot with Stop. Runs
 * open in the run modal ("View run"). Older comments load in pages.
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

  const comments = createInfiniteQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "comments"),
    queryFn: ({ pageParam, signal }) => issuesApi.listComments(props.taskId, { limit: COMMENT_PAGE_SIZE, after: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: IssueComment[]) => (last.length < COMMENT_PAGE_SIZE ? undefined : last[last.length - 1]?.id),
  }));
  const events = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "activity"),
    queryFn: ({ signal }) => issuesApi.activity(props.taskId, signal),
  }));
  const runs = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "runs"),
    queryFn: ({ signal }) => issuesApi.runs(props.taskId, signal),
  }));
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
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
  const queue = useQueuedComments(() => props.taskId, () => live().length > 0 || !!task.data?.assigneeAgentId);

  const names = {
    agent: (id: string) => people.agent(id)?.name,
    person: (id: string) => people.personName(id),
    youId: () => people.youId(),
  };
  const requests = createMemo(() =>
    taskRequests(
      { interactions: interactions.data ?? [], approvals: approvals.data ?? [] },
      {
        youId: people.youId(),
        agentName: (id) => people.agent(id)?.name,
        personName: (id) => people.personName(id),
        task: task.data ? { id: task.data.id, identifier: task.data.identifier, title: task.data.title } : null,
      },
    ),
  );
  const thread = createMemo(() =>
    buildThread({
      comments: comments.data?.pages.flat() ?? [],
      events: events.data ?? [],
      runs: runs.data ?? [],
      requests: requests(),
      hiddenCommentIds: queuedIds(queue.data),
      names,
      moreComments: comments.hasNextPage,
      filter: filter(),
      search: search(),
    }),
  );
  const loading = () => comments.isPending || events.isPending || runs.isPending;

  // Opening the section, and new entries arriving, keep the newest in view.
  const toBottom = () => queueMicrotask(() => log?.scrollTo({ top: log.scrollHeight }));
  createEffect(on(() => [props.taskId, loading()], () => !loading() && toBottom()));
  createEffect(on(() => thread().length + live().length, (count, previous) => previous !== undefined && count > previous && toBottom()));

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
          <Match when={comments.isError || events.isError}>
            <p class="ta-muted">The activity couldn't be loaded: {((comments.error ?? events.error) as Error).message}</p>
          </Match>
          <Match when={true}>
            <Show when={comments.hasNextPage}>
              <button type="button" class="ta-more" disabled={comments.isFetchingNextPage} onClick={() => void comments.fetchNextPage()}>
                {comments.isFetchingNextPage ? "Loading earlier comments…" : "Load earlier comments"}
              </button>
            </Show>
            <Show when={thread().length === 0 && live().length === 0}>
              <p class="ta-muted">{search() || filter() !== "all" ? "Nothing matches." : "No activity yet."}</p>
            </Show>
            <For each={thread()}>
              {(item) => (
                <Switch>
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
                  <Match when={item.kind === "comment" && item}>{(entry) => <Comment taskId={props.taskId} comment={entry().comment} people={people} />}</Match>
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
      <Show when={task.data}>
        {(found) => (
          <div class="ta-compose">
            <Composer task={found()} liveRunId={live()[0]?.id ?? null} />
          </div>
        )}
      </Show>
    </section>
  );
}

function Comment(props: { taskId: string; comment: IssueComment; people: ReturnType<typeof useTaskPeople> }) {
  const client = useQueryClient();
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
