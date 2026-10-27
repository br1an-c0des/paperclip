import type { DocumentRevision, IssueDocument } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  History,
  Lock,
  LockOpen,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { documentsApi } from "@/api/documents";
import { viewport } from "@/layout/breakpoints";
import { stampLabel } from "@/tasks/thread-model";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { CommentsPanel, newCommentBlock, openThreadCount, useAnnotationLayer, useThreads, type PendingComment } from "./Annotations";
import type { SelectionAnchor } from "./annotation-model";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  classifySaveError,
  diffCounts,
  documentName,
  draftFrom,
  draftProblem,
  editBlock,
  isDirty,
  isPlanKey,
  lineDiff,
  lockLabel,
  lockState,
  revisionState,
  upsertPayload,
  viewedRevision,
  type Draft,
  type LockHolder,
} from "./document-model";
import { documentKeys, type DocumentHost } from "./host";
import { MarkdownEditor } from "./MarkdownEditor";
import "./DocumentView.css";

/*
 * One document, read and edited (board 5's document; phone board M5): the rendered Markdown with
 * comments on its text, the editor, revision history with restore, and the lock. On a phone the
 * document is read-only, as mobile.md has it.
 *
 * Saving sends the revision the edit started from. If someone saved in between, the server refuses
 * and the editor shows both versions: keep editing, take theirs, or overwrite with yours. A locked
 * document can't be saved, restored or deleted until someone unlocks it; the header says who holds
 * the lock.
 */

export function DocumentView(props: {
  host: DocumentHost;
  docKey: string;
  /** Open straight into the editor, as after New document or a row's Edit. */
  editOnOpen?: boolean;
  backLabel: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const phone = () => viewport() === "phone";

  const doc = createQuery(() => ({
    queryKey: documentKeys.doc(props.host, props.docKey),
    queryFn: ({ signal }) => documentsApi.get(props.host.owner, props.docKey, signal),
  }));
  const [historyWanted, setHistoryWanted] = createSignal(false);
  const revisions = createQuery(() => ({
    queryKey: documentKeys.revisions(props.host, props.docKey),
    queryFn: ({ signal }) => documentsApi.revisions(props.host.owner, props.docKey, signal),
    enabled: historyWanted(),
  }));
  const threads = useThreads(() => props.host, () => props.docKey);

  const [selectedRevision, setSelectedRevision] = createSignal<string | null>(null);
  const [compare, setCompare] = createSignal(false);
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [tab, setTab] = createSignal<"write" | "preview">("write");
  const [saving, setSaving] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [conflict, setConflict] = createSignal<IssueDocument | null>(null);
  const [showTheirs, setShowTheirs] = createSignal(false);
  const [busy, setBusy] = createSignal<"lock" | "restore" | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [pendingLeave, setPendingLeave] = createSignal<(() => void) | null>(null);

  const [commentsOpen, setCommentsOpen] = createSignal(false);
  const [focusedThread, setFocusedThread] = createSignal<string | null>(null);
  const [selection, setSelection] = createSignal<PendingComment | null>(null);
  const [composing, setComposing] = createSignal<SelectionAnchor | null>(null);
  const [textEl, setTextEl] = createSignal<HTMLElement>();

  const revState = createMemo(() => (doc.data ? revisionState(doc.data, revisions.data ?? []) : null));
  const viewing = createMemo(() => {
    const state = revState();
    return state ? viewedRevision(state, selectedRevision()) : null;
  });
  const lock = createMemo(() => (doc.data ? lockState(doc.data, props.host.youId()) : ({ locked: false } as const)));
  const lockSince = () => {
    const current = lock();
    return current.locked ? current.since : null;
  };
  const editing = () => draft() !== null;
  const dirty = () => {
    const current = draft();
    return current ? isDirty(current, doc.data) : false;
  };
  const blocked = () => editBlock({ lock: lock(), viewingHistory: viewing() !== null, phone: phone() });
  const commentBlock = () => newCommentBlock({ editing: editing(), viewingHistory: viewing() !== null, hasRevision: Boolean(doc.data?.latestRevisionId) });
  const shownBody = () => viewing()?.body ?? doc.data?.body ?? "";
  const holderName = (holder: LockHolder) =>
    holder.kind === "agent" ? props.host.nameOf(holder.id, null) : holder.kind === "user" ? props.host.nameOf(null, holder.id) : null;
  const author = (revision: Pick<DocumentRevision, "createdByAgentId" | "createdByUserId">) =>
    props.host.nameOf(revision.createdByAgentId, revision.createdByUserId);

  const refresh = () => client.invalidateQueries({ queryKey: documentKeys.list(props.host) });
  const store = (result: IssueDocument) => {
    client.setQueryData(documentKeys.doc(props.host, props.docKey), result);
    void refresh();
  };

  // Open in the editor once, if asked and allowed.
  let openedEditor = false;
  createEffect(() => {
    if (openedEditor || !props.editOnOpen || !doc.data) return;
    openedEditor = true;
    if (blocked() === null) setDraft(draftFrom(doc.data));
  });

  // A lock that arrives while editing (someone else locked it) leaves the draft but stops saving.
  createEffect(on(() => lock().locked, (locked) => locked && editing() && setFailure("This document was locked. Unlock it to save your changes."), { defer: true }));

  const layer = useAnnotationLayer({
    container: textEl,
    markdown: shownBody,
    threads: () => threads.data ?? [],
    focusedId: focusedThread,
    pendingText: () => composing()?.selectedText ?? null,
    enabled: () => !editing() && viewing() === null,
    onSelect: setSelection,
    onFocusThread: (id) => {
      setCommentsOpen(true);
      setFocusedThread(id);
    },
  });

  const guard = (action: () => void) => {
    if (dirty()) setPendingLeave(() => action);
    else action();
  };

  const startEditing = () => {
    if (!doc.data || blocked() !== null) return;
    setFailure(null);
    setConflict(null);
    setTab("write");
    setSelection(null);
    setDraft(draftFrom(doc.data));
  };

  const stopEditing = () => {
    setDraft(null);
    setConflict(null);
    setFailure(null);
  };

  const save = async (options: { close: boolean; base?: string | null }) => {
    const current = draft();
    if (!current || saving()) return;
    if (lock().locked) {
      setFailure(`${lockLabel(lock(), holderName)}. Unlock it to save your changes.`);
      return;
    }
    const problem = draftProblem(current);
    if (problem) {
      setFailure(problem);
      return;
    }
    if (conflict() && options.base === undefined) return;
    if (doc.data && !isDirty(current, doc.data) && options.base === undefined) {
      if (options.close) stopEditing();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const result = await documentsApi.upsert(props.host.owner, props.docKey, upsertPayload(current, options.base ?? current.baseRevisionId));
      store(result);
      setConflict(null);
      void client.invalidateQueries({ queryKey: documentKeys.revisions(props.host, props.docKey) });
      void client.invalidateQueries({ queryKey: documentKeys.annotations(props.host, props.docKey) });
      if (options.close) setDraft(null);
      else setDraft((value) => (value ? { ...value, baseRevisionId: result.latestRevisionId } : value));
    } catch (error) {
      const failed = classifySaveError(error);
      if (failed.kind === "conflict") {
        try {
          setConflict(await documentsApi.get(props.host.owner, props.docKey));
          setShowTheirs(false);
        } catch {
          setFailure("This document changed while you were editing, and the latest version couldn't be loaded.");
        }
      } else {
        setFailure(failed.message);
        if (failed.kind === "locked") void client.invalidateQueries({ queryKey: documentKeys.doc(props.host, props.docKey) });
      }
    } finally {
      setSaving(false);
    }
  };

  const setLocked = async (locked: boolean) => {
    if (locked && dirty()) {
      pushToast({ tone: "warn", title: "Save or cancel your edits before locking this document." });
      return;
    }
    setBusy("lock");
    try {
      const result = locked ? await documentsApi.lock(props.host.owner, props.docKey) : await documentsApi.unlock(props.host.owner, props.docKey);
      store(result);
      if (locked) stopEditing();
      else setFailure(null);
    } catch (error) {
      pushToast({ tone: "error", title: locked ? "Couldn't lock the document" : "Couldn't unlock the document", body: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (revision: DocumentRevision) => {
    setBusy("restore");
    try {
      const result = await documentsApi.restore(props.host.owner, props.docKey, revision.id);
      store(result);
      setSelectedRevision(null);
      setCompare(false);
      void client.invalidateQueries({ queryKey: documentKeys.revisions(props.host, props.docKey) });
      pushToast({ tone: "success", title: `Restored revision ${revision.revisionNumber} as revision ${result.latestRevisionNumber}` });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't restore the revision", body: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    try {
      await documentsApi.remove(props.host.owner, props.docKey);
      client.removeQueries({ queryKey: documentKeys.doc(props.host, props.docKey) });
      void refresh();
      props.onDeleted();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't delete the document", body: (error as Error).message });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shownBody());
      pushToast({ tone: "success", title: "Copied the document's Markdown" });
    } catch {
      pushToast({ tone: "error", title: "Couldn't copy the document" });
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([shownBody()], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = viewing() ? `${props.docKey}-rev-${viewing()!.revisionNumber}.md` : `${props.docKey}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const startComment = () => {
    const picked = selection();
    if (!picked) return;
    setComposing({ selector: picked.selector, selectedText: picked.selectedText });
    setSelection(null);
    setFocusedThread(null);
    setCommentsOpen(true);
  };

  const title = () => (doc.data ? documentName(viewing() ?? doc.data) : props.docKey);

  return (
    <section
      class="tf dv"
      aria-label={`Document ${title()}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && editing() && !event.defaultPrevented) {
          event.preventDefault();
          guard(stopEditing);
        }
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m" && selection()) {
          event.preventDefault();
          startComment();
        }
      }}
    >
      <div class="tsec-head dv-head">
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label={props.backLabel} onClick={() => guard(props.onBack)}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div class="dv-heading">
          <h2 class="disp dv-title">{title()}</h2>
          <Show when={doc.data}>
            {(current) => (
              <span class="tsec-muted dv-meta">
                <span class="mono">{current().key}</span> · rev {viewing()?.revisionNumber ?? current().latestRevisionNumber}
                <Show when={author(viewing() ?? revState()!.current)}>{(name) => <> · {name()}</>}</Show> ·{" "}
                {stampLabel(viewing()?.createdAt ?? current().updatedAt)}
              </span>
            )}
          </Show>
        </div>
        <Show when={doc.data && !editing()}>
          <div class="tsec-head-tools">
            <button
              type="button"
              class="btn btn--well btn--compact dv-comments-btn"
              aria-pressed={commentsOpen()}
              aria-label={`Comments, ${openThreadCount(threads.data ?? [])} open`}
              onClick={() => setCommentsOpen(!commentsOpen())}
            >
              <MessageSquare size={14} aria-hidden="true" />
              {openThreadCount(threads.data ?? [])}
            </button>
            <Menu onOpenChange={(open) => open && setHistoryWanted(true)}>
              <Menu.Trigger class="btn btn--secondary btn--compact" aria-label="Revision history">
                <History size={14} aria-hidden="true" />
                rev {viewing()?.revisionNumber ?? doc.data!.latestRevisionNumber}
                <ChevronDown size={13} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Revisions" width={280}>
                <Show when={!revisions.isPending} fallback={<p class="dv-menu-note">Loading revisions…</p>}>
                  <For each={revState()?.revisions ?? []}>
                    {(revision) => (
                      <Menu.Item
                        icon={(viewing()?.id ?? revState()?.current.id) === revision.id ? <Check size={14} /> : <span />}
                        description={`${author(revision) ?? "Unknown"} · ${stampLabel(revision.createdAt)}`}
                        hint={revision.id === revState()?.current.id ? "Current" : undefined}
                        onSelect={() => {
                          setSelectedRevision(revision.id === revState()?.current.id ? null : revision.id);
                          setCompare(false);
                          setSelection(null);
                        }}
                      >
                        Revision {revision.revisionNumber}
                      </Menu.Item>
                    )}
                  </For>
                </Show>
              </Menu.Content>
            </Menu>
            <Show when={blocked() === null}>
              <Button size="compact" variant="primary" icon={<Pencil size={14} aria-hidden="true" />} onClick={startEditing}>
                Edit
              </Button>
            </Show>
            <Menu placement="bottom-end">
              <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label="Document actions">
                <MoreHorizontal size={16} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Document actions" width={240}>
                <Menu.Item
                  icon={lock().locked ? <LockOpen size={14} /> : <Lock size={14} />}
                  description={lock().locked ? lockLabel(lock(), holderName) : "Nobody can change it until it's unlocked"}
                  disabled={busy() === "lock"}
                  onSelect={() => void setLocked(!lock().locked)}
                >
                  {lock().locked ? "Unlock" : "Lock"}
                </Menu.Item>
                <Menu.Item icon={<Copy size={14} />} onSelect={() => void copy()}>
                  Copy Markdown
                </Menu.Item>
                <Menu.Item icon={<Download size={14} />} onSelect={download}>
                  Download .md
                </Menu.Item>
                <Show when={!phone()}>
                  <Menu.Separator />
                  <Menu.Item
                    icon={<Trash2 size={14} />}
                    danger
                    disabled={lock().locked}
                    description={lock().locked ? "Unlock it first" : undefined}
                    onSelect={() => setConfirmDelete(true)}
                  >
                    Delete document
                  </Menu.Item>
                </Show>
              </Menu.Content>
            </Menu>
          </div>
        </Show>
      </div>

      <div class="tsec-scroll dv-scroll">
        <Switch>
          <Match when={doc.isPending}>
            <p class="tsec-muted">Loading…</p>
          </Match>
          <Match when={doc.isError}>
            <p class="tsec-muted">This document couldn't be loaded: {(doc.error as Error).message}</p>
          </Match>
          <Match when={doc.data}>
            {(current) => (
              <>
                <Show when={lock().locked}>
                  <div class="dv-banner dv-banner--amber" role="status">
                    <Lock size={15} aria-hidden="true" />
                    <span class="dv-banner-text">
                      <strong>{lockLabel(lock(), holderName)}</strong>
                      <Show when={lockSince()}>{(since) => <> since {stampLabel(since())}</>}</Show>. It can't be edited, restored or deleted until
                      it's unlocked.
                    </span>
                    <Button size="compact" icon={<LockOpen size={14} aria-hidden="true" />} disabled={busy() === "lock"} onClick={() => void setLocked(false)}>
                      Unlock
                    </Button>
                  </div>
                </Show>

                <Show when={viewing()}>
                  {(revision) => (
                    <div class="dv-banner dv-banner--amber" role="status">
                      <History size={15} aria-hidden="true" />
                      <span class="dv-banner-text">
                        <strong>Revision {revision().revisionNumber}</strong> of {current().latestRevisionNumber}. Restoring it saves it as a new revision; history is kept.
                      </span>
                      <div class="dv-banner-actions">
                        <Button size="compact" variant="quiet" aria-pressed={compare()} onClick={() => setCompare(!compare())}>
                          {compare() ? "Show text" : "Changes to current"}
                        </Button>
                        <Button size="compact" variant="quiet" onClick={() => setSelectedRevision(null)}>
                          Back to current
                        </Button>
                        <Show when={!lock().locked && !phone()}>
                          <Button size="compact" variant="primary" disabled={busy() === "restore"} onClick={() => void restore(revision())}>
                            {busy() === "restore" ? "Restoring…" : "Restore"}
                          </Button>
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>

                <Show when={conflict()}>
                  {(theirs) => (
                    <div class="dv-banner dv-banner--amber dv-banner--stack" role="alert">
                      <span class="dv-banner-text">
                        <strong>Changed while you were editing.</strong> Revision {theirs().latestRevisionNumber}
                        <Show when={props.host.nameOf(theirs().updatedByAgentId, theirs().updatedByUserId)}>{(name) => <> by {name()}</>}</Show> is
                        now the latest. Your edits are kept here.
                      </span>
                      <div class="dv-banner-actions">
                        <Button size="compact" variant="quiet" aria-pressed={showTheirs()} onClick={() => setShowTheirs(!showTheirs())}>
                          {showTheirs() ? "Hide differences" : "Show differences"}
                        </Button>
                        <Button
                          size="compact"
                          onClick={() => {
                            setDraft(draftFrom(theirs()));
                            setConflict(null);
                          }}
                        >
                          Use theirs
                        </Button>
                        <Button size="compact" variant="primary" disabled={saving()} onClick={() => void save({ close: true, base: theirs().latestRevisionId })}>
                          Overwrite with mine
                        </Button>
                      </div>
                      <Show when={showTheirs()}>
                        <DiffView before={theirs().body} after={draft()?.body ?? ""} beforeLabel={`Theirs, rev ${theirs().latestRevisionNumber}`} afterLabel="Yours" />
                      </Show>
                    </div>
                  )}
                </Show>

                <Show when={failure()}>
                  {(message) => (
                    <p class="dv-failure" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>

                <div class="dv-grid" data-comments={commentsOpen() && !editing() ? "" : undefined}>
                  <div class="dv-main">
                    <Switch>
                      <Match when={draft()}>
                        {(editingDraft) => (
                          <div class="dv-editor">
                            <Show when={!isPlanKey(current().key)}>
                              <TextInput
                                value={editingDraft().title}
                                placeholder="Title (optional)"
                                aria-label="Document title"
                                onInput={(event) => setDraft({ ...editingDraft(), title: event.currentTarget.value })}
                              />
                            </Show>
                            <Segmented
                              label="Editor view"
                              options={[
                                { value: "write", label: "Write" },
                                { value: "preview", label: "Preview" },
                              ]}
                              value={tab()}
                              onChange={setTab}
                            />
                            <Show
                              when={tab() === "write"}
                              fallback={
                                <div class="dv-preview">
                                  <Show when={editingDraft().body.trim()} fallback={<p class="tsec-muted">Nothing to preview yet.</p>}>
                                    <Markdown source={editingDraft().body} />
                                  </Show>
                                </div>
                              }
                            >
                              <MarkdownEditor
                                value={editingDraft().body}
                                label={`${title()} (Markdown)`}
                                placeholder="Write in Markdown…"
                                autofocus={!props.editOnOpen || isPlanKey(current().key)}
                                onChange={(body) => setDraft((value) => (value ? { ...value, body } : value))}
                                onSave={() => void save({ close: false })}
                              />
                            </Show>
                          </div>
                        )}
                      </Match>
                      <Match when={viewing() && compare()}>
                        <DiffView
                          before={viewing()!.body}
                          after={current().body}
                          beforeLabel={`Revision ${viewing()!.revisionNumber}`}
                          afterLabel={`Current, revision ${current().latestRevisionNumber}`}
                        />
                      </Match>
                      <Match when={true}>
                        <div class="dv-text" ref={setTextEl}>
                          <Show when={shownBody().trim()} fallback={<p class="tsec-muted">This document is empty.</p>}>
                            <Markdown source={shownBody()} />
                          </Show>
                          <Show when={selection()}>
                            {(picked) => (
                              <Button
                                size="compact"
                                variant="primary"
                                class="dc-float"
                                style={{ top: `${picked().top}px`, left: `${picked().left}px` }}
                                icon={<MessageSquarePlus size={14} aria-hidden="true" />}
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={startComment}
                              >
                                Comment
                              </Button>
                            )}
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  </div>
                  <Show when={commentsOpen() && !editing()}>
                    <CommentsPanel
                      host={props.host}
                      docKey={props.docKey}
                      threads={threads.data ?? []}
                      loading={threads.isPending}
                      revision={{ id: current().latestRevisionId, number: current().latestRevisionNumber }}
                      blocked={commentBlock()}
                      pending={composing()}
                      focusedId={focusedThread()}
                      onFocus={(id) => {
                        setFocusedThread(id);
                        if (id) layer.reveal(id);
                      }}
                      onClearPending={() => setComposing(null)}
                      onClose={() => {
                        setCommentsOpen(false);
                        setComposing(null);
                        setFocusedThread(null);
                      }}
                    />
                  </Show>
                </div>
              </>
            )}
          </Match>
        </Switch>
      </div>

      <Show when={editing()}>
        <div class="dv-foot">
          <span class="tsec-muted dv-foot-note">{dirty() ? "Unsaved changes · Ctrl+S saves" : "No changes"}</span>
          <Button size="compact" variant="quiet" onClick={() => guard(stopEditing)}>
            Cancel
          </Button>
          <Button size="compact" variant="primary" disabled={saving() || lock().locked || Boolean(conflict())} onClick={() => void save({ close: true })}>
            {saving() ? "Saving…" : "Save"}
          </Button>
        </div>
      </Show>

      <ConfirmDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete this document?"
        body={<>“{title()}” and its revision history will be deleted. This can't be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
      <ConfirmDialog
        open={pendingLeave() !== null}
        onOpenChange={(open) => !open && setPendingLeave(null)}
        title="Discard your changes?"
        body="Your edits to this document haven't been saved."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          const action = pendingLeave();
          setPendingLeave(null);
          stopEditing();
          action?.();
        }}
      />
    </section>
  );
}

/** Two versions of a document side by side as a line diff. */
export function DiffView(props: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const rows = createMemo(() => lineDiff(props.before, props.after));
  const counts = createMemo(() => diffCounts(rows()));
  return (
    <div class="dv-diff">
      <p class="tsec-muted dv-diff-legend">
        {props.beforeLabel} → {props.afterLabel}: <span class="dv-diff-add">+{counts().added}</span>{" "}
        <span class="dv-diff-del">−{counts().removed}</span>
      </p>
      <Show when={counts().added + counts().removed > 0} fallback={<p class="tsec-muted">No differences.</p>}>
        <div class="dv-diff-rows mono" role="table" aria-label="Line differences">
          <For each={rows()}>
            {(row) => (
              <div class="dv-diff-row" data-kind={row.kind} role="row">
                <span class="dv-diff-num" role="cell">
                  {row.oldLine ?? ""}
                </span>
                <span class="dv-diff-num" role="cell">
                  {row.newLine ?? ""}
                </span>
                <span class="dv-diff-sign" role="cell" aria-label={row.kind === "added" ? "added" : row.kind === "removed" ? "removed" : undefined}>
                  {row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}
                </span>
                <span class="dv-diff-text" role="cell">
                  {row.text || " "}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
