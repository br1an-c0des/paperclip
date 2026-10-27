import type { AttentionItem, CompactIssue } from "@paperclipai/shared";
import { A, Navigate, useParams } from "@solidjs/router";
import { Inbox as InboxIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { hasOpenDialog, isTextInputTarget } from "@/lib/shortcuts";
import { useTaskPeople } from "@/tasks/people";
import { Button } from "@/ui/Button";
import {
  DEFAULT_SNOOZE,
  filterByKind,
  INBOX_TABS,
  inboxKeyAction,
  itemKind,
  KIND_FILTERS,
  kindCounts,
  selectionAfterRemoval,
  stepSelection,
  tabFromPath,
  type InboxTab,
  type KindFilter,
} from "./inbox-model";
import { NeedsItem, ShelfRow } from "./InboxItem";
import { TaskRows } from "./InboxTasks";
import { useInbox } from "./use-inbox";
import "@/ui/Segmented.css";
import "./Inbox.css";

/*
 * `/:prefix/inbox/*` (board 14): everything waiting on you, in five tabs.
 *
 * - Needs you: one stack of request cards, most urgent first, with a kind filter. Cards answer in
 *   place, as in the task's thread.
 * - Updates: your tasks, unread first in the count. Alerts: what broke. Snoozed and Cleared: what
 *   you set aside, with Restore.
 * - Keys (inbox-model.ts, `inboxKeyAction`): j/k move, Enter opens the task in the task modal, y
 *   clears, s snoozes until tomorrow morning, a answers, r and Shift+U read state, u restores.
 *
 * The old Inbox's paths (`/inbox/mine`, `/inbox/unread`…) land on the closest tab.
 */

/** A menu or popover owns the keyboard while it's open (as the task list checks). */
function hasOpenLayer() {
  return document.querySelector('[data-layer="menu"], [data-layer="popover"]') !== null;
}

const KIND_GLYPH: Record<Exclude<KindFilter, "all">, string> = {
  question: "var(--g-tide)",
  proposal: "var(--g-orchid)",
  approval: "var(--g-ember)",
  signoff: "var(--g-lagoon)",
};

export function InboxPage() {
  const params = useParams<{ rest?: string }>();
  const company = useCompany();
  const base = () => `/${company().issuePrefix}/inbox`;
  const tab = () => tabFromPath(params.rest);
  const canonical = () => INBOX_TABS.find((entry) => entry.tab === tab())!.path;
  const redirect = () => (params.rest ?? "") !== canonical();
  return (
    <Show when={!redirect()} fallback={<Navigate href={canonical() ? `${base()}/${canonical()}` : base()} />}>
      <Inbox tab={tab()} base={base()} />
    </Show>
  );
}

function Inbox(props: { tab: InboxTab; base: string }) {
  const people = useTaskPeople();
  const commands = useCommands();
  const inbox = useInbox({ people, clearedOpen: () => props.tab === "cleared" });
  const [kind, setKind] = createSignal<KindFilter>("all");
  const [selected, setSelected] = createSignal<string | null>(null);

  const kindOf = (item: AttentionItem) => itemKind(item, inbox.requests().get(item.id));
  const counts = createMemo(() => kindCounts(inbox.groups().needs, kindOf));
  const needs = createMemo(() => filterByKind(inbox.groups().needs, kind(), kindOf));

  const tabCount = (tab: InboxTab): number | null => {
    const groups = inbox.groups();
    if (!inbox.feed.data && tab !== "updates") return null;
    switch (tab) {
      case "needs":
        return groups.needs.length;
      case "updates":
        return inbox.tasks.data ? inbox.unread() : null;
      case "alerts":
        return groups.alerts.length;
      case "snoozed":
        return groups.snoozed.length;
      default:
        return null;
    }
  };

  /** The rows of the current tab, in order, as the keys move through them. */
  const ids = createMemo((): string[] => {
    switch (props.tab) {
      case "needs":
        return needs().map((item) => item.id);
      case "alerts":
        return inbox.groups().alerts.map((item) => item.id);
      case "snoozed":
        return inbox.groups().snoozed.map((item) => item.id);
      case "cleared":
        return [...inbox.groups().cleared.map((item) => item.id), ...inbox.archived().map((task) => task.id)];
      case "updates":
        return (inbox.tasks.data ?? []).map((task) => task.id);
    }
  });
  const itemsById = createMemo(() => new Map((inbox.feed.data?.items ?? []).map((item) => [item.id, item] as const)));
  const tasksById = createMemo(() => new Map([...(inbox.tasks.data ?? []), ...inbox.archived()].map((task) => [task.id, task] as const)));

  // A new tab or filter starts with nothing selected; a row that leaves hands the cursor on.
  createEffect(on([() => props.tab, kind], () => setSelected(null), { defer: true }));
  let lastIds: string[] = [];
  createEffect(() => {
    const now = ids();
    const current = selected();
    if (current && !now.includes(current)) {
      const next = selectionAfterRemoval(lastIds, current);
      setSelected(next && now.includes(next) ? next : null);
    }
    lastIds = now;
  });

  let root: HTMLDivElement | undefined;
  const rowOf = (id: string) => root?.querySelector<HTMLElement>(`[data-inbox-item="${CSS.escape(id)}"]`) ?? null;
  const select = (id: string | null) => {
    setSelected(id);
    if (!id) return;
    const row = rowOf(id);
    if (row && !row.contains(document.activeElement)) row.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  };

  const openItem = (item: AttentionItem) => {
    const task = inbox.taskOf(item);
    if (!task) return;
    commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title ?? task.identifier ?? "", projectId: item.project?.id ?? null });
  };
  const openTask = (task: CompactIssue) => {
    if (task.isUnreadForMe) inbox.markRead([task.id]);
    commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title, projectId: task.projectId });
  };

  /** Moves focus into the selected card's first answer control. */
  const answer = (id: string) => {
    const control = rowOf(id)?.querySelector<HTMLElement>(
      ".ibx-main .rq-opt:not(:disabled), .ibx-main .rq-chip:not(:disabled), .ibx-main input:not(:disabled), .ibx-main textarea:not(:disabled), .ibx-main .rq-acts button:not(:disabled)",
    );
    control?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextInputTarget(event.target) || hasOpenDialog() || hasOpenLayer()) return;
    const action = inboxKeyAction(event.key);
    if (!action) return;
    // Enter on a button or link inside a row is that control's own press.
    if (action === "open" && event.key === "Enter" && (event.target as Element | null)?.closest?.("button, a, [role=radio], [role=checkbox]")) return;
    if (action === "next" || action === "previous") {
      event.preventDefault();
      select(stepSelection(ids(), selected(), action === "next" ? 1 : -1));
      return;
    }
    const id = selected();
    if (!id) return;
    const item = itemsById().get(id);
    const task = tasksById().get(id);
    const archived = inbox.archived().some((entry) => entry.id === id);
    const run = (fn: () => void) => {
      event.preventDefault();
      fn();
    };
    switch (action) {
      case "open":
        if (item) run(() => openItem(item));
        else if (task) run(() => openTask(task));
        break;
      case "clear":
        if (item && props.tab !== "cleared") run(() => inbox.clear(item));
        else if (task && !archived) run(() => inbox.archive(task));
        break;
      case "snooze":
        if (item && (props.tab === "needs" || props.tab === "alerts")) run(() => inbox.snooze(item, DEFAULT_SNOOZE.until(new Date())));
        break;
      case "answer":
        if (item && props.tab === "needs") run(() => answer(id));
        break;
      case "restore":
        if (item && (props.tab === "snoozed" || props.tab === "cleared")) run(() => inbox.restore(item));
        else if (task && archived) run(() => inbox.unarchive(task));
        break;
      case "read":
        if (task?.isUnreadForMe) run(() => inbox.markRead([task.id]));
        break;
      case "unread":
        if (task && !task.isUnreadForMe && !archived) run(() => inbox.markUnread(task.id));
        break;
    }
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  const unreadIds = () => (inbox.tasks.data ?? []).filter((task) => task.isUnreadForMe).map((task) => task.id);

  return (
    <div class="ibx" ref={root}>
      <header class="ibx-head">
        <h1 class="disp">
          <InboxIcon size={24} aria-hidden="true" />
          Inbox
        </h1>
        <nav class="tabs ibx-tabs" aria-label="Inbox views">
          <For each={INBOX_TABS}>
            {(entry) => (
              <A class="tab" href={entry.path ? `${props.base}/${entry.path}` : props.base} end>
                {entry.label}
                <Show when={tabCount(entry.tab)}>
                  {(count) => <span class="ibx-count" classList={{ "ibx-count--hot": entry.tab === "needs" }}>{count()}</span>}
                </Show>
              </A>
            )}
          </For>
        </nav>
      </header>

      <Switch>
        <Match when={props.tab === "needs"}>
          <div class="ibx-bar">
            <div class="seg ibx-kinds" role="group" aria-label="Request kinds">
              <For each={KIND_FILTERS}>
                {(filter) => (
                  <button type="button" aria-pressed={kind() === filter.value} onClick={() => setKind(filter.value)}>
                    <Show when={filter.value !== "all"}>
                      <span class="ibx-glyph" style={{ background: KIND_GLYPH[filter.value as Exclude<KindFilter, "all">] }} aria-hidden="true" />
                    </Show>
                    {filter.label}
                    <span class="ibx-kind-count">{counts()[filter.value]}</span>
                  </button>
                )}
              </For>
            </div>
            <span class="ibx-note">Most urgent first</span>
            <KeyHints keys={[["j k", "move"], ["y", "clear"], ["s", "snooze"], ["a", "answer"], ["enter", "open the task"]]} />
          </div>
          <FeedState inbox={inbox} empty={kind() === "all" ? "Nothing needs you right now." : "Nothing of this kind needs you."} count={needs().length}>
            <section class="ibx-stack" aria-label="Requests waiting on you">
              <For each={needs()}>
                {(item) => (
                  <NeedsItem
                    item={item}
                    request={inbox.requests().get(item.id)}
                    failed={inbox.sourceFailed(item)}
                    inbox={inbox}
                    people={people}
                    selected={selected() === item.id}
                    onSelect={() => setSelected(item.id)}
                    onOpen={() => openItem(item)}
                  />
                )}
              </For>
            </section>
          </FeedState>
        </Match>

        <Match when={props.tab === "alerts"}>
          <div class="ibx-bar">
            <span class="ibx-note">Failed runs, budget alerts, agent errors and stuck blockers, most urgent first</span>
            <KeyHints keys={[["j k", "move"], ["y", "clear"], ["s", "snooze"], ["enter", "open the task"]]} />
          </div>
          <FeedState inbox={inbox} empty="No alerts. Everything's running." count={inbox.groups().alerts.length}>
            <section class="ibx-stack" aria-label="Alerts">
              <For each={inbox.groups().alerts}>
                {(item) => (
                  <NeedsItem
                    item={item}
                    request={undefined}
                    failed={false}
                    inbox={inbox}
                    people={people}
                    selected={selected() === item.id}
                    onSelect={() => setSelected(item.id)}
                    onOpen={() => openItem(item)}
                  />
                )}
              </For>
            </section>
          </FeedState>
        </Match>

        <Match when={props.tab === "updates"}>
          <div class="ibx-bar">
            <span class="ibx-note">Tasks you took part in, latest activity first</span>
            <Show when={unreadIds().length > 0}>
              <Button size="compact" onClick={() => inbox.markRead(unreadIds())}>
                Mark all read
              </Button>
            </Show>
            <KeyHints keys={[["j k", "move"], ["r", "read"], ["⇧U", "unread"], ["y", "archive"], ["enter", "open"]]} />
          </div>
          <Show when={!inbox.tasks.isError} fallback={<p class="ibx-empty card">Couldn't load your tasks. {inbox.tasks.error?.message}</p>}>
            <Show when={inbox.tasks.data} fallback={<p class="ibx-empty card">Loading your tasks…</p>}>
              {(tasks) => (
                <TaskRows
                  tasks={tasks()}
                  people={people}
                  inbox={inbox}
                  selectedId={selected()}
                  onSelect={setSelected}
                  onOpen={openTask}
                  empty="No tasks yet. Tasks you create, comment on or are assigned show up here."
                />
              )}
            </Show>
          </Show>
        </Match>

        <Match when={props.tab === "snoozed" || props.tab === "cleared"}>
          <div class="ibx-bar">
            <span class="ibx-note">{props.tab === "snoozed" ? "Back in your inbox when the snooze ends" : "Cleared requests and alerts, and tasks you archived"}</span>
            <KeyHints keys={[["j k", "move"], ["u", "restore"], ["enter", "open the task"]]} />
          </div>
          <FeedState
            inbox={inbox}
            empty={props.tab === "snoozed" ? "Nothing snoozed." : "Nothing cleared."}
            count={(props.tab === "snoozed" ? inbox.groups().snoozed : inbox.groups().cleared).length + (props.tab === "cleared" ? inbox.archived().length : 0)}
          >
            <Show when={(props.tab === "snoozed" ? inbox.groups().snoozed : inbox.groups().cleared).length > 0}>
              <ul class="ibx-rows" aria-label={props.tab === "snoozed" ? "Snoozed" : "Cleared"}>
                <For each={props.tab === "snoozed" ? inbox.groups().snoozed : inbox.groups().cleared}>
                  {(item) => (
                    <ShelfRow
                      item={item}
                      pending={inbox.pendingStep(item.id)}
                      inbox={inbox}
                      selected={selected() === item.id}
                      onSelect={() => setSelected(item.id)}
                      onOpen={() => openItem(item)}
                    />
                  )}
                </For>
              </ul>
            </Show>
            <Show when={props.tab === "cleared" && inbox.archived().length > 0}>
              <h2 class="ibx-sub">Archived tasks</h2>
              <TaskRows tasks={inbox.archived()} archived people={people} inbox={inbox} selectedId={selected()} onSelect={setSelected} onOpen={openTask} empty="" />
            </Show>
          </FeedState>
        </Match>
      </Switch>
    </div>
  );
}

function KeyHints(props: { keys: [string, string][] }) {
  return (
    <div class="ibx-keys" aria-label="Keyboard shortcuts">
      <For each={props.keys}>
        {([keys, label]) => (
          <span>
            <For each={keys.split(" ")}>{(key) => <kbd>{key}</kbd>}</For> {label}
          </span>
        )}
      </For>
    </div>
  );
}

/** The feed's loading, error and empty states around a tab's list. */
function FeedState(props: { inbox: ReturnType<typeof useInbox>; empty: string; count: number; children: import("solid-js").JSX.Element }) {
  return (
    <Switch fallback={props.children}>
      <Match when={props.inbox.feed.isError}>
        <p class="ibx-empty card">Couldn't load the inbox. {props.inbox.feed.error?.message}</p>
      </Match>
      <Match when={!props.inbox.feed.data}>
        <p class="ibx-empty card">Loading your inbox…</p>
      </Match>
      <Match when={props.count === 0}>
        <p class="ibx-empty card">{props.empty}</p>
      </Match>
    </Switch>
  );
}
