import type { CompanySearchFilterOptionCounts, CompanySearchSort, IssueLabel, IssueStatus, Project } from "@paperclipai/shared";
import { Check, ChevronDown, Info, ListFilter, X } from "lucide-solid";
import { createMemo, For, Match, Show, Switch, type JSX } from "solid-js";
import { LabelDot } from "@/tasks/pickers";
import { PRIORITY_ORDER } from "@/tasks/list-model";
import type { TaskPeople } from "@/tasks/people";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { PriorityBars, StatusCapsule } from "@/ui/Status";
import { STATUS_META, STATUS_ORDER } from "@/ui/status-meta";
import { Tooltip } from "@/ui/Tooltip";
import {
  assigneeName,
  isFilterOn,
  UPDATED_WINDOWS,
  type FilterChip,
  type FilterDimension,
  type FilterNames,
  type SearchFilters,
} from "./filters";
import { SEARCH_SORTS, SORT_LABELS } from "./search-url";

/*
 * The Search page's filter controls (boards S1 and S2): the chips for filters in force, the Filter
 * menu, the tip about typed filters, the sort menu, and the "Narrow tasks" column of facets with
 * their counts (the response's `filterOptionCounts`, each counting what the other filters leave).
 */

type Toggle = (dimension: FilterDimension, value: string) => void;

export function FilterChips(props: { chips: FilterChip[]; onRemove: (dimension: FilterDimension) => void }) {
  return (
    <For each={props.chips}>
      {(chip) => (
        <span class="sx-fchip">
          <span class="muted">{chip.label}</span>
          <b>{chip.value}</b>
          <button type="button" class="sx-fchip-x" aria-label={`Remove the ${chip.label.toLowerCase()} filter`} onClick={() => props.onRemove(chip.dimension)}>
            <X size={13} stroke-width={2.4} aria-hidden="true" />
          </button>
        </span>
      )}
    </For>
  );
}

export function TypedFiltersTip() {
  return (
    <Tooltip content="Or type them in the search box, like status:blocked, assignee:me or updated:7d.">
      {(trigger) => (
        <button {...trigger} type="button" class="sx-info" aria-label="Filters can also be typed, like status:blocked, assignee:me or updated:7d">
          <Info size={15} aria-hidden="true" />
        </button>
      )}
    </Tooltip>
  );
}

const count = (value: number | undefined) => (value ? String(value) : undefined);

/** The board's Filter menu: every kind of filter, each a set of ticks with its count. */
export function FilterMenu(props: {
  filters: SearchFilters;
  counts: CompanySearchFilterOptionCounts | undefined;
  people: TaskPeople;
  projects: readonly Project[];
  labels: readonly IssueLabel[];
  onToggle: Toggle;
}) {
  const item = (dimension: FilterDimension, value: string) => ({
    checked: isFilterOn(props.filters, dimension, value),
    onChange: () => props.onToggle(dimension, value),
  });
  return (
    <Menu>
      <Menu.Trigger as={Button} size="compact" class="sx-filter">
        <ListFilter size={14} aria-hidden="true" />
        Filter
      </Menu.Trigger>
      <Menu.Content label="Add a filter" width={290} class="sx-menu">
        <Menu.Group label="Status">
          <For each={STATUS_ORDER}>
            {(status) => (
              <Menu.CheckboxItem icon={<StatusCapsule status={status} size="row" />} hint={count(props.counts?.status[status])} {...item("status", status)}>
                {STATUS_META[status].label}
              </Menu.CheckboxItem>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group label="Priority">
          <For each={PRIORITY_ORDER}>
            {(priority) => (
              <Menu.CheckboxItem icon={<PriorityBars priority={priority} />} hint={count(props.counts?.priority[priority])} {...item("priority", priority)}>
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </Menu.CheckboxItem>
            )}
          </For>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group label="Assignee">
          <Show when={props.people.youId()}>
            {(id) => (
              <Menu.CheckboxItem
                icon={<InitialsDisc name="You" seed={id()} size={20} you />}
                hint={count(props.counts?.assigneeUserId[id()])}
                {...item("assignee", `user:${id()}`)}
              >
                You
              </Menu.CheckboxItem>
            )}
          </Show>
          <For each={props.people.assignableAgents()}>
            {(agent) => (
              <Menu.CheckboxItem
                icon={<AgentAvatar agent={agent} size={20} />}
                hint={count(props.counts?.assigneeAgentId[agent.id])}
                {...item("assignee", `agent:${agent.id}`)}
              >
                {agent.name}
              </Menu.CheckboxItem>
            )}
          </For>
          <For each={props.people.otherPeople()}>
            {(person) => (
              <Menu.CheckboxItem
                icon={<InitialsDisc name={person.name} seed={person.id} size={20} />}
                hint={count(props.counts?.assigneeUserId[person.id])}
                {...item("assignee", `user:${person.id}`)}
              >
                {person.name}
              </Menu.CheckboxItem>
            )}
          </For>
          <Menu.CheckboxItem icon={<span class="pick-none" aria-hidden="true" />} {...item("assignee", "none")}>
            Unassigned
          </Menu.CheckboxItem>
        </Menu.Group>
        <Show when={props.projects.length > 0}>
          <Menu.Separator />
          <Menu.Group label="Project">
            <For each={props.projects}>
              {(project) => (
                <Menu.CheckboxItem
                  icon={<LabelDot color={project.color} />}
                  hint={count(props.counts?.projectId[project.id])}
                  {...item("project", project.id)}
                >
                  {project.name}
                </Menu.CheckboxItem>
              )}
            </For>
          </Menu.Group>
        </Show>
        <Show when={props.labels.length > 0}>
          <Menu.Separator />
          <Menu.Group label="Label">
            <For each={props.labels}>
              {(label) => (
                <Menu.CheckboxItem icon={<LabelDot color={label.color} />} hint={count(props.counts?.labelId[label.id])} {...item("label", label.id)}>
                  {label.name}
                </Menu.CheckboxItem>
              )}
            </For>
          </Menu.Group>
        </Show>
        <Menu.Separator />
        <Menu.Group label="Updated">
          <For each={UPDATED_WINDOWS}>
            {(window) => (
              <Menu.CheckboxItem hint={count(props.counts?.updatedWithin[window.value])} {...item("updated", window.value)}>
                {window.label}
              </Menu.CheckboxItem>
            )}
          </For>
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

export function SortMenu(props: { sort: CompanySearchSort; onChange: (sort: CompanySearchSort) => void }) {
  return (
    <Menu placement="bottom-end">
      <Menu.Trigger as={Button} size="compact" class="sx-sort">
        <span class="muted">Sort</span>
        <b>{SORT_LABELS[props.sort]}</b>
        <ChevronDown size={14} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Sort results" width={220}>
        <For each={SEARCH_SORTS}>
          {(sort) => (
            <Menu.Item onSelect={() => props.onChange(sort)} hint={sort === props.sort ? <Check size={14} aria-hidden="true" /> : undefined}>
              {SORT_LABELS[sort]}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

type FacetOption = { value: string; label: string; count: number; mark?: JSX.Element };

function FacetGroup(props: { label: string; dimension: FilterDimension; options: FacetOption[]; filters: SearchFilters; onToggle: Toggle }) {
  return (
    <Show when={props.options.length > 0}>
      <div class="sx-facet" role="group" aria-label={props.label}>
        <span class="sx-facet-h">{props.label}</span>
        <For each={props.options}>
          {(option) => {
            const on = () => isFilterOn(props.filters, props.dimension, option.value);
            return (
              <button type="button" class="sx-facet-opt" role="checkbox" aria-checked={on()} onClick={() => props.onToggle(props.dimension, option.value)}>
                <span class="sx-tick" classList={{ "sx-tick--on": on() }} aria-hidden="true">
                  <Show when={on()}>
                    <Check size={11} stroke-width={3} />
                  </Show>
                </span>
                <Show when={option.mark}>{option.mark}</Show>
                <span class="sx-facet-label">{option.label}</span>
                <span class="sx-facet-n">{option.count}</span>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

/** Values with a count, plus any picked one, most first. */
function present(counts: Record<string, number> | undefined, picked: readonly string[]) {
  const values = new Set([...Object.keys(counts ?? {}).filter((key) => (counts?.[key] ?? 0) > 0), ...picked]);
  return [...values].sort((a, b) => (counts?.[b] ?? 0) - (counts?.[a] ?? 0));
}

/**
 * "Narrow tasks" (board S1's right column): status, assignee and updated, plus project and label
 * when the results span more than one. Only values that occur are listed.
 */
export function FacetColumn(props: {
  filters: SearchFilters;
  counts: CompanySearchFilterOptionCounts | undefined;
  names: FilterNames;
  people: TaskPeople;
  projects: readonly Project[];
  labels: readonly IssueLabel[];
  hasFilters: boolean;
  onToggle: Toggle;
  onClear: () => void;
}) {
  const status = createMemo<FacetOption[]>(() =>
    STATUS_ORDER.filter((value) => (props.counts?.status[value] ?? 0) > 0 || props.filters.status.includes(value)).map((value) => ({
      value,
      label: STATUS_META[value as IssueStatus].label,
      count: props.counts?.status[value] ?? 0,
      mark: <StatusCapsule status={value} size="tiny" />,
    })),
  );
  const assignee = createMemo<FacetOption[]>(() => {
    const picked = props.filters.assignee;
    const agents = present(props.counts?.assigneeAgentId, picked?.startsWith("agent:") ? [picked.slice(6)] : []);
    const users = present(props.counts?.assigneeUserId, picked?.startsWith("user:") ? [picked.slice(5)] : []);
    const options: FacetOption[] = [
      ...agents.map((id) => {
        const agent = props.people.agent(id);
        return {
          value: `agent:${id}`,
          label: assigneeName(`agent:${id}`, props.names),
          count: props.counts?.assigneeAgentId[id] ?? 0,
          mark: agent ? <AgentAvatar agent={agent} size={20} /> : <InitialsDisc name="?" seed={id} size={20} />,
        };
      }),
      ...users.map((id) => ({
        value: `user:${id}`,
        label: assigneeName(`user:${id}`, props.names),
        count: props.counts?.assigneeUserId[id] ?? 0,
        mark: <InitialsDisc name={assigneeName(`user:${id}`, props.names)} seed={id} size={20} you={id === props.names.youId} />,
      })),
    ];
    return options.sort((a, b) => b.count - a.count);
  });
  const projects = createMemo<FacetOption[]>(() => {
    const values = present(props.counts?.projectId, props.filters.projectId ? [props.filters.projectId] : []);
    if (values.length < 2 && !props.filters.projectId) return [];
    return values.map((id) => ({
      value: id,
      label: props.names.project(id) ?? "Unknown project",
      count: props.counts?.projectId[id] ?? 0,
      mark: <LabelDot color={props.projects.find((project) => project.id === id)?.color} />,
    }));
  });
  const labels = createMemo<FacetOption[]>(() =>
    present(props.counts?.labelId, props.filters.labelId ? [props.filters.labelId] : []).map((id) => ({
      value: id,
      label: props.names.label(id) ?? "Unknown label",
      count: props.counts?.labelId[id] ?? 0,
      mark: <LabelDot color={props.labels.find((label) => label.id === id)?.color} />,
    })),
  );
  const updated = createMemo<FacetOption[]>(() =>
    UPDATED_WINDOWS.filter((window) => (props.counts?.updatedWithin[window.value] ?? 0) > 0 || props.filters.updated === window.value).map((window) => ({
      value: window.value,
      label: window.label,
      count: props.counts?.updatedWithin[window.value] ?? 0,
    })),
  );
  return (
    <aside class="card sx-facets" aria-labelledby="sx-facets-h">
      <div class="sx-facets-head">
        <h2 id="sx-facets-h" class="disp">
          Narrow tasks
        </h2>
        <Show when={props.hasFilters}>
          <Button ghost size="compact" onClick={props.onClear}>
            Clear
          </Button>
        </Show>
      </div>
      <Switch>
        <Match when={status().length + assignee().length + updated().length === 0}>
          <p class="sx-facets-none">No tasks to narrow.</p>
        </Match>
        <Match when={true}>
          <FacetGroup label="Status" dimension="status" options={status()} filters={props.filters} onToggle={props.onToggle} />
          <FacetGroup label="Assignee" dimension="assignee" options={assignee()} filters={props.filters} onToggle={props.onToggle} />
          <FacetGroup label="Project" dimension="project" options={projects()} filters={props.filters} onToggle={props.onToggle} />
          <FacetGroup label="Label" dimension="label" options={labels()} filters={props.filters} onToggle={props.onToggle} />
          <FacetGroup label="Updated" dimension="updated" options={updated()} filters={props.filters} onToggle={props.onToggle} />
        </Match>
      </Switch>
    </aside>
  );
}
