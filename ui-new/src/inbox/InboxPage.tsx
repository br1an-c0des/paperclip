import type { AttentionItem, CompactIssue } from "@paperclipai/shared";
import { A, Navigate, useParams } from "@solidjs/router";
import { ChevronRight, Inbox as InboxIcon, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { hasOpenDialog, isTextInputTarget } from "@/lib/shortcuts";
import { useTaskPeople } from "@/tasks/people";
import { Button } from "@/ui/Button";
import {
  activityGroups,
  agingLabel,
  arrivalGroups,
  DEFAULT_SNOOZE,
  filterByKind,
  isFresh,
  lastLookedLabel,
  itemWords,
  matchesTerms,
  searchTerms,
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
import { AgingRow, NeedsItem, ShelfRow } from "./InboxItem";
import { TaskRows } from "./InboxTasks";
import { useLastSeen } from "./seen";
import { useInbox } from "./use-inbox";
import "@/ui/Segmented.css";
import "./Inbox.css";

/*
 * `/:prefix/inbox/*` (board 14): everything waiting on you, in five tabs.
 *
 * - Needs you: request cards, most urgent first, with a kind filter, in New today and Earlier, then
 *   the aging shelf folded at the bottom (requests idle past their retention days, with Keep).
 *   Cards answer in place, as in the task's thread; "New" marks what arrived since you last looked.
 * - Updates: your tasks, grouped by latest activity (M10), unread first in the count. Alerts: what
 *   broke. Snoozed and Cleared: what you set aside, with Restore.
 * - Search (the magnifier; `/` stays the command palette's) narrows the open tab to what matches every word typed: titles,
 *   tasks, why it's here, who asked, the request's own text.
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
  const company = useCompany();
  const seen = useLastSeen(() => company().id);
  const [kind, setKind] = createSignal<KindFilter>("all");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [agingOpen, setAgingOpen] = createSignal(false);
  const terms = createMemo(() => searchTerms(query()));

  /** Whether an item matches the search: the feed's words, and its card's once loaded. */
  const found = (item: AttentionItem) => {
    const request = inbox.requests().get(item.id);
    return matchesTerms(terms(), [...itemWords(item), request?.title, request?.body, request?.asker.name]);
  };
  const searched = (items: readonly AttentionItem[]) => (terms().length ? items.filter(found) : [...items]);

  const kindOf = (item: AttentionItem) => itemKind(item, inbox.requests().get(item.id));
  const counts = createMemo(() => kindCounts(searched(inbox.groups().needs), kindOf));
  const needs = createMemo(() => filterByKind(searched(inbox.groups().needs), kind(), kindOf));
  const arrivals = createMemo(() => arrivalGroups(needs()));
  const today = createMemo(() => arrivals().find((group) => group.key === "today")?.items ?? []);
  const earlier = createMemo(() => arrivals().find((group) => group.key === "earlier")?.items ?? []);
  const aging = createMemo(() => filterByKind(searched(inbox.groups().aging), kind(), kindOf));
  const alerts = createMemo(() => searched(inbox.groups().alerts));
  const snoozed = createMemo(() => searched(inbox.groups().snoozed));
  const cleared = createMemo(() => searched(inbox.groups().cleared));
  const taskFound = (task: CompactIssue) => matchesTerms(terms(), [task.identifier, task.title]);
  const tasks = createMemo(() => (inbox.tasks.data ?? []).filter(taskFound));
  const archived = createMemo(() => inbox.archived().filter(taskFound));
  const updateGroups = createMemo(() => activityGroups(tasks(), (task) => task.lastActivityAt ?? task.updatedAt));

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

  /** The rows of the current tab, in the order they're drawn, as the keys move through them. */
  const ids = createMemo((): string[] => {
    switch (props.tab) {
      case "needs":
        return [...today(), ...earlier(), ...(agingOpen() ? aging() : [])].map((item) => item.id);
      case "alerts":
        return alerts().map((item) => item.id);
      case "snoozed":
        return snoozed().map((item) => item.id);
      case "cleared":
        return [...cleared().map((item) => item.id), ...archived().map((task) => task.id)];
      case "updates":
        return updateGroups().flatMap((group) => group.items.map((task) => task.id));
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

  let searchInput: HTMLInputElement | undefined;
  const openSearch = () => {
    setSearching(true);
    queueMicrotask(() => searchInput?.focus());
  };
  const closeSearch = () => {
    setQuery("");
    setSearching(false);
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
  const fresh = (item: AttentionItem) => isFresh(item, seen.at());
  const needsItem = (item: AttentionItem) => (
    <NeedsItem
      item={item}
      request={inbox.requests().get(item.id)}
      failed={inbox.sourceFailed(item)}
      inbox={inbox}
      people={people}
      selected={selected() === item.id}
      fresh={fresh(item)}
      onSelect={() => setSelected(item.id)}
      onOpen={() => openItem(item)}
    />
  );
  const searchNote = (count: number) => (terms().length ? <span class="ibx-note">{count === 1 ? "1 match" : `${count} matches`}</span> : null);

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
        <div class="ibx-head-end">
          <Show
            when={searching()}
            fallback={
              <Button variant="icon" size="compact" ghost aria-label="Search the inbox" title="Search the inbox" onClick={openSearch}>
                <Search size={16} aria-hidden="true" />
              </Button>
            }
          >
            <label class="ibx-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                placeholder="Search the inbox"
                aria-label="Search the inbox"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
              />
              <button type="button" class="ibx-search-x" aria-label="Close the search" onClick={closeSearch}>
                <X size={14} aria-hidden="true" />
              </button>
            </label>
          </Show>
        </div>
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
            {searchNote(needs().length + aging().length)}
            <KeyHints keys={[["j k", "move"], ["y", "clear"], ["s", "snooze"], ["a", "answer"], ["enter", "open the task"]]} />
          </div>
          <FeedState
            inbox={inbox}
            empty={terms().length ? "Nothing waiting on you matches the search." : kind() === "all" ? "Nothing needs you right now." : "Nothing of this kind needs you."}
            count={needs().length + aging().length}
          >
            <Show when={needs().length === 0}>
              <p class="ibx-empty card">{kind() === "all" && !terms().length ? "Nothing new needs you. Older requests are below." : "Nothing recent matches. Older requests are below."}</p>
            </Show>
            <Show when={today().length > 0}>
              <section class="ibx-group" aria-labelledby="ibx-today">
                <h2 class="ibx-sub" id="ibx-today">
                  New today <span class="ibx-sub-count">{today().length}</span>
                </h2>
                <div class="ibx-stack">
                  <For each={today()}>{(item) => needsItem(item)}</For>
                </div>
              </section>
            </Show>
            <Show when={earlier().length > 0}>
              <section class="ibx-group" aria-labelledby="ibx-earlier">
                <h2 class="ibx-sub" id="ibx-earlier">
                  Earlier <span class="ibx-sub-count">{earlier().length}</span>
                </h2>
                <div class="ibx-stack">
                  <For each={earlier()}>{(item) => needsItem(item)}</For>
                </div>
              </section>
            </Show>
            <Show when={aging().length > 0}>
              <section class="ibx-group ibx-aging" aria-label={agingLabel(aging())}>
                <button type="button" class="ibx-fold" aria-expanded={agingOpen()} aria-controls="ibx-aging-rows" onClick={() => setAgingOpen((open) => !open)}>
                  <ChevronRight size={15} aria-hidden="true" class="ibx-fold-icon" />
                  <span class="ibx-sub">{agingLabel(aging())}</span>
                  <span class="ibx-sub-count">{aging().length}</span>
                  <span class="ibx-note">Gone quiet. Keep one to bring it back.</span>
                </button>
                <Show when={agingOpen()}>
                  <ul class="ibx-rows" id="ibx-aging-rows" aria-label={agingLabel(aging())}>
                    <For each={aging()}>
                      {(item) => <AgingRow item={item} inbox={inbox} selected={selected() === item.id} onSelect={() => setSelected(item.id)} onOpen={() => openItem(item)} />}
                    </For>
                  </ul>
                </Show>
              </section>
            </Show>
          </FeedState>
        </Match>

        <Match when={props.tab === "alerts"}>
          <div class="ibx-bar">
            <span class="ibx-note">Failed runs, budget alerts, agent errors and stuck blockers, most urgent first</span>
            {searchNote(alerts().length)}
            <KeyHints keys={[["j k", "move"], ["y", "clear"], ["s", "snooze"], ["enter", "open the task"]]} />
          </div>
          <FeedState inbox={inbox} empty={terms().length ? "No alerts match the search." : "No alerts. Everything's running."} count={alerts().length}>
            <section class="ibx-stack" aria-label="Alerts">
              <For each={alerts()}>
                {(item) => (
                  <NeedsItem
                    item={item}
                    request={undefined}
                    failed={false}
                    inbox={inbox}
                    people={people}
                    selected={selected() === item.id}
                    fresh={fresh(item)}
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
            <span class="ibx-note">
              {unreadIds().length ? `${unreadIds().length} unread` : "All caught up"}
              {seen.known ? ` · you last looked ${lastLookedLabel(seen.at())}` : ""}
            </span>
            {searchNote(tasks().length)}
            <Show when={unreadIds().length > 0}>
              <Button size="compact" onClick={() => inbox.markRead(unreadIds())}>
                Mark all read
              </Button>
            </Show>
            <KeyHints keys={[["j k", "move"], ["r", "read"], ["⇧U", "unread"], ["y", "archive"], ["enter", "open"]]} />
          </div>
          <Show when={!inbox.tasks.isError} fallback={<p class="ibx-empty card">Couldn't load your tasks. {inbox.tasks.error?.message}</p>}>
            <Show when={inbox.tasks.data} fallback={<p class="ibx-empty card">Loading your tasks…</p>}>
              <Show
                when={updateGroups().length > 0}
                fallback={
                  <p class="ibx-empty card">{terms().length ? "None of your tasks match the search." : "No tasks yet. Tasks you create, comment on or are assigned show up here."}</p>
                }
              >
                <For each={updateGroups()}>
                  {(group) => (
                    <section class="ibx-group" aria-labelledby={`ibx-upd-${group.key}`}>
                      <h2 class="ibx-sub" id={`ibx-upd-${group.key}`}>
                        {group.label} <span class="ibx-sub-count">{group.items.length}</span>
                      </h2>
                      <TaskRows tasks={group.items} people={people} inbox={inbox} selectedId={selected()} onSelect={setSelected} onOpen={openTask} empty="" />
                    </section>
                  )}
                </For>
              </Show>
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
            empty={terms().length ? "Nothing here matches the search." : props.tab === "snoozed" ? "Nothing snoozed." : "Nothing cleared."}
            count={(props.tab === "snoozed" ? snoozed() : cleared()).length + (props.tab === "cleared" ? archived().length : 0)}
          >
            <Show when={(props.tab === "snoozed" ? snoozed() : cleared()).length > 0}>
              <ul class="ibx-rows" aria-label={props.tab === "snoozed" ? "Snoozed" : "Cleared"}>
                <For each={props.tab === "snoozed" ? snoozed() : cleared()}>
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
            <Show when={props.tab === "cleared" && archived().length > 0}>
              <h2 class="ibx-sub">Archived tasks</h2>
              <TaskRows tasks={archived()} archived people={people} inbox={inbox} selectedId={selected()} onSelect={setSelected} onOpen={openTask} empty="" />
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
