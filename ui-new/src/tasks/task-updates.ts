import type { CompactIssue, IssueLabel } from "@paperclipai/shared";
import { useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLabelsQuery } from "@/lib/company-data";
import { LIST_CACHE_HOLD_MS } from "@/lib/live-events";
import { pushToast } from "@/ui/Toast";

/*
 * Changing tasks from the list: inline edits, bulk changes on a selection, drops between groups and
 * quick add. Changes show at once in every cached list and in the open task, and roll back with a
 * toast if the server refuses them; the lists are refetched once no change is still on its way.
 *
 * Changes still on their way are kept per task and laid over any task data that arrives meanwhile.
 * Without that, a refetch started by an earlier change (or by the live-events socket announcing
 * it) lands while a later change is still in flight, and snaps the field back to the earlier value.
 * The overlay also outlives the change by HOLD_MS: the server answers repeated task-list requests
 * from a 2-second cache that a write doesn't clear (ISSUE_LIST_SERVER_CACHE_TTL_MS in
 * server/src/routes/issues.ts), so a list fetched just after a change can still show the old value.
 * Once the hold is over the lists are fetched again.
 *
 * There's no bulk endpoint (the old UI has none either), so a change to several tasks is one PATCH
 * per task, a few at a time.
 */

export type TaskChange = { task: CompactIssue; data: Record<string, unknown> };

const CONCURRENCY = 4;

/** The task as it looks after the change, with label ids turned into the labels the list shows. */
export function applyUpdate<T extends Pick<CompactIssue, "labels">>(
  task: T,
  data: Record<string, unknown>,
  labels: readonly IssueLabel[] = [],
): T {
  const next = { ...task, ...data } as T;
  if (Array.isArray(data.labelIds)) {
    const byId = new Map([...labels, ...(task.labels ?? [])].map((label) => [label.id, label] as const));
    next.labels = (data.labelIds as string[]).flatMap((id) => {
      const label = byId.get(id);
      return label ? [label] : [];
    });
  }
  return next;
}

function patchCaches(client: QueryClient, companyId: string, ids: ReadonlySet<string>, change: <T extends CompactIssue>(task: T) => T) {
  client.setQueriesData<unknown>({ queryKey: queryKeys.issues.list(companyId) }, (old: unknown) => {
    if (!Array.isArray(old) || !old.some((item) => ids.has((item as { id?: string })?.id ?? ""))) return old;
    return old.map((item) => (ids.has((item as { id?: string })?.id ?? "") ? change(item as CompactIssue) : item));
  });
  client.setQueriesData<unknown>({ queryKey: ["issues", "detail"] }, (old: unknown) => {
    const task = old as CompactIssue | undefined;
    return task && ids.has(task.id) ? change(task) : old;
  });
}

/** Longer than the server's list cache lives, so a fetch after the hold sees the change. */
const HOLD_MS = LIST_CACHE_HOLD_MS;

/**
 * A task's changes in flight: the values they set, how many there are, and the last one's request.
 * Each change waits for the one before it, so the server gets them in the order they were made.
 * Once none is left in flight the values are held until `holdUntil`.
 */
type Pending = { companyId: string; data: Record<string, unknown>; count: number; last: Promise<unknown>; holdUntil: number };

/** Per query client: the changes in flight or held, by task id. */
const inFlight = new WeakMap<QueryClient, Map<string, Pending>>();

function expired(entry: Pending, now = Date.now()) {
  return entry.count === 0 && entry.holdUntil <= now;
}

function sameValue(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** True when the task doesn't show every value the change sets yet. */
export function lacks(task: unknown, data: Record<string, unknown>) {
  return Object.entries(data).some(([key, value]) => !sameValue((task as Record<string, unknown>)[key], value));
}

/** Watches the cache and lays the changes in flight or held over any task data that arrives. */
function watchCache(client: QueryClient) {
  const known = inFlight.get(client);
  if (known) return known;
  const pending = new Map<string, Pending>();
  inFlight.set(client, pending);
  client.getQueryCache().subscribe((event) => {
    // "success" is fetched or set data; "setState" is a cancelled fetch putting back older data.
    if (pending.size === 0 || event.type !== "updated") return;
    if (event.action.type !== "success" && event.action.type !== "setState") return;
    if (event.query.queryKey[0] !== "issues") return;
    const data = event.query.state.data as unknown;
    const items = (Array.isArray(data) ? data : [data]) as ({ id?: string } | undefined)[];
    for (const [id, entry] of pending) {
      if (expired(entry)) {
        pending.delete(id);
        continue;
      }
      if (!items.some((item) => item?.id === id && lacks(item, entry.data))) continue;
      const labels = client.getQueryData<IssueLabel[]>(queryKeys.issues.labels(entry.companyId));
      // Patching only what still lacks the values keeps this from setting data in a loop.
      patchCaches(client, entry.companyId, new Set([id]), (task) => (lacks(task, entry.data) ? applyUpdate(task, entry.data, labels) : task));
    }
  });
  return pending;
}

async function eachLimited<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

function refOf(task: CompactIssue) {
  return task.identifier ?? task.title;
}

export function useTaskUpdates() {
  const client = useQueryClient();
  const company = useCompany();
  const labels = useLabelsQuery();
  const pending = watchCache(client);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    void client.invalidateQueries({ queryKey: ["issues", "detail"] });
  };
  const inFlightCount = () => [...pending.values()].filter((entry) => entry.count > 0).length;
  // After the hold, drop the held values and fetch the lists again.
  let holdTimer: number | undefined;
  const refreshAfterHold = () => {
    window.clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      for (const [id, entry] of pending) if (expired(entry)) pending.delete(id);
      if (inFlightCount() === 0) refresh();
    }, HOLD_MS + 50);
  };

  const track = (companyId: string, id: string, data: Record<string, unknown>) => {
    const entry = pending.get(id) ?? { companyId, data: {}, count: 0, last: Promise.resolve(), holdUntil: 0 };
    entry.data = { ...entry.data, ...data };
    entry.count += 1;
    pending.set(id, entry);
  };
  /** Sends one change once the task's earlier changes are done. */
  const send = (id: string, data: Record<string, unknown>) => {
    const entry = pending.get(id)!;
    const request = entry.last.catch(() => undefined).then(() => issuesApi.update(id, data));
    entry.last = request;
    return request;
  };
  /** Ends one change. A key a later change also set stays pending with the later value. */
  const settle = (id: string, data: Record<string, unknown>, failed: boolean) => {
    const entry = pending.get(id);
    if (!entry) return;
    entry.count -= 1;
    if (failed) for (const key of Object.keys(data)) if (sameValue(entry.data[key], data[key])) delete entry.data[key];
    if (entry.count > 0) return;
    if (Object.keys(entry.data).length === 0) pending.delete(id);
    else entry.holdUntil = Date.now() + HOLD_MS;
  };

  /** Applies each change, optimistically. Resolves with how many the server refused. */
  const update = async (all: readonly TaskChange[]) => {
    const changes = all.filter((change) => Object.keys(change.data).length > 0);
    if (changes.length === 0) return 0;
    const companyId = company().id;
    for (const { task, data } of changes) track(companyId, task.id, data);
    // A refetch already on its way would land with old values: stop it first, since stopping one
    // puts back the data it started from. The lists are fetched again once every change settles.
    await Promise.all([
      client.cancelQueries({ queryKey: queryKeys.issues.list(companyId) }),
      client.cancelQueries({ queryKey: ["issues", "detail"] }),
    ]);
    for (const { task, data } of changes) {
      patchCaches(client, companyId, new Set([task.id]), (cached) => applyUpdate(cached, data, labels.data));
    }
    const failures: { change: TaskChange; error: unknown }[] = [];
    await eachLimited(changes, async (change) => {
      try {
        await send(change.task.id, change.data);
        settle(change.task.id, change.data, false);
      } catch (error) {
        failures.push({ change, error });
        settle(change.task.id, change.data, true);
        // Put back the fields this change touched, as they were, unless a later change set them.
        const later = pending.get(change.task.id)?.data ?? {};
        const keys = Object.keys(change.data).filter((key) => !(key in later));
        const before = Object.fromEntries(keys.map((key) => [key, (change.task as Record<string, unknown>)[key]]));
        if (keys.includes("labelIds")) before.labels = change.task.labels;
        patchCaches(client, companyId, new Set([change.task.id]), (cached) => ({ ...cached, ...before }));
      }
    });
    if (inFlightCount() === 0) {
      refresh();
      refreshAfterHold();
    }
    const first = failures[0];
    if (first) {
      const reason = first.error instanceof Error ? first.error.message : String(first.error);
      pushToast({
        tone: "error",
        title: changes.length === 1 ? `Couldn't update ${refOf(first.change.task)}` : `${failures.length} of ${changes.length} tasks weren't updated`,
        body: reason,
      });
    } else if (changes.length > 1) {
      pushToast({ tone: "success", title: `Updated ${changes.length} tasks` });
    }
    return failures.length;
  };

  /** Creates a task in this company. Throws if the server refuses it. */
  const create = async (data: Record<string, unknown>) => {
    const created = await issuesApi.create(company().id, data);
    refresh();
    return created;
  };

  return { update, create };
}

export type TaskUpdates = ReturnType<typeof useTaskUpdates>;
