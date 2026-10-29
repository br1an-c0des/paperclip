import type { WorkspaceFileListItem, WorkspaceFileListResponse } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowLeft, Check, ChevronDown, ChevronRight, File, FileCode2, FileText, Folder, FolderOpen, Image, RefreshCw, Search, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { fileResourcesApi, WORKSPACE_FILE_PAGE_SIZE, type WorkspaceFileTarget } from "@/api/file-resources";
import { queryKeys } from "@/api/queryKeys";
import { useProjectsQuery } from "@/lib/company-data";
import { TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import type { FileOpen } from "./file-ref";
import { FilePreview } from "./FilePreview";
import { appendPage, basename, groupByFolder, normalizePath, revealPath, treeRows, type FolderListing } from "./file-tree";
import { describeUnavailable, fileSize, isMarkdownPath, languageFor } from "./preview";
import "./WorkspaceFiles.css";

/*
 * The task's workspace files ("Browse workspace files" in Docs and files, board 5): what the agent
 * changed (git status), the most recently modified files, or the whole tree folder by folder, with
 * a search, and a preview of the picked file. Built in rather than behind
 * `enableExperimentalFileViewer` (decision 12).
 *
 * By default the server chooses the workspace: the task's execution workspace, else its project's.
 * The workspace picker in the header can browse any project workspace in the company instead, as
 * the old file browser's "other workspace" source does (`workspace=project` with its project and
 * workspace ids).
 */

type Mode = "changed" | "recent" | "all";

/** Where the viewer browses: the task's own workspace, or a named project workspace. */
type Source = WorkspaceFileTarget & { label?: string };

const TASK_SOURCE: Source = {};

export function WorkspaceFiles(props: {
  taskId: string;
  /** A file to open straight away, as from an output that points into the workspace. */
  open?: FileOpen | null;
  backLabel: string;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const projects = useProjectsQuery();
  const [source, setSource] = createSignal<Source>(
    props.open ? { workspace: props.open.workspace, projectId: props.open.projectId, workspaceId: props.open.workspaceId } : TASK_SOURCE,
  );
  const target = (): WorkspaceFileTarget => ({ workspace: source().workspace, projectId: source().projectId, workspaceId: source().workspaceId });
  const targetKey = () => [target().workspace ?? "auto", target().workspaceId ?? ""] as const;
  // Project workspaces to browse instead, by project.
  const projectWorkspaces = createMemo(() =>
    (projects.data ?? []).filter((project) => !project.archivedAt && (project.workspaces ?? []).length > 0),
  );
  const picked = (projectId: string, workspaceId: string) => source().workspace === "project" && source().projectId === projectId && source().workspaceId === workspaceId;

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

  // Changed files, recent files and search results: one flat list. Recent is the most recently
  // modified files first, which works in workspaces that aren't git checkouts too.
  const flatMode = () => (query() ? "all" : mode());
  const flat = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "files", "list", ...targetKey(), query() ? "search" : mode(), query()),
    queryFn: ({ signal }) =>
      fileResourcesApi.list(props.taskId, { ...target(), mode: flatMode(), q: query() || null, limit: WORKSPACE_FILE_PAGE_SIZE }, signal),
    enabled: mode() !== "all" || query() !== "",
    retry: false,
  }));

  // Another workspace starts afresh: its tree, its changes, nothing picked.
  const browse = (next: Source) => {
    setSource(next);
    setListings(new Map());
    setExpanded(new Set<string>());
    setRootInfo(null);
    setSelected(null);
  };

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
  const sourceLabel = () => {
    const current = source();
    if (current.workspace !== "project") return "This task's workspace";
    const project = projectWorkspaces().find((candidate) => candidate.id === current.projectId);
    const workspace = project?.workspaces.find((candidate) => candidate.id === current.workspaceId);
    return workspace ? `${project!.name} · ${workspace.name}` : (current.label ?? "A project workspace");
  };
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
          <Show when={projectWorkspaces().length > 0 || source().workspace === "project"}>
            <Menu placement="bottom-end">
              <Menu.Trigger class="wf-source" aria-label={`Workspace: ${sourceLabel()}. Change`} title={sourceLabel()}>
                <span class="wf-source-label">{sourceLabel()}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="Workspace to browse" width={300}>
                <Menu.Item
                  description="Where this task's runs work"
                  hint={source().workspace !== "project" ? <Check size={14} /> : undefined}
                  onSelect={() => source().workspace === "project" && browse(TASK_SOURCE)}
                >
                  This task's workspace
                </Menu.Item>
                <For each={projectWorkspaces()}>
                  {(project) => (
                    <Menu.Group label={project.name}>
                      <For each={project.workspaces}>
                        {(workspace) => (
                          <Menu.Item
                            description={workspace.cwd ?? workspace.repoUrl ?? undefined}
                            hint={picked(project.id, workspace.id) ? <Check size={14} /> : undefined}
                            onSelect={() =>
                              !picked(project.id, workspace.id) &&
                              browse({ workspace: "project", projectId: project.id, workspaceId: workspace.id, label: `${project.name} · ${workspace.name}` })
                            }
                          >
                            {workspace.name}
                          </Menu.Item>
                        )}
                      </For>
                    </Menu.Group>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </Show>
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
                    { value: "recent", label: "Recent" },
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
          <div
            class="wf-list"
            role="group"
            aria-label={query() ? "Search results" : mode() === "changed" ? "Changed files" : mode() === "recent" ? "Recently modified files" : "All files"}
          >
            <Switch>
              <Match when={mode() === "recent" && !query()}>
                <Switch>
                  <Match when={flat.isPending}>
                    <p class="tsec-muted wf-note">Looking for recent files…</p>
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
                  <Match when={(flat.data?.items ?? []).length === 0}>
                    <p class="tsec-muted wf-note">No files in this workspace yet.</p>
                  </Match>
                  <Match when={true}>
                    <For each={flat.data?.items ?? []}>
                      {(item) => (
                        <FileRow
                          item={item}
                          depth={0}
                          selected={selected()?.path === normalizePath(item.relativePath)}
                          onPick={() => pick(item)}
                          detail={item.modifiedAt ? modifiedLabel(item.modifiedAt) : undefined}
                          showPath
                        />
                      )}
                    </For>
                    <Show when={flat.data?.truncated}>
                      <p class="tsec-muted wf-note">Showing the {flat.data!.items.length} most recently changed. Search to find others.</p>
                    </Show>
                  </Match>
                </Switch>
              </Match>
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

/** "just now", "5m ago", "3h ago", "Oct 12". */
export function modifiedLabel(value: string, now = Date.now()) {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function FileRow(props: {
  item: WorkspaceFileListItem;
  depth: number;
  selected: boolean;
  onPick: () => void;
  /** Shown in place of the size, such as when the file changed. */
  detail?: string;
  /** Show the file's folder too, for a flat list across folders. */
  showPath?: boolean;
}) {
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
      <span class="wf-name">
        {basename(path())}
        <Show when={props.showPath && normalizePath(path()).includes("/")}>
          <span class="wf-folder mono"> {normalizePath(path()).split("/").slice(0, -1).join("/")}</span>
        </Show>
      </span>
      <Show when={props.detail ?? (props.item.byteSize != null ? fileSize(props.item.byteSize) : null)}>
        {(text) => <span class="wf-size">{text()}</span>}
      </Show>
    </button>
  );
}
