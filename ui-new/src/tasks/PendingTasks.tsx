import { For, Show } from "solid-js";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useOptionalWriteQueue, useWritesFor } from "@/lib/offline/WriteQueueProvider";
import { WriteStatus } from "@/lib/offline/WriteStatus";
import type { QueuedWrite } from "@/lib/offline/write-queue";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { canReopen, restoreDraft } from "./new-task-saves";
import "./PendingTasks.css";

/*
 * New tasks still being saved (U153), at the top of the task list: each one as soon as Create
 * closes the dialog, with how it stands (sending, waiting for the connection, or failed with Retry,
 * Edit and Discard) until it lands and its real row takes its place. A project's list shows only
 * the project's.
 */

/** Takes a failed task's draft back into the new-task dialog, when the dialog is free (new-task-saves.ts). */
export function useReopenNewTask() {
  const commands = useCommands();
  const company = useCompany();
  const queue = useOptionalWriteQueue();
  return (write: QueuedWrite) => {
    if (!canReopen(write, { companyId: company().id, dialogOpen: commands.newTask() !== null })) return false;
    restoreDraft(write);
    queue?.discard(write.id);
    commands.openNewTask();
    return true;
  };
}

export function PendingTasks(props: { projectId?: string }) {
  const company = useCompany();
  const writes = useWritesFor(() => "new-task");
  const reopen = useReopenNewTask();
  const rows = () =>
    writes().filter((write) => write.companyId === company().id && (!props.projectId || write.request.body.projectId === props.projectId));
  const edit = (write: QueuedWrite) => {
    if (!reopen(write)) pushToast({ tone: "info", title: "Finish the task you're writing first", body: "Create or cancel the open draft, then edit this one." });
  };
  return (
    <Show when={rows().length > 0}>
      <section class="card pt" aria-label="New tasks being saved">
        <ul class="pt-list">
          <For each={rows()}>
            {(write) => (
              <li class="pt-row" classList={{ "pt-row--failed": write.status === "failed" }}>
                <span class="pt-name">
                  <Capsule gradient={write.status === "failed" ? "flare" : "ion"} size="tiny" queued={write.status !== "failed"} />
                  <span class="pt-title">{write.preview?.title ?? "New task"}</span>
                </span>
                <WriteStatus
                  write={write}
                  compact
                  waiting="Saved offline. It's created when Paperclip is back."
                  action={write.restore ? { label: "Edit", run: () => edit(write) } : undefined}
                />
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
