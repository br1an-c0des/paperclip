import type { AgentDetail } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { createMemo, For, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { SettingsCard } from "@/ui/Field";
import { TonePill } from "@/ui/Status";
import { failure, OutlineCard, SectionTitle } from "../shared";

/*
 * Tools and channels (board 30's outline). This slice lists what the agent's runs get, read-only,
 * from its effective tool profile: the connections installed for it and how many tools its profiles
 * allow. Installing and removing connections, tool policies, the tool-call decisions and chat
 * channels come later; the outline below says what this section will hold.
 */

const PURPOSE: Record<string, string> = { tool: "App or MCP server", channel: "Channel", ai: "AI connection" };

export function ToolsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const tools = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "effective-tools"),
    queryFn: ({ signal }) => agentsApi.effectiveTools(company().id, props.agent.id, signal),
    retry: false,
  }));
  const connections = createMemo(() => tools.data?.installedConnections ?? []);
  return (
    <>
      <SectionTitle title="Tools and channels">The apps and chat channels {props.agent.name} can use.</SectionTitle>
      <SettingsCard
        title="Installed for this agent"
        description={tools.data ? `${tools.data.allowedToolNames.length} tools allowed by ${tools.data.profiles.length === 1 ? "1 profile" : `${tools.data.profiles.length} profiles`}.` : undefined}
      >
        <Show when={tools.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the tools. {failure(tools.error, "")}
          </p>
        </Show>
        <ul class="ps-list">
          <For each={connections()} fallback={<Show when={tools.isSuccess}><li class="ps-list-note">No connections are installed for this agent.</li></Show>}>
            {(connection) => (
              <li class="ps-list-row">
                <span class="ps-list-name">
                  <b>{connection.name}</b>
                  <span class="ps-list-meta">{PURPOSE[connection.connectionPurpose] ?? connection.connectionPurpose}</span>
                </span>
                <TonePill tone={connection.enabled && (connection.status ?? "active") === "active" ? "green" : "amber"} compact>
                  {connection.enabled ? (connection.status ?? "active") : "disabled"}
                </TonePill>
              </li>
            )}
          </For>
        </ul>
      </SettingsCard>
      <OutlineCard
        rows={[
          { name: "Apps and MCP servers", text: "Connections the agent may use; add or remove them." },
          { name: "Tool profile", text: "Which tools a run gets, and the policies that apply." },
          { name: "Recent decisions", text: "Tool calls that were allowed, asked about, or blocked." },
          { name: "Channels", text: "Slack, GitHub and other chat channels connected to the agent." },
        ]}
        was="Tools, Channels"
        note="Changing these isn't built yet. This section will also hold:"
      />
    </>
  );
}
