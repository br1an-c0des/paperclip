import type { AttentionItem, AttentionSubject, CompactIssue } from "@paperclipai/shared";
import { createMutation, createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import { inboxApi } from "@/api/inbox";
import { interactionsApi } from "@/api/interactions";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { requestFromApproval, requestFromInteraction, type Request } from "@/requests/request-model";
import type { TaskPeople } from "@/tasks/people";
import { pushToast } from "@/ui/Toast";
import { archivedTasks, groupFeed, snoozeLabel, unreadCount, type Pending } from "./inbox-model";

/*
 * The Inbox's data and triage (board 14):
 *
 * - The attention feed, whole and with your cleared and snoozed items, sorted into tabs.
 * - Each request's card source: a task's interactions (the same query as the task's thread, so an
 *   answer here shows there) and each approval by id.
 * - Clear, snooze and restore, shown at once and undone from the toast. A step stays shown until a
 *   feed fetched after it lands.
 * - Your tasks for Updates, with read state and the inbox archive.
 *
 * Every step refreshes the nav's counts (`sidebar-badges`) along with the feed or the task list.
 */

type PendingEntry = Pending & { settledAt?: number };

/** The task a feed item is about: its related task, or the subject when that's a task. */
export function itemTask(item: AttentionItem) {
  if (item.relatedIssue) return item.relatedIssue;
  return item.subject.kind === "issue" ? item.subject : null;
}

export function useInbox(options: { people: TaskPeople; clearedOpen: () => boolean }) {
  const company = useCompany();
  const client = useQueryClient();
  const companyId = () => company().id;

  const feed = createQuery(() => ({
    queryKey: queryKeys.inbox.feed(companyId()),
    queryFn: ({ signal }) => inboxApi.feed(companyId(), signal),
    refetchOnWindowFocus: true,
  }));

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

  const triage = createMutation(() => ({
    mutationFn: (input: { item: AttentionItem; step: Pending }): Promise<unknown> => {
      const key = input.item.dismissalKey;
      if (input.step.action === "clear") return inboxApi.clear(companyId(), key);
      if (input.step.action === "snooze") return inboxApi.snooze(companyId(), key, input.step.until);
      return inboxApi.restore(companyId(), key);
    },
    onMutate: (input) => setStep(input.item.id, input.step),
    onSuccess: (_result, input) => {
      setStep(input.item.id, { ...input.step, settledAt: Date.now() });
      refreshFeed();
    },
    onError: (error: Error, input) => {
      setStep(input.item.id, null);
      pushToast({ tone: "error", title: "Couldn't update the inbox", body: error.message });
    },
  }));

  const title = (item: AttentionItem) => item.subject.title ?? itemTask(item)?.title ?? undefined;

  const clear = (item: AttentionItem) => {
    triage.mutate({ item, step: { action: "clear" } });
    pushToast({
      dedupeKey: `inbox-clear-${item.id}`,
      title: "Cleared",
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

  // The cards' sources. Interactions are read per task, as the task's thread reads them.
  const interactionTaskIds = createMemo(() => [
    ...new Set(
      (feed.data?.items ?? []).flatMap((item) => (item.sourceKind === "issue_thread_interaction" && itemTask(item) ? [itemTask(item)!.id] : [])),
    ),
  ]);
  const approvalIds = createMemo(() => [...new Set((feed.data?.items ?? []).flatMap((item) => (item.sourceKind === "approval" ? [item.subject.id] : [])))]);
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
      }
    }
    return result;
  });
  /** Whether an item's card source failed to load, so it falls back to a plain row. */
  const sourceFailed = (item: AttentionItem) => {
    if (item.sourceKind === "approval") return approvals[approvalIds().indexOf(item.subject.id)]?.isError ?? false;
    const task = itemTask(item);
    return task ? (interactions[interactionTaskIds().indexOf(task.id)]?.isError ?? false) : false;
  };

  // Updates: your tasks.
  const tasks = createQuery(() => ({
    queryKey: queryKeys.inbox.tasks(companyId()),
    queryFn: ({ signal }) => inboxApi.tasks(companyId(), signal),
  }));
  const tasksWithArchived = createQuery(() => ({
    queryKey: queryKeys.inbox.tasksWithArchived(companyId()),
    queryFn: ({ signal }) => inboxApi.tasksWithArchived(companyId(), signal),
    enabled: options.clearedOpen(),
  }));
  const archived = createMemo(() => archivedTasks(tasksWithArchived.data ?? [], tasks.data ?? []));

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
    },
    onSettled: refreshTasks,
    onError: (error: Error) => pushToast({ tone: "error", title: "Couldn't update your tasks", body: error.message }),
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
    refreshFeed,
    tasks,
    unread: () => unreadCount(tasks.data),
    tasksWithArchived,
    archived,
    markRead,
    markUnread,
    archive,
    unarchive,
  };
}

export type Inbox = ReturnType<typeof useInbox>;
