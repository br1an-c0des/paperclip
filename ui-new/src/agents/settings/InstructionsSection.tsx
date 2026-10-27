import type { AgentDetail, AgentInstructionCandidate, AgentInstructionsFileDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Download, File, Folder, History, Plus, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { MarkdownEditor } from "@/documents/MarkdownEditor";
import { useCompany } from "@/lib/company";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { Markdown } from "@/ui/Markdown";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { actionableCandidates, bundleSize, diffHunks, diffSummary, fileRows, lineDiff, newFileProblem } from "../instructions-model";
import { dateTime, failure, SectionTitle, shortDate, useAdapters } from "../shared";

/*
 * Instructions (board 27): the agent's instruction files, with AGENTS.md as the entry file, and
 * changes a run suggested, shown as a diff to accept or reject. A file is edited in the Markdown
 * editor and saved on its own; the entry file keeps revisions, which History lists and can restore.
 *
 * Saving sends the base the edit started from (the entry file's revision, other files' content
 * hash), so an edit made elsewhere in the meantime comes back as a conflict instead of being
 * overwritten. Bundle settings (external folders, a different entry file) stay in the old UI.
 */

export function InstructionsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const adapters = useAdapters(() => props.agent);
  const supported = () => props.agent.adapterType === "paperclip_runner" || adapters.harness()?.capabilities.supportsInstructionsBundle !== false;
  const bundle = createQuery(() => ({
    queryKey: queryKeys.agents.instructionsBundle(props.agent.id),
    queryFn: ({ signal }) => agentsApi.instructionsBundle(props.agent.id, company().id, signal),
    enabled: supported(),
    retry: false,
  }));
  const candidates = createQuery(() => ({
    queryKey: queryKeys.agents.instructionCandidates(props.agent.id),
    queryFn: ({ signal }) => agentsApi.instructionCandidates(props.agent.id, company().id, signal),
    enabled: supported() && bundle.data?.mode !== "external",
    retry: false,
  }));
  const [selected, setSelected] = createSignal<string | null>(null);
  const files = () => bundle.data?.files ?? [];
  const current = () => selected() ?? bundle.data?.entryFile ?? "AGENTS.md";
  createEffect(on(() => props.agent.id, () => setSelected(null), { defer: true }));

  return (
    <>
      <SectionTitle title="Instructions">
        The files that tell {props.agent.name} how to work. It reads {bundle.data?.entryFile ?? "AGENTS.md"} first, which can point to the others. Agents can suggest edits; you
        decide.
      </SectionTitle>
      <Show
        when={supported()}
        fallback={
          <section class="card planned">
            <p>{props.agent.name}'s harness doesn't read instruction files. What it's told comes from its prompt template, under Model and runtime → Advanced.</p>
          </section>
        }
      >
        <Show when={bundle.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the instructions. {failure(bundle.error, "")}
          </p>
        </Show>
        <Show when={bundle.data?.warnings.length}>
          <div class="ps-banner" role="status">
            {bundle.data!.warnings.join(" ")}
          </div>
        </Show>
        <Show when={bundle.data?.mode === "external"}>
          <div class="ps-banner" role="status">
            These files live in a folder outside Paperclip ({bundle.data?.rootPath}). Edits here change that folder.
          </div>
        </Show>
        <For each={actionableCandidates(candidates.data)}>{(candidate) => <Suggestion agent={props.agent} candidate={candidate} />}</For>
        <Show when={bundle.data}>
          {(found) => (
            <section class="card ag-files" aria-label="Instruction files">
              <div class="ag-files-list">
                <div class="ag-files-head">
                  <b>Files</b>
                  <Show when={found().editable}>
                    <NewFile
                      existing={files()}
                      onCreate={async (path) => {
                        await agentsApi.saveInstructionsFile(props.agent.id, { path, content: `# ${path.replace(/^.*\//, "").replace(/\.\w+$/, "")}\n`, baseHash: null }, company().id);
                        await client.invalidateQueries({ queryKey: queryKeys.agents.instructionsBundle(props.agent.id) });
                        setSelected(path);
                      }}
                    />
                  </Show>
                </div>
                <div class="ag-tree">
                  <For each={fileRows(files())}>
                    {(row) =>
                      row.kind === "folder" ? (
                        <span class="ag-tree-folder" style={{ "padding-left": `${8 + row.depth * 16}px` }}>
                          <Folder size={14} aria-hidden="true" />
                          {row.name}
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-current={row.path === current() ? "page" : undefined}
                          style={{ "padding-left": `${8 + row.depth * 16}px` }}
                          onClick={() => setSelected(row.path)}
                        >
                          <File size={14} aria-hidden="true" />
                          <span class="ag-tree-name">{row.name}</span>
                          <Show when={row.file.isEntryFile}>
                            <span class="ag-chip">entry</span>
                          </Show>
                        </button>
                      )
                    }
                  </For>
                </div>
                <div class="ag-files-foot">{bundleSize(files())}</div>
              </div>
              <FileEditor agent={props.agent} path={current()} editable={found().editable} entry={current() === found().entryFile} onDeleted={() => setSelected(null)} />
            </section>
          )}
        </Show>
      </Show>
    </>
  );
}

/** One file: Edit or Preview, History (entry file), download, delete, and Save. */
function FileEditor(props: { agent: AgentDetail; path: string; editable: boolean; entry: boolean; onDeleted: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [mode, setMode] = createSignal<"edit" | "preview">("edit");
  const [draft, setDraft] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const file = createQuery(() => ({
    queryKey: queryKeys.agents.instructionsFile(props.agent.id, props.path),
    queryFn: ({ signal }) => agentsApi.instructionsFile(props.agent.id, props.path, company().id, signal),
    retry: false,
  }));
  createEffect(
    on(
      () => props.path,
      () => {
        setDraft(null);
        setProblem(null);
      },
      { defer: true },
    ),
  );
  const content = () => draft() ?? file.data?.content ?? "";
  const dirty = () => draft() !== null && draft() !== file.data?.content;
  const readOnly = () => !props.editable || file.data?.editable === false || file.data?.binary === true;

  const save = async () => {
    const detail = file.data;
    if (!detail || !dirty()) return;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await agentsApi.saveInstructionsFile(
        props.agent.id,
        {
          path: props.path,
          content: content(),
          baseHash: detail.contentHash ?? null,
          ...(props.entry ? { baseRevisionId: detail.revision?.id ?? null } : {}),
        },
        company().id,
      );
      client.setQueryData(queryKeys.agents.instructionsFile(props.agent.id, props.path), saved);
      setDraft(null);
      await client.invalidateQueries({ queryKey: queryKeys.agents.instructionsBundle(props.agent.id) });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the file. If it changed elsewhere, copy your edit, reload it and try again."));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    setDeleteOpen(false);
    try {
      await agentsApi.deleteInstructionsFile(props.agent.id, props.path, company().id, file.data?.contentHash);
      await client.invalidateQueries({ queryKey: queryKeys.agents.instructionsBundle(props.agent.id) });
      pushToast({ tone: "success", title: `Deleted ${props.path}` });
      props.onDeleted();
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't delete the file", body: failure(caught, "") || undefined });
    }
  };

  return (
    <div class="ag-editor">
      <div class="ag-editor-head">
        <span class="mono ag-editor-path">{props.path}</span>
        <Show when={file.data?.revision && file.data.revision.createdAt && !file.data.revision.createdAt.startsWith("1970")}>
          <span class="ps-muted-line">Edited {shortDate(file.data!.revision!.createdAt)}</span>
        </Show>
        <div class="ag-editor-actions">
          <Segmented
            label="View"
            options={[
              { value: "edit", label: readOnly() ? "Source" : "Edit" },
              { value: "preview", label: "Preview" },
            ]}
            value={mode()}
            onChange={setMode}
          />
          <Show when={props.entry && file.data?.revision}>
            <FileHistory agent={props.agent} path={props.path} current={file.data!} onRestored={() => setDraft(null)} />
          </Show>
          <a class="btn btn--icon btn--compact btn--ghost" href={agentsApi.instructionsFileDownloadUrl(props.agent.id, props.path, company().id)} aria-label={`Download ${props.path}`} title="Download">
            <Download size={14} aria-hidden="true" />
          </a>
          <Show when={props.editable && !props.entry}>
            <Button size="compact" variant="icon" ghost aria-label={`Delete ${props.path}`} title="Delete" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          </Show>
          <Show when={!readOnly()}>
            <Button size="compact" variant="primary" disabled={!dirty() || saving()} onClick={() => void save()}>
              {saving() ? "Saving…" : dirty() ? "Save" : "Saved"}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={problem()}>
        <p class="ag-editor-error" role="alert">
          {problem()}
        </p>
      </Show>
      <div class="ag-editor-body">
        <Show when={file.isLoading}>
          <p class="ps-list-note">Loading {props.path}…</p>
        </Show>
        <Show when={file.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't open {props.path}. {failure(file.error, "")}
          </p>
        </Show>
        <Show when={file.data}>
          <Show when={mode() === "edit"} fallback={<Markdown class="ag-preview" source={content()} />}>
            <Show when={!readOnly()} fallback={<pre class="ag-pre mono ag-source">{content()}</pre>}>
              <MarkdownEditor value={file.data!.content} label={`Edit ${props.path}`} onChange={(value) => setDraft(value)} onSave={() => void save()} />
            </Show>
          </Show>
        </Show>
      </div>
      <Dialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        title={`Delete ${props.path}?`}
        width={440}
        description={`${props.agent.name} stops reading it from the next run.`}
        footer={
          <>
            <Button variant="quiet" onClick={() => setDeleteOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete file
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}

/** The entry file's earlier versions; restoring one makes it the current version. */
function FileHistory(props: { agent: AgentDetail; path: string; current: AgentInstructionsFileDetail; onRestored: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal<string | null>(null);
  const history = createQuery(() => ({
    queryKey: queryKeys.agents.instructionHistory(props.agent.id, props.path),
    queryFn: ({ signal }) => agentsApi.instructionHistory(props.agent.id, props.path, company().id, undefined, signal),
    enabled: open(),
    retry: false,
  }));
  const restore = async (revisionId: string) => {
    const base = props.current.revision?.id;
    if (!base) return;
    setBusy(revisionId);
    try {
      const restored = await agentsApi.restoreInstructions(props.agent.id, { path: props.path, revisionId, baseRevisionId: base }, company().id);
      client.setQueryData(queryKeys.agents.instructionsFile(props.agent.id, props.path), restored);
      await client.invalidateQueries({ queryKey: queryKeys.agents.instructionsBundle(props.agent.id) });
      props.onRestored();
      setOpen(false);
      pushToast({ tone: "success", title: "Restored the earlier version" });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't restore it", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger class="btn btn--secondary btn--compact">
        <History size={14} aria-hidden="true" />
        History
      </Popover.Trigger>
      <Popover.Content title={`${props.path} history`} width={380}>
        <Show when={history.isLoading}>
          <p class="ps-list-note">Loading…</p>
        </Show>
        <ul class="ag-history">
          <For each={history.data?.revisions ?? []} fallback={<Show when={history.isSuccess}><li class="ps-list-note">No earlier versions.</li></Show>}>
            {(revision) => (
              <li>
                <span>
                  <b>{revision.createdAt.startsWith("1970") ? "First version" : dateTime(revision.createdAt)}</b>
                  <span class="ps-list-meta">
                    {revision.source === "board" ? "Edited here" : revision.source === "restore" ? "Restored" : revision.source === "tool" ? "Edited by a run" : revision.source} · {revision.byteLength} bytes
                  </span>
                </span>
                <Show when={revision.id !== props.current.revision?.id} fallback={<span class="ag-chip">current</span>}>
                  <Button size="compact" variant="quiet" disabled={busy() !== null} onClick={() => void restore(revision.id)}>
                    {busy() === revision.id ? "Restoring…" : "Restore"}
                  </Button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Popover.Content>
    </Popover>
  );
}

function NewFile(props: { existing: readonly { path: string }[]; onCreate: (path: string) => Promise<void> }) {
  const [open, setOpen] = createSignal(false);
  const [path, setPath] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const create = async (event: Event) => {
    event.preventDefault();
    const found = newFileProblem(path(), props.existing);
    if (found) return setProblem(found);
    setBusy(true);
    try {
      await props.onCreate(path().trim());
      setPath("");
      setOpen(false);
    } catch (caught) {
      setProblem(failure(caught, "Couldn't create the file."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <Popover.Trigger class="btn btn--icon btn--compact btn--ghost" aria-label="New file">
        <Plus size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content title="New file" width={320}>
        <form class="ps-popover-form" onSubmit={(event) => void create(event)}>
          <TextInput
            class="mono"
            value={path()}
            placeholder="TOOLS.md"
            aria-label="File path"
            autocomplete="off"
            spellcheck={false}
            invalid={Boolean(problem())}
            onInput={(event) => {
              setProblem(null);
              setPath(event.currentTarget.value);
            }}
            autofocus
          />
          <p class="fhelp">A path inside the instructions folder, such as research/sources.md.</p>
          <div class="ps-form-foot">
            <Show when={problem()}>
              <span class="nt-error" role="alert">
                {problem()}
              </span>
            </Show>
            <Button size="compact" variant="primary" type="submit" disabled={busy()}>
              {busy() ? "Creating…" : "Create file"}
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover>
  );
}

/** A change a run suggested to an instruction file, as a diff to accept or reject. */
function Suggestion(props: { agent: AgentDetail; candidate: AgentInstructionCandidate }) {
  const company = useCompany();
  const client = useQueryClient();
  const [open, setOpen] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const file = createQuery(() => ({
    queryKey: queryKeys.agents.instructionsFile(props.agent.id, props.candidate.entryFile),
    queryFn: ({ signal }) => agentsApi.instructionsFile(props.agent.id, props.candidate.entryFile, company().id, signal),
    retry: false,
  }));
  const lines = createMemo(() => lineDiff(file.data?.content ?? "", props.candidate.content ?? ""));
  const conflict = () => props.candidate.state === "conflict";
  const resolve = async (accept: boolean) => {
    setBusy(true);
    try {
      // Rejecting resolves the suggestion with the file as it is now.
      const content = accept ? (props.candidate.content ?? "") : (file.data?.content ?? "");
      const saved = await agentsApi.resolveInstructionCandidate(
        props.agent.id,
        props.candidate.runId,
        { content, baseRevisionId: file.data?.revision?.id ?? null },
        company().id,
      );
      client.setQueryData(queryKeys.agents.instructionsFile(props.agent.id, saved.path), saved);
      await client.invalidateQueries({ queryKey: queryKeys.agents.instructionsBundle(props.agent.id) });
      pushToast({ tone: "success", title: accept ? `Accepted the change to ${props.candidate.entryFile}` : "Rejected the suggested change" });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't resolve the suggestion", body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="card ag-suggestion" aria-label={`Suggested change to ${props.candidate.entryFile}`}>
      <div class="ag-suggestion-head">
        <AgentAvatar agent={props.agent} size={32} ring={false} />
        <div class="ag-suggestion-text">
          <h3 class="disp">
            Run <span class="mono">{props.candidate.runId.slice(0, 8)}</span> suggested a change to {props.candidate.entryFile}
          </h3>
          <span class="ps-muted-line">
            {shortDate(props.candidate.createdAt)} · {diffSummary(lines())}
            {conflict() ? " · the file changed since; accepting replaces those edits" : ""}
          </span>
        </div>
        <button type="button" class="btn btn--quiet btn--compact" onClick={() => setOpen(!open())}>
          {open() ? "Hide change" : "Show change"}
        </button>
        <Button size="compact" disabled={busy()} onClick={() => void resolve(false)}>
          Reject
        </Button>
        <Button size="compact" variant="primary" disabled={busy() || !file.isSuccess} onClick={() => void resolve(true)}>
          Accept
        </Button>
      </div>
      <Show when={open()}>
        <div class="ag-diff mono">
          <For each={diffHunks(lines())}>
            {(line) =>
              line === null ? (
                <div class="ag-diff-gap">…</div>
              ) : (
                <div class="ag-diff-line" data-kind={line.kind}>
                  <span>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}</span>
                  <span>{line.text || " "}</span>
                </div>
              )
            }
          </For>
        </div>
      </Show>
    </section>
  );
}
