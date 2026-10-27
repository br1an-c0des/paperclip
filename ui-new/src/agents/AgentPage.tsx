import type { AgentDetail } from "@paperclipai/shared";
import { A, Navigate, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { MessageCircle, SlidersHorizontal } from "lucide-solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import { agentsApi, findAgent } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { buttonClass } from "@/ui/Button";
import { RailLayout, SectionRail } from "@/ui/PageHeader";
import { AgentHeader } from "./AgentHeader";
import { AGENT_SECTIONS, agentView, runtimeIdentity, type AgentSectionKey } from "./agent-model";
import { BudgetSection } from "./settings/BudgetSection";
import { HistorySection } from "./settings/HistorySection";
import { InstructionsSection } from "./settings/InstructionsSection";
import { KeysSection } from "./settings/KeysSection";
import { MemorySection } from "./settings/MemorySection";
import { PermissionsSection } from "./settings/PermissionsSection";
import { ProfileSection } from "./settings/ProfileSection";
import { RuntimeSection } from "./settings/RuntimeSection";
import { SecretsSection } from "./settings/SecretsSection";
import { SkillsSection } from "./settings/SkillsSection";
import { ToolsSection } from "./settings/ToolsSection";
// The settings share the project settings' rows, lists and meters, and New task's small icon buttons.
import "@/projects/NewProjectDialog.css";
import "@/projects/settings/ProjectSettings.css";
import "@/tasks/NewTaskDialog.css";
import "./Agent.css";

/*
 * An agent's page (`/:prefix/agents/:agentKey/*`). The boards give an agent two views under one
 * header card, with no tabs: its chat (board 12), which is where clicking an agent lands, and its
 * settings (board 26), reached with "Manage agent" and left with "Open chat".
 *
 * The chat is the next slice of M5, so the agent's own address shows a short note in its place,
 * pointing to the settings. Settings sections have their own addresses, using the old UI's tab
 * names (`/instructions`, `/configuration`, `/permissions?fromTask=…`) so its links keep working.
 */

export function AgentPage() {
  const params = useParams<{ agentKey: string; rest?: string }>();
  const company = useCompany();
  const agents = useAgentsQuery();
  const listed = createMemo(() => findAgent(agents.data, params.agentKey));
  const key = () => listed()?.id ?? params.agentKey;
  const detail = createQuery(() => ({
    queryKey: queryKeys.agents.detail(key()),
    queryFn: ({ signal }) => agentsApi.get(key(), company().id, signal),
    enabled: agents.isSuccess || agents.isError,
    retry: false,
  }));
  const agent = createMemo(() => (detail.data?.companyId === company().id ? detail.data : undefined));
  const view = createMemo(() => agentView(params.rest ?? ""));
  const base = () => `/${company().issuePrefix}/agents/${agent()?.urlKey ?? params.agentKey}`;

  return (
    <Show
      when={agent()}
      fallback={
        <section class="card planned" role={detail.isError ? "alert" : "status"}>
          <Show when={detail.isError} fallback={<p class="cap">Loading the agent…</p>}>
            <p>There's no agent called “{params.agentKey}” in {company().name}, or you can't see it.</p>
          </Show>
        </section>
      }
    >
      {(found) => (
        <Show when={view()} fallback={<Navigate href={base()} />}>
          {(current) => (
            <>
              <AgentHeader agent={found()} base={base()} view={current().view} />
              <Switch>
                <Match when={current().view === "chat"}>
                  <ChatComingNext agent={found()} base={base()} />
                </Match>
                <Match when={current().view === "settings" && (current() as { section: AgentSectionKey }).section}>
                  {(section) => <AgentSettings agent={found()} base={base()} section={section()} />}
                </Match>
              </Switch>
            </>
          )}
        </Show>
      )}
    </Show>
  );
}

/** Board 12 is the agent's home; until the chat is built, this says so and points to the settings. */
function ChatComingNext(props: { agent: AgentDetail; base: string }) {
  return (
    <section class="card ag-chat-next">
      <span class="ag-chat-next-icon" aria-hidden="true">
        <MessageCircle size={20} />
      </span>
      <div>
        <p class="cap">Chat arrives in the next part of M5</p>
        <p>
          Clicking an agent will open one ongoing conversation with {props.agent.name} here, with what it's doing now beside it. Until then, its
          settings, sessions and spend are under Manage agent.
        </p>
        <div class="ag-chat-next-links">
          <A class={buttonClass({ size: "compact", variant: "primary" })} href={`${props.base}/profile`}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            Manage agent
          </A>
          <A class={buttonClass({ size: "compact" })} href={`${props.base}/runtime`}>
            {runtimeIdentity(props.agent).label}
          </A>
        </div>
      </div>
    </section>
  );
}

function AgentSettings(props: { agent: AgentDetail; base: string; section: AgentSectionKey }) {
  return (
    <RailLayout
      rail={
        <SectionRail
          label="Agent settings"
          entries={AGENT_SECTIONS.map((entry) =>
            "heading" in entry
              ? entry
              : { label: entry.label, href: `${props.base}/${entry.key}`, tag: entry.key === "tools" ? "outline" : undefined },
          )}
        />
      }
    >
      <Switch>
        <Match when={props.section === "profile"}>
          <ProfileSection agent={props.agent} base={props.base} />
        </Match>
        <Match when={props.section === "instructions"}>
          <InstructionsSection agent={props.agent} />
        </Match>
        <Match when={props.section === "memory"}>
          <MemorySection agent={props.agent} base={props.base} />
        </Match>
        <Match when={props.section === "skills"}>
          <SkillsSection agent={props.agent} />
        </Match>
        <Match when={props.section === "runtime"}>
          <RuntimeSection agent={props.agent} base={props.base} />
        </Match>
        <Match when={props.section === "tools"}>
          <ToolsSection agent={props.agent} />
        </Match>
        <Match when={props.section === "secrets"}>
          <SecretsSection agent={props.agent} />
        </Match>
        <Match when={props.section === "budget"}>
          <BudgetSection agent={props.agent} />
        </Match>
        <Match when={props.section === "permissions"}>
          <PermissionsSection agent={props.agent} />
        </Match>
        <Match when={props.section === "keys"}>
          <KeysSection agent={props.agent} />
        </Match>
        <Match when={props.section === "history"}>
          <HistorySection agent={props.agent} base={props.base} />
        </Match>
      </Switch>
    </RailLayout>
  );
}
