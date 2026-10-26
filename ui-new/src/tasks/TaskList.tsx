import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { ChevronDown, CornerDownRight, Pin, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { issuePath } from "@/api/issues";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { Capsule, LabelPill, PriorityBars, RunningPill, StatusCapsule, TonePill } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { buildTaskGroups, COLLAPSED_BY_DEFAULT, updatedLabel, type TaskRow } from "./list-model";
import { Assignee, type TaskPeople } from "./people";
import "./TaskList.css";

/*
 * The task list (board 1): one group card per status, with Name, Assignee, Priority, Labels and
 * Updated columns. Beside a docked panel (boards 2, 3 and 5) the rows keep their full width: one
 * sideways scroll moves every card, and the Name column stays pinned unless the pin in the column
 * headings turns it off.
 *
 * A row's title links to the task's full page, so it can open in a new tab; a plain click calls
 * `onOpen` instead, which opens the panel.
 */

const PIN_KEY = "ui-new:tasks:pin-name";

function readPin() {
  try {
    return localStorage.getItem(PIN_KEY) !== "off";
  } catch {
    return true;
  }
}

function plainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function TaskList(props: {
  tasks: readonly CompactIssue[];
  people: TaskPeople;
  /** The open task, highlighted. */
  selectedId?: string | null;
  onOpen: (task: CompactIssue) => void;
  /** New tasks added from a group go to this project. */
  projectId?: string;
}) {
  const company = useCompany();
  const commands = useCommands();
  const [pinned, setPinned] = createSignal(readPin());
  const [collapsed, setCollapsed] = createSignal<Partial<Record<IssueStatus, boolean>>>({});
  const groups = createMemo(() => buildTaskGroups(props.tasks, props.people.liveIssueIds()));
  const isOpen = (status: IssueStatus) => !(collapsed()[status] ?? COLLAPSED_BY_DEFAULT.has(status));

  const togglePin = () => {
    const next = !pinned();
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "on" : "off");
    } catch {
      // The choice lasts for this page only.
    }
  };

  const addTask = (status?: IssueStatus) =>
    commands.openNewTask({ ...(props.projectId ? { projectId: props.projectId } : {}), ...(status ? { status } : {}) });

  return (
    <div class="tl" classList={{ "tl--pinned": pinned() }}>
      <div class="tl-scroll">
        <div class="tl-sheet">
          <For each={groups()}>
            {(group) => {
              const meta = STATUS_META[group.status];
              const open = () => isOpen(group.status);
              return (
                <section class="tl-card" aria-label={meta.label}>
                  <div class="card tl-frame" aria-hidden="true" />
                  <div class="tl-body">
                    <div class="tl-bar tl-head">
                      <Capsule gradient={meta.gradient} size="group" grain />
                      <h2 class="disp">{meta.label}</h2>
                      <span class="tl-count">{group.rows.length}</span>
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact tl-head-add"
                        aria-label={`Add task to ${meta.label}`}
                        onClick={() => addTask(group.status)}
                      >
                        <Plus size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact"
                        aria-label={`${open() ? "Collapse" : "Expand"} ${meta.label}`}
                        aria-expanded={open()}
                        onClick={() => setCollapsed({ ...collapsed(), [group.status]: open() })}
                      >
                        <ChevronDown size={14} stroke-width={2.2} aria-hidden="true" class="tl-chevron" classList={{ "tl-chevron--closed": !open() }} />
                      </button>
                    </div>
                    <Show when={open()}>
                      <div class="tl-cols" role="presentation">
                        <span class="tl-pin-col tl-cols-name">
                          Name
                          <button
                            type="button"
                            class="tl-pin"
                            aria-pressed={pinned()}
                            aria-label="Pin the Name column"
                            title={pinned() ? "Unpin the Name column" : "Pin the Name column"}
                            onClick={togglePin}
                          >
                            <Pin size={12} aria-hidden="true" fill={pinned() ? "currentColor" : "none"} />
                          </button>
                        </span>
                        <span>Assignee</span>
                        <span>Priority</span>
                        <span>Labels</span>
                        <span>Updated</span>
                      </div>
                      <For each={group.rows}>
                        {(row) => (
                          <Row
                            row={row}
                            status={group.status}
                            people={props.people}
                            selected={props.selectedId === row.task.id}
                            href={issuePath(company().issuePrefix, row.task)}
                            onOpen={props.onOpen}
                          />
                        )}
                      </For>
                      <button type="button" class="tl-bar tl-add" onClick={() => addTask(group.status)}>
                        <Plus size={14} aria-hidden="true" />
                        Add task
                      </button>
                    </Show>
                  </div>
                </section>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

function Row(props: {
  row: TaskRow;
  status: IssueStatus;
  people: TaskPeople;
  selected: boolean;
  href: string;
  onOpen: (task: CompactIssue) => void;
}) {
  const task = () => props.row.task;
  const open = (event: MouseEvent) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    props.onOpen(task());
  };
  // A click anywhere on the row opens the task too, unless it was on a control inside it.
  const openFromRow = (event: MouseEvent) => {
    if (event.defaultPrevented || !plainClick(event)) return;
    if ((event.target as Element).closest("a, button, input, [role='menu']")) return;
    props.onOpen(task());
  };
  return (
    <div class="tl-row" classList={{ "tl-row--selected": props.selected }} onClick={openFromRow}>
      <div class="tl-pin-col tl-name">
        <StatusCapsule status={props.status} size="row" />
        <span class="mono tl-id">{task().identifier}</span>
        <a class="tl-title" href={props.href} onClick={open} aria-current={props.selected ? "true" : undefined}>
          {task().title}
        </a>
        <Show when={props.row.subtasks > 0}>
          <span class="tl-subtasks" title={`${props.row.subtasksDone} of ${props.row.subtasks} subtasks done`}>
            <CornerDownRight size={13} aria-hidden="true" />
            {props.row.subtasks}
          </span>
        </Show>
        <Show when={props.row.live}>
          <RunningPill compact />
        </Show>
        <Show when={props.row.note}>
          {(note) => (
            <TonePill tone={note().tone} compact icon={<Capsule gradient={note().tone === "red" ? "flare" : note().tone === "green" ? "lagoon" : "tide"} size="tiny" />}>
              {note().label}
            </TonePill>
          )}
        </Show>
      </div>
      <Assignee task={task()} people={props.people} />
      <PriorityBars priority={task().priority as IssuePriority} withLabel />
      <div class="tl-labels">
        <For each={task().labels ?? []}>{(label) => <LabelPill name={label.name} color={label.color} />}</For>
      </div>
      <span class="tl-updated">{updatedLabel(task().lastActivityAt ?? task().updatedAt)}</span>
    </div>
  );
}
