import type { ResourceMemberships } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Star } from "lucide-solid";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { resourceMembershipsApi } from "@/api/resource-memberships";
import { useCompany } from "@/lib/company";
import { buttonClass } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { applyAgentMembership, isAgentStarred } from "./star-model";
import "./AgentStar.css";

/*
 * Your starred agents (agents/membership): the star on an agent's page and roster row, and the
 * Starred group in the nav (layout/Nav.tsx). Personal: nobody else sees your stars. The star turns
 * at once and turns back if the server says no (star-model.ts has the rules).
 */

export function useAgentStars() {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.projectSettings.memberships(company().id);
  const memberships = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => resourceMembershipsApi.mine(company().id, signal),
    staleTime: 30_000,
    retry: false,
  }));
  const toggle = createMutation(() => ({
    mutationFn: (input: { agentId: string; name: string; starred: boolean }) =>
      agentsApi.updateMembership(company().id, input.agentId, { starred: input.starred }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key() });
      const previous = client.getQueryData<ResourceMemberships>(key());
      client.setQueryData<ResourceMemberships>(key(), (current) => applyAgentMembership(current, input.agentId, { starred: input.starred }));
      return { previous };
    },
    onError: (error, input, context) => {
      if (context?.previous) client.setQueryData(key(), context.previous);
      pushToast({ tone: "error", title: `Couldn't ${input.starred ? "star" : "unstar"} ${input.name}`, body: error instanceof Error ? error.message : undefined });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: key() }),
  }));
  return {
    memberships,
    starred: (agentId: string) => isAgentStarred(memberships.data, agentId),
    toggle: (agent: { id: string; name: string }) =>
      toggle.mutate({ agentId: agent.id, name: agent.name, starred: !isAgentStarred(memberships.data, agent.id) }),
  };
}

/** A star button: filled when the agent is in your nav's Starred group. */
export function AgentStarButton(props: { agent: { id: string; name: string }; size?: number }) {
  const stars = useAgentStars();
  const on = () => stars.starred(props.agent.id);
  return (
    <button
      type="button"
      class={`${buttonClass({ variant: "icon", size: "compact", ghost: true })} agent-star`}
      classList={{ "agent-star--on": on() }}
      aria-pressed={on()}
      aria-label={on() ? `Unstar ${props.agent.name}` : `Star ${props.agent.name}`}
      title={on() ? "Starred: it's in your nav. Click to unstar." : "Star: keep it in your nav"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        stars.toggle(props.agent);
      }}
    >
      <Star size={props.size ?? 15} aria-hidden="true" fill={on() ? "currentColor" : "none"} />
    </button>
  );
}
