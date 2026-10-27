import type { WorkspaceFileListItem } from "@paperclipai/shared";

/*
 * The workspace file tree's model. The server lists one folder at a time (`mode=all`, no search),
 * so the tree is a map from folder path to its loaded children, plus the set of expanded folders;
 * `treeRows` flattens it into the rows on screen. Changed files and search results come back as a
 * flat list instead, which `groupByFolder` arranges under their folders.
 *
 * Paths are workspace-relative with `/` separators and no leading or trailing slash; the root is "".
 */

export type TreeEntry = Pick<WorkspaceFileListItem, "kind" | "title" | "relativePath"> &
  Partial<Pick<WorkspaceFileListItem, "byteSize" | "modifiedAt" | "previewKind">>;

export type FolderListing<T extends TreeEntry = TreeEntry> = {
  items: T[];
  /** The server stopped early; more can be loaded from `items.length`. */
  truncated: boolean;
  loading?: boolean;
  error?: string | null;
};

export type TreeRow<T extends TreeEntry = TreeEntry> =
  | { kind: "entry"; entry: T; depth: number; expanded: boolean }
  | { kind: "loading"; path: string; depth: number }
  | { kind: "error"; path: string; depth: number; message: string }
  | { kind: "more"; path: string; depth: number; loaded: number }
  | { kind: "empty"; path: string; depth: number };

export function normalizePath(path: string | null | undefined) {
  return (path ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function basename(path: string) {
  const clean = normalizePath(path);
  const at = clean.lastIndexOf("/");
  return at === -1 ? clean : clean.slice(at + 1);
}

/** The folder a path sits in: "src/a/b.ts" → "src/a", "b.ts" → "". */
export function parentPath(path: string) {
  const clean = normalizePath(path);
  const at = clean.lastIndexOf("/");
  return at === -1 ? "" : clean.slice(0, at);
}

/** Every folder above a path, outermost first: "src/a/b.ts" → ["src", "src/a"]. */
export function ancestors(path: string) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const out: string[] = [];
  for (let index = 1; index < parts.length; index += 1) out.push(parts.slice(0, index).join("/"));
  return out;
}

/** Folders first, then files, each by name without regard to case. */
export function sortEntries<T extends TreeEntry>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return basename(a.relativePath).localeCompare(basename(b.relativePath), undefined, { sensitivity: "base", numeric: true });
  });
}

/** The visible rows of a lazily loaded tree, depth first from `root`. */
export function treeRows<T extends TreeEntry>(
  listings: ReadonlyMap<string, FolderListing<T>>,
  expanded: ReadonlySet<string>,
  root = "",
): TreeRow<T>[] {
  const rows: TreeRow<T>[] = [];
  const walk = (folder: string, depth: number) => {
    const listing = listings.get(folder);
    if (!listing || (listing.loading && listing.items.length === 0)) {
      rows.push({ kind: "loading", path: folder, depth });
      return;
    }
    if (listing.error && listing.items.length === 0) {
      rows.push({ kind: "error", path: folder, depth, message: listing.error });
      return;
    }
    if (listing.items.length === 0) {
      rows.push({ kind: "empty", path: folder, depth });
      return;
    }
    for (const entry of sortEntries(listing.items)) {
      const path = normalizePath(entry.relativePath);
      const open = entry.kind === "directory" && expanded.has(path);
      rows.push({ kind: "entry", entry, depth, expanded: open });
      if (open) walk(path, depth + 1);
    }
    if (listing.loading) rows.push({ kind: "loading", path: folder, depth });
    else if (listing.truncated) rows.push({ kind: "more", path: folder, depth, loaded: listing.items.length });
  };
  walk(normalizePath(root), 0);
  return rows;
}

/** Adds a page to a folder's listing, dropping entries already there. */
export function appendPage<T extends TreeEntry>(current: FolderListing<T> | undefined, page: { items: T[]; truncated: boolean }): FolderListing<T> {
  const seen = new Set((current?.items ?? []).map((item) => normalizePath(item.relativePath)));
  const fresh = page.items.filter((item) => !seen.has(normalizePath(item.relativePath)));
  return { items: [...(current?.items ?? []), ...fresh], truncated: page.truncated, loading: false, error: null };
}

/** Expanded folders plus every folder above `path`, so a file opened from a link shows in place. */
export function revealPath(expanded: ReadonlySet<string>, path: string) {
  const next = new Set(expanded);
  for (const folder of ancestors(path)) next.add(folder);
  return next;
}

export type FolderGroup<T extends TreeEntry> = { folder: string; files: T[] };

/** A flat list of files (changed files, search results) grouped by folder, root first. */
export function groupByFolder<T extends TreeEntry>(items: readonly T[]): FolderGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (item.kind !== "file") continue;
    const folder = parentPath(item.relativePath);
    const list = groups.get(folder) ?? [];
    list.push(item);
    groups.set(folder, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { sensitivity: "base" })))
    .map(([folder, files]) => ({ folder, files: sortEntries(files) }));
}
