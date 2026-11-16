import type { CompactIssue, LiveEvent } from "@paperclipai/shared";
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/solid-query";
import { queryKeys } from "@/api/queryKeys";
import type { LiveViewer } from "@/lib/live-events";
import type { RecentTask } from "./nav-model";

/*
 * Subtasks under the nav's recent tasks (U167, after upstream #21649's RecentTaskGroup): the rules,
 * kept apart from the components so they can be tested.
 *
 * - A recent task with direct subtasks (`subtaskCount` from the summaries, `?navigation=true`)
 *   folds; it's folded until you unfold it, and the nav remembers what you unfolded, per company
 *   and person (nav-prefs.tsx `useRecentUnfolded`).
 * - An unfolded parent lists its subtasks, ten at a time (`RECENT_SUBTASK_PAGE_SIZE`), read only
 *   while it's unfolded. Another recent task that is one of them moves into the group (pinned there
 *   when it's past the first page), so nothing you opened lately is hidden. Folded, it's its own
 *   row again.
 * - At most three subtask reads run at once across the nav (`readRecentSubtasks`).
 * - Refreshes are bounded (`recentNavTargets`): an event refetches only the summary batches and the
 *   groups it names, never every group you unfolded.
 */

export const RECENT_SUBTASK_PAGE_SIZE = 10;

/** How many subtask reads may run at once; the others wait, and a cancelled one never starts. */
export const RECENT_SUBTASK_CONCURRENCY = 3;

/** Whether a recent task folds: the server says it has direct subtasks you can read. */
export function hasSubtasks(task: Pick<RecentTask, "subtaskCount">) {
  return (task.subtaskCount ?? 0) > 0;
}

export type RecentTree = {
  /** The rows the section lists, in recent order. */
  top: RecentTask[];
  /** Recent tasks shown inside an unfolded parent's group instead, by parent. */
  nested: ReadonlyMap<string, RecentTask[]>;
};

/**
 * Which recent tasks sit inside another's group: a task whose parent is a listed, unfolded recent
 * task with subtasks, and itself listed at the top (one level, as the group lists direct subtasks
 * only). A cycle in the parents (bad data) leaves its tasks as plain rows.
 */
export function recentTaskTree(entries: readonly RecentTask[], unfolded: ReadonlySet<string>): RecentTree {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const parentOf = (id: string) => {
    const parentId = byId.get(id)?.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    return parent && parent.id !== id && hasSubtasks(parent) && unfolded.has(parent.id) ? parent.id : null;
  };
  const nestedIn = new Map<string, string | null>();
  const cyclic = new Set<string>();
  const resolve = (start: string) => {
    // Walk up to a task already known, or the top; a task seen twice on the way is a cycle.
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | null = start;
    while (current && !nestedIn.has(current)) {
      if (seen.has(current)) {
        for (const id of path.slice(path.indexOf(current))) {
          nestedIn.set(id, null);
          cyclic.add(id);
        }
        break;
      }
      seen.add(current);
      path.push(current);
      current = parentOf(current);
    }
    for (const id of path.reverse()) {
      if (nestedIn.has(id)) continue;
      const parent = parentOf(id);
      // Only under a parent that is itself at the top, and not part of a cycle.
      nestedIn.set(id, parent && !cyclic.has(parent) && nestedIn.get(parent) === null ? parent : null);
    }
  };
  for (const entry of entries) resolve(entry.id);
  const nested = new Map<string, RecentTask[]>();
  const top: RecentTask[] = [];
  for (const entry of entries) {
    const parent = nestedIn.get(entry.id);
    if (parent) nested.set(parent, [...(nested.get(parent) ?? []), entry]);
    else top.push(entry);
  }
  return { top, nested };
}

/** Unfolds or folds a parent, keeping only parents still in your recent tasks. */
export function toggleUnfolded(list: readonly string[], id: string, recentIds: readonly string[]): string[] {
  const keep = new Set(recentIds);
  const next = list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  return next.filter((entry) => keep.has(entry));
}

export function parseUnfolded(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string").slice(0, 20) : [];
}

/** A row in a group: a subtask the server listed, or a recent task pinned there. */
export type SubtaskRow = Pick<CompactIssue, "id" | "identifier" | "title" | "status" | "displayStatus" | "blockerAttention" | "isUnreadForMe">;

export type SubtaskView = {
  rows: SubtaskRow[];
  /** Subtasks the group doesn't show yet, as the parent's count has them. */
  remaining: number;
  /** Unread subtasks among those. */
  hiddenUnread: number;
  /** More rows are loaded than shown, so Show more needn't wait for a page. */
  loadedHidden: boolean;
};

/**
 * What a group shows: the first page of subtasks (every loaded page after Show more), then any
 * recent task of the parent's not among them, which takes the last places of the first page.
 * Rows of another parent or company (a cache from before an account switch) are left out.
 */
export function subtaskView(input: {
  parentId: string;
  companyId: string;
  pages: readonly (readonly CompactIssue[])[] | undefined;
  pinned: readonly RecentTask[];
  showAll: boolean;
  count: number;
  unread: number;
}): SubtaskView {
  const loaded = new Map<string, SubtaskRow>();
  for (const page of input.pages ?? []) {
    for (const row of page) if (row.parentId === input.parentId && row.companyId === input.companyId && !loaded.has(row.id)) loaded.set(row.id, row);
  }
  const all = [...loaded.values()];
  let shown = input.showAll ? all : all.slice(0, RECENT_SUBTASK_PAGE_SIZE);
  const pinned = input.pinned.filter((task) => !shown.some((row) => row.id === task.id));
  if (!input.showAll && pinned.length > 0) shown = shown.slice(0, Math.max(0, RECENT_SUBTASK_PAGE_SIZE - pinned.length));
  const rows: SubtaskRow[] = [
    ...shown,
    ...pinned.map((task) => ({
      id: task.id,
      identifier: task.identifier,
      title: task.title,
      status: task.status,
      displayStatus: task.displayStatus ?? undefined,
      blockerAttention: task.blockerAttention,
      isUnreadForMe: task.isUnreadForMe,
    })),
  ];
  const shownIds = new Set(rows.map((row) => row.id));
  return {
    rows,
    remaining: Math.max(0, input.count - rows.length),
    hiddenUnread: Math.max(0, input.unread - rows.filter((row) => row.isUnreadForMe).length),
    loadedHidden: all.some((row) => !shownIds.has(row.id)),
  };
}

/** The next page starts after the last id of a full page. */
export function nextSubtaskPage(last: readonly CompactIssue[]): string | undefined {
  return last.length === RECENT_SUBTASK_PAGE_SIZE ? last.at(-1)?.id : undefined;
}

let active = 0;
const waiting = new Set<() => void>();

/**
 * Runs one subtask read when a place is free (at most `RECENT_SUBTASK_CONCURRENCY` at once, shared
 * by every group). A read cancelled while it waits (its group folded) never starts.
 */
export async function readRecentSubtasks<T>(signal: AbortSignal | undefined, read: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      waiting.delete(start);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    function start() {
      if (active >= RECENT_SUBTASK_CONCURRENCY) return;
      waiting.delete(start);
      signal?.removeEventListener("abort", abort);
      active++;
      resolve();
    }
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    waiting.add(start);
    start();
  });
  try {
    signal?.throwIfAborted();
    return await read();
  } finally {
    active--;
    for (const start of [...waiting]) {
      if (active >= RECENT_SUBTASK_CONCURRENCY) break;
      start();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Live refreshes

/**
 * The parents an event's task belongs to, now and before a move (`recentSubtaskParentIds`, which
 * the server adds for board viewers since upstream #21649, listing only parents you can read).
 * Undefined from a server that doesn't send them.
 */
export function parentHints(payload: Record<string, unknown> | undefined): string[] | undefined {
  const ids = payload?.recentSubtaskParentIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : undefined;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Actions that change who may see which tasks: every recent summary and group is read again from scratch. */
export function changesTaskAudience(action: string | null) {
  return (
    !!action &&
    (action.startsWith("issue_access_grant.") ||
      action.startsWith("resource_membership.") ||
      action.startsWith("company_membership.") ||
      action.startsWith("membership.") ||
      action.includes("privacy"))
  );
}

export const recentViewerKey = (userId: string | null | undefined) => userId ?? "anonymous";

type Targets = { reset: boolean; keys: QueryKey[] };

/**
 * The cached recent-task queries one task change affects (`issueId`, under `parents`):
 *
 * - Groups: a parent named, the task itself (its own subtasks), or a group whose loaded pages list
 *   the task. Only your own groups when `viewer` is given (a read mark is personal).
 * - Summary batches: one naming the task, one of the parents, or the task's parent as a batch
 *   already knows it. Without parent hints (an older server) every batch, as before.
 */
export function recentTaskTargets(
  client: QueryClient,
  companyId: string,
  issueId: string | null,
  parents: readonly string[] | undefined,
  viewer?: string,
): QueryKey[] {
  const keys: QueryKey[] = [];
  const named = new Set(parents ?? []);
  if (issueId) named.add(issueId);
  for (const query of client.getQueryCache().findAll({ queryKey: [...queryKeys.recentNav(companyId), "subtasks"] })) {
    const [, , , owner, parentId] = query.queryKey;
    if (viewer !== undefined && owner !== viewer) continue;
    const data = query.state.data as InfiniteData<CompactIssue[]> | undefined;
    const lists = !!issueId && !!data?.pages?.some((page) => Array.isArray(page) && page.some((row) => row.id === issueId));
    if (named.has(String(parentId)) || lists) keys.push(query.queryKey);
  }
  const batches = client.getQueryCache().findAll({ queryKey: [...queryKeys.recentNav(companyId), "summaries"] });
  if (!parents) return [...keys, ...batches.map((batch) => batch.queryKey)];
  const affected = new Set(named);
  for (const batch of batches) {
    const rows = batch.state.data;
    if (!Array.isArray(rows)) continue;
    for (const row of rows as { id?: unknown; parentId?: unknown }[]) {
      if (row.id === issueId && typeof row.parentId === "string") affected.add(row.parentId);
    }
  }
  for (const batch of batches) {
    if (batch.queryKey.slice(3).some((id) => affected.has(String(id)))) keys.push(batch.queryKey);
  }
  return keys;
}

/**
 * What a live event refreshes of the recent tasks: nothing for most events; the summary batches and
 * groups it names for a task's activity and a run's start or end; your own groups only for your read
 * marks (someone else's leave your unread counts alone); everything, from scratch, when who may see
 * what changed.
 */
export function recentNavTargets(client: QueryClient, companyId: string, event: LiveEvent, viewer: LiveViewer | undefined): Targets {
  const payload = event.payload ?? {};
  const none: Targets = { reset: false, keys: [] };
  if (event.type === "heartbeat.run.status" || event.type === "heartbeat.run.queued") {
    const issueId = readString(payload.issueId);
    const parents = parentHints(payload);
    // A run with no task changes no task.
    if (!issueId && !parents?.length) return none;
    return { reset: false, keys: recentTaskTargets(client, companyId, issueId, parents) };
  }
  if (event.type !== "activity.logged") return none;
  const action = readString(payload.action);
  if (changesTaskAudience(action)) return { reset: true, keys: [] };
  if (payload.entityType !== "issue" || action?.startsWith("issue.file_resource_")) return none;
  const entityId = readString(payload.entityId);
  const parents = parentHints(payload);
  if (action === "issue.read_marked" || action === "issue.read_unmarked") {
    const details = (payload.details ?? null) as Record<string, unknown> | null;
    const reader = readString(details?.userId) ?? (payload.actorType === "user" ? readString(payload.actorId) : null);
    if (!reader || reader !== viewer?.userId) return none;
    return { reset: false, keys: recentTaskTargets(client, companyId, entityId, parents ?? [], recentViewerKey(viewer.userId)) };
  }
  return { reset: false, keys: recentTaskTargets(client, companyId, entityId, parents) };
}

/** Refetches what `recentNavTargets` names; the keys come back for the trailing refetch. */
export function refreshRecentNav(client: QueryClient, companyId: string, event: LiveEvent, viewer: LiveViewer | undefined): QueryKey[] {
  const targets = recentNavTargets(client, companyId, event, viewer);
  if (targets.reset) {
    // Drop what was read under the old audience at once, so a task you lost doesn't linger.
    void client.resetQueries({ queryKey: queryKeys.recentNav(companyId) });
    return [];
  }
  for (const queryKey of targets.keys) void client.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false });
  return targets.keys;
}

/**
 * After you mark tasks read or unread here (the Inbox), their groups and batches, and their
 * parents', refresh: an authenticated socket's read events don't say who read.
 */
export function refreshRecentNavForTasks(client: QueryClient, companyId: string, tasks: readonly Pick<CompactIssue, "id" | "parentId">[], viewer: string | null) {
  const keys = new Map<string, QueryKey>();
  for (const task of tasks) {
    for (const key of recentTaskTargets(client, companyId, task.id, task.parentId ? [task.parentId] : [], recentViewerKey(viewer))) keys.set(JSON.stringify(key), key);
  }
  for (const queryKey of keys.values()) void client.invalidateQueries({ queryKey, exact: true });
}
