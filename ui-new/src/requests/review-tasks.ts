import { createQueries } from "@tanstack/solid-query";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";

/*
 * The tasks behind sign-off requests (`requestFromReview`): the attention feed names a task in
 * review, and its stages and current participant come from the task itself. Read with the task's
 * own detail query, so answering a sign-off (which refreshes the task) settles the card.
 */
export function useReviewTasks(taskIds: () => readonly string[]) {
  const queries = createQueries(() => ({
    queries: taskIds().map((taskId) => ({
      queryKey: queryKeys.issues.detail(taskId),
      queryFn: ({ signal }: { signal: AbortSignal }) => issuesApi.get(taskId, signal),
    })),
  }));
  const at = (taskId: string) => queries[taskIds().indexOf(taskId)];
  return {
    task: (taskId: string) => at(taskId)?.data,
    failed: (taskId: string) => at(taskId)?.isError ?? false,
    loading: () => queries.some((query) => query.isPending),
  };
}
