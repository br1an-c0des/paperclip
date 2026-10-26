import type { CompactIssue, IssueLabel } from "@paperclipai/shared";
import { useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useLabelsQuery } from "@/lib/company-data";
import { pushToast } from "@/ui/Toast";

/*
 * Changing tasks from the list: inline edits, bulk changes on a selection, drops between groups and
 * quick add. Changes show at once in every cached list and in the open task, and roll back with a
 * toast if the server refuses them; either way the lists are refetched afterwards.
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

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    void client.invalidateQueries({ queryKey: ["issues", "detail"] });
  };

  /** Applies each change, optimistically. Resolves with how many the server refused. */
  const update = async (changes: readonly TaskChange[]) => {
    const pending = changes.filter((change) => Object.keys(change.data).length > 0);
    if (pending.length === 0) return 0;
    const companyId = company().id;
    for (const { task, data } of pending) {
      patchCaches(client, companyId, new Set([task.id]), (cached) => applyUpdate(cached, data, labels.data));
    }
    const failures: { change: TaskChange; error: unknown }[] = [];
    await eachLimited(pending, async (change) => {
      try {
        await issuesApi.update(change.task.id, change.data);
      } catch (error) {
        failures.push({ change, error });
        // Put back the fields this change touched, as they were.
        const before = Object.fromEntries(Object.keys(change.data).map((key) => [key, (change.task as Record<string, unknown>)[key]]));
        if ("labelIds" in change.data) before.labels = change.task.labels;
        patchCaches(client, companyId, new Set([change.task.id]), (cached) => ({ ...cached, ...before }));
      }
    });
    refresh();
    const first = failures[0];
    if (first) {
      const reason = first.error instanceof Error ? first.error.message : String(first.error);
      pushToast({
        tone: "error",
        title: pending.length === 1 ? `Couldn't update ${refOf(first.change.task)}` : `${failures.length} of ${pending.length} tasks weren't updated`,
        body: reason,
      });
    } else if (pending.length > 1) {
      pushToast({ tone: "success", title: `Updated ${pending.length} tasks` });
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
