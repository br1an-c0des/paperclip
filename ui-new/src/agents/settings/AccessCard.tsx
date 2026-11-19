import type { AgentAccess, AgentDetail } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { CardNote, useAgentSaver } from "../shared";
import { ActionGroups, LevelRow } from "./AccessControls";
import { accessSummary, overrideCount, storedAccess } from "./access-model";

/*
 * The Access card on the agent's Permissions page (step 4a, access-model.ts): the agent's level,
 * then each of the thirteen actions as a switch. A switch shows what the level gives; one set for
 * this agent says so and has Reset, which puts the level's default back. Delete tasks is in no
 * level, so it's off unless turned on here. Every change saves at once with the whole access
 * (`PATCH /agents/:id/permissions` `{ access }`); changing it takes a person who can manage agents.
 *
 * This replaces the Hire agents and Assign tasks switches (the `agents:create` and `tasks:assign`
 * rows) and the actor-side Interactions switches that became actions. The level menu and the
 * switches are AccessControls.tsx, which outside connections share.
 */

export function AccessCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const saver = useAgentSaver(() => props.agent);
  const access = createMemo(() => storedAccess(props.agent.permissions));
  const pendingHire = () => props.agent.status === "pending_approval";
  const disabled = () => saver.state() === "saving" || pendingHire();
  const save = (next: AgentAccess, fallback: string) =>
    void saver.run(async () => {
      const saved = await agentsApi.updatePermissions(
        props.agent.id,
        { access: next, canCreateSkills: props.agent.permissions?.canCreateSkills !== false },
        company().id,
      );
      client.setQueryData(queryKeys.agents.detail(props.agent.id), saved);
    }, fallback);
  const level = () => access().level;

  return (
    <section id="access" class="ag-anchor">
      <SettingsCard
        title="Access"
        info="What it may do through Paperclip's tools and API. The level sets the defaults; a switch set for this agent overrides its level. Changes save at once."
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            {pendingHire() ? "This can be set once the hire is approved." : accessSummary(access())}
          </CardNote>
        }
        footer={
          overrideCount(access()) > 0 ? (
            <span class="ix-foot">
              <InfoTip label="About Reset all">Puts every action back to what the level gives.</InfoTip>
              <Button size="compact" variant="quiet" disabled={disabled()} onClick={() => save({ level: level() }, "Couldn't reset the actions.")}>
                Reset all
              </Button>
            </span>
          ) : undefined
        }
      >
        <LevelRow access={access()} disabled={disabled()} onChange={save} />
        <ActionGroups access={access()} disabled={disabled()} overrideLabel="Set for this agent" onChange={save} />
      </SettingsCard>
    </section>
  );
}
