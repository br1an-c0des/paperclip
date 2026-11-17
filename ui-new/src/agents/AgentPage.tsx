import type { AgentDetail } from "@paperclipai/shared";
import { Navigate, useLocation, useNavigate, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, Match, Show, Switch } from "solid-js";
import { agentsApi, findAgent } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { addressWithSegment, rememberedId, rememberKey, type KeyMemory } from "@/lib/renamed-address";
import { ChatHeaderActions, ChatView, createChatControls } from "@/chat/ChatView";
import { RailLayout, SectionRail } from "@/ui/PageHeader";
import { useAgentEnvironmentSlots } from "@/plugins/agent-environment";
import { usePluginSlots } from "@/plugins/contributions";
import { isPluginTab, pluginTabValue } from "@/plugins/model";
import { PluginDetailTab } from "@/plugins/PluginSlot";
import { AgentHeader } from "./AgentHeader";
import { AGENT_SECTIONS, agentView, type AgentSectionKey } from "./agent-model";
import { AdvancedSection } from "./settings/AdvancedSection";
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
 * header card, with no tabs: its chat (board 12, src/chat/), which is where clicking an agent lands,
 * and its settings (board 26), reached with "Manage agent" and left with "Open chat". Settings
 * sections have their own addresses, using the old UI's tab names (`/instructions`,
 * `/configuration`, `/permissions?fromTask=…`) so its links keep working.
 *
 * Plugins' agent tabs (`detailTab` slots for agents) sit in the settings rail under "From plugins",
 * at the old UI's addresses, `/agents/:agentKey/plugin:<pluginKey>:<slotId>`. A tab that names an
 * `agentEnvironmentDriver` shows only when the agent's environment uses that plugin driver.
 */

/** Which agent each address key found this session, so a renamed agent keeps its pages. */
const agentKeys: KeyMemory = new Map();

export function AgentPage() {
  const params = useParams<{ agentKey: string; rest?: string }>();
  const company = useCompany();
  const agents = useAgentsQuery();
  const listed = createMemo(() => findAgent(agents.data, params.agentKey));
  // The address uses the agent's name (`urlKey`), which a rename changes. Once an address has
  // found an agent, its id stays in use for that address for the session (lib/renamed-address), so
  // a rename keeps the page, the effect below moves the address to the new name, and an older
  // history entry with the old name still opens the agent.
  const key = createMemo(() => {
    const found = listed();
    if (found) {
      rememberKey(agentKeys, params.agentKey, found.id, company().id);
      return found.id;
    }
    return rememberedId(agentKeys, params.agentKey, company().id) ?? params.agentKey;
  });
  const detail = createQuery(() => ({
    queryKey: queryKeys.agents.detail(key()),
    queryFn: ({ signal }) => agentsApi.get(key(), company().id, signal),
    enabled: agents.isSuccess || agents.isError,
    retry: false,
  }));
  const agent = createMemo(() => (detail.data?.companyId === company().id ? detail.data : undefined));
  const pluginTab = () => {
    const first = (params.rest ?? "").replace(/^\/+/, "").split("/")[0];
    return isPluginTab(first) ? first : null;
  };
  const view = createMemo(() => (pluginTab() ? ({ view: "settings", section: "profile" } as const) : agentView(params.rest ?? "")));
  const base = () => `/${company().issuePrefix}/agents/${agent()?.urlKey ?? params.agentKey}`;
  const chatControls = createChatControls();
  // An old tab name (`/configuration`, `/identity`, `/activity`…) moves to its section's own address,
  // keeping the query and fragment, so the rail marks where you are.
  const navigate = useNavigate();
  const location = useLocation();
  // A renamed agent: the old name no longer finds it in the list, so the address moves to the new one.
  createEffect(() => {
    const found = agent();
    if (!found || !agents.isSuccess || listed() || params.agentKey === found.id) return;
    // Only the name's segment changes, so a run's address (`/agents/:key/runs/:runId`) keeps its run.
    navigate(addressWithSegment(location, 2, found.urlKey), { replace: true });
  });
  createEffect(() => {
    const current = view();
    if (!agent() || pluginTab() || current?.view !== "settings") return;
    const first = (params.rest ?? "").replace(/^\/+|\/+$/g, "").split("/")[0];
    if (first !== current.section) navigate(`${base()}/${current.section}${location.search}${location.hash}`, { replace: true });
  });

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
              <AgentHeader
                agent={found()}
                base={base()}
                view={current().view}
                chatActions={<ChatHeaderActions controls={chatControls} />}
              />
              <Switch>
                <Match when={current().view === "chat"}>
                  <ChatView agent={found()} base={base()} controls={chatControls} />
                </Match>
                <Match when={current().view === "settings" && (current() as { section: AgentSectionKey }).section}>
                  {(section) => <AgentSettings agent={found()} base={base()} section={section()} pluginTab={pluginTab()} />}
                </Match>
              </Switch>
            </>
          )}
        </Show>
      )}
    </Show>
  );
}

function AgentSettings(props: { agent: AgentDetail; base: string; section: AgentSectionKey; pluginTab: string | null }) {
  const company = useCompany();
  const plugins = usePluginSlots(() => ({ slotTypes: ["detailTab"], entityType: "agent" }));
  // Tabs that need a plugin environment driver show only when the agent runs there (U114).
  const tabs = useAgentEnvironmentSlots(plugins.slots, () => props.agent.id);
  return (
    <RailLayout
      rail={
        <SectionRail
          label="Agent settings"
          entries={[
            ...AGENT_SECTIONS.map((entry) =>
              "heading" in entry
                ? entry
                : { label: entry.label, href: `${props.base}/${entry.key}` },
            ),
            ...(tabs.slots().length > 0 ? [{ heading: "From plugins" }] : []),
            ...tabs.slots().map((slot) => ({ label: slot.displayName, href: `${props.base}/${pluginTabValue(slot)}`, tag: "plugin" })),
          ]}
        />
      }
    >
      <Switch>
        <Match when={props.pluginTab}>
          {(tab) => (
            <PluginDetailTab
              slots={tabs.slots()}
              tab={tab()}
              loading={plugins.query.isLoading || tabs.loading()}
              context={{ companyId: company().id, companyPrefix: company().issuePrefix, entityId: props.agent.id, entityType: "agent" }}
            />
          )}
        </Match>
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
        <Match when={props.section === "advanced"}>
          <AdvancedSection agent={props.agent} />
        </Match>
      </Switch>
    </RailLayout>
  );
}
