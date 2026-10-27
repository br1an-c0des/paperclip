import type { Project, ProjectIconName } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { ArrowRight, Check, ChevronDown } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { activeAgents } from "@/api/agents";
import { useAgentsQuery } from "@/lib/company-data";
import { ProjectTile } from "@/projects/NewProjectDialog";
import { TILE_COLORS, TILE_ICONS } from "@/projects/new-project";
import { AgentAvatar } from "@/ui/Avatar";
import { FieldButton, SettingsCard, SettingsRow, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { nameEdit, PROJECT_STATUS_OPTIONS, projectDescriptionEdit, projectGoalIds, targetDateEdit, targetDateValue } from "./settings-model";
import { CardNote, useProjectSaver } from "./shared";

/*
 * Details (board 10's first card): name, tile color and icon, description, status, lead and target
 * date. Changes save as you make them: text when the field loses focus (or on Enter for the name),
 * picks at once. The goals have their own section; this card links to it.
 */

function dateLabel(value: string | Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function DetailsSection(props: { project: Project; base: string }) {
  const saver = useProjectSaver(() => props.project);
  const agents = useAgentsQuery();
  const agentList = createMemo(() => activeAgents(agents.data));
  const lead = () => agentList().find((agent) => agent.id === props.project.leadAgentId);
  const status = () => PROJECT_STATUS_OPTIONS.find((option) => option.value === props.project.status) ?? PROJECT_STATUS_OPTIONS[0]!;

  const [name, setName] = createSignal(props.project.name);
  const [description, setDescription] = createSignal(props.project.description ?? "");
  const [dateProblem, setDateProblem] = createSignal<string | null>(null);
  const [tileOpen, setTileOpen] = createSignal(false);
  // The fields follow the saved values when they change elsewhere (another tab, a live event).
  createEffect(on(() => props.project.name, (value) => setName(value), { defer: true }));
  createEffect(on(() => props.project.description, (value) => setDescription(value ?? ""), { defer: true }));

  const saveName = async () => {
    const patch = nameEdit(props.project.name, name());
    if (!patch) return setName(props.project.name);
    // The URL key follows the name, so the page moves to the new address; the toast outlives that.
    if (await saver.save(patch)) pushToast({ tone: "success", title: `Renamed to ${patch.name as string}` });
  };
  const saveDate = (value: string) => {
    const patch = targetDateEdit(props.project.targetDate, value);
    if (patch === "invalid") return setDateProblem("That isn't a date.");
    setDateProblem(null);
    void saver.save(patch);
  };
  const goalCount = () => projectGoalIds(props.project).length;

  return (
    <SettingsCard
      title="Details"
      description={
        <CardNote state={saver.state()} error={saver.error()}>
          Changes save as you make them.
        </CardNote>
      }
      footer={
        <span class="ps-meta">
          Created {dateLabel(props.project.createdAt)} · Updated {dateLabel(props.project.updatedAt)}
        </span>
      }
    >
      <SettingsRow label="Name" for="ps-name">
        <TextInput
          id="ps-name"
          value={name()}
          autocomplete="off"
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={() => void saveName()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(props.project.name);
              event.currentTarget.blur();
            }
          }}
        />
      </SettingsRow>

      <SettingsRow label="Icon and color">
        <div class="ps-tile-row">
          <Popover open={tileOpen()} onOpenChange={setTileOpen}>
            <Popover.Trigger class="np-tile-button" aria-label="Change the icon and color">
              <ProjectTile name={props.project.name} color={props.project.color} icon={props.project.icon as ProjectIconName | null} size={40} />
              <span class="np-tile-caret" aria-hidden="true">
                <ChevronDown size={12} />
              </span>
            </Popover.Trigger>
            <Popover.Content label="Icon and color" width={344} hideClose class="np-tile-pop">
              <div class="lbl">Icon</div>
              <div class="np-icons ps-icons" role="radiogroup" aria-label="Project icon">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!props.project.icon}
                  aria-label="First letter"
                  class="np-icon"
                  onClick={() => void saver.save(props.project.icon ? { icon: null } : null)}
                >
                  <ProjectTile name={props.project.name} color={props.project.color} icon={null} size={28} />
                </button>
                <For each={TILE_ICONS}>
                  {(icon) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={props.project.icon === icon.value}
                      aria-label={icon.label}
                      class="np-icon"
                      onClick={() => void saver.save(props.project.icon === icon.value ? null : { icon: icon.value })}
                    >
                      <ProjectTile name={props.project.name} color={props.project.color} icon={icon.value} size={28} />
                    </button>
                  )}
                </For>
              </div>
            </Popover.Content>
          </Popover>
          <div class="np-colors ps-colors" role="radiogroup" aria-label="Project color">
            <For each={TILE_COLORS}>
              {(color) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={(props.project.color ?? "").toLowerCase() === color.stops[0].toLowerCase()}
                  aria-label={color.name}
                  class="np-color"
                  style={{ background: `linear-gradient(160deg, ${color.stops[0]}, ${color.stops[1]})` }}
                  onClick={() => void saver.save((props.project.color ?? "").toLowerCase() === color.stops[0].toLowerCase() ? null : { color: color.stops[0] })}
                />
              )}
            </For>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow label="Description" help="Agents read this as context for every task in the project." for="ps-description">
        <TextArea
          id="ps-description"
          rows={5}
          value={description()}
          placeholder="What this project is for."
          onInput={(event) => setDescription(event.currentTarget.value)}
          onBlur={() => void saver.save(projectDescriptionEdit(props.project.description, description()))}
        />
      </SettingsRow>

      <SettingsRow label="Status">
        <Menu>
          <Menu.Trigger
            as={FieldButton}
            class="ps-field-280"
            aria-label={`Status: ${status().label}`}
            icon={<Capsule gradient={status().gradient} size="tiny" live={props.project.status === "in_progress"} />}
          >
            {status().label}
          </Menu.Trigger>
          <Menu.Content label="Status" width={240}>
            <For each={PROJECT_STATUS_OPTIONS}>
              {(option) => (
                <Menu.Item
                  onSelect={() => void saver.save(option.value === props.project.status ? null : { status: option.value })}
                  icon={<Capsule gradient={option.gradient} size="row" />}
                  hint={option.value === props.project.status ? <Check size={14} /> : undefined}
                >
                  {option.label}
                </Menu.Item>
              )}
            </For>
          </Menu.Content>
        </Menu>
      </SettingsRow>

      <SettingsRow label="Lead" help="The agent who looks after the project.">
        <Menu>
          <Menu.Trigger
            as={FieldButton}
            class="ps-field-360"
            aria-label={`Lead: ${lead()?.name ?? "No lead"}`}
            icon={<Show when={lead()}>{(agent) => <AgentAvatar agent={agent()} size={20} ring={false} />}</Show>}
          >
            {lead()?.name ?? "No lead"}
          </Menu.Trigger>
          <Menu.Content label="Lead" width={280}>
            <For each={agentList()} fallback={<p class="nt-menu-note">This company has no agents yet.</p>}>
              {(agent) => (
                <Menu.Item
                  onSelect={() => void saver.save(agent.id === props.project.leadAgentId ? null : { leadAgentId: agent.id })}
                  icon={<AgentAvatar agent={agent} size={24} ring={false} />}
                  hint={agent.id === props.project.leadAgentId ? <Check size={14} /> : undefined}
                >
                  {agent.name}
                </Menu.Item>
              )}
            </For>
            <Menu.Separator />
            <Menu.Item
              onSelect={() => void saver.save(props.project.leadAgentId ? { leadAgentId: null } : null)}
              hint={props.project.leadAgentId ? undefined : <Check size={14} />}
            >
              No lead
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </SettingsRow>

      <SettingsRow label="Target date" for="ps-target">
        <div class="ps-inline">
          <TextInput
            id="ps-target"
            type="date"
            class="ps-field-220"
            value={targetDateValue(props.project.targetDate)}
            invalid={Boolean(dateProblem())}
            onChange={(event) => saveDate(event.currentTarget.value)}
          />
          <Show when={props.project.targetDate}>
            <button type="button" class="ps-link" onClick={() => saveDate("")}>
              Clear
            </button>
          </Show>
          <Show when={dateProblem()}>
            <span class="field-error" role="alert">
              {dateProblem()}
            </span>
          </Show>
        </div>
      </SettingsRow>

      <SettingsRow label="Goals" help="Why this project exists.">
        <A class="ps-goals-link" href={`${props.base}/goals`}>
          {goalCount() === 0 ? "No goals yet" : goalCount() === 1 ? "1 goal" : `${goalCount()} goals`}
          <span class="ps-link">
            Manage goals
            <ArrowRight size={13} aria-hidden="true" />
          </span>
        </A>
      </SettingsRow>
    </SettingsCard>
  );
}
