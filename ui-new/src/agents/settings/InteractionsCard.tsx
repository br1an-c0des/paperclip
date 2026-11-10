import type { AgentDetail, AgentInteractionPermissionsPatch } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { CardNote, failure, SwitchRow, useAgentSaver } from "../shared";
import { deniedCount, interactionAllowed, interactionGroups, interactionOverridden, resetAllPatch, resetPatch, switchPatch } from "./interactions-model";
import "./Interactions.css";

/*
 * The Interactions card on the agent's Permissions page (U105, interactions-model.ts): eleven
 * switches for what the agent may do to other agents and their work, and what they may do to it,
 * each allowed by default. A switch saves at once; one the agent has its own setting for shows
 * "Set for this agent" and Reset, which puts the default back. Changing them takes a person who
 * can manage permissions (the server answers 403 otherwise, shown under the card's title).
 */

export function InteractionsCard(props: { agent: AgentDetail }) {
  const client = useQueryClient();
  const saver = useAgentSaver(() => props.agent);
  const state = createQuery(() => ({
    queryKey: queryKeys.agents.interactionPermissions(props.agent.id),
    queryFn: ({ signal }) => agentsApi.interactionPermissions(props.agent.id, signal),
    retry: false,
  }));
  const pendingHire = () => props.agent.status === "pending_approval";
  const disabled = () => saver.state() === "saving" || !state.data || pendingHire();
  const save = (patch: AgentInteractionPermissionsPatch, fallback: string) =>
    void saver.run(async () => {
      const next = await agentsApi.updateInteractionPermissions(props.agent.id, patch);
      client.setQueryData(queryKeys.agents.interactionPermissions(props.agent.id), next);
    }, fallback);
  const denied = () => deniedCount(state.data);
  const resetAll = () => resetAllPatch(state.data);

  return (
    <section id="interactions" class="ag-anchor">
      <SettingsCard
        title="Interactions"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            {pendingHire()
              ? "These can be set once the hire is approved."
              : denied() > 0
                ? `${denied()} of 11 turned off. Changes save at once.`
                : "Everything is allowed until you turn it off. Changes save at once."}
          </CardNote>
        }
        footer={
          resetAll() ? (
            <span class="ix-foot">
              <span class="fhelp">Switches set for this agent override the default.</span>
              <Button size="compact" variant="quiet" disabled={disabled()} onClick={() => save(resetAll()!, "Couldn't reset the interaction switches.")}>
                Reset all
              </Button>
            </span>
          ) : undefined
        }
      >
        <Show when={state.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the interaction switches. {failure(state.error, "")}{" "}
            <Button size="compact" variant="quiet" onClick={() => void state.refetch()}>
              Retry
            </Button>
          </p>
        </Show>
        <Show when={state.isPending}>
          <p class="ps-list-note">Loading…</p>
        </Show>
        <Show when={state.data}>
          <For each={interactionGroups(props.agent.name)}>
            {(group) => (
              <div class="ix-group" role="group" aria-label={group.title} data-direction={group.direction}>
                <h4 class="ix-group-title">{group.title}</h4>
                <For each={group.rows}>
                  {(row) => (
                    <SwitchRow
                      label={row.label}
                      help={row.help}
                      checked={interactionAllowed(state.data, row.key)}
                      disabled={disabled()}
                      onChange={(value) => save(switchPatch(row.key, value), `Couldn't change “${row.label}”.`)}
                    >
                      <Show when={interactionOverridden(state.data, row.key)}>
                        <span class="ix-override">
                          Set for this agent
                          <Button
                            size="compact"
                            variant="quiet"
                            disabled={disabled()}
                            aria-label={`Reset “${row.label}” to the default`}
                            onClick={() => save(resetPatch(row.key), `Couldn't reset “${row.label}”.`)}
                          >
                            Reset
                          </Button>
                        </span>
                      </Show>
                    </SwitchRow>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </SettingsCard>
    </section>
  );
}
