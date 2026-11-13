import type { AttentionFeed, AttentionItem, AttentionReceipt, AttentionSubject, CompactIssue } from "@paperclipai/shared";
import { createMutation, createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import { accessApi } from "@/api/access";
import { attentionApi } from "@/api/attention";
import { ApiError } from "@/api/client";
import { decisionsApi } from "@/api/decisions";
import { inboxApi } from "@/api/inbox";
import { interactionsApi } from "@/api/interactions";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useSession } from "@/lib/session";
import { requestFromDecision } from "@/requests/decision-model";
import { requestFromJoin } from "@/requests/join-model";
import { requestFromApproval, requestFromInteraction, requestFromReview, type Request } from "@/requests/request-model";
import { useReviewTasks } from "@/requests/review-tasks";
import type { TaskPeople } from "@/tasks/people";
import { useTaskRetry } from "@/tasks/retry";
import { pushToast } from "@/ui/Toast";
import {
  archivedTasks,
  groupFeed,
  interruptionOf,
  keepsRowsOnError,
  snoozeLabel,
  sourceNotices,
  splitMine,
  unreadCount,
  withStep,
  type MineSources,
  type Pending,
} from "./inbox-model";
import { useAttentionFeed } from "./needs-you";
import { alreadyClosed, alreadyClosedText, liveReceipts, withOwner } from "./routing-model";

/*
 * The Inbox's data and triage (board 14):
 *
 * - The attention feed, whole and with your cleared and snoozed items, sorted into tabs.
 * - Each request's card source: a task's interactions (the same query as the task's thread, so an
 *   answer here shows there), each approval by id, the task behind each review for its sign-off,
 *   each proposal by id with the open list's changed targets, and the pending join requests (the
 *   list Settings → Members reads).
 * - Keep brings a request back from the aging shelf, at once in the cached feed.
 * - Archive (the "clear" step), snooze and restore, shown at once and undone from the toast. Archive
 *   and snooze send the card's `changeFingerprint`, so it comes back when it changes. A step stays
 *   shown until a feed fetched after it lands. It also patches the feed's cache, which the nav's
 *   Inbox count reads (`needs-you.ts`), so the count moves with it; a failed step puts the item back.
 * - Routing (U133, `routing-model.ts`): claim and transfer patch the card's owner in the cache at
 *   once; withdraw ends the request for everyone and drops it once the server agrees. When someone
 *   else was first, the toast says who and the feed is read again.
 * - For you's receipts, read only while For you is open, each with its own dismiss.
 * - Your tasks for Updates in one read (`inbox/mine`), with read state and the inbox archive. The
 *   read is checked against who you are before it's kept, as the old Inbox checks it. Its context
 *   rows give a task behind a failed run its interruption, for Retry on Updates rows and on failed
 *   run alerts (`src/tasks/retry.tsx`); a source that failed is named above the rows.
 * - Cleared's archived tasks: the task list with them less the list without them, read only while
 *   Cleared is open. A restored task leaves at once and stays out past the server's 2s list cache.
 *
 * Every step refreshes the feed or the task list, and `sidebar-badges`, which other counts still read.
 */

type PendingEntry = Pending & { settledAt?: number };

/** How long the server keeps a compact task list (`ISSUE_LIST_SERVER_CACHE_TTL_MS`), plus a margin. */
const LIST_CACHE_MS = 2_500;

/** The task a feed item is about: its related task, or the subject when that's a task. */
export function itemTask(item: AttentionItem) {
  if (item.relatedIssue) return item.relatedIssue;
  return item.subject.kind === "issue" ? item.subject : null;
}

function itemTitleOf(item: AttentionItem) {
  return item.subject.title ?? itemTask(item)?.title ?? undefined;
}

export function useInbox(options: { people: TaskPeople; clearedOpen: () => boolean; receiptsOpen?: () => boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const companyId = () => company().id;

  const feed = useAttentionFeed();

  const [pending, setPending] = createSignal<ReadonlyMap<string, PendingEntry>>(new Map());
  const setStep = (id: string, step: PendingEntry | null) =>
    setPending((current) => {
      const next = new Map(current);
      if (step) next.set(id, step);
      else next.delete(id);
      return next;
    });
  /** Steps a feed hasn't caught up with: in flight, or settled after the feed was fetched. */
  const shownSteps = createMemo(() => {
    const fetchedAt = feed.dataUpdatedAt;
    return new Map([...pending()].filter(([, step]) => step.settledAt === undefined || step.settledAt >= fetchedAt));
  });
  const groups = createMemo(() => groupFeed(feed.data?.items ?? [], shownSteps()));

  const refreshFeed = () => {
    void client.invalidateQueries({ queryKey: queryKeys.inbox.attention(companyId()) });
    void client.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId()) });
  };

  /** Replaces one item in the cached feed; returns it as it was. */
  const patchItem = (id: string, change: (item: AttentionItem) => AttentionItem) => {
    let before: AttentionItem | undefined;
    client.setQueryData<AttentionFeed>(queryKeys.inbox.feed(companyId()), (current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => {
              if (item.id !== id) return item;
              before = item;
              return change(item);
            }),
          }
        : current,
    );
    return before;
  };

  const triage = createMutation(() => ({
    mutationFn: (input: { item: AttentionItem; step: Pending }): Promise<unknown> => {
      const key = input.item.dismissalKey;
      const fingerprint = input.item.changeFingerprint || null;
      if (input.step.action === "clear") return inboxApi.clear(companyId(), key, fingerprint);
      if (input.step.action === "snooze") return inboxApi.snooze(companyId(), key, input.step.until, fingerprint);
      return inboxApi.restore(companyId(), key);
    },
    onMutate: async (input) => {
      setStep(input.item.id, input.step);
      // A fetch already on its way would land without the step; the refresh after it brings it back.
      await client.cancelQueries({ queryKey: queryKeys.inbox.feed(companyId()) });
      const before = patchItem(input.item.id, (item) => withStep(item, input.step));
      return { before };
    },
    onSuccess: (_result, input) => {
      setStep(input.item.id, { ...input.step, settledAt: Date.now() });
      refreshFeed();
    },
    onError: (error: Error, input, context) => {
      setStep(input.item.id, null);
      if (context?.before) patchItem(input.item.id, () => context.before!);
      pushToast({ tone: "error", title: "Couldn't update the inbox", body: error.message });
    },
  }));

  const title = (item: AttentionItem) => itemTitleOf(item);

  const clear = (item: AttentionItem) => {
    triage.mutate({ item, step: { action: "clear" } });
    pushToast({
      dedupeKey: `inbox-clear-${item.id}`,
      title: "Archived for you",
      body: title(item),
      tone: "info",
      ttlMs: 8000,
      action: { label: "Undo", onClick: () => restore(item) },
    });
  };
  const snooze = (item: AttentionItem, until: Date) => {
    triage.mutate({ item, step: { action: "snooze", until: until.toISOString() } });
    pushToast({
      dedupeKey: `inbox-snooze-${item.id}`,
      title: `Snoozed. ${snoozeLabel(until.toISOString())}`,
      body: title(item),
      tone: "info",
      ttlMs: 8000,
      action: { label: "Undo", onClick: () => restore(item) },
    });
  };
  const restore = (item: AttentionItem) => triage.mutate({ item, step: { action: "restore" } });

  // Keep: off the aging shelf, back in Needs you.
  const keepStep = createMutation(() => ({
    mutationFn: (item: AttentionItem) => inboxApi.keep(companyId(), item.sourceKind, item.subject.id, true),
    onMutate: async (item: AttentionItem) => {
      await client.cancelQueries({ queryKey: queryKeys.inbox.feed(companyId()) });
      return { before: patchItem(item.id, (current) => ({ ...current, keep: true })) };
    },
    onSuccess: () => refreshFeed(),
    onError: (error: Error, item, context) => {
      if (context?.before) patchItem(item.id, () => context.before!);
      pushToast({ tone: "error", title: "Couldn't keep it", body: error.message });
    },
  }));
  const keep = (item: AttentionItem) => keepStep.mutate(item);

  // Routing: claim, transfer and withdraw (U133).
  const names = (id: string) => options.people.personName(id);
  const routeFailed = (title: string, error: Error) => {
    const closed = alreadyClosed(error);
    if (closed) {
      pushToast({ tone: "warn", title: alreadyClosedText(closed, options.people.youId(), names), body: "The inbox has been read again." });
      refreshFeed();
      return;
    }
    pushToast({ tone: "error", title, body: error.message });
  };
  const route = createMutation(() => ({
    mutationFn: (input: { item: AttentionItem; to: string | null }) =>
      input.to === null
        ? attentionApi.claim(companyId(), input.item.sourceKind, input.item.subject.id)
        : attentionApi.transfer(companyId(), input.item.sourceKind, input.item.subject.id, { userId: input.to }),
    onMutate: async (input: { item: AttentionItem; to: string | null }) => {
      await client.cancelQueries({ queryKey: queryKeys.inbox.feed(companyId()) });
      const you = options.people.youId();
      if (!you) return { before: undefined };
      const before = patchItem(input.item.id, (item) => (input.to === null ? withOwner(item, you, null) : withOwner(item, input.to, you)));
      return { before };
    },
    onSuccess: (_result: unknown, input: { item: AttentionItem; to: string | null }) => {
      refreshFeed();
      const title = itemTitleOf(input.item);
      if (input.to === null) pushToast({ tone: "success", title: "Claimed. It's in For you now.", body: title });
      else pushToast({ tone: "success", title: `Transferred to ${names(input.to)}`, body: title });
    },
    onError: (error: Error, input: { item: AttentionItem; to: string | null }, context: { before: AttentionItem | undefined } | undefined) => {
      if (context?.before) patchItem(input.item.id, () => context.before!);
      routeFailed(input.to === null ? "Couldn't claim it" : "Couldn't transfer it", error);
    },
  }));
  const claim = (item: AttentionItem) => route.mutate({ item, to: null });
  const transfer = (item: AttentionItem, userId: string) => route.mutate({ item, to: userId });

  const withdrawStep = createMutation(() => ({
    mutationFn: (input: { item: AttentionItem; reason: string }) =>
      attentionApi.close(companyId(), input.item.sourceKind, input.item.subject.id, { mode: "withdraw", reason: input.reason.trim() || null }),
    onSuccess: (_result: unknown, input: { item: AttentionItem; reason: string }) => {
      client.setQueryData<AttentionFeed>(queryKeys.inbox.feed(companyId()), (current) =>
        current ? { ...current, items: current.items.filter((item) => item.id !== input.item.id) } : current,
      );
      refreshFeed();
      void client.invalidateQueries({ queryKey: ["approvals", companyId()] });
      const task = itemTask(input.item);
      if (task) void client.invalidateQueries({ queryKey: queryKeys.issues.detail(task.id) });
      pushToast({ tone: "success", title: "Withdrawn for everyone", body: itemTitleOf(input.item) });
    },
    onError: (error: Error) => routeFailed("Couldn't withdraw it", error),
  }));
  /** Resolves true once withdrawn; false when it failed (the toast says why). */
  const withdraw = (item: AttentionItem, reason = "") =>
    withdrawStep.mutateAsync({ item, reason }).then(
      () => true,
      () => false,
    );

  /** The Close… menu's dialogs, drawn once by the page (`RouteDialogs` in InboxRouting.tsx). */
  const [dialog, setDialog] = createSignal<{ kind: "transfer" | "withdraw"; item: AttentionItem } | null>(null);

  // For you's receipts: what someone else did with a request that was yours.
  const receiptsQuery = createQuery(() => ({
    queryKey: queryKeys.inbox.receipts(companyId()),
    queryFn: ({ signal }) => attentionApi.receipts(companyId(), signal),
    enabled: options.receiptsOpen?.() ?? false,
    refetchOnWindowFocus: true,
  }));
  const [dismissedReceipts, setDismissedReceipts] = createSignal<ReadonlySet<string>>(new Set());
  const receipts = createMemo(() => liveReceipts(receiptsQuery.data?.receipts, dismissedReceipts()));
  const dismissReceipt = (receipt: AttentionReceipt) => {
    setDismissedReceipts((current) => new Set([...current, receipt.dismissalKey]));
    inboxApi.clear(companyId(), receipt.dismissalKey).then(
      () => void client.invalidateQueries({ queryKey: queryKeys.inbox.receipts(companyId()) }),
      (error: Error) => {
        setDismissedReceipts((current) => new Set([...current].filter((key) => key !== receipt.dismissalKey)));
        pushToast({ tone: "error", title: "Couldn't dismiss it", body: error.message });
      },
    );
  };

  // The cards' sources. Interactions are read per task, as the task's thread reads them.
  const interactionTaskIds = createMemo(() => [
    ...new Set(
      (feed.data?.items ?? []).flatMap((item) => (item.sourceKind === "issue_thread_interaction" && itemTask(item) ? [itemTask(item)!.id] : [])),
    ),
  ]);
  const approvalIds = createMemo(() => [...new Set((feed.data?.items ?? []).flatMap((item) => (item.sourceKind === "approval" ? [item.subject.id] : [])))]);
  const reviewTaskIds = createMemo(() => [
    ...new Set((feed.data?.items ?? []).flatMap((item) => (item.sourceKind === "review" && itemTask(item) ? [itemTask(item)!.id] : []))),
  ]);
  const reviews = useReviewTasks(reviewTaskIds);
  const decisionIds = createMemo(() => [...new Set((feed.data?.items ?? []).flatMap((item) => (item.sourceKind === "decision" ? [item.subject.id] : [])))]);
  const hasJoins = createMemo(() => (feed.data?.items ?? []).some((item) => item.sourceKind === "join_request"));
  const decisions = createQueries(() => ({
    queries: decisionIds().map((decisionId) => ({
      queryKey: queryKeys.decisions.detail(decisionId),
      queryFn: ({ signal }: { signal: AbortSignal }) => decisionsApi.get(decisionId, signal),
    })),
  }));
  // One list for every open proposal's changed targets.
  const openDecisions = createQuery(() => ({
    queryKey: queryKeys.decisions.open(companyId()),
    queryFn: ({ signal }) => decisionsApi.open(companyId(), signal),
    enabled: decisionIds().length > 0,
  }));
  const joins = createQuery(() => ({
    queryKey: queryKeys.companySettings.joinRequests(companyId()),
    queryFn: ({ signal }) => accessApi.joinRequests(companyId(), signal),
    enabled: hasJoins(),
  }));
  const interactions = createQueries(() => ({
    queries: interactionTaskIds().map((taskId) => ({
      queryKey: queryKeys.issues.section(taskId, "interactions"),
      queryFn: ({ signal }: { signal: AbortSignal }) => interactionsApi.list(taskId, signal),
    })),
  }));
  const approvals = createQueries(() => ({
    queries: approvalIds().map((approvalId) => ({
      queryKey: queryKeys.inbox.approval(companyId(), approvalId),
      queryFn: ({ signal }: { signal: AbortSignal }) => inboxApi.approval(approvalId, signal),
    })),
  }));

  // The feed leaves an approval's linked tasks out (`relatedIssue` is null), so they're read apart.
  const approvalTasks = createQueries(() => ({
    queries: approvalIds().map((approvalId) => ({
      queryKey: queryKeys.inbox.approvalIssues(companyId(), approvalId),
      queryFn: ({ signal }: { signal: AbortSignal }) => inboxApi.approvalIssues(approvalId, signal),
    })),
  }));
  const approvalTaskById = createMemo(() => {
    const result = new Map<string, AttentionSubject>();
    approvalIds().forEach((approvalId, index) => {
      const task = approvalTasks[index]?.data?.[0];
      if (!task) return;
      result.set(approvalId, {
        kind: "issue",
        id: task.id,
        companyId: task.companyId,
        title: task.title,
        identifier: task.identifier,
        status: task.status,
        href: null,
        metadata: { priority: task.priority, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId },
      });
    });
    return result;
  });
  /** The task an item is about, including an approval's first linked task. */
  const taskOf = (item: AttentionItem): AttentionSubject | null =>
    itemTask(item) ?? (item.sourceKind === "approval" ? (approvalTaskById().get(item.subject.id) ?? null) : null);

  /** Each item's request, once its card source has loaded. */
  const requests = createMemo(() => {
    const people = options.people;
    const interactionById = new Map(interactions.flatMap((query) => query.data ?? []).map((interaction) => [interaction.id, interaction] as const));
    const approvalById = new Map(approvals.flatMap((query) => (query.data ? [query.data] : [])).map((approval) => [approval.id, approval] as const));
    const decisionById = new Map(decisions.flatMap((query) => (query.data ? [query.data] : [])).map((decision) => [decision.id, decision] as const));
    const changedById = new Map((openDecisions.data ?? []).map((decision) => [decision.id, decision.targetChanged] as const));
    const joinById = new Map((joins.data ?? []).map((join) => [join.id, join] as const));
    const result = new Map<string, Request>();
    for (const item of feed.data?.items ?? []) {
      const task = taskOf(item);
      const ctx = {
        youId: people.youId(),
        agentName: (id: string) => people.agent(id)?.name,
        personName: (id: string) => people.personName(id),
        task: task ? { id: task.id, identifier: task.identifier, title: task.title ?? task.identifier ?? "" } : null,
      };
      if (item.sourceKind === "issue_thread_interaction") {
        const interaction = interactionById.get(item.subject.id);
        if (interaction) result.set(item.id, requestFromInteraction(interaction, ctx));
      } else if (item.sourceKind === "approval") {
        const approval = approvalById.get(item.subject.id);
        if (approval) result.set(item.id, requestFromApproval(approval, ctx));
      } else if (item.sourceKind === "decision") {
        const decision = decisionById.get(item.subject.id);
        if (decision) result.set(item.id, requestFromDecision(decision, ctx, changedById.get(decision.id) ?? null));
      } else if (item.sourceKind === "join_request") {
        const join = joinById.get(item.subject.id);
        if (join) result.set(item.id, requestFromJoin(join, ctx));
      } else if (item.sourceKind === "review" && task) {
        const reviewed = reviews.task(task.id);
        const stalled = item.subject.metadata?.reviewAttentionState === "stalled";
        if (reviewed) result.set(item.id, requestFromReview(reviewed, ctx, { stalled, whyNow: item.whyNow, since: item.activityAt }));
      }
    }
    return result;
  });
  /** Whether an item's card source failed to load, so it falls back to a plain row. */
  const sourceFailed = (item: AttentionItem) => {
    if (item.sourceKind === "approval") return approvals[approvalIds().indexOf(item.subject.id)]?.isError ?? false;
    if (item.sourceKind === "decision") return decisions[decisionIds().indexOf(item.subject.id)]?.isError ?? false;
    // Without the right to approve joins, the list fails; so does a request no longer pending.
    if (item.sourceKind === "join_request") return joins.isError || (!!joins.data && !joins.data.some((join) => join.id === item.subject.id));
    const task = itemTask(item);
    if (item.sourceKind === "review") return task ? reviews.failed(task.id) : false;
    return task ? (interactions[interactionTaskIds().indexOf(task.id)]?.isError ?? false) : false;
  };

  // Updates: your tasks, in one read. The rows are kept as an array (as the task lists are), so
  // read state, the archive and a retry patch them in place; the context and sources sit beside.
  const session = useSession();
  const tasks = createQuery(() => ({
    queryKey: queryKeys.inbox.tasks(companyId()),
    queryFn: async ({ signal }) => {
      const id = companyId();
      const snapshot = await inboxApi.mine(id, signal);
      const you = session.youId();
      if (you && snapshot.userId !== you) {
        void client.invalidateQueries({ queryKey: queryKeys.auth.session });
        throw new ApiError("Your account changed. Refresh the inbox.", 409, { error: "account_changed" });
      }
      const { rows, context, sources } = splitMine(snapshot);
      client.setQueryData(queryKeys.inbox.mineContext(id), context);
      client.setQueryData(queryKeys.inbox.mineSources(id), sources);
      return rows;
    },
  }));
  // Written by the read above, never fetched on their own.
  const mineContext = createQuery(() => ({
    queryKey: queryKeys.inbox.mineContext(companyId()),
    queryFn: () => client.getQueryData<CompactIssue[]>(queryKeys.inbox.mineContext(companyId())) ?? [],
    enabled: false,
  }));
  const mineSources = createQuery(() => ({
    queryKey: queryKeys.inbox.mineSources(companyId()),
    queryFn: () => client.getQueryData<MineSources>(queryKeys.inbox.mineSources(companyId())) ?? null,
    enabled: false,
  }));
  /** The rows to show: the last good ones through an outage, none after a refusal. */
  const rows = () => (!tasks.isError || keepsRowsOnError(tasks.error, !!tasks.data) ? tasks.data : undefined);
  const notices = createMemo(() => sourceNotices(mineSources.data ?? undefined));
  const retrySources = () => void tasks.refetch();

  const retry = useTaskRetry();
  /** A task's interruption, from its Updates row or the failure context; for Retry. */
  const interruptionFor = (taskId: string) => interruptionOf(taskId, tasks.data, mineContext.data);
  /** A task's display status (Monitoring), from its Updates row: the attention feed's subjects don't carry one. */
  const displayStatusFor = (taskId: string) => tasks.data?.find((task) => task.id === taskId)?.displayStatus ?? null;

  // Cleared: the archived tasks, as the task list with them less the one without them.
  const tasksUnarchived = createQuery(() => ({
    queryKey: queryKeys.inbox.tasksUnarchived(companyId()),
    queryFn: ({ signal }) => inboxApi.tasks(companyId(), signal),
    enabled: options.clearedOpen(),
  }));
  const tasksWithArchived = createQuery(() => ({
    queryKey: queryKeys.inbox.tasksWithArchived(companyId()),
    queryFn: ({ signal }) => inboxApi.tasksWithArchived(companyId(), signal),
    enabled: options.clearedOpen(),
  }));
  // Tasks restored here, kept out of the list until the server's lists say so.
  const [restoring, setRestoring] = createSignal<ReadonlySet<string>>(new Set());
  const dropRestoring = (ids: readonly string[]) => setRestoring((current) => new Set([...current].filter((id) => !ids.includes(id))));
  const archived = createMemo(() =>
    tasksUnarchived.data ? archivedTasks(tasksWithArchived.data ?? [], tasksUnarchived.data).filter((task) => !restoring().has(task.id)) : [],
  );

  const refreshTasks = () => {
    void client.invalidateQueries({ queryKey: ["issues", companyId(), "inbox"] });
    void client.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId()) });
  };
  /** Patches a task's read state in the list at once; the refetch confirms it. */
  const patchUnread = (ids: readonly string[], unread: boolean) =>
    client.setQueryData<CompactIssue[]>(queryKeys.inbox.tasks(companyId()), (current) =>
      current?.map((task) => (ids.includes(task.id) ? { ...task, isUnreadForMe: unread } : task)),
    );
  const taskStep = createMutation(() => ({
    mutationFn: (input: { action: "read" | "unread" | "archive" | "unarchive"; ids: readonly string[] }) =>
      Promise.all(
        input.ids.map((id) =>
          input.action === "read"
            ? inboxApi.markRead(id)
            : input.action === "unread"
              ? inboxApi.markUnread(id)
              : input.action === "archive"
                ? inboxApi.archive(id)
                : inboxApi.unarchive(id),
        ),
      ),
    onMutate: (input) => {
      if (input.action === "read" || input.action === "unread") patchUnread(input.ids, input.action === "unread");
      if (input.action === "archive") {
        client.setQueryData<CompactIssue[]>(queryKeys.inbox.tasks(companyId()), (current) => current?.filter((task) => !input.ids.includes(task.id)));
      }
      if (input.action === "unarchive") setRestoring((current) => new Set([...current, ...input.ids]));
    },
    onSuccess: (_result, input) => {
      // The server keeps a task list for 2s, so a list read straight after can still show it
      // archived: keep it out of Cleared until a read after that, then read again.
      if (input.action !== "unarchive") return;
      setTimeout(() => {
        void client.invalidateQueries({ queryKey: ["issues", companyId(), "inbox"] }).finally(() => dropRestoring(input.ids));
      }, LIST_CACHE_MS);
    },
    onSettled: refreshTasks,
    onError: (error: Error, input) => {
      if (input.action === "unarchive") dropRestoring(input.ids);
      pushToast({ tone: "error", title: "Couldn't update your tasks", body: error.message });
    },
  }));

  const markRead = (ids: readonly string[]) => ids.length > 0 && taskStep.mutate({ action: "read", ids });
  const markUnread = (id: string) => taskStep.mutate({ action: "unread", ids: [id] });
  const unarchive = (task: Pick<CompactIssue, "id">) => taskStep.mutate({ action: "unarchive", ids: [task.id] });
  const archive = (task: Pick<CompactIssue, "id" | "identifier" | "title">) => {
    taskStep.mutate({ action: "archive", ids: [task.id] });
    pushToast({
      dedupeKey: `inbox-archive-${task.id}`,
      title: "Archived from your inbox",
      body: task.identifier ? `${task.identifier} ${task.title}` : task.title,
      tone: "info",
      ttlMs: 8000,
      action: { label: "Undo", onClick: () => unarchive(task) },
    });
  };

  return {
    feed,
    groups,
    taskOf,
    pendingStep: (id: string) => shownSteps().get(id),
    requests,
    sourceFailed,
    clear,
    snooze,
    restore,
    keep,
    claim,
    transfer,
    withdraw,
    routing: () => route.isPending || withdrawStep.isPending,
    dialog,
    askTransfer: (item: AttentionItem) => setDialog({ kind: "transfer", item }),
    askWithdraw: (item: AttentionItem) => setDialog({ kind: "withdraw", item }),
    closeDialog: () => setDialog(null),
    receipts,
    receiptsQuery,
    dismissReceipt,
    refreshFeed,
    tasks,
    rows,
    mineContext,
    notices,
    retrySources,
    retry,
    interruptionFor,
    displayStatusFor,
    unread: () => unreadCount(rows()),
    tasksWithArchived,
    archived,
    markRead,
    markUnread,
    archive,
    unarchive,
  };
}

export type Inbox = ReturnType<typeof useInbox>;
