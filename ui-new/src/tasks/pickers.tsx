import type { IssuePriority, IssueStatus } from "@paperclipai/shared";
import { Check } from "lucide-solid";
import { For, Show } from "solid-js";
import { useLabelsQuery } from "@/lib/company-data";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Menu } from "@/ui/Menu";
import { PriorityBars, StatusCapsule } from "@/ui/Status";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { PRIORITY_ORDER, STATUS_PICK_ORDER } from "./list-model";
import type { TaskPeople } from "./people";
import "./pickers.css";

/*
 * The items of the menus that change a task's status, priority, assignee and labels. The list's
 * cells and the selection bar wrap them in their own triggers. A single task's current value gets a
 * check; across a selection there's none, since the tasks may differ.
 */

const picked = (on: boolean) => (on ? <Check size={14} aria-hidden="true" /> : undefined);

export function StatusItems(props: { current?: IssueStatus; onPick: (status: IssueStatus) => void }) {
  return (
    <For each={STATUS_PICK_ORDER}>
      {(status) => (
        <Menu.Item icon={<StatusCapsule status={status} size="row" />} hint={picked(props.current === status)} onSelect={() => props.onPick(status)}>
          {STATUS_META[status].label}
        </Menu.Item>
      )}
    </For>
  );
}

export function PriorityItems(props: { current?: IssuePriority; onPick: (priority: IssuePriority) => void }) {
  return (
    <For each={PRIORITY_ORDER}>
      {(priority) => (
        <Menu.Item icon={<PriorityBars priority={priority} />} hint={picked(props.current === priority)} onSelect={() => props.onPick(priority)}>
          {PRIORITY_META[priority].label}
        </Menu.Item>
      )}
    </For>
  );
}

export type AssigneePick = { agentId: string | null; userId: string | null };

/** You, then agents, then the company's other people, then Unassigned. `current` is an assignee key. */
export function AssigneeItems(props: { people: TaskPeople; current?: string; onPick: (pick: AssigneePick) => void }) {
  const you = () => props.people.youId();
  return (
    <>
      <Show when={you()}>
        {(id) => (
          <Menu.Item
            icon={<InitialsDisc name="You" seed={id()} size={20} you />}
            hint={picked(props.current === `user:${id()}`)}
            onSelect={() => props.onPick({ agentId: null, userId: id() })}
          >
            You
          </Menu.Item>
        )}
      </Show>
      <Show when={props.people.assignableAgents().length > 0}>
        <Menu.Group label="Agents">
          <For each={props.people.assignableAgents()}>
            {(agent) => (
              <Menu.Item
                icon={<AgentAvatar agent={agent} size={20} />}
                hint={picked(props.current === `agent:${agent.id}`)}
                onSelect={() => props.onPick({ agentId: agent.id, userId: null })}
              >
                {agent.name}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
      </Show>
      <Show when={props.people.otherPeople().length > 0}>
        <Menu.Group label="People">
          <For each={props.people.otherPeople()}>
            {(person) => (
              <Menu.Item
                icon={<InitialsDisc name={person.name} seed={person.id} size={20} />}
                hint={picked(props.current === `user:${person.id}`)}
                onSelect={() => props.onPick({ agentId: null, userId: person.id })}
              >
                {person.name}
              </Menu.Item>
            )}
          </For>
        </Menu.Group>
      </Show>
      <Menu.Separator />
      <Menu.Item
        icon={<span class="pick-none" aria-hidden="true" />}
        hint={picked(props.current === "none")}
        onSelect={() => props.onPick({ agentId: null, userId: null })}
      >
        Unassigned
      </Menu.Item>
    </>
  );
}

export function LabelDot(props: { color?: string | null }) {
  return (
    <i
      class="pick-dot"
      aria-hidden="true"
      style={{
        background: props.color ? `linear-gradient(135deg, ${props.color}, color-mix(in srgb, ${props.color} 70%, #000))` : "var(--g-ash)",
      }}
    />
  );
}

/** The company's labels as checkboxes. The menu stays open while labels are ticked. */
export function LabelItems(props: { checked: (id: string) => boolean; onChange: (id: string, checked: boolean) => void }) {
  const labels = useLabelsQuery();
  return (
    <Show when={(labels.data ?? []).length > 0} fallback={<Menu.Item disabled>No labels yet</Menu.Item>}>
      <For each={[...(labels.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}>
        {(label) => (
          <Menu.CheckboxItem icon={<LabelDot color={label.color} />} checked={props.checked(label.id)} onChange={(on) => props.onChange(label.id, on)}>
            {label.name}
          </Menu.CheckboxItem>
        )}
      </For>
    </Show>
  );
}
