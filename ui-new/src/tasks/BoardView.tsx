import type { CompactIssue, IssuePriority } from "@paperclipai/shared";
import { ChevronLeft, ChevronRight, CornerDownRight, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { issuePath } from "@/api/issues";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { hasOpenDialog, isTextInputTarget } from "@/lib/shortcuts";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Menu } from "@/ui/Menu";
import { Capsule, LabelPill, PriorityBars, RunningPill, TonePill } from "@/ui/Status";
import { PRIORITY_META } from "@/ui/status-meta";
import { columnTone, COLUMN_PAGE, moveCursor, neighbourColumn, type CursorMove } from "./board-model";
import { moveUpdate, type GroupValue, type TaskGroup, type TaskRow } from "./list-model";
import { assigneeName, type TaskPeople } from "./people";
import { AssigneeItems, LabelItems, PriorityItems } from "./pickers";
import type { TaskUpdates } from "./task-updates";
import { GroupMarkView, hasOpenLayer, latest, openMoreOptions, plainClick, QuickAdd } from "./TaskList";
import { assigneeKey } from "./view-state";
import "./BoardView.css";

/*
 * The board view (board 4): the list's groups as columns, each tinted with its status, with a card
 * per task. Columns fold to a narrow strip; Done starts folded. The columns scroll sideways as one
 * strip, and on a narrow screen each column takes most of the width and snaps into place.
 *
 * It does what the list does, in columns: a click on a card opens the docked panel, its title links
 * to the full page, ⌘/Ctrl-click and shift-click tick cards for the selection bar, dragging a card
 * into another column changes the grouped field (through the same update path as the list's drag
 * between groups), and each column adds tasks at its foot. A card's assignee, priority and labels
 * are menus, as the list's cells are, so they can change without a drag or a pointer.
 *
 * Keys: j/k or ↓/↑ move between cards in a column, h/l or ←/→ between columns, Enter or o opens
 * the card, x ticks it, Shift+←/→ moves it into the next column, Esc clears the ticks.
 */

type DragState = { ids: string[]; from: GroupValue; columnKey: string };

export function BoardView(props: {
  columns: readonly TaskGroup[];
  people: TaskPeople;
  updates: TaskUpdates;
  /** The open task, highlighted. */
  selectedId?: string | null;
  onOpen: (task: CompactIssue) => void;
  /** New tasks added from a column go to this project. */
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
  const [adding, setAdding] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<DragState | null>(null);
  const [dropKey, setDropKey] = createSignal<string | null>(null);
  const [limits, setLimits] = createSignal<Record<string, number>>({});
  let anchorId: string | null = null;

  const columnKeys = createMemo(() => props.columns.map((group) => group.key));
  const columnsByKey = createMemo(() => new Map(props.columns.map((group) => [group.key, group] as const)));
  const indexOf = createMemo(() => new Map(props.columns.map((group, index) => [group.key, index] as const)));
  const rowsByKey = createMemo(
    () => new Map(props.columns.map((group) => [group.key, new Map(group.rows.map((row) => [row.task.id, row] as const))] as const)),
  );
  const tasksById = createMemo(() => new Map(props.columns.flatMap((group) => group.rows.map((row) => [row.task.id, row.task] as const))));
  const canDrag = () => props.columns.some((group) => group.value !== null);
  const limitOf = (group: TaskGroup) => limits()[group.key] ?? COLUMN_PAGE;
  const shownRows = (group: TaskGroup) => group.rows.slice(0, limitOf(group));
  // The cards in the order they're shown, for shift-click ranges. Folded columns are skipped.
  const shownIds = createMemo(() => {
    const seen = new Set<string>();
    for (const group of props.columns) if (props.isOpen(group)) for (const row of shownRows(group)) seen.add(row.task.id);
    return [...seen];
  });

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

  /** Moves tasks into a column: a ticked card carries every ticked task with it. */
  const moveInto = (ids: readonly string[], from: GroupValue, to: TaskGroup) => {
    if (to.value === null) return;
    const changes = ids.flatMap((id) => {
      const task = tasksById().get(id);
      const data = task ? moveUpdate(task, from, to.value) : null;
      return task && data ? [{ task, data }] : [];
    });
    void props.updates.update(changes);
  };

  // Dragging, as on the list.
  const onDragStart = (event: DragEvent, group: TaskGroup, task: CompactIssue) => {
    if (!canDrag() || !event.dataTransfer) return;
    const ids = props.checked.has(task.id) ? [...props.checked] : [task.id];
    setDrag({ ids, from: group.value, columnKey: group.key });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.map((id) => tasksById().get(id)?.identifier ?? id).join(", "));
  };
  const endDrag = () => {
    setDrag(null);
    setDropKey(null);
  };
  const onDragOver = (event: DragEvent, group: TaskGroup) => {
    if (!drag() || group.value === null) return;
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
    moveInto(current.ids, current.from, group);
  };

  // Keyboard movement. The cursor is focus, on a card's title link.
  const grid = () =>
    [...(root?.querySelectorAll<HTMLElement>("[data-column]") ?? [])].map((column) => [
      ...column.querySelectorAll<HTMLElement>("[data-card]"),
    ]);
  const focusCard = (card: HTMLElement | undefined) => {
    const target = card?.querySelector<HTMLElement>("[data-nav-focus]");
    if (!target) return;
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  /** Focuses a card once it shows up in its column, after a change has moved it there. */
  const focusWhenShown = (columnKey: string, taskId: string, fallback?: HTMLElement) => {
    let frames = 0;
    const attempt = () => {
      const card = root?.querySelector<HTMLElement>(`[data-column="${CSS.escape(columnKey)}"] [data-card="${CSS.escape(taskId)}"]`);
      if (card) return focusCard(card);
      if (++frames < 40) window.setTimeout(attempt, 25);
      else if (fallback?.isConnected) focusCard(fallback);
    };
    window.setTimeout(attempt, 0);
  };
  const cardTask = (card: HTMLElement | undefined) => (card?.dataset.card ? tasksById().get(card.dataset.card) : undefined);

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
    const cards = grid();
    const focusedIn = root?.contains(document.activeElement) ?? false;
    const current = focusedIn ? ((document.activeElement as HTMLElement).closest<HTMLElement>("[data-card]") ?? undefined) : undefined;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const moves: Record<string, CursorMove> = {
      j: "down",
      ArrowDown: "down",
      k: "up",
      ArrowUp: "up",
      h: "left",
      ArrowLeft: "left",
      l: "right",
      ArrowRight: "right",
    };
    const move = moves[lower];
    if (move) {
      // Arrows only move the cursor once it's on the board; the letters bring it in.
      if (key.startsWith("Arrow") && !focusedIn) return;
      let at: { col: number; row: number } | null = null;
      const find = (card: HTMLElement | undefined) => {
        if (!card) return null;
        for (let col = 0; col < cards.length; col++) {
          const row = cards[col]!.indexOf(card);
          if (row !== -1) return { col, row };
        }
        return null;
      };
      at = find(current);
      if (!at && props.selectedId) at = find(cards.flat().find((card) => card.dataset.card === props.selectedId));
      // Shift+←/→ carries the card into the next column.
      if (event.shiftKey && (move === "left" || move === "right")) {
        const task = cardTask(current);
        const column = current?.closest<HTMLElement>("[data-column]")?.dataset.column;
        const from = column !== undefined ? indexOf().get(column) : undefined;
        if (!task || from === undefined) return;
        event.preventDefault();
        const to = neighbourColumn(props.columns, from, move === "right" ? 1 : -1);
        if (to === null) return;
        const target = props.columns[to]!;
        const ids = props.checked.has(task.id) ? [...props.checked] : [task.id];
        moveInto(ids, props.columns[from]!.value, target);
        const below = cards[at?.col ?? 0]?.[(at?.row ?? 0) + 1] ?? cards[at?.col ?? 0]?.[(at?.row ?? 0) - 1];
        if (props.isOpen(target)) focusWhenShown(target.key, task.id, below);
        else if (below) focusWhenShown(column!, below.dataset.card!, below);
        return;
      }
      if (event.shiftKey) return;
      event.preventDefault();
      const next = moveCursor(
        cards.map((column) => column.map((card) => card.dataset.card!)),
        at,
        move,
      );
      if (!next) return;
      const card = cards[next.col]![next.row];
      focusCard(card);
      // With a task open, the panel follows the cursor.
      const task = cardTask(card);
      if (task && props.selectedId) props.onOpen(task);
      return;
    }
    if (!current) return;
    const task = cardTask(current);
    if (!task) return;
    if (lower === "o" || (key === "Enter" && !(event.target as Element).closest("button"))) {
      event.preventDefault();
      props.onOpen(task);
    } else if (lower === "x") {
      event.preventDefault();
      check(task.id, event.shiftKey ? "range" : "toggle");
    }
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <div ref={root} class="bv" classList={{ "bv--dragging": drag() !== null }}>
      <div class="bv-scroll">
        <div class="bv-track">
          <For each={columnKeys()}>
            {(key) => {
              // Keyed by the column's key, so a change to a task updates the column instead of
              // remounting it (and closing any menu open in it).
              const group = latest(() => columnsByKey().get(key));
              const open = () => props.isOpen(group());
              const tone = () => columnTone(group());
              const dropping = () => dropKey() === group().key && drag()?.columnKey !== group().key;
              const drop = {
                onDragOver: (event: DragEvent) => onDragOver(event, group()),
                onDragLeave: (event: DragEvent) => onDragLeave(event, group()),
                onDrop: (event: DragEvent) => onDrop(event, group()),
              };
              return (
                <Show
                  when={open()}
                  fallback={
                    <section
                      class="bv-col bv-col--closed"
                      classList={{ "bv-col--drop": dropping() }}
                      style={{ "--bv-tint": tone().tint }}
                      aria-label={`${group().label}, collapsed`}
                      data-column={group().key}
                      {...drop}
                    >
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact bv-fold"
                        aria-label={`Expand ${group().label}`}
                        aria-expanded={false}
                        onClick={() => props.onToggleGroup(group(), true)}
                      >
                        <ChevronRight size={14} stroke-width={2.2} aria-hidden="true" />
                      </button>
                      <span class="bv-vlabel" style={{ color: tone().ink }}>
                        {group().label}
                      </span>
                      <span class="bv-count">{group().rows.length}</span>
                    </section>
                  }
                >
                  <section
                    class="bv-col"
                    classList={{ "bv-col--drop": dropping() }}
                    style={{ "--bv-tint": tone().tint }}
                    aria-label={group().label}
                    data-column={group().key}
                    {...drop}
                  >
                    <div class="bv-head">
                      <GroupMarkView mark={group().mark} people={props.people} />
                      <h2 class="disp">{group().label}</h2>
                      <span class="bv-count">{group().rows.length}</span>
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact bv-fold"
                        aria-label={`Collapse ${group().label}`}
                        aria-expanded={true}
                        onClick={() => props.onToggleGroup(group(), false)}
                      >
                        <ChevronLeft size={14} stroke-width={2.2} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="btn btn--icon btn--ghost btn--compact"
                        aria-label={`Add task to ${group().label}`}
                        onClick={() => startAdding(group())}
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <For each={shownRows(group()).map((row) => row.task.id)}>
                      {(id) => {
                        const row = latest(() => rowsByKey().get(key)?.get(id));
                        return (
                          <Card
                            row={row()}
                            people={props.people}
                            updates={props.updates}
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
                    <Show when={group().rows.length > limitOf(group())}>
                      <button
                        type="button"
                        class="bv-add bv-more"
                        onClick={() => setLimits({ ...limits(), [group().key]: limitOf(group()) + COLUMN_PAGE })}
                      >
                        Show {Math.min(COLUMN_PAGE, group().rows.length - limitOf(group()))} more
                      </button>
                    </Show>
                    <Show
                      when={adding() === group().key}
                      fallback={
                        <button type="button" class="bv-add" onClick={() => startAdding(group())}>
                          <Plus size={14} aria-hidden="true" />
                          Add task
                        </button>
                      }
                    >
                      <QuickAdd
                        class="card bv-quick"
                        hideHint
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
                  </section>
                </Show>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

/** The card's assignee: an agent's avatar, a person's disc, or a dashed empty disc. */
function AssigneeDisc(props: { task: CompactIssue; people: TaskPeople }) {
  const agent = () => props.people.agent(props.task.assigneeAgentId);
  return (
    <Switch fallback={<span class="assignee-none bv-none" aria-hidden="true" />}>
      <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={24} />}</Match>
      <Match when={props.task.assigneeUserId}>
        {(id) => (
          <InitialsDisc name={props.people.personName(id())} seed={id()} size={24} you={id() === props.people.youId()} />
        )}
      </Match>
    </Switch>
  );
}

function Card(props: {
  row: TaskRow;
  people: TaskPeople;
  updates: TaskUpdates;
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
  const priority = () => task().priority as IssuePriority;
  const labelIds = () => task().labelIds ?? task().labels?.map((label) => label.id) ?? [];
  const labelNames = () => (task().labels ?? []).map((label) => label.name).join(", ");
  const change = (data: Record<string, unknown>) => void props.updates.update([{ task: task(), data }]);
  const who = () => assigneeName(task(), props.people);
  const percent = () => (props.row.subtasks > 0 ? Math.round((props.row.subtasksDone / props.row.subtasks) * 100) : 0);

  const open = (event: MouseEvent) => {
    if (!plainClick(event)) {
      // ⌘/Ctrl-click on the title ticks the card rather than opening a tab, as on the card body.
      if (event.button === 0 && (event.shiftKey || event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        props.onCheck(event.shiftKey ? "range" : "toggle");
      }
      return;
    }
    event.preventDefault();
    props.onOpen(task());
  };
  // A click anywhere on the card opens the task too, unless it was on a control inside it.
  const openFromCard = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if ((event.target as Element).closest("a, button, input, [role='menu']")) return;
    if (event.shiftKey) return props.onCheck("range");
    if (event.metaKey || event.ctrlKey) return props.onCheck("toggle");
    if (plainClick(event)) props.onOpen(task());
  };

  return (
    <article
      class="card bv-card"
      classList={{ "bv-card--selected": props.selected, "bv-card--checked": props.checked }}
      data-card={task().id}
      aria-label={`${task().identifier ?? ""} ${task().title}`.trim()}
      draggable={props.draggable}
      onDragStart={(event) => props.onDragStart(event)}
      onDragEnd={() => props.onDragEnd()}
      onClick={openFromCard}
    >
      <div class="bv-card-top">
        <span class="mono bv-id">{task().identifier}</span>
        <Show when={props.checked}>
          <span class="bv-ticked">Selected</span>
        </Show>
        <Show when={props.row.live}>
          <span class="bv-live">
            <RunningPill compact />
          </span>
        </Show>
      </div>
      <a
        class="bv-title"
        href={props.href}
        draggable={false}
        data-nav-focus
        onClick={open}
        aria-current={props.selected ? "true" : undefined}
      >
        {task().title}
      </a>
      <Show when={props.row.note}>
        {(note) => (
          <TonePill
            tone={note().tone}
            compact
            icon={<Capsule gradient={note().tone === "red" ? "flare" : note().tone === "green" ? "lagoon" : "tide"} size="tiny" />}
          >
            {note().label}
          </TonePill>
        )}
      </Show>
      <div class="bv-pills">
        <Menu>
          <Menu.Trigger class="bv-who" aria-label={`Assignee: ${who()}. Change assignee`} title={who()}>
            <AssigneeDisc task={task()} people={props.people} />
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
          <Menu.Trigger class="bv-pill" aria-label={`Priority: ${PRIORITY_META[priority()].label}. Change priority`}>
            <PriorityBars priority={priority()} withLabel />
          </Menu.Trigger>
          <Menu.Content label="Priority" width={200}>
            <PriorityItems current={priority()} onPick={(next) => next !== priority() && change({ priority: next })} />
          </Menu.Content>
        </Menu>
        <Menu>
          <Menu.Trigger class="bv-labels" aria-label={labelNames() ? `Labels: ${labelNames()}. Change labels` : "No labels. Add a label"}>
            <For each={task().labels ?? []} fallback={<span class="bv-pill bv-pill--add">+ Label</span>}>
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
      </div>
      <Show when={props.row.subtasks > 0}>
        <div class="bv-subtasks">
          <CornerDownRight size={13} aria-hidden="true" />
          {props.row.subtasksDone} of {props.row.subtasks} subtasks
          <span class="bv-progress" role="presentation">
            <span style={{ width: `${percent()}%` }} />
          </span>
        </div>
      </Show>
    </article>
  );
}
