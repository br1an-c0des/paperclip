import { A } from "@solidjs/router";
import { AlertTriangle, Sparkles } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { BuiltInSetupDialog } from "@/agents/BuiltInSetup";
import { useCompany } from "@/lib/company";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { FieldButton } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { useCardAgentChecks } from "./agent-checks";
import { sortForCards, type CardAgentCheck } from "./card-agent-model";

/*
 * Who runs a card's setup and updates (after ui/src/pages/StatusCards/SummarizerAgentSelect.tsx):
 * the company's built-in Summarizer by default (`""`), or one of its agents. Agents that can take
 * tasks are offered (not retired, not waiting for approval, with a sound reporting line), the ones
 * that can write a card first (card-agent-model.ts). Each says why it can't, or what to watch for;
 * one that never can (a `process` agent) can't be picked.
 *
 * `AgentNotice` says the same of the chosen agent under the picker, with what to do about it.
 */

export function AgentPicker(props: { value: string; onChange: (agentId: string) => void; id?: string; label?: string }) {
  const checks = useCardAgentChecks();
  const candidates = createMemo(() =>
    sortForCards(
      (checks.agents.data ?? []).filter(
        (agent) => agent.status !== "terminated" && agent.status !== "pending_approval" && agent.orgChainHealth?.status !== "invalid_org_chain",
      ),
      checks.jwt(),
    ),
  );
  const chosen = () => (props.value ? (checks.agents.data ?? []).find((agent) => agent.id === props.value) : undefined);
  const summarizer = () => checks.check("");
  const hint = (check: CardAgentCheck) => (check.level === "warn" || check.level === "blocked" ? check.title : undefined);
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
      <Menu.Content label="Agent for this card" width={320}>
        <Menu.Item
          icon={<Sparkles size={16} />}
          description="The company's built-in agent for summaries"
          hint={props.value === "" ? "Chosen" : hint(summarizer())}
          onSelect={() => props.onChange("")}
        >
          Summarizer (default)
        </Menu.Item>
        <Menu.Separator />
        <For each={candidates()} fallback={<p class="sc-menu-note muted">No agents to choose.</p>}>
          {({ agent, check }) => (
            <Menu.Item
              icon={<AgentAvatar agent={agent} size={24} />}
              disabled={check.level === "blocked"}
              description={check.level === "blocked" ? check.title : undefined}
              hint={agent.id === props.value ? "Chosen" : check.level === "warn" ? check.title : undefined}
              onSelect={() => props.onChange(agent.id)}
            >
              {agent.name}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

/** What stands in the way of the chosen agent writing the card, and what to do; nothing when it can. */
export function AgentNotice(props: { agentId: string; check?: CardAgentCheck }) {
  const company = useCompany();
  const checks = useCardAgentChecks();
  const check = () => props.check ?? checks.check(props.agentId);
  const [settingUp, setSettingUp] = createSignal(false);
  const base = () => `/${company().issuePrefix}`;
  const agentHref = (id: string) => {
    const agent = checks.agents.data?.find((entry) => entry.id === id);
    return `${base()}/agents/${agent?.urlKey ?? id}`;
  };
  return (
    <Show when={check().level === "warn" || check().level === "blocked"}>
      <div class="sc-agent-notice" classList={{ "sc-agent-notice--blocked": check().level === "blocked" }} role={check().level === "blocked" ? "alert" : "status"}>
        <AlertTriangle size={15} aria-hidden="true" class="sc-agent-notice-icon" />
        <div class="sc-agent-notice-body">
          <b>{props.agentId ? check().title : `Summarizer: ${check().title.toLowerCase()}`}</b>
          <Show when={check().detail}>
            <span>{check().detail}</span>
          </Show>
          <Show when={check().action}>
            <span class="sc-agent-notice-actions">
              <Show when={check().action === "setup_summarizer" && checks.summarizer()}>
                <Button size="compact" onClick={() => setSettingUp(true)}>
                  Set up the Summarizer
                </Button>
              </Show>
              <Show when={check().action === "open_agent" && check().agentId}>
                {(id) => (
                  <A class="sc-agent-notice-link" href={agentHref(id())}>
                    Open {props.agentId ? "the agent" : "the Summarizer"}
                  </A>
                )}
              </Show>
              <Show when={check().action === "approve"}>
                <A class="sc-agent-notice-link" href={`${base()}/inbox`}>
                  Open the Inbox
                </A>
              </Show>
            </span>
          </Show>
        </div>
      </div>
      <Show when={settingUp() && checks.summarizer()}>
        {(state) => <BuiltInSetupDialog state={state()} onClose={() => setSettingUp(false)} />}
      </Show>
    </Show>
  );
}
