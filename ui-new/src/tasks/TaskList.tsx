import type { CompactIssue, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { Check, ChevronDown, CornerDownRight, Pin, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { issuePath } from "@/api/issues";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { hasOpenDialog, isTextInputTarget } from "@/lib/shortcuts";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Capsule, LabelPill, PriorityBars, RunningPill, StatusCapsule, TonePill } from "@/ui/Status";
import { PRIORITY_META, STATUS_META } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import { groupDefaults, moveUpdate, updatedLabel, type GroupMark, type GroupValue, type TaskGroup, type TaskRow } from "./list-model";
import { Assignee, assigneeName, type TaskPeople } from "./people";
import { AssigneeItems, LabelDot, LabelItems, PriorityItems, StatusItems } from "./pickers";
import { RetryMark, type TaskRetry } from "./retry";
import type { TaskUpdates } from "./task-updates";
import { assigneeKey } from "./view-state";
import "./TaskList.css";

/*
 * The task list (board 1): one group card per status, or per whatever the viewer groups by, with
 * Name, Assignee, Priority, Labels and Updated columns. Beside a docked panel (boards 2, 3 and 5)
 * the rows keep their full width: one sideways scroll moves every card, and the Name column stays
 * pinned unless the pin in the column headings turns it off.
 *
 * A row's title links to the task's full page, so it can open in a new tab; a plain click calls
 * `onOpen` instead, which opens the panel. The status, assignee, priority and labels cells are menus
 * that change the task in place. Rows can be ticked (shift-click ticks a range, ⌘/Ctrl-click one
 * more), dragged into another group, and added to a group by typing a title at its foot. An
 * interrupted task shows its state, with Retry when the server allows one (retry.tsx).
 *
 * Keys, after the old list: j/k or the arrows move between group headings and rows, Enter or o
 * opens a row, x ticks it, ←/→ fold and unfold a group, Esc clears the ticks.
 */

const PIN_KEY = "ui-new:tasks:pin-name";

function readPin() {
  try {
    return localStorage.getItem(PIN_KEY) !== "off";
  } catch {
    return true;
  }
}

export function plainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A menu or popover owns the keyboard while it's open. */
export function hasOpenLayer() {
  return document.querySelector('[data-layer="menu"], [data-layer="popover"]') !== null;
}

/**
 * The latest value of a keyed item. While a removed group or row is being torn down its lookup comes
 * back empty for a moment, so this keeps the last value it had.
 */
export function latest<T>(get: () => T | undefined): () => T {
  let last: T | undefined;
  return () => {
    const value = get();
    if (value !== undefined) last = value;
    return last as T;
  };
}

type DragState = { ids: string[]; from: GroupValue; groupKey: string };

export function TaskList(props: {
  groups: readonly TaskGroup[];
  people: TaskPeople;
  updates: TaskUpdates;
  retry: TaskRetry;
  /** The open task, highlighted. */
  selectedId?: string | null;
  onOpen: (task: CompactIssue) => void;
  /** New tasks added from a group go to this project. */
  projectId?: string;
  isOpen: (group: TaskGroup) => boolean;
  onToggleGroup: (group: TaskGroup, open: boolean) => void;
  /** Ticked tasks, by id. */
  checked: ReadonlySet<string>;
  onCheckedChange: (ids: Set<string>) => void;
}) {
  const company = useCompany();
  const commands = useCommands();
  let root: HTMLDivElement | undefined;
  const [pinned, setPinned] = createSignal(readPin());
  const [adding, setAdding] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<DragState | null>(null);
  const [dropKey, setDropKey] = createSignal<string | null>(null);
  let anchorId: string | null = null;

  const groupKeys = createMemo(() => props.groups.map((group) => group.key));
  const groupsByKey = createMemo(() => new Map(props.groups.map((group) => [group.key, group] as const)));
  const rowsByKey = createMemo(
    () => new Map(props.groups.map((group) => [group.key, new Map(group.rows.map((row) => [row.task.id, row] as const))] as const)),
  );
  const rowIds = (group: TaskGroup) => group.rows.map((row) => row.task.id);

  const canDrag = () => props.groups.some((group) => group.value !== null);
  const tasksById = createMemo(() => new Map(props.groups.flatMap((group) => group.rows.map((row) => [row.task.id, row.task] as const))));
  // The rows in the order they're shown, for shift-click ranges. Folded groups are skipped.
  const shownIds = createMemo(() => {
    const seen = new Set<string>();
    for (const group of props.groups) if (props.isOpen(group)) for (const row of group.rows) seen.add(row.task.id);
    return [...seen];
  });

  const togglePin = () => {
    const next = !pinned();
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "on" : "off");
    } catch {
      // The choice lasts for this page only.
    }
  };

  const check = (id: string, mode: "toggle" | "range") => {
    const next = new Set(props.checked);
    if (mode === "range" && anchorId && anchorId !== id) {
      const order = shownIds();
      const [a, b] = [order.indexOf(anchorId), order.indexOf(id)].sort((x, y) => x - y);
      if (a !== -1 && b !== -1) {
        for (const each of order.slice(a, b + 1)) next.add(each);
        props.onCheckedChange(next);
        return;
      }
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    anchorId = id;
    props.onCheckedChange(next);
  };

  const startAdding = (group: TaskGroup) => {
    if (!props.isOpen(group)) props.onToggleGroup(group, true);
    setAdding(group.key);
  };

  // Dragging: a ticked row carries every ticked task with it; any other row goes alone.
  const onDragStart = (event: DragEvent, group: TaskGroup, task: CompactIssue) => {
    if (!canDrag() || !event.dataTransfer) return;
    const ids = props.checked.has(task.id) ? [...props.checked] : [task.id];
    setDrag({ ids, from: group.value, groupKey: group.key });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.map((id) => tasksById().get(id)?.identifier ?? id).join(", "));
  };
  const endDrag = () => {
    setDrag(null);
    setDropKey(null);
  };
  const onDragOver = (event: DragEvent, group: TaskGroup) => {
    const current = drag();
    if (!current || group.value === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropKey(group.key);
  };
  const onDragLeave = (event: DragEvent, group: TaskGroup) => {
    const into = event.relatedTarget as Node | null;
    if (into && (event.currentTarget as Element).contains(into)) return;
    if (dropKey() === group.key) setDropKey(null);
  };
  const onDrop = (event: DragEvent, group: TaskGroup) => {
    const current = drag();
    endDrag();
    if (!current || group.value === null) return;
    event.preventDefault();
    const changes = current.ids.flatMap((id) => {
      const task = tasksById().get(id);
      const data = task ? moveUpdate(task, current.from, group.value) : null;
      return task && data ? [{ task, data }] : [];
    });
    void props.updates.update(changes);
  };

  // Keyboard movement. The cursor is focus: a heading's fold button or a row's title link.
  const navItems = () => [...(root?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
  const focusItem = (item: HTMLElement | undefined) => {
    const target = item?.querySelector<HTMLElement>("[data-nav-focus]");
    if (!target) return;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  };
  const rowTask = (item: HTMLElement | undefined) => (item?.dataset.task ? tasksById().get(item.dataset.task) : undefined);
  const groupOf = (item: HTMLElement | undefined) => props.groups.find((group) => group.key === item?.dataset.group);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextInputTarget(event.target) || hasOpenDialog() || hasOpenLayer()) return;
    const key = event.key;
    if (key === "Escape") {
      if (props.checked.size === 0) return;
      event.preventDefault();
      props.onCheckedChange(new Set());
      return;
    }
    const items = navItems();
    const focusedIn = root?.contains(document.activeElement) ?? false;
    const current = focusedIn ? ((document.activeElement as HTMLElement).closest<HTMLElement>("[data-nav]") ?? undefined) : undefined;
    const isArrow = key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight";
    // Arrows only move the cursor once it's in the list; j and k bring it in.
    if (isArrow && !focusedIn) return;
    if (key === "j" || key === "k" || key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const step = key === "j" || key === "ArrowDown" ? 1 : -1;
      let index = current ? items.indexOf(current) : -1;
      if (index === -1 && props.selectedId) index = items.findIndex((item) => item.dataset.task === props.selectedId);
      const next = items[index === -1 ? (step === 1 ? 0 : items.length - 1) : Math.min(Math.max(index + step, 0), items.length - 1)];
      focusItem(next);
      // With a task open, the panel follows the cursor.
      const task = rowTask(next);
      if (task && props.selectedId) props.onOpen(task);
      return;
    }
    if (!current) return;
    const group = groupOf(current);
    const task = rowTask(current);
    if (key === "o" || (key === "Enter" && !(event.target as Element).closest("a, button"))) {
      if (!task) return;
      event.preventDefault();
      props.onOpen(task);
    } else if (key === "x") {
      if (!task) return;
      event.preventDefault();
      check(task.id, event.shiftKey ? "range" : "toggle");
    } else if (key === "ArrowLeft" && group) {
      event.preventDefault();
      if (props.isOpen(group)) props.onToggleGroup(group, false);
      queueMicrotask(() => focusItem(navItems().find((item) => item.dataset.head === group.key)));
    } else if (key === "ArrowRight" && group && !task && !props.isOpen(group)) {
      event.preventDefault();
      props.onToggleGroup(group, true);
    }
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <div
      ref={root}
      class="tl"
      classList={{ "tl--pinned": pinned(), "tl--checking": props.checked.size > 0, "tl--dragging": drag() !== null }}
    >
      <div class="tl-scroll">
        <div class="tl-sheet">
          <For each={groupKeys()}>
            {(key) => {
              // Keyed by the group's key, so a change to a task updates the card instead of
              // remounting it (and closing any menu open in it).
              const group = latest(() => groupsByKey().get(key));
              const open = () => props.isOpen(group());
              return (
                <section
                  class="tl-card"
                  classList={{ "tl-card--drop": dropKey() === group().key && drag()?.groupKey !== group().key }}
                  aria-label={group().label}
                  onDragOver={(event) => onDragOver(event, group())}
                  onDragLeave={(event) => onDragLeave(event, group())}
                  onDrop={(event) => onDrop(event, group())}
                >
                  <div class="card tl-frame" aria-hidden="true" />
                  <div class="tl-body">
                    <div class="tl-bar tl-head" data-nav data-head={group().key} data-group={group().key}>
                      <GroupMarkView mark={group().mark} people={props.people} />
                      <h2 class="disp">{group().label}</h2>
                      <span class="tl-count">{group().rows.length}</span>
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact tl-head-add"
                        aria-label={`Add task to ${group().label}`}
                        onClick={() => startAdding(group())}
                      >
                        <Plus size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact"
                        aria-label={`${open() ? "Collapse" : "Expand"} ${group().label}`}
                        aria-expanded={open()}
                        data-nav-focus
                        onClick={() => props.onToggleGroup(group(), !open())}
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
                      <For each={rowIds(group())}>
                        {(id) => {
                          const row = latest(() => rowsByKey().get(key)?.get(id));
                          return (
                            <Row
                              row={row()}
                              group={group()}
                              people={props.people}
                              updates={props.updates}
                              retry={props.retry}
                              selected={props.selectedId === row().task.id}
                              checked={props.checked.has(row().task.id)}
                              draggable={canDrag()}
                              href={issuePath(company().issuePrefix, row().task)}
                              onOpen={props.onOpen}
                              onCheck={(mode) => check(row().task.id, mode)}
                              onDragStart={(event) => onDragStart(event, group(), row().task)}
                              onDragEnd={endDrag}
                            />
                          );
                        }}
                      </For>
                      <Show
                        when={adding() === group().key}
                        fallback={
                          <button type="button" class="tl-bar tl-add" onClick={() => startAdding(group())}>
                            <Plus size={14} aria-hidden="true" />
                            Add task
                          </button>
                        }
                      >
                        <QuickAdd
                          group={group()}
                          updates={props.updates}
                          projectId={props.projectId}
                          onClose={() => setAdding(null)}
                          onMore={(title) => {
                            setAdding(null);
                            openMoreOptions(commands, props.projectId, group().value, title);
                          }}
                        />
                      </Show>
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

/** "More options" from a quick add: the new-task dialog, with the group's value and the title so far. */
export function openMoreOptions(commands: ReturnType<typeof useCommands>, projectId: string | undefined, value: GroupValue, title: string) {
  commands.openNewTask({
    ...(projectId ? { projectId } : {}),
    ...(value?.field === "status" ? { status: value.status } : {}),
    ...(value?.field === "assignee" && value.agentId ? { assigneeAgentId: value.agentId } : {}),
    ...(value?.field === "parent" && value.parentId ? { parentId: value.parentId } : {}),
    ...(title ? { title } : {}),
  });
}

export function GroupMarkView(props: { mark: GroupMark; people: TaskPeople }) {
  return (
    <span class="tl-mark">
      <Switch fallback={<Capsule gradient="ash" size="group" grain />}>
        <Match when={props.mark.kind === "status" && props.mark}>
          {(mark) => <Capsule gradient={STATUS_META[mark().status].gradient} size="group" grain />}
        </Match>
        <Match when={props.mark.kind === "priority" && props.mark}>{(mark) => <PriorityBars priority={mark().priority} />}</Match>
        <Match when={props.mark.kind === "agent" && props.mark}>
          {(mark) => (
            <Show when={props.people.agent(mark().agentId)} fallback={<span class="assignee-none tl-mark-disc" aria-hidden="true" />}>
              {(agent) => <AgentAvatar agent={agent()} size={24} />}
            </Show>
          )}
        </Match>
        <Match when={props.mark.kind === "user" && props.mark}>
          {(mark) => <InitialsDisc name={mark().you ? "You" : props.people.personName(mark().userId)} seed={mark().userId} size={24} you={mark().you} />}
        </Match>
        <Match when={props.mark.kind === "unassigned"}>
          <span class="assignee-none tl-mark-disc" aria-hidden="true" />
        </Match>
        <Match when={props.mark.kind === "label" && props.mark}>{(mark) => <LabelDot color={mark().color} />}</Match>
        <Match when={props.mark.kind === "task" && props.mark}>
          {(mark) => <Show when={mark().status} fallback={<Capsule gradient="ash" size="row" />}>{(status) => <StatusCapsule status={status()} size="row" />}</Show>}
        </Match>
      </Switch>
    </span>
  );
}

function Row(props: {
  row: TaskRow;
  group: TaskGroup;
  people: TaskPeople;
  updates: TaskUpdates;
  retry: TaskRetry;
  selected: boolean;
  checked: boolean;
  draggable: boolean;
  href: string;
  onOpen: (task: CompactIssue) => void;
  onCheck: (mode: "toggle" | "range") => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const task = () => props.row.task;
  const status = () => task().status as IssueStatus;
  const priority = () => task().priority as IssuePriority;
  const labelIds = () => task().labelIds ?? task().labels?.map((label) => label.id) ?? [];
  const labelNames = () => (task().labels ?? []).map((label) => label.name).join(", ");
  const change = (data: Record<string, unknown>) => void props.updates.update([{ task: task(), data }]);

  const open = (event: MouseEvent) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    props.onOpen(task());
  };
  // A click anywhere on the row opens the task too, unless it was on a control inside it.
  // Shift-click ticks a range of rows, ⌘/Ctrl-click ticks one.
  const openFromRow = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if ((event.target as Element).closest("a, button, input, [role='menu']")) return;
    if (event.shiftKey) return props.onCheck("range");
    if (event.metaKey || event.ctrlKey) return props.onCheck("toggle");
    if (plainClick(event)) props.onOpen(task());
  };
  return (
    <div
      class="tl-row"
      classList={{ "tl-row--selected": props.selected, "tl-row--checked": props.checked }}
      data-nav
      data-task={task().id}
      data-group={props.group.key}
      draggable={props.draggable}
      onDragStart={(event) => props.onDragStart(event)}
      onDragEnd={() => props.onDragEnd()}
      onClick={openFromRow}
    >
      <div class="tl-pin-col tl-name">
        <button
          type="button"
          role="checkbox"
          class="tl-check"
          aria-checked={props.checked}
          aria-label={`Select ${task().identifier ?? task().title}`}
          onClick={(event) => props.onCheck(event.shiftKey ? "range" : "toggle")}
        >
          <Show when={props.checked}>
            <Check size={11} stroke-width={3.2} aria-hidden="true" />
          </Show>
        </button>
        <Menu>
          <Menu.Trigger class="tl-status" aria-label={`Status: ${STATUS_META[status()].label}. Change status`}>
            <StatusCapsule status={status()} size="row" />
          </Menu.Trigger>
          <Menu.Content label="Status" width={220}>
            <StatusItems current={status()} onPick={(next) => next !== status() && change({ status: next })} />
          </Menu.Content>
        </Menu>
        <span class="mono tl-id">{task().identifier}</span>
        <a
          class="tl-title"
          href={props.href}
          draggable={false}
          data-nav-focus
          onClick={open}
          aria-current={props.selected ? "true" : undefined}
        >
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
        <RetryMark task={task()} retry={props.retry} />
      </div>
      <Menu>
        <Menu.Trigger class="tl-cell" aria-label={`Assignee: ${assigneeName(task(), props.people)}. Change assignee`}>
          <Assignee task={task()} people={props.people} />
        </Menu.Trigger>
        <Menu.Content label="Assignee" width={260}>
          <AssigneeItems
            people={props.people}
            current={assigneeKey(task())}
            onPick={(pick) => {
              if (pick.agentId === (task().assigneeAgentId ?? null) && pick.userId === (task().assigneeUserId ?? null)) return;
              change({ assigneeAgentId: pick.agentId, assigneeUserId: pick.userId });
            }}
          />
        </Menu.Content>
      </Menu>
      <Menu>
        <Menu.Trigger class="tl-cell" aria-label={`Priority: ${PRIORITY_META[priority()].label}. Change priority`}>
          <PriorityBars priority={priority()} withLabel />
        </Menu.Trigger>
        <Menu.Content label="Priority" width={200}>
          <PriorityItems current={priority()} onPick={(next) => next !== priority() && change({ priority: next })} />
        </Menu.Content>
      </Menu>
      <Menu>
        <Menu.Trigger class="tl-cell tl-labels" aria-label={labelNames() ? `Labels: ${labelNames()}. Change labels` : "No labels. Add a label"}>
          <For each={task().labels ?? []} fallback={<span class="tl-labels-add">Add label</span>}>
            {(label) => <LabelPill name={label.name} color={label.color} />}
          </For>
        </Menu.Trigger>
        <Menu.Content label="Labels" width={240}>
          <LabelItems
            checked={(id) => labelIds().includes(id)}
            onChange={(id, on) => change({ labelIds: on ? [...labelIds(), id] : labelIds().filter((each) => each !== id) })}
          />
        </Menu.Content>
      </Menu>
      <span class="tl-updated">{updatedLabel(task().lastActivityAt ?? task().updatedAt)}</span>
    </div>
  );
}

/**
 * Typing a title at a group's foot adds a task with the group's value (its status, assignee,
 * priority, label or parent). The field stays open for the next one; Esc closes it. The board's
 * columns use it too, with their own class and without the hint.
 */
export function QuickAdd(props: {
  group: TaskGroup;
  updates: TaskUpdates;
  projectId?: string;
  onClose: () => void;
  onMore: (title: string) => void;
  class?: string;
  hideHint?: boolean;
}) {
  let input: HTMLInputElement | undefined;
  const [title, setTitle] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    const text = title().trim();
    if (!text || saving()) return;
    setSaving(true);
    try {
      await props.updates.create({ title: text, ...(props.projectId ? { projectId: props.projectId } : {}), ...groupDefaults(props.group.value) });
      setTitle("");
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't add the task", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
      input?.focus();
    }
  };

  return (
    <form class={props.class ?? "tl-bar tl-quick"} onSubmit={submit}>
      <Plus size={14} aria-hidden="true" />
      <TextInput
        ref={(element) => {
          input = element;
          queueMicrotask(() => element.focus());
        }}
        value={title()}
        onInput={(event) => setTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }}
        onBlur={(event) => {
          const into = event.relatedTarget as Node | null;
          if (!title().trim() && !(into && event.currentTarget.form?.contains(into))) props.onClose();
        }}
        placeholder={`New task in ${props.group.label}`}
        aria-label={`New task title, in ${props.group.label}`}
        readOnly={saving()}
      />
      <Show when={!props.hideHint}>
        <span class="tl-quick-hint">Enter to add · Esc to close</span>
      </Show>
      <button type="button" class="btn btn--quiet btn--compact" onClick={() => props.onMore(title().trim())}>
        More options
      </button>
    </form>
  );
}
