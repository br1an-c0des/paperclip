import type { CompactIssue } from "@paperclipai/shared";
import { Archive, ArchiveRestore, Eye, EyeOff } from "lucide-solid";
import { For, Show } from "solid-js";
import { updatedLabel } from "@/tasks/list-model";
import { assigneeName, type TaskPeople } from "@/tasks/people";
import { RetryMark } from "@/tasks/retry";
import { Button } from "@/ui/Button";
import { StatusCapsule } from "@/ui/Status";
import { shownStatus, STATUS_META } from "@/ui/status-meta";
import { parentOf } from "./inbox-model";
import type { Inbox } from "./use-inbox";

/*
 * Updates, and the archived half of Cleared: the tasks you took part in, newest activity first,
 * as the old Inbox's Mine tab lists them. Unread ones carry a dot and count toward the tab.
 * Opening a task marks it read; archiving takes it out of your inbox, not off the task list.
 *
 * A subtask names its parent ("in TES-2"), from the rows or the read's context rows. An interrupted
 * task shows its state and Retry, as the task list does (src/tasks/retry.tsx); the state of a task
 * behind a failed run comes from the read's failure context.
 */

export function TaskRows(props: {
  tasks: readonly CompactIssue[];
  people: TaskPeople;
  inbox: Inbox;
  archived?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (task: CompactIssue) => void;
  empty: string;
}) {
  const parent = (task: CompactIssue) => parentOf(task, props.inbox.tasks.data ?? [], props.inbox.mineContext.data ?? []);
  return (
    <ul class="ibx-rows" aria-label={props.archived ? "Archived tasks" : "Your tasks"}>
      <For each={props.tasks} fallback={<li class="ibx-empty">{props.empty}</li>}>
        {(task) => (
          <li
            class="ibx-row ibx-task"
            classList={{ "ibx-row--selected": props.selectedId === task.id, "ibx-task--unread": !props.archived && task.isUnreadForMe === true }}
            data-inbox-item={task.id}
            tabindex="-1"
            onFocusIn={() => props.onSelect(task.id)}
            onPointerDown={() => props.onSelect(task.id)}
          >
            <span class="ibx-dot" aria-label={task.isUnreadForMe && !props.archived ? "Unread" : undefined} />
            <StatusCapsule status={shownStatus(task)} size="row" />
            <button type="button" class="ibx-task-open" onClick={() => props.onOpen(task)}>
              <span class="mono">{task.identifier}</span>
              <span class="ibx-row-title">{task.title}</span>
              <Show when={!props.archived && parent(task)}>
                {(found) => (
                  <span class="ibx-task-parent" title={`Subtask of ${found().identifier ?? ""} ${found().title}`.trim()}>
                    in {found().identifier ?? found().title}
                  </span>
                )}
              </Show>
            </button>
            <Show when={!props.archived}>
              <RetryMark task={task} retry={props.inbox.retry} />
            </Show>
            <span class="ibx-task-meta">
              {STATUS_META[shownStatus(task)].label} · {assigneeName(task, props.people)}
            </span>
            <span class="ibx-row-when">{updatedLabel(task.lastActivityAt ?? task.updatedAt)}</span>
            <span class="ibx-row-acts">
              <Show
                when={!props.archived}
                fallback={
                  <Button size="compact" variant="quiet" icon={<ArchiveRestore size={14} aria-hidden="true" />} onClick={() => props.inbox.unarchive(task)}>
                    Restore
                  </Button>
                }
              >
                <Show
                  when={task.isUnreadForMe}
                  fallback={
                    <Button size="compact" variant="icon" aria-label="Mark unread" title="Mark unread (Shift+U)" onClick={() => props.inbox.markUnread(task.id)}>
                      <EyeOff size={14} aria-hidden="true" />
                    </Button>
                  }
                >
                  <Button size="compact" variant="icon" aria-label="Mark read" title="Mark read (R)" onClick={() => props.inbox.markRead([task.id])}>
                    <Eye size={14} aria-hidden="true" />
                  </Button>
                </Show>
                <Button size="compact" variant="icon" aria-label="Archive from the inbox" title="Archive from the inbox (Y)" onClick={() => props.inbox.archive(task)}>
                  <Archive size={14} aria-hidden="true" />
                </Button>
              </Show>
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}
