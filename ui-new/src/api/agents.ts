import type { Agent } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Agents, as ui/src/api/agents.ts uses them. Only what the shell needs so far: the company's agents
 * for the nav, palette and assignee menus, and the model list for the new-task dialog's overrides
 * (decision 7).
 */

/** One entry in an adapter's model catalog. The type lives in the old UI, not the shared package. */
export type AdapterModel = { id: string; label: string };

export const agentsApi = {
  list: (companyId: string) => api.get<Agent[]>(`/companies/${companyId}/agents`),
  adapterModels: (companyId: string, adapterType: string) =>
    api.get<AdapterModel[]>(
      `/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(adapterType)}/models`,
    ),
};

/** Agents the board works with: everything except terminated ones. */
export function activeAgents(agents: readonly Agent[] | undefined) {
  return (agents ?? []).filter((agent) => agent.status !== "terminated");
}
