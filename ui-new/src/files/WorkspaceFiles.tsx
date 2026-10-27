import type { WorkspaceFileListItem, WorkspaceFileListResponse } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, ChevronDown, ChevronRight, File, FileCode2, FileText, Folder, FolderOpen, Image, RefreshCw, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { fileResourcesApi, WORKSPACE_FILE_PAGE_SIZE, type WorkspaceFileTarget } from "@/api/file-resources";
import { queryKeys } from "@/api/queryKeys";
import { TextInput } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import type { FileOpen } from "./file-ref";
import { FilePreview } from "./FilePreview";
import { appendPage, basename, groupByFolder, normalizePath, revealPath, treeRows, type FolderListing } from "./file-tree";
import { describeUnavailable, fileSize, isMarkdownPath, languageFor } from "./preview";
import "./WorkspaceFiles.css";

/*
 * The task's workspace files ("Browse workspace files" in Docs and files, board 5): what the agent
 * changed (git status), or the whole tree folder by folder, with a search, and a preview of the
 * picked file. Built in rather than behind `enableExperimentalFileViewer` (decision 12). The
 * server chooses the workspace: the task's execution workspace, else its project's.
 */

type Mode = "changed" | "all";

export function WorkspaceFiles(props: {
  taskId: string;
  /** A file to open straight away, as from an output that points into the workspace. */
  open?: FileOpen | null;
  backLabel: string;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const target = (): WorkspaceFileTarget => ({
    workspace: props.open?.workspace,
    projectId: props.open?.projectId,
    workspaceId: props.open?.workspaceId,
  });
  const targetKey = () => [target().workspace ?? "auto", target().workspaceId ?? ""] as const;

  const [mode, setMode] = createSignal<Mode>(props.open ? "all" : "changed");
  const [searching, setSearching] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<FileOpen | null>(props.open ?? null);
  const [listings, setListings] = createSignal(new Map<string, FolderListing<WorkspaceFileListItem>>());
  const [expanded, setExpanded] = createSignal(new Set<string>(props.open ? revealPath(new Set(), props.open.path) : []));
  const [rootInfo, setRootInfo] = createSignal<WorkspaceFileListResponse | null>(null);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(search, (value) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => setQuery(value.trim()), 250);
    }),
  );

  // Changed files and search results: one flat list.
  const flat = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "files", "list", ...targetKey(), query() ? "search" : mode(), query()),
    queryFn: ({ signal }) =>
      fileResourcesApi.list(
        props.taskId,
        { ...target(), mode: query() ? "all" : "changed", q: query() || null, limit: WORKSPACE_FILE_PAGE_SIZE },
        signal,
      ),
    enabled: mode() === "changed" || query() !== "",
    retry: false,
  }));

  // The whole tree, one folder at a time.
  const setListing = (path: string, next: FolderListing<WorkspaceFileListItem>) =>
    setListings((current) => new Map(current).set(path, next));

  const loadFolder = async (path: string, offset = 0) => {
    const current = listings().get(path);
    if (current?.loading) return;
    setListing(path, { items: current?.items ?? [], truncated: current?.truncated ?? false, loading: true, error: null });
    try {
      const page = await client.fetchQuery({
        queryKey: queryKeys.issues.section(props.taskId, "files", "list", ...targetKey(), "all", path, String(offset)),
        queryFn: ({ signal }) =>
          fileResourcesApi.list(props.taskId, { ...target(), mode: "all", path: path || null, limit: WORKSPACE_FILE_PAGE_SIZE, offset }, signal),
        staleTime: 10_000,
      });
      if (path === "") setRootInfo(page);
      if (page.state === "unavailable") {
        setListing(path, { items: [], truncated: false, loading: false, error: describeUnavailable(page.unavailableReason).body });
        return;
      }
      setListing(path, appendPage(offset === 0 ? undefined : listings().get(path), page));
    } catch (error) {
      setListing(path, { items: listings().get(path)?.items ?? [], truncated: false, loading: false, error: (error as Error).message });
    }
  };

  const refresh = () => {
    setListings(new Map());
    void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "files") });
    if (mode() === "all") {
      void loadFolder("");
      for (const folder of expanded()) void loadFolder(folder);
    }
  };

  // Load the root, and every folder that's open, when the tree is showing.
  createEffect(() => {
    if (mode() !== "all" || query()) return;
    if (!listings().has("")) void loadFolder("");
    for (const folder of expanded()) if (!listings().has(folder)) void loadFolder(folder);
  });

  const toggle = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const pick = (item: Pick<WorkspaceFileListItem, "relativePath">) => {
    setSelected({ ...target(), path: normalizePath(item.relativePath), line: null });
  };

  const rows = createMemo(() => treeRows(listings(), expanded()));
  const groups = createMemo(() => groupByFolder(flat.data?.items ?? []));
  const info = () => (mode() === "all" && !query() ? rootInfo() : flat.data) ?? rootInfo() ?? flat.data ?? null;
  const flatUnavailable = () => (flat.data?.state === "unavailable" ? describeUnavailable(flat.data.unavailableReason) : null);

  return (
    <section class="tf wf" aria-label="Workspace files">
      <div class="tsec-head">
        <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label={props.backLabel} onClick={() => props.onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div class="dv-heading wf-heading">
          <h2 class="disp">Workspace files</h2>
          <Show when={info()?.workspace}>
            {(workspace) => (
              <span class="tsec-muted wf-label">
                <span class="mono">{workspace().workspaceLabel}</span>
                <Show when={workspace().projectName}>{(name) => <> · {name()}</>}</Show>
              </span>
            )}
          </Show>
        </div>
        <div class="tsec-head-tools">
          <button
            type="button"
            class="btn btn--icon btn--ghost btn--compact"
            aria-label={searching() ? "Close search" : "Search files"}
            aria-pressed={searching()}
            onClick={() => {
              const next = !searching();
              setSearching(next);
              if (!next) setSearch("");
            }}
          >
            {searching() ? <X size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
          </button>
          <button type="button" class="btn btn--icon btn--ghost btn--compact" aria-label="Refresh" title="Refresh" onClick={refresh}>
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="wf-body" data-pane={selected() ? "preview" : "tree"}>
        <div class="wf-tree">
          <div class="wf-tree-tools">
            <Show
              when={searching()}
              fallback={
                <Segmented
                  label="Files to show"
                  options={[
                    { value: "changed", label: "Changed" },
                    { value: "all", label: "All files" },
                  ]}
                  value={mode()}
                  onChange={setMode}
                />
              }
            >
              <TextInput
                type="search"
                value={search()}
                placeholder="Search file names"
                aria-label="Search file names"
                ref={(element) => queueMicrotask(() => element.focus())}
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
            </Show>
          </div>
          <div class="wf-list" role="group" aria-label={query() ? "Search results" : mode() === "changed" ? "Changed files" : "All files"}>
            <Switch>
              <Match when={mode() === "changed" || query()}>
                <Switch>
                  <Match when={flat.isPending}>
                    <p class="tsec-muted wf-note">{query() ? "Searching…" : "Looking for changes…"}</p>
                  </Match>
                  <Match when={flat.isError}>
                    <p class="tsec-muted wf-note">The files couldn't be listed: {(flat.error as Error).message}</p>
                  </Match>
                  <Match when={flatUnavailable()}>
                    {(reason) => (
                      <div class="wf-note">
                        <strong>{reason().title}</strong>
                        <p class="tsec-muted">{reason().body}</p>
                      </div>
                    )}
                  </Match>
                  <Match when={groups().length === 0}>
                    <p class="tsec-muted wf-note">{query() ? "No files match." : "No changed files. Browse all files instead."}</p>
                  </Match>
                  <Match when={true}>
                    <For each={groups()}>
                      {(group) => (
                        <div class="wf-group">
                          <Show when={group.folder}>
                            <span class="wf-group-folder mono">{group.folder}/</span>
                          </Show>
                          <For each={group.files}>
                            {(item) => <FileRow item={item} depth={0} selected={selected()?.path === normalizePath(item.relativePath)} onPick={() => pick(item)} />}
                          </For>
                        </div>
                      )}
                    </For>
                    <Show when={flat.data?.truncated}>
                      <p class="tsec-muted wf-note">Showing the first {flat.data!.items.length}. {query() ? "Refine the search" : "Search"} to narrow it down.</p>
                    </Show>
                  </Match>
                </Switch>
              </Match>
              <Match when={true}>
                <For each={rows()}>
                  {(row) => (
                    <Switch>
                      <Match when={row.kind === "entry" && row}>
                        {(entry) =>
                          entry().entry.kind === "directory" ? (
                            <button
                              type="button"
                             
                              class="wf-row"
                              style={{ "--depth": entry().depth }}
                              aria-expanded={entry().expanded}
                              onClick={() => toggle(normalizePath(entry().entry.relativePath))}
                            >
                              {entry().expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                              {entry().expanded ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />}
                              <span class="wf-name">{basename(entry().entry.relativePath)}</span>
                            </button>
                          ) : (
                            <FileRow
                              item={entry().entry}
                              depth={entry().depth}
                              selected={selected()?.path === normalizePath(entry().entry.relativePath)}
                              onPick={() => pick(entry().entry)}
                            />
                          )
                        }
                      </Match>
                      <Match when={row.kind === "loading"}>
                        <p class="tsec-muted wf-row wf-row--note" style={{ "--depth": row.depth }}>
                          Loading…
                        </p>
                      </Match>
                      <Match when={row.kind === "empty"}>
                        <p class="tsec-muted wf-row wf-row--note" style={{ "--depth": row.depth }}>
                          Empty folder
                        </p>
                      </Match>
                      <Match when={row.kind === "error" && row}>
                        {(failed) => (
                          <p class="tsec-muted wf-row wf-row--note" style={{ "--depth": failed().depth }}>
                            {failed().message}
                          </p>
                        )}
                      </Match>
                      <Match when={row.kind === "more" && row}>
                        {(more) => (
                          <button
                            type="button"
                            class="wf-row wf-row--more"
                            style={{ "--depth": more().depth }}
                            onClick={() => void loadFolder(more().path, more().loaded)}
                          >
                            Show more
                          </button>
                        )}
                      </Match>
                    </Switch>
                  )}
                </For>
              </Match>
            </Switch>
          </div>
        </div>

        <div class="wf-pane">
          <Show
            when={selected()}
            fallback={
              <div class="wf-empty">
                <FileText size={22} aria-hidden="true" />
                <p class="tsec-muted">Pick a file to preview it.</p>
              </div>
            }
          >
            {(file) => <FilePreview taskId={props.taskId} file={file()} onClose={() => setSelected(null)} />}
          </Show>
        </div>
      </div>
    </section>
  );
}

function FileRow(props: { item: WorkspaceFileListItem; depth: number; selected: boolean; onPick: () => void }) {
  const path = () => props.item.relativePath;
  const icon = () => {
    if (props.item.previewKind === "image") return <Image size={15} aria-hidden="true" />;
    if (isMarkdownPath(path())) return <FileText size={15} aria-hidden="true" />;
    if (languageFor(path())) return <FileCode2 size={15} aria-hidden="true" />;
    return <File size={15} aria-hidden="true" />;
  };
  return (
    <button
      type="button"
     
      class="wf-row wf-row--file"
      style={{ "--depth": props.depth }}
      aria-current={props.selected || undefined}
      title={path()}
      onClick={() => props.onPick()}
    >
      {icon()}
      <span class="wf-name">{basename(path())}</span>
      <Show when={props.item.byteSize != null}>
        <span class="wf-size">{fileSize(props.item.byteSize!)}</span>
      </Show>
    </button>
  );
}
