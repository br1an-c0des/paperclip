import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, on } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { runsApi } from "@/api/runs";
import { WORKLOAD_RUN_LIMIT, workloadApi } from "@/api/workload";
import { useChatIndex } from "@/chat/chat-index";
import { useNow } from "@/lib/clock";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useExperimentalSettingsQuery, useLiveRunsQuery, useProjectsQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import type { WorkloadInput, WorkloadScope, WorkloadTask } from "./workload-model";

/*
 * The data agent workload reads, in one place for the project tab and the company page: the shared
 * agent, project and live-run lists, the company's run history, your chats (whose runs read "Chat"),
 * and the scope's tasks (passed in, since both pages already hold their task list).
 *
 * The history isn't on the live events' `heartbeats` key, which every run's progress refreshes;
 * it refetches when a run starts, queues or finishes, which changes the live list.
 *
 * Two clocks: `input().now` moves when the data does, which is enough for chains, open work and
 * the heatmap; `liveNow()` ticks every second while an agent is running, for today's lanes (the
 * live bar, busy time and the "now" line).
 */

export function useWorkload(props: { scope: () => WorkloadScope; tasks: () => readonly WorkloadTask[] | undefined }) {
  const company = useCompany();
  const client = useQueryClient();
  const session = useSession();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const liveRuns = useLiveRunsQuery();
  const experimental = useExperimentalSettingsQuery();
  const chats = useChatIndex();
  const runs = createQuery(() => ({
    queryKey: queryKeys.workload.runs(company().id),
    queryFn: ({ signal }) => runsApi.list(company().id, { limit: WORKLOAD_RUN_LIMIT, summary: true }, signal),
    staleTime: 30_000,
  }));
  const builtIn = createQuery(() => ({
    queryKey: queryKeys.workload.builtInAgents(company().id),
    queryFn: ({ signal }) => workloadApi.builtInAgentIds(company().id, signal),
    // The server only answers while the instance has built-in agents on (`enableBuiltInAgents`).
    enabled: props.scope().kind === "company" && experimental.data?.enableBuiltInAgents === true,
    staleTime: 5 * 60_000,
  }));

  const liveSignature = createMemo(() =>
    (liveRuns.data ?? [])
      .map((run) => `${run.id}:${run.status}`)
      .sort()
      .join(","),
  );
  createEffect(
    on(
      liveSignature,
      () => {
        void client.invalidateQueries({ queryKey: queryKeys.workload.runs(company().id) });
      },
      { defer: true },
    ),
  );

  const liveNow = useNow(() => (liveRuns.data ?? []).some((run) => run.status === "running"));
  const now = createMemo(() => {
    void runs.dataUpdatedAt;
    void liveRuns.dataUpdatedAt;
    void agents.dataUpdatedAt;
    return Date.now();
  });

  const input = createMemo<WorkloadInput>(() => ({
    scope: props.scope(),
    agents: agents.data ?? [],
    tasks: props.tasks() ?? [],
    runs: runs.data ?? [],
    runsTruncated: (runs.data?.length ?? 0) >= WORKLOAD_RUN_LIMIT,
    liveRuns: liveRuns.data ?? [],
    projects: projects.data ?? [],
    chatIds: chats.ids(),
    youId: session.youId(),
    now: now(),
  }));

  return {
    input,
    liveNow,
    agents,
    builtInIds: createMemo(() => new Set(builtIn.data ?? [])),
    ready: () => agents.isSuccess && runs.isSuccess && props.tasks() !== undefined,
    error: () => (runs.error ?? agents.error) as Error | null,
  };
}
