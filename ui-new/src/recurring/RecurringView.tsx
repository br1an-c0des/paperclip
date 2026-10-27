import type { CompactIssue, RoutineListItem } from "@paperclipai/shared";
import { useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Braces, CalendarClock, ChevronDown, ChevronRight, Ellipsis, Folder, Plus, Repeat, Search, Webhook } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch as Branch, type JSX } from "solid-js";
import { issuePath, issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { routinesApi } from "@/api/routines";
import { Dock } from "@/layout/Panel";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { updatedLabel } from "@/tasks/list-model";
import { Assignee, useTaskPeople } from "@/tasks/people";
import { opensAs, taskOpenMode } from "@/tasks/task-open-mode";
import { TaskModal } from "@/tasks/TaskModal";
import { TaskPanel } from "@/tasks/TaskPanel";
import type { useTaskList } from "@/tasks/TasksView";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Capsule, StatusCapsule } from "@/ui/Status";
import { Switch } from "@/ui/Switch";
import { STATUS_META } from "@/ui/status-meta";
import { pushToast } from "@/ui/Toast";
import { refreshRecurring, useRoutineFoldersQuery, useRoutinesQuery } from "./queries";
import {
  groupRoutines,
  matchesSearch,
  nextLabel,
  occurrencesByRoutine,
  RECURRING_GROUP_OPTIONS,
  runOutcome,
  triggerKinds,
  whenLabel,
  type RecurringGroup,
  type RecurringGroupBy,
  type TriggerKind,
} from "./recurring-model";
import { RecurringPanel } from "./RecurringPanel";
import { formatFire } from "./schedule";
import { ShowSwitch } from "./ShowSwitch";
import "@/tasks/TaskList.css";
import "./RecurringView.css";

/*
 * The Recurring view of the task list (board R1), which replaces the Routines page: Show: Recurring
 * beside Tasks in the toolbar, grouped by folder (or project, or assignee). Each row has the name,
 * assignee, when it runs (its trigger kinds and schedule) and its next run, the last run (the task it
 * made and that task's status), and an on switch. A row unfolds to the tasks it made, newest first:
 * each occurrence is an ordinary task, grouped under its recurring task. Each folder has an actions
 * menu (new folder, rename, delete).
 *
 * Opening a row docks the recurring task's panel (R2–R4) beside the list, or opens it as a modal
 * when tasks open as modals; opening an occurrence opens that task's panel. The URL keeps what's
 * open (`?recurring=<id>&section=runs`, or `?task=TES-12`), so links and the back button work.
 * Archived recurring tasks are hidden until "Show archived".
 */

type TaskListQuery = ReturnType<typeof useTaskList>;

const GROUP_KEY = (companyId: string) => `paperclip.ui-new.recurring-group.${companyId}`;
const KIND_ICON: Record<TriggerKind, () => JSX.Element> = {
  schedule: () => <CalendarClock size={13} aria-hidden="true" />,
  webhook: () => <Webhook size={13} aria-hidden="true" />,
  api: () => <Braces size={13} aria-hidden="true" />,
};
const KIND_LABEL: Record<TriggerKind, string> = { schedule: "Schedule", webhook: "Webhook", api: "API" };
/** How many of a recurring task's tasks unfold under its row. */
const SHOWN_OCCURRENCES = 5;

function readGroup(companyId: string): RecurringGroupBy {
  try {
    const value = localStorage.getItem(GROUP_KEY(companyId));
    return RECURRING_GROUP_OPTIONS.some((option) => option.value === value) ? (value as RecurringGroupBy) : "folder";
  } catch {
    return "folder";
  }
}

export function RecurringView(props: { projectId?: string; tasks: TaskListQuery }) {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const people = useTaskPeople();
  const projects = useProjectsQuery();
  const [params, setParams] = useSearchParams<{ recurring?: string; task?: string; section?: string }>();
  const routines = useRoutinesQuery(() => props.projectId);
  const folders = useRoutineFoldersQuery();
  const [groupBy, setGroupByState] = createSignal<RecurringGroupBy>(readGroup(company().id));
  const [search, setSearch] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [showArchived, setShowArchived] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const [folderDialog, setFolderDialog] = createSignal<{ mode: "new" | "rename" | "delete"; id?: string; name?: string } | null>(null);

  const setGroupBy = (next: RecurringGroupBy) => {
    setGroupByState(next);
    try {
      localStorage.setItem(GROUP_KEY(company().id), next);
    } catch {
      // The choice lasts until the page reloads.
    }
  };

  const occurrences = createMemo(() => occurrencesByRoutine(props.tasks.data ?? []));
  const all = () => routines.data ?? [];
  const archivedCount = () => all().filter((routine) => routine.status === "archived").length;
  const visible = createMemo(() =>
    all().filter((routine) => (showArchived() || routine.status !== "archived") && matchesSearch(routine, search())),
  );
  const groups = createMemo(() =>
    groupRoutines(visible(), groupBy(), {
      folders: groupBy() === "folder" && !search() ? (folders.data?.folders ?? []) : (folders.data?.folders ?? []).filter((folder) => visible().some((routine) => routine.folderId === folder.id)),
      project: (id) => projects.data?.find((project) => project.id === id)?.name,
      agent: (id) => people.agent(id)?.name,
    }),
  );
  const order = createMemo(() => groups().flatMap((group) => (collapsed().has(group.key) ? [] : group.routines)));

  const openId = () => params.recurring ?? null;
  const open = (routine: { id: string }, section?: "runs" | "history") =>
    setParams({ recurring: routine.id, task: undefined, section }, { scroll: false });
  const close = () => setParams({ recurring: undefined, section: undefined });
  const step = (delta: number) => {
    const index = order().findIndex((routine) => routine.id === openId());
    const next = index === -1 ? undefined : order()[index + delta];
    return next ? () => open(next) : undefined;
  };

  // An occurrence opens as a task, beside the list or as a modal, as on the task list.
  const openTaskRef = () => params.task ?? null;
  const taskFromList = createMemo(() => {
    const ref = openTaskRef();
    return ref ? (props.tasks.data ?? []).find((task) => task.identifier === ref || task.id === ref) : undefined;
  });
  const lookedUp = createQuery(() => ({
    queryKey: queryKeys.issues.detail(openTaskRef() ?? ""),
    queryFn: ({ signal }) => issuesApi.get(openTaskRef()!, signal),
    enabled: openTaskRef() !== null && !taskFromList(),
  }));
  const openTask = () => taskFromList() ?? (openTaskRef() && lookedUp.data ? lookedUp.data : undefined);
  const showTask = (task: { id: string; identifier: string | null }) =>
    setParams({ task: task.identifier ?? task.id, recurring: undefined, section: undefined }, { scroll: false });
  const closeTask = () => setParams({ task: undefined, section: undefined });

  const toggleActive = async (routine: RoutineListItem, on: boolean) => {
    try {
      await routinesApi.update(routine.id, { status: on ? "active" : "paused" });
    } catch (error) {
      pushToast({
        tone: "error",
        title: on ? `Couldn't turn on ${routine.title}` : `Couldn't pause ${routine.title}`,
        body: error instanceof Error ? error.message : undefined,
      });
    } finally {
      refreshRecurring(client, company().id);
    }
  };

  const newRecurring = () => {
    commands.openNewTask(props.projectId ? { projectId: props.projectId, repeat: true } : { repeat: true });
  };

  return (
    <>
      <div class="tv-toolbar rv-toolbar" role="toolbar" aria-label="Recurring tasks">
        <ShowSwitch projectId={props.projectId} />
        <span class="tv-toolbar-end">
          <Menu>
            <Menu.Trigger as={Button}>
              {groupBy() === "none" ? "No grouping" : `Group: ${RECURRING_GROUP_OPTIONS.find((option) => option.value === groupBy())?.label}`}
              <ChevronDown size={12} stroke-width={2} aria-hidden="true" class="tv-caret" />
            </Menu.Trigger>
            <Menu.Content label="Group by" width={200}>
              <For each={RECURRING_GROUP_OPTIONS.filter((option) => !(props.projectId && option.value === "project"))}>
                {(option) => (
                  <Menu.Item hint={groupBy() === option.value ? "✓" : undefined} onSelect={() => setGroupBy(option.value)}>
                    {option.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
          <Show when={archivedCount() > 0}>
            <Button ghost size="compact" class="tv-toggle" aria-pressed={showArchived()} onClick={() => setShowArchived(!showArchived())}>
              {showArchived() ? "Hide archived" : `Show archived (${archivedCount()})`}
            </Button>
          </Show>
        </span>
        <Show
          when={searching() || search()}
          fallback={
            <Button variant="icon" ghost aria-label="Search recurring tasks" onClick={() => setSearching(true)}>
              <Search size={16} aria-hidden="true" />
            </Button>
          }
        >
          <label class="tv-search">
            <Search size={14} aria-hidden="true" />
            <TextInput
              type="search"
              value={search()}
              autofocus
              onInput={(event) => setSearch(event.currentTarget.value)}
              onBlur={() => !search() && setSearching(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSearch("");
                  setSearching(false);
                }
              }}
              placeholder="Search recurring tasks"
              aria-label="Search recurring tasks"
            />
          </label>
        </Show>
        <Button variant="primary" class="tv-new" onClick={newRecurring}>
          <Plus size={15} stroke-width={2.4} aria-hidden="true" />
          Recurring task
        </Button>
      </div>
      <Branch>
        <Match when={routines.isError && !routines.data}>
          <section class="card tv-note">
            <p>The recurring tasks couldn't be loaded: {(routines.error as Error).message}</p>
          </section>
        </Match>
        <Match when={!routines.data}>
          <section class="card tv-note" aria-busy="true">
            <p class="muted">Loading recurring tasks…</p>
          </section>
        </Match>
        <Match when={true}>
          <Dock>
            <Show
              when={visible().length > 0 || (groupBy() === "folder" && !search() && (folders.data?.folders.length ?? 0) > 0)}
              fallback={
                <section class="card tv-note tv-note--row">
                  <Show
                    when={search()}
                    fallback={
                      <>
                        <p>No recurring tasks yet. A task can repeat on a schedule, or each time a webhook arrives.</p>
                        <Button size="compact" onClick={newRecurring}>
                          New recurring task
                        </Button>
                      </>
                    }
                  >
                    <p>No recurring tasks match this search.</p>
                  </Show>
                </section>
              }
            >
              <div class="tl tl--pinned rv">
                <div class="tl-scroll">
                  <div class="tl-sheet">
                    <For each={groups()}>
                      {(group) => (
                        <FolderCard
                          group={group}
                          groupBy={groupBy()}
                          open={!collapsed().has(group.key)}
                          onToggle={(isOpen) => {
                            const next = new Set(collapsed());
                            if (isOpen) next.delete(group.key);
                            else next.add(group.key);
                            setCollapsed(next);
                          }}
                          onFolderAction={setFolderDialog}
                        >
                          <For each={group.routines}>
                            {(routine) => (
                              <RoutineRow
                                routine={routine}
                                people={people}
                                occurrences={occurrences().get(routine.id) ?? []}
                                selected={openId() === routine.id}
                                expanded={expanded().has(routine.id)}
                                onExpand={(isOpen) => {
                                  const next = new Set(expanded());
                                  if (isOpen) next.add(routine.id);
                                  else next.delete(routine.id);
                                  setExpanded(next);
                                }}
                                onOpen={(section) => open(routine, section)}
                                onOpenTask={showTask}
                                onToggleActive={(on) => void toggleActive(routine, on)}
                              />
                            )}
                          </For>
                        </FolderCard>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </Show>
            <Show when={openId()}>
              {(id) => (
                <RecurringPanel
                  routineId={id()}
                  asModal={opensAs(taskOpenMode(), true) === "modal"}
                  onClose={close}
                  onOpenTask={showTask}
                  onPrevious={step(-1)}
                  onNext={step(1)}
                />
              )}
            </Show>
            <Show when={openTask()}>
              {(task) => (
                <Show
                  when={opensAs(taskOpenMode(), true) === "modal"}
                  fallback={<TaskPanel task={task()} onClose={closeTask} onOpenTask={showTask} />}
                >
                  <TaskModal task={task()} onClose={closeTask} onOpenTask={showTask} canDock />
                </Show>
              )}
            </Show>
          </Dock>
        </Match>
      </Branch>
      <FolderDialog value={folderDialog()} onClose={() => setFolderDialog(null)} />
    </>
  );
}

function FolderCard(props: {
  group: RecurringGroup;
  groupBy: RecurringGroupBy;
  open: boolean;
  onToggle: (open: boolean) => void;
  onFolderAction: (action: { mode: "new" | "rename" | "delete"; id?: string; name?: string }) => void;
  children: JSX.Element;
}) {
  return (
    <section class="tl-card" aria-label={props.group.label}>
      <div class="card tl-frame" aria-hidden="true" />
      <div class="tl-body">
        <div class="tl-bar tl-head">
          <Show when={props.groupBy === "folder"}>
            <Folder size={17} aria-hidden="true" class="rv-folder-icon" />
          </Show>
          <h2 class="disp">{props.group.label}</h2>
          <span class="tl-count">{props.group.routines.length}</span>
          <Show when={props.groupBy === "folder"}>
            <Menu placement="bottom-end">
              <Menu.Trigger class="btn btn--icon btn--ghost btn--compact tl-head-add" aria-label={`Folder actions for ${props.group.label}`}>
                <Ellipsis size={16} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label={`Folder actions for ${props.group.label}`} width={220}>
                <Menu.Item onSelect={() => props.onFolderAction({ mode: "new" })}>New folder</Menu.Item>
                <Show when={props.group.folderId}>
                  {(id) => (
                    <>
                      <Menu.Item onSelect={() => props.onFolderAction({ mode: "rename", id: id(), name: props.group.label })}>Rename folder</Menu.Item>
                      <Menu.Item danger description="Its recurring tasks move to Unfiled" onSelect={() => props.onFolderAction({ mode: "delete", id: id(), name: props.group.label })}>
                        Delete folder
                      </Menu.Item>
                    </>
                  )}
                </Show>
              </Menu.Content>
            </Menu>
          </Show>
          <button
            type="button"
            class="btn btn--icon btn--ghost btn--compact"
            classList={{ "tl-head-add": props.groupBy !== "folder" }}
            aria-label={`${props.open ? "Collapse" : "Expand"} ${props.group.label}`}
            aria-expanded={props.open}
            onClick={() => props.onToggle(!props.open)}
          >
            <ChevronDown size={14} stroke-width={2.2} aria-hidden="true" class="tl-chevron" classList={{ "tl-chevron--closed": !props.open }} />
          </button>
        </div>
        <Show when={props.open}>
          <div class="tl-cols" role="presentation">
            <span class="tl-pin-col tl-cols-name rv-cols-name">Name</span>
            <span>Assignee</span>
            <span>When</span>
            <span>Last run</span>
            <span>On</span>
          </div>
          <Show when={props.group.routines.length > 0} fallback={<p class="rv-empty">Nothing in this folder yet. Move a recurring task here from its panel.</p>}>
            <div role="list">{props.children}</div>
          </Show>
        </Show>
      </div>
    </section>
  );
}

function RoutineRow(props: {
  routine: RoutineListItem;
  people: ReturnType<typeof useTaskPeople>;
  occurrences: CompactIssue[];
  selected: boolean;
  expanded: boolean;
  onExpand: (open: boolean) => void;
  onOpen: (section?: "runs") => void;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
  onToggleActive: (on: boolean) => void;
}) {
  const company = useCompany();
  const on = () => props.routine.status === "active";
  const archived = () => props.routine.status === "archived";
  const kinds = () => triggerKinds(props.routine.triggers);
  const last = () => (props.routine.lastRun ? runOutcome(props.routine.lastRun) : null);
  const shown = () => props.occurrences.slice(0, SHOWN_OCCURRENCES);
  const canExpand = () => props.occurrences.length > 0;
  const plugin = () => props.routine.managedByPlugin?.pluginDisplayName ?? null;

  return (
    <div role="listitem">
      <div
        class="tl-row rv-row"
        classList={{ "tl-row--selected": props.selected, "rv-row--off": !on() }}
        onClick={(event) => {
          if ((event.target as Element).closest("a, button, input, [role='switch']")) return;
          props.onOpen();
        }}
      >
        <div class="tl-pin-col tl-name rv-name">
          <Show when={canExpand()} fallback={<span class="rv-expand-space" aria-hidden="true" />}>
            <button
              type="button"
              class="rv-expand"
              aria-expanded={props.expanded}
              aria-label={`${props.expanded ? "Hide" : "Show"} the tasks ${props.routine.title} made`}
              onClick={() => props.onExpand(!props.expanded)}
            >
              <ChevronRight size={14} stroke-width={2.4} aria-hidden="true" />
            </button>
          </Show>
          <span class="rv-icon" aria-hidden="true">
            <Repeat size={14} />
          </span>
          <a
            class="tl-title"
            href={`?show=recurring&recurring=${props.routine.id}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              props.onOpen();
            }}
          >
            {props.routine.title}
          </a>
          <Show when={plugin()}>{(name) => <span class="rv-badge">{name()}</span>}</Show>
          <Show when={archived()}>
            <span class="rv-badge">Archived</span>
          </Show>
        </div>
        <span class="rv-cell">
          <Assignee task={{ assigneeAgentId: props.routine.assigneeAgentId, assigneeUserId: null }} people={props.people} size={20} />
        </span>
        <span class="rv-cell rv-stack">
          <span class="rv-when">
            <For each={kinds()}>
              {(kind) => (
                <span class="rv-kind" role="img" aria-label={KIND_LABEL[kind]} title={KIND_LABEL[kind]}>
                  {KIND_ICON[kind]()}
                </span>
              )}
            </For>
            <span class="rv-ellipsis">{whenLabel(props.routine.triggers)}</span>
          </span>
          <span class="rv-sub">{nextLabel(props.routine, props.routine.triggers)}</span>
        </span>
        <span class="rv-cell rv-stack">
          <Show when={last()} fallback={<span class="rv-sub">No runs yet</span>}>
            {(outcome) => (
              <>
                <span class="rv-last" data-tone={outcome().tone}>
                  <Capsule gradient={outcome().gradient} size="row" live={outcome().live} />
                  <Show when={outcome().task?.identifier}>
                    {(identifier) => (
                      <a
                        class="mono rv-id"
                        href={issuePath(company().issuePrefix, outcome().task!)}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                          event.preventDefault();
                          props.onOpenTask(outcome().task!);
                        }}
                      >
                        {identifier()}
                      </a>
                    )}
                  </Show>
                  <span class="rv-ellipsis">{outcome().label}</span>
                </span>
                <span class="rv-sub">{formatFire(props.routine.lastRun!.triggeredAt)}</span>
              </>
            )}
          </Show>
        </span>
        <span class="rv-cell rv-on">
          <Switch label={`Active: ${props.routine.title}`} labelHidden checked={on()} disabled={archived()} onChange={(next) => props.onToggleActive(next)} />
        </span>
      </div>
      <Show when={props.expanded && canExpand()}>
        <ul class="rv-kids" aria-label={`Tasks ${props.routine.title} made`}>
          <For each={shown()}>
            {(task) => (
              <li class="tl-row rv-kid" onClick={(event) => !(event.target as Element).closest("a") && props.onOpenTask(task)}>
                <div class="tl-pin-col tl-name rv-kid-name">
                  <StatusCapsule status={task.status} size="row" live={task.status === "in_progress"} />
                  <span class="tl-id mono">{task.identifier}</span>
                  <a
                    class="tl-title"
                    href={issuePath(company().issuePrefix, task)}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                      event.preventDefault();
                      props.onOpenTask(task);
                    }}
                  >
                    {task.title}
                  </a>
                </div>
                <span />
                <span class="rv-sub">{updatedLabel(task.createdAt)}</span>
                <span class="rv-sub">{STATUS_META[task.status]?.label ?? task.status}</span>
                <span />
              </li>
            )}
          </For>
          <li class="rv-kids-foot">
            <button type="button" class="rv-all-runs" onClick={() => props.onOpen("runs")}>
              {props.occurrences.length > SHOWN_OCCURRENCES ? `All ${props.occurrences.length} tasks and runs` : "All runs"}
            </button>
          </li>
        </ul>
      </Show>
    </div>
  );
}

/** New folder, rename a folder, or delete one (its recurring tasks move to Unfiled). */
function FolderDialog(props: { value: { mode: "new" | "rename" | "delete"; id?: string; name?: string } | null; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(on(() => props.value, (value) => setName(value?.name ?? "")));
  const title = () => (props.value?.mode === "new" ? "New folder" : props.value?.mode === "rename" ? "Rename folder" : `Delete ${props.value?.name ?? "folder"}?`);
  const save = async () => {
    const value = props.value;
    if (!value) return;
    setBusy(true);
    try {
      if (value.mode === "new") await routinesApi.createFolder(company().id, name().trim());
      else if (value.mode === "rename") await routinesApi.renameFolder(company().id, value.id!, name().trim());
      else await routinesApi.deleteFolder(company().id, value.id!);
      refreshRecurring(client, company().id);
      props.onClose();
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't ${value.mode === "delete" ? "delete" : "save"} the folder`, body: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={props.value !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={title()}
      width={420}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button
            variant={props.value?.mode === "delete" ? "danger" : "primary"}
            disabled={busy() || (props.value?.mode !== "delete" && !name().trim())}
            onClick={() => void save()}
          >
            {props.value?.mode === "delete" ? "Delete folder" : "Save"}
          </Button>
        </>
      }
    >
      <Show
        when={props.value?.mode !== "delete"}
        fallback={<p class="rv-dialog-note">Its recurring tasks move to Unfiled. Nothing else changes.</p>}
      >
        <TextInput
          aria-label="Folder name"
          placeholder="Market data"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name().trim()) {
              event.preventDefault();
              void save();
            }
          }}
          autofocus
        />
      </Show>
    </Dialog>
  );
}
