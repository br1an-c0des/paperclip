import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowDown, ArrowUp, Clock, CornerDownRight, Ellipsis, Pencil, Square, Trash2 } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { queuedCommentsApi } from "@/api/queued-comments";
import { Button } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { isFixed, moveEntry, preview, queueErrorMessage, queuedSummary, rowDelivery, visibleEntries, type QueueAction } from "./queue-model";
import "./QueuedMessages.css";

/*
 * Messages waiting for the agent's next turn (board 3's dashed row, steering/*). Each one can be
 * steered into the run that's going now (or, on runners that can't steer, the run interrupted so
 * the queue starts the next one), edited, moved, or cancelled. The queue polls while a run is
 * going, and every change echoes the queue's revision so a stale tab can't overwrite a newer one.
 */

export function useQueuedComments(taskId: () => string, active: () => boolean) {
  return createQuery(() => ({
    queryKey: queryKeys.issues.section(taskId(), "queued-comments"),
    queryFn: ({ signal }) => queuedCommentsApi.get(taskId(), signal),
    enabled: active(),
    refetchInterval: (query) => (active() || (query.state.data?.entries.length ?? 0) > 0 ? 2_000 : false),
  }));
}

/** The comment ids waiting in the queue, so the thread can leave them out. */
export function queuedIds(queue: IssueQueuedCommentQueue | undefined) {
  return new Set((queue?.entries ?? []).map((entry) => entry.comment.id));
}

export function QueuedMessages(props: { taskId: string; queue: IssueQueuedCommentQueue }) {
  const client = useQueryClient();
  const [delivering, setDelivering] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<{ id: string; body: string } | null>(null);
  const entries = () => visibleEntries(props.queue, delivering());
  const key = () => queryKeys.issues.section(props.taskId, "queued-comments");
  const version = () => ({ queueId: props.queue.queueId!, revision: props.queue.revision });

  const run = async (action: QueueAction, id: string, call: () => Promise<IssueQueuedCommentQueue>, delivered: string[] = []) => {
    if (busy() || !props.queue.queueId) return;
    setBusy(`${action}:${id}`);
    setError(null);
    if (delivered.length) setDelivering((now) => new Set([...now, ...delivered]));
    try {
      client.setQueryData(key(), await call());
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "comments") });
      return true;
    } catch (failure) {
      setDelivering((now) => new Set([...now].filter((value) => !delivered.includes(value))));
      setError(queueErrorMessage(failure, action));
      if (failure instanceof ApiError && failure.status === 409) void client.invalidateQueries({ queryKey: key() });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const steer = (entry: IssueQueuedCommentEntry) =>
    run("steer", entry.comment.id, () => queuedCommentsApi.steer(props.taskId, entry.comment.id, { ...version(), targetRunId: props.queue.targetRunId! }), [entry.comment.id]);
  const interrupt = () =>
    run("interrupt", "all", () => queuedCommentsApi.interrupt(props.taskId, { ...version(), targetRunId: props.queue.targetRunId }), entries().map((entry) => entry.comment.id));
  const discard = (entry: IssueQueuedCommentEntry) => run("discard", entry.comment.id, () => queuedCommentsApi.discard(props.taskId, entry.comment.id, version()), [entry.comment.id]);
  const move = (entry: IssueQueuedCommentEntry, delta: -1 | 1) => {
    const order = moveEntry(entries(), entry.comment.id, delta);
    if (order) void run("move", entry.comment.id, () => queuedCommentsApi.reorder(props.taskId, { ...version(), orderedCommentIds: order }));
  };
  const saveEdit = async () => {
    const edit = editing();
    if (!edit?.body.trim()) return;
    if (await run("edit", edit.id, () => queuedCommentsApi.edit(props.taskId, edit.id, { ...version(), body: edit.body }))) setEditing(null);
  };

  return (
    <Show when={entries().length > 0}>
      <section class="qm" aria-label="Queued messages">
        <div class="qm-head">
          <Clock size={14} aria-hidden="true" />
          <span>
            <b>{queuedSummary(entries().length)}</b> for the next turn
            <Show when={props.queue.executionWait?.message}>{(message) => <span class="qm-wait"> · {message()}</span>}</Show>
          </span>
          <Show when={props.queue.targetRunId}>
            <Button size="compact" variant="quiet" class="qm-interrupt" disabled={!!busy() || !props.queue.queueId} onClick={() => void interrupt()} title="Stop the current run and start the next one with these messages">
              <Square size={12} aria-hidden="true" />
              Interrupt and send
            </Button>
          </Show>
        </div>
        <ol class="qm-list">
          <For each={entries()}>
            {(entry, index) => {
              const delivery = () => rowDelivery(props.queue, entry);
              const fixed = isFixed(entry);
              return (
                <li class="qm-row">
                  <Show
                    when={editing()?.id === entry.comment.id}
                    fallback={
                      <>
                        <CornerDownRight size={14} class="qm-glyph" aria-hidden="true" />
                        <span class="qm-text">“{preview(entry.comment.body)}”</span>
                        <div class="qm-acts">
                          <Show when={delivery()}>
                            {(found) => (
                              <Button
                                size="compact"
                                variant="quiet"
                                class="qm-steer"
                                disabled={!found().enabled || !!busy()}
                                title={found().hint}
                                onClick={() => void (found().action === "steer" ? steer(entry) : interrupt())}
                              >
                                {found().action === "steer" ? "Steer now" : "Interrupt"}
                              </Button>
                            )}
                          </Show>
                          <Show when={entry.canEdit && !fixed}>
                            <Button size="compact" variant="quiet" disabled={!!busy()} onClick={() => setEditing({ id: entry.comment.id, body: entry.comment.body })}>
                              Edit
                            </Button>
                          </Show>
                          <Menu placement="bottom-end">
                            <Menu.Trigger class="qm-more" aria-label={`More for queued message ${index() + 1}`} disabled={!!busy()}>
                              <Ellipsis size={15} aria-hidden="true" />
                            </Menu.Trigger>
                            <Menu.Content label="Queued message" width={220}>
                              <Show when={!fixed}>
                                <Menu.Item icon={<ArrowUp size={14} />} disabled={index() === 0} onSelect={() => move(entry, -1)}>
                                  Move up
                                </Menu.Item>
                                <Menu.Item icon={<ArrowDown size={14} />} disabled={index() === entries().length - 1} onSelect={() => move(entry, 1)}>
                                  Move down
                                </Menu.Item>
                              </Show>
                              <Show when={entry.canEdit && !fixed}>
                                <Menu.Item icon={<Pencil size={14} />} onSelect={() => setEditing({ id: entry.comment.id, body: entry.comment.body })}>
                                  Edit
                                </Menu.Item>
                              </Show>
                              <Menu.Item icon={<Trash2 size={14} />} danger disabled={!entry.canDiscard} onSelect={() => void discard(entry)}>
                                Cancel message
                              </Menu.Item>
                            </Menu.Content>
                          </Menu>
                        </div>
                      </>
                    }
                  >
                    <form
                      class="qm-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdit();
                      }}
                    >
                      <TextArea
                        aria-label="Edit queued message"
                        rows={2}
                        value={editing()!.body}
                        ref={(element) => queueMicrotask(() => element.focus())}
                        onInput={(event) => setEditing({ id: entry.comment.id, body: event.currentTarget.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            void saveEdit();
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            setEditing(null);
                          }
                        }}
                      />
                      <div class="qm-edit-acts">
                        <Button size="compact" variant="quiet" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button type="submit" size="compact" variant="primary" disabled={!editing()!.body.trim() || !!busy()}>
                          Save
                        </Button>
                      </div>
                    </form>
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
        <Show when={error()}>
          <p class="qm-error" role="alert">
            {error()}
          </p>
        </Show>
      </section>
    </Show>
  );
}
