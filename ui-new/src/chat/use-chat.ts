import type { AgentDetail, Issue, IssueComment } from "@paperclipai/shared";
import { createInfiniteQuery, createQuery, useQueryClient } from "@tanstack/solid-query";
import { batch, createEffect, createMemo, createSignal, on, untrack } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { chatApi } from "@/api/chat";
import { ApiError } from "@/api/client";
import { interactionsApi } from "@/api/interactions";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useNow } from "@/lib/clock";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery, useLiveRunsQuery } from "@/lib/company-data";
import { useLiveEvent } from "@/lib/live-events";
import { taskRequests } from "@/requests/request-model";
import { isActiveRun } from "@/runs/run-model";
import { queuedIds, useQueuedComments } from "@/tasks/composer/QueuedMessages";
import { useTaskPeople } from "@/tasks/people";
import { buildChat, shownReplies, type ChatTask, type ReplyTurn } from "./chat-model";

/*
 * Everything the chat view reads, in one place.
 *
 * - Whether chat is on: the instance's `enableAgentChat` (decision 2). A 404 from the chat routes
 *   means the same.
 * - The chat: `GET /chats/:agent`, null until the first message. Its row is then read like any
 *   task's (`issues.section(id, "core")`), so live task events keep its state fresh.
 * - Messages, newest page first, 50 at a time, with "Load earlier messages". The live events
 *   refresh them through the task's detail key.
 * - Hand-offs, reports, the agent's requests and approvals on the chat, and the queue.
 * - Reply turns: the agent's runs on the chat. A run that leaves the live list is kept as finished
 *   until its message arrives (`shownReplies`).
 */

const PAGE = 50;

export type ChatState = ReturnType<typeof useChat>;

export function useChat(agent: () => AgentDetail) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const settings = useExperimentalSettingsQuery();
  const liveRuns = useLiveRunsQuery();

  const chatQuery = createQuery(() => ({
    queryKey: queryKeys.chat.detail(company().id, agent().id),
    queryFn: ({ signal }) => chatApi.get(company().id, agent().id, signal),
    enabled: settings.data?.enableAgentChat === true || settings.isError,
    retry: false,
  }));
  /** Off on this instance: the setting says so, or the chat routes answer 404. */
  const off = () =>
    settings.data?.enableAgentChat === false || (chatQuery.error instanceof ApiError && chatQuery.error.status === 404);
  const found = () => chatQuery.data ?? null;
  const chatId = () => found()?.id ?? null;

  const core = createQuery(() => ({
    queryKey: queryKeys.issues.section(chatId() ?? "", "core"),
    queryFn: ({ signal }) => issuesApi.getCore(chatId()!, signal),
    enabled: !!chatId(),
    placeholderData: found() ?? undefined,
  }));
  const chat = (): Issue | null => (core.data?.id === chatId() ? core.data : null) ?? found();

  /** Creates the chat on the first message or upload, once. */
  let opening: Promise<Issue> | null = null;
  const ensure = async (): Promise<Issue> => {
    const existing = chat();
    if (existing) return existing;
    opening ??= chatApi.open(company().id, agent().id).then((issue) => {
      client.setQueryData(queryKeys.chat.detail(company().id, agent().id), issue);
      void client.invalidateQueries({ queryKey: queryKeys.chat.list(company().id) });
      return issue;
    });
    try {
      return await opening;
    } finally {
      opening = null;
    }
  };

  const comments = createInfiniteQuery(() => ({
    queryKey: queryKeys.issues.section(chatId() ?? "", "comments", "chat"),
    queryFn: ({ pageParam, signal }) => issuesApi.listComments(chatId()!, { limit: PAGE, after: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: IssueComment[]) => (last.length < PAGE ? undefined : last[last.length - 1]?.id),
    enabled: !!chatId(),
  }));
  const allComments = createMemo(() => comments.data?.pages.flat() ?? []);

  const handoffs = createQuery(() => ({
    queryKey: queryKeys.chat.handoffs(company().id, chatId() ?? ""),
    queryFn: ({ signal }) => chatApi.handoffs(company().id, chatId()!, signal),
    enabled: !!chatId(),
  }));
  const reports = createQuery(() => ({
    queryKey: queryKeys.chat.reports(company().id, agent().id),
    queryFn: ({ signal }) => chatApi.reports(company().id, agent().id, signal),
    enabled: settings.data?.enableAgentChat === true && !off(),
  }));
  const interactions = createQuery(() => ({
    queryKey: queryKeys.issues.section(chatId() ?? "", "interactions"),
    queryFn: ({ signal }) => interactionsApi.list(chatId()!, signal),
    enabled: !!chatId(),
    refetchInterval: (query) => (query.state.data?.some((item) => item.status === "pending" && item.acceptanceBlocker) ? 2_000 : false),
  }));
  // The chat's runs, for replies that ended without a message. Refreshed with the task.
  const runs = createQuery(() => ({
    queryKey: queryKeys.issues.section(chatId() ?? "", "runs"),
    queryFn: ({ signal }) => issuesApi.runs(chatId()!, signal),
    enabled: !!chatId(),
  }));
  const approvals = createQuery(() => ({
    queryKey: queryKeys.issues.section(chatId() ?? "", "approvals"),
    queryFn: ({ signal }) => approvalsApi.forIssue(chatId()!, signal),
    enabled: !!chatId(),
  }));

  // The agent's runs: on this chat (replies), and elsewhere (the work it's doing alongside).
  const agentRuns = createMemo(() => (liveRuns.data ?? []).filter((run) => run.agentId === agent().id));
  const replyRuns = createMemo(() => agentRuns().filter((run) => !!chatId() && run.issueId === chatId()));
  const otherRuns = createMemo(() => agentRuns().filter((run) => run.issueId !== chatId()));

  // Reply turns seen while the chat is open; one that leaves the live list is finished from then.
  // Another chat starts afresh, in the same effect: a separate reset could run after this one and
  // drop a reply already running when the chat opens.
  const [turns, setTurns] = createSignal<ReplyTurn[]>([]);
  let turnsChat: string | null = null;
  createEffect(
    on(replyRuns, (live) => {
      const liveIds = new Set(live.map((run) => run.id));
      const chat = untrack(chatId);
      const fresh = chat !== turnsChat;
      turnsChat = chat;
      setTurns((previous) => {
        const next: ReplyTurn[] = (fresh ? [] : previous).map((turn) =>
          liveIds.has(turn.runId) || turn.finishedAt ? turn : { ...turn, status: "finished", finishedAt: new Date().toISOString() },
        );
        for (const run of live) {
          const at = next.findIndex((turn) => turn.runId === run.id);
          if (at === -1) next.push({ runId: run.id, status: run.status, finishedAt: null });
          else if (!next[at]!.finishedAt && next[at]!.status !== run.status) next[at] = { ...next[at]!, status: run.status };
        }
        return next;
      });
    }),
  );
  // A run's end comes as a status event. The live-runs refetch it starts can come back with the run
  // still going until the trailing refetch (lib/live-events.tsx) lands, so the event itself ends
  // the turn.
  useLiveEvent(["heartbeat.run.status"], (event) => {
    const runId = event.payload?.runId;
    const status = event.payload?.status;
    if (typeof runId !== "string" || typeof status !== "string" || isActiveRun(status)) return;
    if (!untrack(turns).some((turn) => turn.runId === runId && !turn.finishedAt)) return;
    setTurns((previous) => previous.map((turn) => (turn.runId === runId && !turn.finishedAt ? { ...turn, status, finishedAt: new Date().toISOString() } : turn)));
  });
  const ticking = () => turns().some((turn) => turn.finishedAt !== null) || replyRuns().length > 0;
  const now = useNow(ticking);
  const replies = createMemo(() => shownReplies(turns(), allComments(), new Date(now())));
  // Drop turns that no longer show, so the list doesn't grow.
  createEffect(
    on(replies, (shown) => {
      const keep = new Set(shown.map((turn) => turn.runId));
      if (turns().some((turn) => turn.finishedAt && !keep.has(turn.runId))) setTurns((previous) => previous.filter((turn) => !turn.finishedAt || keep.has(turn.runId)));
    }),
  );

  const replying = () => replyRuns().length > 0;
  const queue = useQueuedComments(() => chatId() ?? "", () => !!chatId() && replying());

  const requests = createMemo(() => {
    const current = chat();
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

  const [search, setSearch] = createSignal("");
  const entries = createMemo(() =>
    buildChat({
      comments: allComments(),
      handoffs: (handoffs.data ?? []) as ChatTask[],
      reports: (reports.data ?? []) as ChatTask[],
      requests: requests(),
      runs: runs.data ?? [],
      liveRunIds: new Set(replies().map((turn) => turn.runId)),
      hiddenCommentIds: queuedIds(queue.data),
      youId: people.youId(),
      moreHistory: comments.hasNextPage,
      search: search(),
      now: new Date(),
    }),
  );

  // Only the first load counts: a chat created by the first message mustn't swap the view (and its
  // composer, mid-send) for a loading note.
  const [ready, setReady] = createSignal(false);
  const firstLoading = () => settings.isPending || chatQuery.isPending || (!!chatId() && comments.isPending);
  createEffect(() => !ready() && !firstLoading() && setReady(true));
  createEffect(on(() => agent().id, () => setReady(false), { defer: true }));
  const loading = () => !ready() && firstLoading();

  const refresh = () =>
    batch(() => {
      const id = chatId();
      if (id) void client.invalidateQueries({ queryKey: queryKeys.issues.detail(id) });
      void client.invalidateQueries({ queryKey: queryKeys.liveRuns(company().id) });
    });

  return {
    off,
    loading,
    error: () => (off() ? null : ((chatQuery.error ?? comments.error) as Error | null)),
    chat,
    chatId,
    ensure,
    entries,
    comments,
    handoffs,
    replies,
    replyRuns,
    otherRuns,
    replying,
    queue,
    search,
    setSearch,
    people,
    refresh,
  };
}
