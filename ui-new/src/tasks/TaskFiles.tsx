import type { IssueAttachment, IssueDocumentSummary, IssueWorkProduct } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, Download, ExternalLink, File, FileText, GitBranch, GitCommit, GitPullRequest, Globe, Lock, Package, Search, Server, Upload, X } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { useTaskPeople, type TaskPeople } from "./people";
import { stampLabel } from "./thread-model";
import "./TaskFiles.css";

/*
 * The task panel's Docs and files section (board 5): the task's documents, its attachments and
 * what its runs produced (pull requests, branches, previews, artifacts), filtered by kind. A
 * document opens here, read-only; files upload with the button or by dropping them on the
 * section. Writing and editing documents come with the document editor slice of M2, and browsing
 * the workspace's files with the file viewer.
 */

type Kind = "all" | "documents" | "attachments" | "outputs";

const OUTPUT_ICONS: Record<string, () => JSX.Element> = {
  pull_request: () => <GitPullRequest size={16} aria-hidden="true" />,
  branch: () => <GitBranch size={16} aria-hidden="true" />,
  commit: () => <GitCommit size={16} aria-hidden="true" />,
  preview_url: () => <Globe size={16} aria-hidden="true" />,
  runtime_service: () => <Server size={16} aria-hidden="true" />,
  document: () => <FileText size={16} aria-hidden="true" />,
  artifact: () => <Package size={16} aria-hidden="true" />,
};

/** "820 B", "14 KB", "2.4 MB". */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function byWhom(people: TaskPeople, agentId: string | null, userId: string | null) {
  const agent = people.agent(agentId);
  if (agent) return agent.name;
  if (userId) return userId === people.youId() ? "You" : people.personName(userId);
  return null;
}

const words = (value: string) => value.replace(/_/g, " ");

export function TaskFiles(props: { taskId: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const [kind, setKind] = createSignal<Kind>("all");
  const [searching, setSearching] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [openKey, setOpenKey] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let picker: HTMLInputElement | undefined;

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

  const matches = (...texts: (string | null | undefined)[]) => {
    const words = search().toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = texts.filter(Boolean).join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const docs = createMemo(() => (documents.data ?? []).filter((doc) => matches(doc.title, doc.key)));
  const files = createMemo(() => (attachments.data ?? []).filter((file) => matches(file.originalFilename, file.contentType)));
  const made = createMemo(() => (outputs.data ?? []).filter((output) => matches(output.title, output.summary, output.provider)));
  const total = () => docs().length + files().length + made().length;
  const show = (section: Exclude<Kind, "all">) => kind() === "all" || kind() === section;
  const loading = () => documents.isPending || attachments.isPending || outputs.isPending;

  const upload = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (chosen.length === 0) return;
    setUploading((count) => count + chosen.length);
    for (const file of chosen) {
      try {
        await issuesApi.uploadAttachment(company().id, props.taskId, file);
      } catch (error) {
        pushToast({ tone: "error", title: `Couldn't upload ${file.name}`, body: error instanceof Error ? error.message : String(error) });
      } finally {
        setUploading((count) => count - 1);
      }
    }
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.taskId) });
  };

  return (
    <Show when={openKey()} fallback={
      <section
        class="tf"
        classList={{ "tf--dragging": dragging() }}
        aria-label="Docs and files"
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
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
          <h2 class="disp">
            {loading() ? "Docs and files" : `${total()} item${total() === 1 ? "" : "s"}`}
          </h2>
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
                <FileGroup title="Documents" count={docs().length} empty="No documents.">
                  <div class="card tf-docs">
                    <For each={docs()}>{(doc) => <DocumentRow doc={doc} people={people} onOpen={() => setOpenKey(doc.key)} />}</For>
                  </div>
                </FileGroup>
              </Show>
              <Show when={show("attachments")}>
                <FileGroup title="Attachments" count={files().length} empty="No attachments. Drop files here to add them.">
                  <div class="tf-tiles">
                    <For each={files()}>{(file) => <AttachmentTile file={file} people={people} />}</For>
                  </div>
                </FileGroup>
              </Show>
              <Show when={show("outputs")}>
                <FileGroup title="Outputs" count={made().length} empty="Nothing produced yet: pull requests, branches and previews from runs show here.">
                  <div class="tf-outputs">
                    <For each={made()}>{(output) => <OutputCard output={output} />}</For>
                  </div>
                </FileGroup>
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
    }>
      {(key) => <DocumentView taskId={props.taskId} docKey={key()} people={people} onBack={() => setOpenKey(null)} />}
    </Show>
  );
}

function FileGroup(props: { title: string; count: number; empty: string; children: JSX.Element }) {
  return (
    <section class="tf-group" aria-label={props.title}>
      <h3 class="tf-group-title">
        {props.title} <span class="tsec-muted">{props.count}</span>
      </h3>
      <Show when={props.count > 0} fallback={<p class="tsec-muted">{props.empty}</p>}>
        {props.children}
      </Show>
    </section>
  );
}

function DocumentRow(props: { doc: IssueDocumentSummary; people: TaskPeople; onOpen: () => void }) {
  const author = () =>
    byWhom(props.people, props.doc.updatedByAgentId, props.doc.updatedByUserId) ??
    byWhom(props.people, props.doc.createdByAgentId, props.doc.createdByUserId);
  return (
    <div class="tf-doc">
      <FileText size={16} aria-hidden="true" class="tf-doc-icon" />
      <button type="button" class="tf-doc-title" onClick={() => props.onOpen()}>
        {props.doc.title || props.doc.key}
      </button>
      <span class="mono tf-doc-key">{props.doc.key}</span>
      <span class="tsec-muted">rev {props.doc.latestRevisionNumber}</span>
      <span class="tsec-muted tf-doc-by">
        <Show when={author()}>{(name) => <>{name()} · </>}</Show>
        {stampLabel(props.doc.updatedAt)}
      </span>
      <Show when={props.doc.lockedAt}>
        <span class="tf-lock" title="Locked">
          <Lock size={13} aria-hidden="true" />
          <span class="sr-only">Locked</span>
        </span>
      </Show>
    </div>
  );
}

function AttachmentTile(props: { file: IssueAttachment; people: TaskPeople }) {
  const name = () => props.file.originalFilename ?? props.file.objectKey.split("/").pop() ?? "File";
  const image = () => props.file.contentType.startsWith("image/");
  const open = () => props.file.openPath ?? props.file.contentPath;
  const author = () => byWhom(props.people, props.file.createdByAgentId, props.file.createdByUserId);
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
      <a
        class="btn btn--icon btn--ghost btn--compact tf-tile-download"
        href={props.file.downloadPath ?? `${props.file.contentPath}?download=1`}
        aria-label={`Download ${name()}`}
        title="Download"
      >
        <Download size={14} aria-hidden="true" />
      </a>
    </div>
  );
}

function OutputCard(props: { output: IssueWorkProduct }) {
  const icon = () => (OUTPUT_ICONS[props.output.type] ?? OUTPUT_ICONS.artifact!)();
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
      </div>
    </div>
  );
}

function DocumentView(props: { taskId: string; docKey: string; people: TaskPeople; onBack: () => void }) {
  const doc = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "documents", props.docKey),
    queryFn: ({ signal }) => issuesApi.getDocument(props.taskId, props.docKey, signal),
  }));
  const author = () => {
    const current = doc.data;
    return current ? byWhom(props.people, current.updatedByAgentId, current.updatedByUserId) : null;
  };
  return (
    <section class="tf" aria-label="Document">
      <div class="tsec-head">
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Back to docs and files" onClick={() => props.onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h2 class="disp tf-doc-heading">{doc.data?.title || props.docKey}</h2>
        <Show when={doc.data}>
          {(current) => (
            <span class="tsec-muted">
              <span class="mono">{current().key}</span> · rev {current().latestRevisionNumber}
              <Show when={author()}>{(name) => <> · {name()}</>}</Show> · {stampLabel(current().updatedAt)}
            </span>
          )}
        </Show>
      </div>
      <div class="tsec-scroll">
        <Switch>
          <Match when={doc.isPending}>
            <p class="tsec-muted">Loading…</p>
          </Match>
          <Match when={doc.isError}>
            <p class="tsec-muted">This document couldn't be loaded: {(doc.error as Error).message}</p>
          </Match>
          <Match when={doc.data}>
            {(current) => (
              <Show when={current().body.trim()} fallback={<p class="tsec-muted">This document is empty.</p>}>
                <Markdown source={current().body} />
              </Show>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}
