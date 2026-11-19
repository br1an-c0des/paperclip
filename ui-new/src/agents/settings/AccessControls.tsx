import type { AgentAccess, AgentAccessLevel } from "@paperclipai/shared";
import { Check } from "lucide-solid";
import { For, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { SwitchRow } from "../shared";
import { ACCESS_LEVELS, actionRows, defaultNote, LEVEL_WORDS, lowestLevel, withAction, withLevel, withoutOverride, type ActionRow } from "./access-model";
import "./Interactions.css";
import "../Agent.css";

/*
 * The level picker and the action switches an access (access-model.ts) is edited with: the agent's
 * Access card (AccessCard.tsx) and an outside connection's access (apps/assistant/
 * ConnectionAccess.tsx). Each change hands the whole new access to `onChange`, which saves it.
 */

type Group = { title: string; rows: ActionRow[] };

const GROUP_TITLES: Record<AgentAccessLevel | "none", string> = {
  read_only: "Every level",
  worker: "Worker and up",
  manager: "Manager and up",
  admin: "Admin",
  none: "Only set here",
};

/** The actions grouped by the lowest level that has them; override-only ones last. */
export function actionGroups(access: AgentAccess): Group[] {
  const rows = actionRows(access);
  const keys: (AgentAccessLevel | "none")[] = [...ACCESS_LEVELS, "none"];
  return keys
    .map((key) => ({ title: GROUP_TITLES[key], rows: rows.filter((row) => (lowestLevel(row.action) ?? "none") === key) }))
    .filter((group) => group.rows.length > 0);
}

/** A level menu, as a field button. Levels above `max` are listed but can't be picked. */
export function LevelMenu(props: { level: AgentAccessLevel; disabled?: boolean; max?: AgentAccessLevel; label?: string; onSelect: (level: AgentAccessLevel) => void }) {
  const allowed = (level: AgentAccessLevel) => !props.max || ACCESS_LEVELS.indexOf(level) <= ACCESS_LEVELS.indexOf(props.max);
  const name = () => props.label ?? "Level";
  return (
    <Menu>
      <Menu.Trigger as={FieldButton} class="ps-field-240" disabled={props.disabled} aria-label={`${name()}: ${LEVEL_WORDS[props.level].label}`}>
        {LEVEL_WORDS[props.level].label}
      </Menu.Trigger>
      <Menu.Content label={name()} width={340}>
        <For each={ACCESS_LEVELS}>
          {(entry) => (
            <Menu.Item
              description={LEVEL_WORDS[entry].description}
              disabled={!allowed(entry)}
              hint={entry === props.level ? <Check size={14} /> : undefined}
              onSelect={() => entry !== props.level && props.onSelect(entry)}
            >
              {LEVEL_WORDS[entry].label}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

/** The Level row: picking a level drops overrides it already gives (`withLevel`). */
export function LevelRow(props: { access: AgentAccess; disabled?: boolean; info?: string; onChange: (next: AgentAccess, fallback: string) => void }) {
  return (
    <SettingsRow
      label="Level"
      info={props.info ?? "Read only reads; worker works its own tasks; manager runs the board; admin also configures and hires agents and may call the whole API."}
    >
      <LevelMenu level={props.access.level} disabled={props.disabled} onSelect={(level) => props.onChange(withLevel(props.access, level), "Couldn't change the level.")} />
    </SettingsRow>
  );
}

/**
 * The thirteen actions as switches, grouped. A row says what the level gives; one with an override
 * is marked with `overrideLabel` ("Set for this agent") and has Reset.
 */
export function ActionGroups(props: { access: AgentAccess; disabled?: boolean; overrideLabel: string; onChange: (next: AgentAccess, fallback: string) => void }) {
  return (
    <For each={actionGroups(props.access)}>
      {(group) => (
        <div class="ix-group" role="group" aria-label={group.title}>
          <h4 class="ix-group-title">{group.title}</h4>
          <For each={group.rows}>
            {(row) => (
              <SwitchRow
                label={row.label}
                info={row.help}
                help={defaultNote(row, props.access.level)}
                checked={row.allowed}
                disabled={props.disabled}
                onChange={(value) => props.onChange(withAction(props.access, row.action, value), `Couldn't change “${row.label}”.`)}
              >
                <Show when={row.override !== undefined}>
                  <span class="ix-override">
                    {props.overrideLabel}
                    <Button
                      size="compact"
                      variant="quiet"
                      disabled={props.disabled}
                      aria-label={`Reset “${row.label}” to the level's default`}
                      onClick={() => props.onChange(withoutOverride(props.access, row.action), `Couldn't reset “${row.label}”.`)}
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
  );
}
