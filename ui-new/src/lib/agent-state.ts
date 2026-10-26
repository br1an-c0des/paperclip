import type { Agent } from "@paperclipai/shared";
import type { LiveRun } from "@/api/heartbeats";

/*
 * What the nav and menus say an agent is doing (board 1's agent list): running when it has a live
 * run or its status says so, otherwise its status in plain words. Each state has a text tone, so
 * color is never the only signal.
 */

export type AgentState = { key: "running" | "idle" | "paused" | "error" | "pending"; label: string; tone: string };

const STATES: Record<AgentState["key"], AgentState> = {
  running: { key: "running", label: "running", tone: "var(--run-fg)" },
  idle: { key: "idle", label: "idle", tone: "var(--muted)" },
  paused: { key: "paused", label: "paused", tone: "var(--amber-fg)" },
  error: { key: "error", label: "error", tone: "var(--red-fg)" },
  pending: { key: "pending", label: "needs approval", tone: "var(--amber-fg)" },
};

/** Agent ids with a run in progress. Queued runs don't count as running. */
export function runningAgentIds(runs: readonly LiveRun[] | undefined) {
  return new Set((runs ?? []).filter((run) => run.status === "running").map((run) => run.agentId));
}

export function agentState(agent: Pick<Agent, "id" | "status">, running: ReadonlySet<string>): AgentState {
  if (running.has(agent.id) || agent.status === "running") return STATES.running;
  if (agent.status === "paused") return STATES.paused;
  if (agent.status === "error") return STATES.error;
  if (agent.status === "pending_approval") return STATES.pending;
  return STATES.idle;
}

/** Running agents first, then by name. */
export function sortAgentsForNav<T extends Pick<Agent, "id" | "name" | "status">>(agents: readonly T[], running: ReadonlySet<string>) {
  const isRunning = (agent: T) => agentState(agent, running).key === "running";
  return [...agents].sort(
    (a, b) => Number(isRunning(b)) - Number(isRunning(a)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
