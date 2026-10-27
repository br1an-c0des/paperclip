import type { Agent } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { issuesApi } from "@/api/issues";
import { orgApi } from "@/api/org";
import { queryKeys } from "@/api/queryKeys";
import { useNow } from "@/lib/clock";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useExperimentalSettingsQuery, useLiveRunsQuery } from "@/lib/company-data";
import {
  agentDetail,
  daysAgo,
  harnessAndModel,
  liveRunByAgent,
  monthSpendCents,
  orgState,
  runCountsByAgent,
  successRate,
  taskIndex,
  type AgentDetail,
  type OrgState,
  type RunCounts,
} from "./org-model";

/*
 * The data both organization pages read, from the caches the rest of the app shares where it can:
 * the agents list and live runs (the nav's), the company task list (All tasks' own query, so opening
 * either fills the other), and the org pages' own tree, recent runs, built-in agents and your
 * primary agent. The live events keep all of them fresh (lib/live-events.tsx).
 */

/** How far back the run counts go, as the boards draw them ("Runs, 14 days"). */
export const RUN_WINDOW_DAYS = 14;

/** One agent as the org pages show it. */
export type OrgAgent = {
  agent: Agent;
  state: OrgState;
  detail: AgentDetail;
  builtIn: boolean;
  primary: boolean;
  harness: string;
  model: string;
  runs: RunCounts;
  success: number | null;
  spendCents: number;
  budgetCents: number;
};

export function useOrgData() {
  const company = useCompany();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const experimental = useExperimentalSettingsQuery();
  const builtInEnabled = () => experimental.data?.enableBuiltInAgents === true;

  const tasks = createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, {}),
    queryFn: ({ signal }) => issuesApi.listAll(company().id, { includeBlockedBy: true, includeRoutineExecutions: true }, signal),
  }));
  const tree = createQuery(() => ({
    queryKey: queryKeys.org(company().id),
    queryFn: ({ signal }) => orgApi.tree(company().id, signal),
  }));
  const recentRuns = createQuery(() => ({
    queryKey: queryKeys.org.recentRuns(company().id),
    queryFn: ({ signal }) => orgApi.recentRuns(company().id, signal),
    staleTime: 30_000,
  }));
  const builtIns = createQuery(() => ({
    queryKey: queryKeys.org.builtInAgents(company().id),
    queryFn: ({ signal }) => orgApi.builtInAgents(company().id, signal),
    enabled: builtInEnabled(),
    retry: false,
  }));
  const primary = createQuery(() => ({
    queryKey: queryKeys.org.primaryAgent(company().id),
    queryFn: ({ signal }) => orgApi.primaryAgent(company().id, signal),
    retry: false,
    staleTime: 60_000,
  }));

  const live = createMemo(() => liveRunByAgent(liveRuns.data));
  const index = createMemo(() => taskIndex(tasks.data));
  const builtInIds = createMemo(
    () => new Set(builtInEnabled() ? (builtIns.data ?? []).flatMap((entry) => (entry.agentId ? [entry.agentId] : [])) : []),
  );
  /** Built-ins that exist but haven't been set up for this company. */
  const builtInsAvailable = createMemo(() => (builtInEnabled() ? (builtIns.data ?? []).filter((entry) => entry.status === "not_provisioned") : []));
  const runCounts = createMemo(() => runCountsByAgent(recentRuns.data, daysAgo(new Date(), RUN_WINDOW_DAYS)));

  /** Every agent but retired ones, with what the org pages say about it. */
  const rows = createMemo<OrgAgent[]>(() => {
    const now = new Date();
    const primaryId = primary.data?.primaryAgentId ?? null;
    return (agents.data ?? [])
      .filter((agent) => agent.status !== "terminated")
      .map((agent) => {
        const state = orgState(agent, live(), index());
        const runs = runCounts().get(agent.id) ?? { total: 0, succeeded: 0, failed: 0 };
        const labels = harnessAndModel(agent);
        return {
          agent,
          state,
          detail: agentDetail(agent, state, live(), index(), now),
          builtIn: builtInIds().has(agent.id),
          primary: agent.id === primaryId,
          harness: labels.harness,
          model: labels.model,
          runs,
          success: successRate(runs),
          spendCents: monthSpendCents(agent, now),
          budgetCents: agent.budgetMonthlyCents ?? 0,
        };
      });
  });
  const byId = createMemo(() => new Map(rows().map((row) => [row.agent.id, row])));

  /** A row's detail line at `now`, for labels that age ("18m", "Last run 2h ago"). */
  const detailAt = (row: OrgAgent, now: number) => agentDetail(row.agent, row.state, live(), index(), new Date(now));

  return { agents, liveRuns, tasks, tree, recentRuns, builtIns, builtInIds, builtInsAvailable, index, rows, byId, detailAt };
}

/**
 * The shared clock (lib/clock.ts) to the minute: labels like "18m" move on once a minute, and the
 * rows that read it don't re-render every second.
 */
export function useMinute() {
  const now = useNow();
  return createMemo(() => Math.floor(now() / 60_000) * 60_000);
}

export type OrgData = ReturnType<typeof useOrgData>;
