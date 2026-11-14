import type { IssueComment, IssueStatus } from "@paperclipai/shared";
import { createInfiniteQuery, createMutation, createQuery, keepPreviousData, useQueryClient } from "@tanstack/solid-query";
import { ArrowDown, ArrowUpRight, Ellipsis, FoldVertical, ListTree, Search, Square, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { commentsApi } from "@/api/comments";
import { interactionsApi } from "@/api/interactions";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useNow } from "@/lib/clock";
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
import { FeedbackVotes } from "./FeedbackVotes";
import { Composer } from "./composer/Composer";
import { QueuedMessages, queuedIds, useQueuedComments } from "./composer/QueuedMessages";
import { PendingComments } from "./composer/PendingComments";
import { describeError } from "@/lib/offline/errors";
import { loadingText } from "@/lib/offline/read-state";
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
import { SourceTrustBadge } from "@/documents/SourceTrustBadge";
import { useTaskPeople } from "./people";
import { StatusChip, TaskStatusChip } from "./TaskDetails";
import { stopLabel, stopRun } from "./run-stop";
import { plainClick } from "./TaskList";
import { createdTasks, duration, stampLabel, suggestedTaskIds, type CreatedTask, type ThreadFilter } from "./thread-model";
import { commentElementId, nearBottom } from "./task-anchor";
import { compactionDetail, compactionRunIds, runsToRead, useRunCompactions } from "./thread-compactions";
import { contextUsageQuery } from "./TaskContext";
import { CopyMessage } from "./CopyMessage";
import { LiveRunStatusLine } from "./LiveRunStatus";
import { useQueueWait } from "@/chat/admission-hold";
import { WaitLine } from "@/runs/QueueWait";
import type { QueueWait } from "@/runs/queue-wait";
import type { LiveRun } from "@/api/heartbeats";
import { RunToolProgress } from "./ToolCallProgress";
import { CommentPluginActions, CommentPluginAnnotations } from "@/plugins/CommentPlugins";
import "./TaskActivity.css";

/*
 * The task panel's Activity section (board 3): the thread, oldest first, with comments as cards,
 * changes and finished runs as compact lines between them, agents' requests and the task's
 * approvals as request cards (board 15), tasks an agent made from this one as linked cards, and the
 * live run as a card at the foot with Stop. Runs open in the run modal ("View run"). An agent's
 * comment has thumbs up and down (FeedbackVotes.tsx); your own has Copy as Markdown, left of its
 * time (CopyMessage.tsx). A finished run's context compactions divide the thread
 * (thread-compactions.ts), and the "created this task" line names the task it was created from.
 *
 * It opens on the latest of the task's history and the task row alone (history-window.ts), and
 * reads the rest when the reader asks: "Show earlier activity", a search, or a filter. From then on
 * older comments load in pages.
 *
 * Under the thread: the messages queued for the agent's next turn, with steer and interrupt, then
 * the composer (mentions, files, work mode, reassigning, run settings, reopening).
 *
 * A `#comment-<id>` link (`focusCommentId`, from TaskSections) checks the comment is this task's,
 * loads earlier pages until it's in the thread, scrolls to it and highlights it. New entries keep
 * the newest in view only while the reader is at the foot; scrolled up, "Jump to latest" takes them
 * back down.
 */

const COMMENT_PAGE_SIZE = 50;

const FILTERS: { value: ThreadFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "comments", label: "Comments" },
  { value: "changes", label: "Changes" },
];

/** How many pages of older comments a `#comment-<id>` link loads before giving up. */
const FOCUS_PAGE_LIMIT = 40;

export function TaskActivity(props: {
  taskId: string;
  title?: string;
  focusCommentId?: string;
  /** Opens a task the thread links to in the same place; without it, in the task modal. */
  onOpenTask?: (task: { id: string; identifier: string | null }) => void;
}) {
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
        mergeRuns(
          client.getQueryData<RunWindow>(key),
          await issuesApi.recentRuns(taskId, signal),
          () => issuesApi.runs(taskId, signal),
          (ids) => issuesApi.runsByIds(taskId, ids, signal),
        ),
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
  // Tasks agents made from this one: its subtasks (the same read as Details) and its follow-ups.
  const subtasks = createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, { parentId: props.taskId }),
    queryFn: ({ signal }) => issuesApi.list(company().id, { parentId: props.taskId }, signal),
  }));
  const followUps = createQuery(() => ({
    queryKey: [...queryKeys.issues.list(company().id), "created-from", props.taskId],
    queryFn: ({ signal }) => issuesApi.listAll(company().id, { createdFromIssueId: props.taskId, includeRoutineExecutions: true }, signal),
  }));
  const madeTasks = createMemo(() =>
    createdTasks([...(subtasks.data ?? []), ...(followUps.data ?? [])], {
      taskId: props.taskId,
      companyId: company().id,
      shown: suggestedTaskIds(interactions.data ?? []),
    }),
  );
  // Compaction dividers (U58): the shown runs' compactions, read while the assignee's session counts
  // any, and the runs Compact now queued (thread-compactions.ts).
  const contextUsage = createQuery(() => contextUsageQuery(props.taskId, task()?.assigneeAgentId));
  const requestedCompactions = createMemo(() => compactionRunIds(shownEvents()));
  const compactions = useRunCompactions(
    createMemo(() => runsToRead(shownRuns(), { sessionCompacted: (contextUsage.data?.compactions ?? 0) > 0, requested: requestedCompactions() }), [], {
      equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
    }),
  );
  const live = createMemo(() => (liveRuns.data ?? []).filter((run) => run.issueId === props.taskId));
  // Ticks the live runs' running times.
  const now = useNow(() => live().length > 0);
  const queue = useQueuedComments(() => props.taskId, () => live().length > 0 || !!task()?.assigneeAgentId);

  const openTask = (task: { id: string; identifier: string | null; title: string; projectId: string | null }) =>
    props.onOpenTask ? props.onOpenTask(task) : commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title, projectId: task.projectId });

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
      tasks: madeTasks(),
      compactions: compactions(),
      compactionRunIds: requestedCompactions(),
      createdFrom: task()?.createdFrom?.issue,
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
  // A failed refresh keeps the thread it has; only a thread that never loaded shows the error.
  const unloaded = (query: { data: unknown; error: unknown }) => (query.data === undefined ? query.error : null);
  const error = () =>
    (expanded() ? (unloaded(comments) ?? unloaded(events)) : (unloaded(recentComments) ?? unloaded(recentEvents))) as Error | null;

  // A search or a filter needs the whole history.
  createEffect(on([filter, search], ([chosen, text]) => (chosen !== "all" || text.trim()) && expandHistory(props.taskId), { defer: true }));

  // A `#comment-<id>` link: once the server confirms the comment is this task's, show the whole
  // history unfiltered and load earlier pages until it's in the thread, then scroll to it.
  const [focusing, setFocusing] = createSignal<string | null>(null);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let focusPages = 0;
  createEffect(
    on([() => props.focusCommentId, () => props.taskId], ([id]) => {
      focusPages = 0;
      setFocusing(id ?? null);
    }),
  );
  const linked = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "comment", focusing() ?? ""),
    queryFn: ({ signal }) => commentsApi.get(props.taskId, focusing()!, signal),
    enabled: focusing() !== null,
    retry: false,
    staleTime: Infinity,
  }));
  createEffect(() => {
    const id = focusing();
    if (!id) return;
    if (linked.isError) {
      setFocusing(null);
      pushToast({ tone: "error", title: "That comment isn't on this task", body: "It may have been deleted, or the link is for another task." });
      return;
    }
    if (!linked.data || loading()) return;
    if (shownComments().some((comment) => comment.id === id)) {
      setFocusing(null);
      setFilter("all");
      setSearch("");
      setSearching(false);
      queueMicrotask(() => {
        const element = log?.querySelector<HTMLElement>(`#${CSS.escape(commentElementId(id))}`);
        element?.scrollIntoView({ block: "center" });
        setHighlighted(id);
        setFollowing(log ? nearBottom(log) : true);
      });
      return;
    }
    if (!expanded()) return expandHistory(props.taskId);
    if (comments.isPending || comments.isFetchingNextPage) return;
    if (comments.hasNextPage && focusPages < FOCUS_PAGE_LIMIT) {
      focusPages += 1;
      void comments.fetchNextPage();
    } else setFocusing(null);
  });
  createEffect(
    on(highlighted, (id) => {
      if (!id) return;
      const timer = window.setTimeout(() => setHighlighted(null), 4_000);
      onCleanup(() => window.clearTimeout(timer));
    }),
  );

  // Opening the section keeps the newest in view, and so do new entries arriving at the foot while
  // the reader is there. Older entries loading above don't move the reader.
  const [following, setFollowing] = createSignal(true);
  const toBottom = () =>
    queueMicrotask(() => {
      log?.scrollTo({ top: log.scrollHeight });
      setFollowing(true);
    });
  createEffect(on(() => [props.taskId, loading()], () => !loading() && !focusing() && !props.focusCommentId && toBottom()));
  createEffect(
    on(
      () => `${thread()[thread().length - 1]?.key ?? ""}:${live().length}`,
      (now, before) => before !== undefined && now !== before && following() && !focusing() && toBottom(),
    ),
  );

  // Live runs whose Stop is out, or recorded and settling (a native session still starting).
  const [stopping, setStopping] = createSignal<ReadonlySet<string>>(new Set());
  const stop = async (run: { id: string; status: string }) => {
    if (stopping().has(run.id)) return;
    setStopping((current) => new Set([...current, run.id]));
    let settling = false;
    try {
      settling = (await stopRun({ runId: run.id, status: run.status }, company().id)) === "pending";
      if (settling) pushToast({ tone: "info", title: "Stopping the run", body: "The Stop is recorded. The run ends as cancelled once its session opens." });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't stop the run", body: error instanceof Error ? error.message : String(error) });
    } finally {
      // A settling Stop stays marked; the run leaves the live list when it ends.
      if (!settling) setStopping((current) => new Set([...current].filter((id) => id !== run.id)));
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
      // Stop on a run still waiting in line puts an in-progress task back to To do (#21407), so the
      // task is read again too, even without the live event that says so.
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
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

      <div class="ta-log" role="log" aria-label="Task thread" ref={log} onScroll={() => log && setFollowing(nearBottom(log))}>
        <Switch>
          <Match when={error()}>
            {(failed) => <p class="ta-muted">The activity couldn't be loaded: {describeError(failed())}</p>}
          </Match>
          <Match when={loading()}>
            <p class="ta-muted">{loadingText("Loading activity…")}</p>
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
                                <Show when={line.createdFrom}>
                                  {(from) => (
                                    <>
                                      {" "}from{" "}
                                      <a
                                        class="ta-from"
                                        href={issuePath(company().issuePrefix, from())}
                                        title={from().title}
                                        onClick={(event) => {
                                          if (!plainClick(event)) return;
                                          event.preventDefault();
                                          openTask({ id: from().id, identifier: from().identifier, title: from().title, projectId: null });
                                        }}
                                      >
                                        {from().identifier ?? from().title}
                                      </a>
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
                    {(entry) => (
                      <Comment
                        taskId={props.taskId}
                        comment={entry().comment}
                        input={inputs().get(entry().comment.id)}
                        people={people}
                        highlighted={highlighted() === entry().comment.id}
                      />
                    )}
                  </Match>
                  <Match when={item.kind === "request" && item}>{(entry) => <RequestCard request={entry().request} taskId={props.taskId} people={people} inThread />}</Match>
                  <Match when={item.kind === "task" && item}>
                    {(entry) => <CreatedTaskCard task={entry().task} at={entry().at} onOpen={openTask} />}
                  </Match>
                  <Match when={item.kind === "compaction" && item}>
                    {(entry) => (
                      <div class="ta-compacted" role="separator" aria-label={`Context compacted, ${stampLabel(entry().at)}`}>
                        <span class="ta-compacted-label">
                          <FoldVertical size={14} aria-hidden="true" />
                          <b>Context compacted</b>
                          <Show when={compactionDetail(entry().compaction)}>{(detail) => <span>· {detail()}</span>}</Show>
                          <time datetime={entry().at.toISOString()}>· {stampLabel(entry().at)}</time>
                          <button type="button" class="ta-view-run" onClick={() => commands.openRunModal(entry().compaction.runId)}>
                            View run
                          </button>
                        </span>
                      </div>
                    )}
                  </Match>
                </Switch>
              )}
            </For>
            <For each={live()}>
              {(run) => {
                // A run waiting for the agent's slot, a named hold, or just to start (U151): no breathing capsule.
                const wait = useQueueWait(() => run);
                return (
                <article class="ta-live" classList={{ "ta-live--waiting": !!wait() }} aria-label="Live run">
                  <Capsule gradient="ion" size="tiny" live={!wait()} queued={!!wait()} />
                  <LiveRunWho run={run} wait={wait} />
                  <span class="ta-muted">
                    Run {run.id.slice(0, 8)}
                    <Show when={run.startedAt}>{(start) => <> · {duration(start(), new Date(now()))}</>}</Show>
                  </span>
                  <Button size="compact" class="ta-live-view" onClick={() => commands.openRunModal(run.id)}>
                    View run
                  </Button>
                  <Button size="compact" disabled={stopping().has(run.id)} onClick={() => void stop(run)}>
                    <Square size={12} aria-hidden="true" />
                    {stopLabel(run.status, stopping().has(run.id))}
                  </Button>
                  {/* What it's doing: a tool, its latest words or a status such as a storage wait (U107). */}
                  <LiveRunStatusLine class="lrs--row" runId={run.id} run={run} active />
                  {/* A connected-app tool call's live progress (U154). */}
                  <RunToolProgress taskId={props.taskId} run={run} />
                </article>
                );
              }}
            </For>
            <Show when={queue.data}>{(found) => <QueuedMessages taskId={props.taskId} queue={found()} />}</Show>
          </Match>
        </Switch>
        {/* Messages that haven't reached the server, even while the thread can't load (U13). */}
        <PendingComments taskId={props.taskId} />
      </div>
      <Show when={!following() && !loading()}>
        <div class="ta-jump">
          <Button size="compact" icon={<ArrowDown size={14} aria-hidden="true" />} onClick={toBottom}>
            Jump to latest
          </Button>
        </div>
      </Show>
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

/**
 * Who the live run line is about. Working from the moment it's admitted, as the chat's live reply
 * reads (U120, #20559); only a queued run's named hold says otherwise (decision 50,
 * chat/admission-hold.ts). Since the 2026-11-14 sync (U151): a run waiting for the agent's slot
 * shows its place in line with Configure, and one still queued after 30 seconds with no named hold
 * says "Waiting to start" (runs/queue-wait.ts).
 */
export function LiveRunWho(props: {
  run: { id: string; status: string; agentName: string; startedAt?: string | null; createdAt?: string | null; execution?: LiveRun["execution"] };
  /** The run's wait, when the caller already reads it. */
  wait?: () => QueueWait | null;
}) {
  const wait = props.wait ?? useQueueWait(() => props.run);
  return (
    <Show when={wait()} fallback={<span class="ta-live-who">{`${props.run.agentName} is working`}</span>}>
      {(found) =>
        found().kind === "agent" ? <WaitLine wait={found()} class="ta-live-wait" /> : <span class="ta-live-who">{`${props.run.agentName} · ${found().label}`}</span>
      }
    </Show>
  );
}

function Comment(props: {
  taskId: string;
  comment: IssueComment;
  input?: CommentInput;
  people: ReturnType<typeof useTaskPeople>;
  /** Reached through a `#comment-<id>` link. */
  highlighted?: boolean;
}) {
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
    <article
      id={commentElementId(props.comment.id)}
      class="ta-comment"
      classList={{ "ta-comment--notice": notice(), "ta-comment--linked": props.highlighted }}
      data-tone={props.comment.presentation?.tone}
    >
      <div class="ta-comment-head">
        <Switch fallback={<InitialsDisc name={name()} seed={userId() ?? name()} size={22} you={you()} />}>
          <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={24} />}</Match>
        </Switch>
        <span class="ta-author">{name()}</span>
        <Show when={agent()}>
          <span class="ta-tag">agent</span>
        </Show>
        <Show when={props.comment.presentation?.title}>{(title) => <span class="ta-tag">{title()}</span>}</Show>
        <SourceTrustBadge sourceTrust={props.comment.sourceTrust} />
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
        <CommentPluginActions comment={props.comment} />
        <Show when={you() && !props.comment.deletedAt}>
          <CopyMessage text={props.comment.body} class="ta-copy" />
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
      <CommentPluginAnnotations comment={props.comment} />
      <Show when={agent() && !notice() && !props.comment.deletedAt}>
        <FeedbackVotes taskId={props.taskId} commentId={props.comment.id} youId={props.people.youId()} />
      </Show>
    </article>
  );
}

/** A task an agent made from this one, as a card at the time it was made, with its status as it is now. */
function CreatedTaskCard(props: { task: CreatedTask; at: Date; onOpen: (task: CreatedTask) => void }) {
  const company = useCompany();
  return (
    <a
      class="ta-made"
      href={issuePath(company().issuePrefix, props.task)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        props.onOpen(props.task);
      }}
    >
      <ListTree size={16} aria-hidden="true" class="ta-made-icon" />
      <span class="ta-made-text">
        <span class="ta-made-kicker">
          {props.task.subtask ? "Subtask created" : "Follow-up created"}
          <Show when={props.task.via}>{(via) => <> from {via().identifier ?? "another subtask"}</>}</Show>
          <time datetime={props.at.toISOString()}> · {stampLabel(props.at)}</time>
        </span>
        <span class="ta-made-title">{props.task.title}</span>
        <span class="ta-made-meta">
          <Show when={props.task.identifier}>{(id) => <span class="mono">{id()}</span>}</Show>
          <TaskStatusChip task={props.task} small />
        </span>
      </span>
      <ArrowUpRight size={15} aria-hidden="true" class="ta-made-icon" />
    </a>
  );
}
