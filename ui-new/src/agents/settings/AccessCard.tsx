import type { AgentAccess, AgentAccessLevel, AgentDetail } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { Check } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, SettingsRow } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { CardNote, SwitchRow, useAgentSaver } from "../shared";
import {
  ACCESS_LEVELS,
  accessSummary,
  actionRows,
  defaultNote,
  LEVEL_WORDS,
  lowestLevel,
  overrideCount,
  storedAccess,
  withAction,
  withLevel,
  withoutOverride,
  type ActionRow,
} from "./access-model";
import "./Interactions.css";

/*
 * The Access card on the agent's Permissions page (step 4a, access-model.ts): the agent's level,
 * then each of the thirteen actions as a switch. A switch shows what the level gives; one set for
 * this agent says so and has Reset, which puts the level's default back. Delete tasks is in no
 * level, so it's off unless turned on here. Every change saves at once with the whole access
 * (`PATCH /agents/:id/permissions` `{ access }`); changing it takes a person who can manage agents.
 *
 * This replaces the Hire agents and Assign tasks switches (the `agents:create` and `tasks:assign`
 * rows) and the actor-side Interactions switches that became actions.
 */

type Group = { title: string; rows: ActionRow[] };

const GROUP_TITLES: Record<AgentAccessLevel | "none", string> = {
  read_only: "Every level",
  worker: "Worker and up",
  manager: "Manager and up",
  admin: "Admin",
  none: "Only set here",
};

function groups(access: AgentAccess): Group[] {
  const rows = actionRows(access);
  const keys: (AgentAccessLevel | "none")[] = [...ACCESS_LEVELS, "none"];
  return keys
    .map((key) => ({ title: GROUP_TITLES[key], rows: rows.filter((row) => (lowestLevel(row.action) ?? "none") === key) }))
    .filter((group) => group.rows.length > 0);
}

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
        <SettingsRow label="Level" info="Read only reads; worker works its own tasks; manager runs the board; admin also configures and hires agents and may call the whole API.">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-240" disabled={disabled()} aria-label={`Level: ${LEVEL_WORDS[level()].label}`}>
              {LEVEL_WORDS[level()].label}
            </Menu.Trigger>
            <Menu.Content label="Level" width={340}>
              <For each={ACCESS_LEVELS}>
                {(entry) => (
                  <Menu.Item
                    description={LEVEL_WORDS[entry].description}
                    hint={entry === level() ? <Check size={14} /> : undefined}
                    onSelect={() => entry !== level() && save(withLevel(access(), entry), "Couldn't change the level.")}
                  >
                    {LEVEL_WORDS[entry].label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </SettingsRow>
        <For each={groups(access())}>
          {(group) => (
            <div class="ix-group" role="group" aria-label={group.title}>
              <h4 class="ix-group-title">{group.title}</h4>
              <For each={group.rows}>
                {(row) => (
                  <SwitchRow
                    label={row.label}
                    info={row.help}
                    help={defaultNote(row, level())}
                    checked={row.allowed}
                    disabled={disabled()}
                    onChange={(value) => save(withAction(access(), row.action, value), `Couldn't change “${row.label}”.`)}
                  >
                    <Show when={row.override !== undefined}>
                      <span class="ix-override">
                        Set for this agent
                        <Button
                          size="compact"
                          variant="quiet"
                          disabled={disabled()}
                          aria-label={`Reset “${row.label}” to the level's default`}
                          onClick={() => save(withoutOverride(access(), row.action), `Couldn't reset “${row.label}”.`)}
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
      </SettingsCard>
    </section>
  );
}
