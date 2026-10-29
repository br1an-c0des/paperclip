import type { QueryClient } from "@tanstack/solid-query";
import { createQuery } from "@tanstack/solid-query";
import { routinesApi } from "@/api/routines";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";

/*
 * The recurring-task queries the view, the panel and New task share, and where their links go.
 * Recurring tasks live in the task list (`/:prefix/issues?show=recurring`), with one open in the
 * panel by `?recurring=<id>`; the old `/routines` paths redirect there.
 */

export function useRoutinesQuery(projectId: () => string | undefined) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.routines.list(company().id, projectId()),
    queryFn: ({ signal }) => routinesApi.list(company().id, projectId() ? { projectId: projectId() } : {}, signal),
  }));
}

export function useRoutineFoldersQuery(enabled: () => boolean = () => true) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.routines.folders(company().id),
    queryFn: ({ signal }) => routinesApi.folders(company().id, signal),
    enabled: enabled(),
  }));
}

export function useRoutineQuery(routineId: () => string | null, options: { refetchInterval?: () => number | false } = {}) {
  return createQuery(() => ({
    queryKey: queryKeys.routines.detail(routineId() ?? ""),
    queryFn: ({ signal }) => routinesApi.get(routineId()!, signal),
    enabled: routineId() !== null,
    refetchInterval: options.refetchInterval?.() ?? false,
  }));
}

/** After a change: every routine query, and the task lists where its occurrences show. */
export function refreshRecurring(client: QueryClient, companyId: string, withTasks = false) {
  void client.invalidateQueries({ queryKey: queryKeys.routines.all });
  if (withTasks) void client.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
}

/** The Recurring view, optionally with one recurring task open (and a section of its panel). */
export function recurringPath(prefix: string, routineId?: string, section?: "runs" | "history" | "activity") {
  const params = new URLSearchParams({ show: "recurring" });
  if (routineId) params.set("recurring", routineId);
  if (section) params.set("section", section);
  return `/${prefix}/issues?${params.toString()}`;
}
