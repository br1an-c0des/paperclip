import type { IssueAttachment, IssueDocumentSummary, IssueWorkProduct } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileText,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  Upload,
  X,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, lazy, Match, on, Show, Suspense, Switch, type JSX } from "solid-js";
import { documentsApi } from "@/api/documents";
import { fileResourcesApi, WORKSPACE_FILE_PAGE_SIZE } from "@/api/file-resources";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { openThreadCount } from "@/documents/annotation-model";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import {
  documentName,
  isMarkdownFile,
  isPlanKey,
  lockLabel,
  lockState,
  slugifyKey,
  sortDocuments,
  titleFromFilename,
} from "@/documents/document-model";
import { documentKeys, type DocumentHost } from "@/documents/host";
import { useThreads } from "@/documents/queries";
import { fileOpenFor, workspaceFileRef, type FileOpen } from "@/files/file-ref";
import { fileSize } from "@/files/preview";
import { viewport } from "@/layout/breakpoints";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { readDivergence } from "./branch-reconcile";
import { useTaskPeople, type TaskPeople } from "./people";
import { stampLabel } from "./thread-model";
import "./TaskFiles.css";

/*
 * The task panel's Docs and files section (board 5): the task's documents, its attachments and
 * what its runs produced (pull requests, branches, previews, artifacts), filtered by kind, and the
 * way into the workspace's files. Documents open in the document editor (src/documents/): new
 * documents, editing, revisions, locks and comments on the text. Files upload with the button or by
 * dropping them on the section; Markdown files become documents, as in the old UI. On a phone,
 * documents and files are read-only (mobile.md).
 */

type Kind = "all" | "documents" | "attachments" | "outputs";

type View =
  | { kind: "list" }
  | { kind: "doc"; key: string; edit: boolean }
  | { kind: "new" }
  | { kind: "files"; open: FileOpen | null };

const OUTPUT_ICONS: Record<string, () => JSX.Element> = {
  pull_request: () => <GitPullRequest size={16} aria-hidden="true" />,
  branch: () => <GitBranch size={16} aria-hidden="true" />,
  commit: () => <GitCommit size={16} aria-hidden="true" />,
  preview_url: () => <Globe size={16} aria-hidden="true" />,
  runtime_service: () => <Server size={16} aria-hidden="true" />,
  document: () => <FileText size={16} aria-hidden="true" />,
  artifact: () => <Package size={16} aria-hidden="true" />,
};

function byWhom(people: TaskPeople, agentId: string | null | undefined, userId: string | null | undefined) {
  const agent = people.agent(agentId);
  if (agent) return agent.name;
  if (userId) return userId === people.youId() ? "You" : people.personName(userId);
  return null;
}

const words = (value: string) => value.replace(/_/g, " ");

// The editor and the file viewer load when first opened, not with the task panel.
const DocumentView = lazy(() => import("@/documents/DocumentView").then((module) => ({ default: module.DocumentView })));
const NewDocument = lazy(() => import("@/documents/NewDocument").then((module) => ({ default: module.NewDocument })));
const WorkspaceFiles = lazy(() => import("@/files/WorkspaceFiles").then((module) => ({ default: module.WorkspaceFiles })));

export function TaskFiles(props: { taskId: string; /** A document to open, from a `#document-<key>` link. */ openDocKey?: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const phone = () => viewport() === "phone";
  const [view, setView] = createSignal<View>({ kind: "list" });
  const [kind, setKind] = createSignal<Kind>("all");
  const [searching, setSearching] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [uploading, setUploading] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let picker: HTMLInputElement | undefined;
  let importer: HTMLInputElement | undefined;

  // A `#document-<key>` link opens that document, when it arrives or another task opens.
  createEffect(
    on([() => props.openDocKey, () => props.taskId], ([key]) => {
      if (key) setView({ kind: "doc", key, edit: false });
    }),
  );

  const host = createMemo<DocumentHost>(() => ({
    owner: { kind: "issue", id: props.taskId },
    root: queryKeys.issues.section(props.taskId, "documents"),
    nameOf: (agentId, userId) => byWhom(people, agentId, userId),
    youId: () => people.youId(),
  }));

  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const documents = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "documents"),
    queryFn: ({ signal }) => issuesApi.listDocuments(props.taskId, signal),
  }));
  const attachments = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "attachments"),
    queryFn: ({ signal }) => issuesApi.listAttachments(props.taskId, signal),
  }));
  const outputs = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "work-products"),
    queryFn: ({ signal }) => issuesApi.listWorkProducts(props.taskId, signal),
  }));
  // The same request the file viewer opens with, so its count here is shared with it.
  const workspace = () => task.data?.currentExecutionWorkspace ?? null;
  const hasWorkspace = () => Boolean(task.data?.executionWorkspaceId || task.data?.currentExecutionWorkspace || task.data?.projectWorkspaceId);
  const changed = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "files", "list", "auto", "", "changed", ""),
    queryFn: ({ signal }) => fileResourcesApi.list(props.taskId, { mode: "changed", limit: WORKSPACE_FILE_PAGE_SIZE }, signal),
    enabled: view().kind === "list" && hasWorkspace(),
    staleTime: 30_000,
    retry: false,
  }));

  const matches = (...texts: (string | null | undefined)[]) => {
    const terms = search().toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = texts.filter(Boolean).join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
  const docs = createMemo(() => sortDocuments((documents.data ?? []).filter((doc) => matches(doc.title, doc.key))));
  const files = createMemo(() => (attachments.data ?? []).filter((file) => matches(file.originalFilename, file.contentType)));
  const made = createMemo(() => (outputs.data ?? []).filter((output) => matches(output.title, output.summary, output.provider)));
  const total = () => docs().length + files().length + made().length;
  const show = (section: Exclude<Kind, "all">) => kind() === "all" || kind() === section;
  const loading = () => documents.isPending || attachments.isPending || outputs.isPending;

  const refreshDocuments = () => client.invalidateQueries({ queryKey: documentKeys.list(host()) });

  const importDocument = async (file: File) => {
    const key = slugifyKey(file.name);
    const existing = (documents.data ?? []).find((doc) => doc.key === key) ?? null;
    if (existing?.lockedAt) throw new Error(`“${documentName(existing)}” is locked`);
    const title = existing ? existing.title : titleFromFilename(file.name) || null;
    await documentsApi.upsert(host().owner, key, {
      title: isPlanKey(key) ? null : title,
      format: "markdown",
      body: await file.text(),
      baseRevisionId: existing?.latestRevisionId ?? null,
    });
    return { key, replaced: Boolean(existing) };
  };

  const upload = async (list: FileList | null, options: { asDocuments?: boolean } = {}) => {
    const chosen = [...(list ?? [])];
    if (chosen.length === 0) return;
    setUploading((count) => count + chosen.length);
    let imported: string | null = null;
    for (const file of chosen) {
      try {
        if (options.asDocuments || isMarkdownFile(file)) {
          const result = await importDocument(file);
          imported = result.key;
          pushToast({ tone: "success", title: result.replaced ? `Updated the document “${result.key}” from ${file.name}` : `Added ${file.name} as a document` });
        } else {
          await issuesApi.uploadAttachment(company().id, props.taskId, file);
        }
      } catch (error) {
        pushToast({ tone: "error", title: `Couldn't upload ${file.name}`, body: error instanceof Error ? error.message : String(error) });
      } finally {
        setUploading((count) => count - 1);
      }
    }
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
    if (imported && chosen.length === 1) setView({ kind: "doc", key: imported, edit: false });
  };

  const backToList = () => setView({ kind: "list" });

  return (
    <Suspense fallback={<p class="tsec-muted tf-loading">Loading…</p>}>
      <Switch>
        <Match when={view().kind === "doc" && (view() as Extract<View, { kind: "doc" }>)}>
          {(open) => (
            <DocumentView
              host={host()}
              docKey={open().key}
              editOnOpen={open().edit}
              backLabel="Back to docs and files"
              onBack={backToList}
              onDeleted={backToList}
            />
          )}
        </Match>
        <Match when={view().kind === "new"}>
          <NewDocument
            host={host()}
            existingKeys={(documents.data ?? []).map((doc) => doc.key)}
            backLabel="Back to docs and files"
            onBack={backToList}
            onCreated={(key) => setView({ kind: "doc", key, edit: false })}
          />
        </Match>
        <Match when={view().kind === "files" && (view() as Extract<View, { kind: "files" }>)}>
          {(open) => <WorkspaceFiles taskId={props.taskId} open={open().open} backLabel="Back to docs and files" onBack={backToList} />}
        </Match>
        <Match when={true}>
          <section
            class="tf"
            classList={{ "tf--dragging": dragging() }}
            aria-label="Docs and files"
            onDragOver={(event) => {
              if (phone() || !event.dataTransfer?.types.includes("Files")) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer?.files.length) return;
              event.preventDefault();
              setDragging(false);
              void upload(event.dataTransfer.files);
            }}
          >
            <div class="tsec-head">
              <h2 class="disp">{loading() ? "Docs and files" : `${total()} item${total() === 1 ? "" : "s"}`}</h2>
              <div class="tsec-head-tools">
                <button
                  type="button"
                  class="btn btn--icon btn--ghost btn--compact"
                  aria-label={searching() ? "Close search" : "Search docs and files"}
                  aria-pressed={searching()}
                  onClick={() => {
                    setSearching(!searching());
                    if (!searching()) setSearch("");
                  }}
                >
                  {searching() ? <X size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
                </button>
                <Button size="compact" icon={<Upload size={14} aria-hidden="true" />} disabled={uploading() > 0} onClick={() => picker?.click()}>
                  {uploading() > 0 ? "Uploading…" : "Upload"}
                </Button>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    void upload(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </div>
            <Show when={searching()}>
              <div class="tf-search">
                <TextInput
                  type="search"
                  value={search()}
                  ref={(element) => queueMicrotask(() => element.focus())}
                  onInput={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search docs and files"
                  aria-label="Search docs and files"
                />
              </div>
            </Show>

            <div class="tsec-scroll">
              <Segmented
                label="Show"
                options={[
                  { value: "all", label: `All ${total()}` },
                  { value: "documents", label: `Documents ${docs().length}` },
                  { value: "attachments", label: `Attachments ${files().length}` },
                  { value: "outputs", label: `Outputs ${made().length}` },
                ]}
                value={kind()}
                onChange={setKind}
              />
              <Switch>
                <Match when={loading()}>
                  <p class="tsec-muted">Loading…</p>
                </Match>
                <Match when={documents.isError || attachments.isError || outputs.isError}>
                  <p class="tsec-muted">
                    Some of this task's files couldn't be loaded: {((documents.error ?? attachments.error ?? outputs.error) as Error).message}
                  </p>
                </Match>
                <Match when={true}>
                  <Show when={show("documents")}>
                    <FileGroup
                      title="Documents"
                      count={docs().length}
                      empty="No documents."
                      tools={
                        <Show when={!phone()}>
                          <Button size="compact" variant="quiet" disabled={uploading() > 0} onClick={() => importer?.click()}>
                            Import .md
                          </Button>
                          <input
                            ref={importer}
                            type="file"
                            accept=".md,.markdown,text/markdown"
                            multiple
                            hidden
                            onChange={(event) => {
                              void upload(event.currentTarget.files, { asDocuments: true });
                              event.currentTarget.value = "";
                            }}
                          />
                          <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setView({ kind: "new" })}>
                            New document
                          </Button>
                        </Show>
                      }
                    >
                      <div class="card tf-docs">
                        <For each={docs()}>
                          {(doc) => (
                            <DocumentRow
                              doc={doc}
                              host={host()}
                              people={people}
                              phone={phone()}
                              onOpen={(edit) => setView({ kind: "doc", key: doc.key, edit })}
                              onChanged={() => void refreshDocuments()}
                            />
                          )}
                        </For>
                      </div>
                    </FileGroup>
                  </Show>
                  <Show when={show("attachments")}>
                    <FileGroup title="Attachments" count={files().length} empty="No attachments. Drop files here to add them.">
                      <div class="tf-tiles">
                        <For each={files()}>
                          {(file) => (
                            <AttachmentTile
                              file={file}
                              people={people}
                              canDelete={!phone()}
                              onDeleted={() => void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "attachments") })}
                            />
                          )}
                        </For>
                      </div>
                    </FileGroup>
                  </Show>
                  <Show when={show("outputs")}>
                    <FileGroup title="Outputs" count={made().length} empty="Nothing produced yet: pull requests, branches and previews from runs show here.">
                      <div class="tf-outputs">
                        <For each={made()}>
                          {(output) => <OutputCard output={output} onOpenFile={(open) => setView({ kind: "files", open })} />}
                        </For>
                      </div>
                    </FileGroup>
                  </Show>
                  <Show when={kind() === "all" || kind() === "outputs"}>
                    <button type="button" class="tf-browse" onClick={() => setView({ kind: "files", open: null })}>
                      <span class="tf-output-icon">
                        <FolderGit2 size={16} aria-hidden="true" />
                      </span>
                      <span class="tf-browse-text">
                        <span class="tf-browse-title">Browse workspace files</span>
                        <span class="tsec-muted">
                          <Show when={workspace()} fallback={hasWorkspace() ? "The task's workspace" : "No workspace yet"}>
                            {(current) => <span class="mono">{current().branchName ?? current().name}</span>}
                          </Show>
                          <Show when={changed.data?.state === "available" && changed.data}>
                            {(list) => (
                              <>
                                {" "}
                                · {list().items.length}
                                {list().truncated ? "+" : ""} changed file{list().items.length === 1 ? "" : "s"}
                              </>
                            )}
                          </Show>
                          <Show when={readDivergence(task.data?.activeRecoveryAction)}>
                            {" "}
                            · <span class="tf-diverged">branch out of step: see Workspace</span>
                          </Show>
                        </span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" class="tf-browse-chevron" />
                    </button>
                  </Show>
                </Match>
              </Switch>
            </div>
            <Show when={dragging()}>
              <div class="tf-drop" aria-hidden="true">
                <Upload size={20} />
                Drop to attach to this task
              </div>
            </Show>
          </section>
        </Match>
      </Switch>
    </Suspense>
  );
}

function FileGroup(props: { title: string; count: number; empty: string; tools?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="tf-group" aria-label={props.title}>
      <div class="tf-group-head">
        <h3 class="tf-group-title">
          {props.title} <span class="tsec-muted">{props.count}</span>
        </h3>
        <Show when={props.tools}>
          <div class="tf-group-tools">{props.tools}</div>
        </Show>
      </div>
      <Show when={props.count > 0} fallback={<p class="tsec-muted">{props.empty}</p>}>
        {props.children}
      </Show>
    </section>
  );
}

function DocumentRow(props: {
  doc: IssueDocumentSummary;
  host: DocumentHost;
  people: TaskPeople;
  phone: boolean;
  onOpen: (edit: boolean) => void;
  onChanged: () => void;
}) {
  const threads = useThreads(() => props.host, () => props.doc.key);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const author = () =>
    byWhom(props.people, props.doc.updatedByAgentId, props.doc.updatedByUserId) ??
    byWhom(props.people, props.doc.createdByAgentId, props.doc.createdByUserId);
  const lock = () => lockState(props.doc, props.people.youId());
  const label = () =>
    lockLabel(lock(), (holder) =>
      holder.kind === "agent" ? byWhom(props.people, holder.id, null) : holder.kind === "user" ? byWhom(props.people, null, holder.id) : null,
    );
  const open = () => openThreadCount(threads.data ?? []);

  const setLocked = async (locked: boolean) => {
    setBusy(true);
    try {
      if (locked) await documentsApi.lock(props.host.owner, props.doc.key);
      else await documentsApi.unlock(props.host.owner, props.doc.key);
      props.onChanged();
    } catch (error) {
      pushToast({ tone: "error", title: locked ? "Couldn't lock the document" : "Couldn't unlock the document", body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await documentsApi.remove(props.host.owner, props.doc.key);
      props.onChanged();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't delete the document", body: (error as Error).message });
    }
  };

  return (
    <div class="tf-doc">
      <span class="tf-doc-icon" data-plan={isPlanKey(props.doc.key) || undefined}>
        <FileText size={16} aria-hidden="true" />
      </span>
      <div class="tf-doc-text">
        <div class="tf-doc-line">
          <button type="button" class="tf-doc-title" onClick={() => props.onOpen(false)}>
            {documentName(props.doc)}
          </button>
          <Show when={isPlanKey(props.doc.key)}>
            <span class="tf-pill tf-pill--run">Task plan</span>
          </Show>
          <Show when={lock().locked}>
            <span class="tf-pill tf-pill--amber">
              <Lock size={10} aria-hidden="true" />
              {label()}
            </span>
          </Show>
        </div>
        <span class="tsec-muted tf-doc-by">
          <span class="mono">{props.doc.key}</span> · rev {props.doc.latestRevisionNumber}
          <Show when={author()}>{(name) => <> · {name()}</>}</Show> · {stampLabel(props.doc.updatedAt)}
        </span>
      </div>
      <Show when={open() > 0}>
        <span class="tf-doc-comments" title={`${open()} open comment${open() === 1 ? "" : "s"}`}>
          <MessageSquare size={13} aria-hidden="true" />
          {open()} open
        </span>
      </Show>
      <Menu placement="bottom-end">
        <Menu.Trigger class="btn btn--icon btn--ghost btn--compact" aria-label={`${documentName(props.doc)} actions`}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Content label={`${documentName(props.doc)} actions`} width={240}>
          <Menu.Item icon={<FileText size={14} />} onSelect={() => props.onOpen(false)}>
            Open
          </Menu.Item>
          <Show when={!props.phone}>
            <Menu.Item
              icon={<Pencil size={14} />}
              disabled={lock().locked}
              description={lock().locked ? "Unlock it first" : undefined}
              onSelect={() => props.onOpen(true)}
            >
              Edit
            </Menu.Item>
          </Show>
          <Menu.Item
            icon={lock().locked ? <LockOpen size={14} /> : <Lock size={14} />}
            disabled={busy()}
            description={lock().locked ? label() : "Nobody can change it until it's unlocked"}
            onSelect={() => void setLocked(!lock().locked)}
          >
            {lock().locked ? "Unlock" : "Lock"}
          </Menu.Item>
          <Show when={!props.phone}>
            <Menu.Separator />
            <Menu.Item
              icon={<Trash2 size={14} />}
              danger
              disabled={lock().locked}
              description={lock().locked ? "Unlock it first" : undefined}
              onSelect={() => setConfirmDelete(true)}
            >
              Delete
            </Menu.Item>
          </Show>
        </Menu.Content>
      </Menu>
      <ConfirmDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete this document?"
        body={<>“{documentName(props.doc)}” and its revision history will be deleted. This can't be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
    </div>
  );
}

function AttachmentTile(props: { file: IssueAttachment; people: TaskPeople; canDelete: boolean; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const name = () => props.file.originalFilename ?? props.file.objectKey.split("/").pop() ?? "File";
  const image = () => props.file.contentType.startsWith("image/");
  const open = () => props.file.openPath ?? props.file.contentPath;
  const author = () => byWhom(props.people, props.file.createdByAgentId, props.file.createdByUserId);
  const remove = async () => {
    try {
      await issuesApi.deleteAttachment(props.file.id);
      props.onDeleted();
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't delete ${name()}`, body: (error as Error).message });
    }
  };
  return (
    <div class="tf-tile">
      <a class="tf-tile-preview" href={open()} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name()}`}>
        <Show when={image()} fallback={<File size={22} aria-hidden="true" />}>
          <img src={props.file.contentPath} alt="" loading="lazy" />
        </Show>
      </a>
      <div class="tf-tile-text">
        <span class="tf-tile-name" title={name()}>
          {name()}
        </span>
        <span class="tsec-muted">
          {fileSize(props.file.byteSize)}
          <Show when={author()}>{(who) => <> · {who()}</>}</Show>
        </span>
      </div>
      <div class="tf-tile-actions">
        <a
          class="btn btn--icon btn--ghost btn--compact"
          href={props.file.downloadPath ?? `${props.file.contentPath}?download=1`}
          aria-label={`Download ${name()}`}
          title="Download"
        >
          <Download size={14} aria-hidden="true" />
        </a>
        <Show when={props.canDelete}>
          <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label={`Delete ${name()}`} title="Delete" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </Show>
      </div>
      <ConfirmDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete this attachment?"
        body={<>“{name()}” will be removed from the task. This can't be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
    </div>
  );
}

function OutputCard(props: { output: IssueWorkProduct; onOpenFile: (open: FileOpen) => void }) {
  const icon = () => (OUTPUT_ICONS[props.output.type] ?? OUTPUT_ICONS.artifact!)();
  const ref = () => workspaceFileRef(props.output);
  return (
    <div class="card tf-output" data-primary={props.output.isPrimary || undefined}>
      <span class="tf-output-icon">{icon()}</span>
      <div class="tf-output-text">
        <Show when={props.output.url} fallback={<span class="tf-output-title">{props.output.title}</span>}>
          {(url) => (
            <a class="tf-output-title" href={url()} target="_blank" rel="noopener noreferrer">
              {props.output.title}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </Show>
        <span class="tsec-muted">
          {words(props.output.type)} · {props.output.provider} · {words(String(props.output.status))}
          <Show when={props.output.reviewState !== "none"}> · {words(props.output.reviewState)}</Show>
        </span>
        <Show when={props.output.summary}>{(summary) => <p class="tf-output-summary">{summary()}</p>}</Show>
        <Show when={ref()}>
          {(file) => (
            <div class="tf-output-actions">
              <Button size="compact" icon={<FileText size={14} aria-hidden="true" />} onClick={() => props.onOpenFile(fileOpenFor(file()))}>
                Open <span class="mono tf-output-path">{file().displayPath}</span>
              </Button>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
