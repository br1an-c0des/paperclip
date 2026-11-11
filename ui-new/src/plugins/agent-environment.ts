import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { agentsApi } from "@/api/agents";
import { environmentsApi } from "@/api/environments";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { agentEnvironmentId, slotsForAgentEnvironment, type ResolvedPluginSlot } from "./model";

/*
 * Agent plugin tabs that follow the agent's environment (upstream #20657, build plan U114): a
 * `detailTab` slot for agents with `agentEnvironmentDriver` shows only when the agent's environment
 * (its own default, else the instance's) is that plugin's driver. Nothing is read unless a slot
 * asks: the agent (`GET /agents/:id`, shared with the agent page), the instance default when the
 * agent has none, and the company's environments. A read that fails hides the gated tabs, as the
 * old UI does.
 */
export function useAgentEnvironmentSlots(slots: () => ResolvedPluginSlot[], agentId: () => string | null | undefined) {
  const company = useCompany();
  const required = createMemo(() => slots().some((slot) => slot.agentEnvironmentDriver));
  const agent = createQuery(() => ({
    queryKey: queryKeys.agents.detail(agentId() ?? "pending"),
    queryFn: ({ signal }) => agentsApi.get(agentId()!, company().id, signal),
    enabled: required() && Boolean(agentId()),
  }));
  const config = () => (agent.data && agent.data.companyId === company().id && !agent.isError ? agent.data : undefined);
  const inherits = () => Boolean(config()) && config()!.defaultEnvironmentId == null;
  const instance = createQuery(() => ({
    queryKey: queryKeys.companySettings.instanceSettings,
    queryFn: instanceSettingsApi.settings,
    enabled: required() && inherits(),
  }));
  const environmentId = () => agentEnvironmentId(config(), inherits() ? (instance.isError ? null : instance.data?.defaultEnvironmentId) : null);
  const environments = createQuery(() => ({
    queryKey: queryKeys.projectSettings.environments(company().id),
    queryFn: ({ signal }) => environmentsApi.list(company().id, signal),
    enabled: required() && Boolean(environmentId()),
  }));
  const environment = () => {
    const id = environmentId();
    return id && !environments.isError ? environments.data?.find((entry) => entry.id === id) : undefined;
  };
  const filtered = createMemo(() => (required() ? slotsForAgentEnvironment(slots(), environment()) : slots()));
  const loading = () =>
    required() && Boolean(agentId()) && (agent.isPending || (inherits() && instance.isPending) || (Boolean(environmentId()) && environments.isPending));
  return { slots: filtered, loading };
}
