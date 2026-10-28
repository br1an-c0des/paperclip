import type { Agent } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { budgetsApi } from "@/api/budgets";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { pushToast } from "@/ui/Toast";
import { mapBulk } from "./bulk-model";

/*
 * Lifecycle and reporting actions for one agent or a selection (board 20's toolbar, board 19's
 * inspector): pause, resume, run now, change manager and set the monthly budget. Each agent's
 * request stands alone; a toast says how many worked and names the ones that didn't.
 */

export type AgentAction = "pause" | "resume" | "wake" | "manager" | "budget";

/** Which of the agents an action applies to: you can't pause a paused agent, or run a pending hire. */
export function actionTargets<A extends Pick<Agent, "status">>(action: AgentAction, agents: readonly A[]) {
  if (action === "pause") return agents.filter((agent) => agent.status !== "paused" && agent.status !== "pending_approval");
  if (action === "resume") return agents.filter((agent) => agent.status === "paused");
  if (action === "wake") return agents.filter((agent) => agent.status !== "paused" && agent.status !== "pending_approval");
  return [...agents];
}

const DONE: Record<AgentAction, string> = {
  pause: "Paused",
  resume: "Resumed",
  wake: "Started a run for",
  manager: "Changed the manager of",
  budget: "Set the budget of",
};

const FAILED: Record<AgentAction, string> = {
  pause: "pause",
  resume: "resume",
  wake: "start a run for",
  manager: "change the manager of",
  budget: "set the budget of",
};

const LIFECYCLE_SETTLE_MS = 1_500;

function agentsWord(count: number) {
  return `${count} ${count === 1 ? "agent" : "agents"}`;
}

export function useAgentActions() {
  const company = useCompany();
  const client = useQueryClient();
  const [busy, setBusy] = createSignal<AgentAction | null>(null);

  const refresh = () => {
    const id = company().id;
    for (const key of [queryKeys.agents.list(id), queryKeys.org(id), queryKeys.liveRuns(id), queryKeys.workload.runs(id), queryKeys.dashboard(id), queryKeys.projectSettings.budgets(id)])
      void client.invalidateQueries({ queryKey: key });
  };

  /** Runs one request per agent; returns the ids that succeeded. */
  async function run(action: AgentAction, agents: readonly Agent[], send: (agent: Agent) => Promise<unknown>) {
    const targets = action === "manager" || action === "budget" ? [...agents] : actionTargets(action, agents);
    if (targets.length === 0) return [];
    setBusy(action);
    try {
      const results = await mapBulk(targets, send);
      const failed = results.flatMap((result, index) =>
        result.status === "rejected" ? [{ agent: targets[index]!, message: result.reason instanceof Error ? result.reason.message : "Something went wrong" }] : [],
      );
      const succeeded = targets.filter((_, index) => results[index]?.status === "fulfilled");
      if (succeeded.length > 0)
        pushToast({ tone: "success", title: `${DONE[action]} ${succeeded.length === 1 ? succeeded[0]!.name : agentsWord(succeeded.length)}` });
      if (failed.length > 0)
        pushToast({
          tone: "error",
          title: `Couldn't ${FAILED[action]} ${failed.length === 1 ? failed[0]!.agent.name : agentsWord(failed.length)}`,
          body: failed.map((entry) => `${entry.agent.name}: ${entry.message}`).join("\n"),
        });
      return succeeded.map((agent) => agent.id);
    } finally {
      setBusy(null);
      refresh();
      // Pause and resume finish after the request answers (the agent comes back still "pausing"),
      // so look again shortly; the live events usually get there first.
      if (action === "pause" || action === "resume") setTimeout(refresh, LIFECYCLE_SETTLE_MS);
    }
  }

  const companyId = () => company().id;
  return {
    busy,
    pause: (agents: readonly Agent[]) => run("pause", agents, (agent) => agentsApi.pause(agent.id, companyId())),
    resume: (agents: readonly Agent[]) => run("resume", agents, (agent) => agentsApi.resume(agent.id, companyId())),
    /** Starts a run now (`/heartbeat/invoke`), as the agent page's Run now and the old UI's do. */
    wake: (agents: readonly Agent[]) => run("wake", agents, (agent) => agentsApi.invoke(agent.id, companyId())),
    setManager: (agents: readonly Agent[], managerId: string | null) =>
      run("manager", agents, (agent) => agentsApi.update(agent.id, { reportsTo: managerId }, companyId())),
    /** Upserts each agent's monthly budget policy (billed cents, UTC calendar month); 0 turns it off. */
    setBudget: (agents: readonly Agent[], cents: number) =>
      run("budget", agents, (agent) =>
        budgetsApi.upsertPolicy(companyId(), {
          scopeType: "agent",
          scopeId: agent.id,
          metric: "billed_cents",
          windowKind: "calendar_month_utc",
          amount: cents,
        }),
      ),
  };
}

export type AgentActions = ReturnType<typeof useAgentActions>;
