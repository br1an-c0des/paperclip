import { Sparkles } from "lucide-solid";
import { createMemo, For } from "solid-js";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { FieldButton } from "@/ui/Field";
import { Menu } from "@/ui/Menu";

/*
 * Who runs a card's setup and updates (after ui/src/pages/StatusCards/SummarizerAgentSelect.tsx):
 * the company's built-in Summarizer by default (`""`), or one of its agents. Agents that can take
 * tasks are offered: not terminated, not waiting for approval, and with a sound reporting line.
 */

export function AgentPicker(props: { value: string; onChange: (agentId: string) => void; id?: string; label?: string }) {
  const agents = useAgentsQuery();
  const candidates = createMemo(() =>
    (agents.data ?? []).filter((agent) => agent.status !== "terminated" && agent.status !== "pending_approval" && agent.orgChainHealth?.status !== "invalid_org_chain"),
  );
  const chosen = () => (props.value ? (agents.data ?? []).find((agent) => agent.id === props.value) : undefined);
  return (
    <Menu>
      <Menu.Trigger
        as={FieldButton}
        id={props.id}
        aria-label={props.label ?? "Agent"}
        icon={chosen() ? <AgentAvatar agent={chosen()!} size={20} /> : <Sparkles size={15} aria-hidden="true" />}
      >
        {chosen()?.name ?? (props.value ? "An agent that's gone" : "Summarizer (default)")}
      </Menu.Trigger>
      <Menu.Content label="Agent for this card" width={300}>
        <Menu.Item icon={<Sparkles size={16} />} description="The company's built-in agent for summaries" onSelect={() => props.onChange("")}>
          Summarizer (default)
        </Menu.Item>
        <Menu.Separator />
        <For each={candidates()} fallback={<p class="sc-menu-note muted">No agents to choose.</p>}>
          {(agent) => (
            <Menu.Item icon={<AgentAvatar agent={agent} size={24} />} hint={agent.id === props.value ? "Chosen" : undefined} onSelect={() => props.onChange(agent.id)}>
              {agent.name}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}
