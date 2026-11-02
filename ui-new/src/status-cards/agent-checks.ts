import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { useBuiltInAgents } from "@/agents/settings/BuiltInCard";
import { adaptersApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useAgentsQuery, useExperimentalSettingsQuery } from "@/lib/company-data";
import { agentCardCheck, harnessJwt, summarizerCardCheck, type CardAgentCheck } from "./card-agent-model";

/*
 * The data card-agent-model.ts reads: the company's agents, the Summarizer's built-in state (only
 * asked for while built-in agents are on; the routes answer 404 otherwise) and the harnesses'
 * capabilities (`GET /adapters`, which every board member may read; App settings' Harnesses
 * section shares the cache).
 */

export function useCardAgentChecks() {
  const agents = useAgentsQuery();
  const experimental = useExperimentalSettingsQuery();
  const builtIns = useBuiltInAgents();
  const adapters = createQuery(() => ({
    queryKey: queryKeys.instanceSettings.adapters,
    queryFn: ({ signal }) => adaptersApi.list(signal),
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const jwt = createMemo(() => harnessJwt(adapters.data));
  const summarizer = createMemo(() => builtIns.states()?.find((state) => state.definition.key === "summarizer"));

  /** The check for a card's agent: `""` (or null) for the default Summarizer. */
  const check = (agentId: string | null | undefined): CardAgentCheck => {
    if (!agentId) {
      const state = summarizer();
      // Built-in agents on, but their list failed: the server can't find a Summarizer either.
      const enabled = experimental.data ? experimental.data.enableBuiltInAgents === true && !builtIns.query.isError : undefined;
      const row = state?.agentId ? agents.data?.find((agent) => agent.id === state.agentId) : undefined;
      return summarizerCardCheck({ enabled, status: state?.status, agentId: state?.agentId }, row, jwt());
    }
    const agent = agents.data?.find((entry) => entry.id === agentId);
    if (!agent) return agents.data ? { level: "warn", title: "Agent gone", detail: "The card's agent no longer exists, so the Summarizer runs it instead. Choose another agent to change that." } : { level: "unknown", title: "Loading…" };
    return agentCardCheck(agent, jwt());
  };

  return { check, jwt, summarizer, agents };
}
