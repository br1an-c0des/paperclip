import { describe, expect, it } from "vitest";
import {
  ancestors,
  appendPage,
  basename,
  groupByFolder,
  normalizePath,
  parentPath,
  revealPath,
  sortEntries,
  treeRows,
  type FolderListing,
  type TreeEntry,
} from "./file-tree";

const file = (relativePath: string): TreeEntry => ({ kind: "file", title: basename(relativePath), relativePath });
const dir = (relativePath: string): TreeEntry => ({ kind: "directory", title: basename(relativePath), relativePath });

const listing = (items: TreeEntry[], extra: Partial<FolderListing> = {}): FolderListing => ({ items, truncated: false, ...extra });

const describeRows = (rows: ReturnType<typeof treeRows>) =>
  rows.map((row) =>
    row.kind === "entry" ? `${"  ".repeat(row.depth)}${row.entry.kind === "directory" ? (row.expanded ? "v " : "> ") : ""}${basename(row.entry.relativePath)}` : `${"  ".repeat(row.depth)}[${row.kind}]`,
  );

describe("paths", () => {
  it("normalizes and splits paths", () => {
    expect(normalizePath("/src\\lib/")).toBe("src/lib");
    expect(basename("src/lib/a.ts")).toBe("a.ts");
    expect(parentPath("src/lib/a.ts")).toBe("src/lib");
    expect(parentPath("a.ts")).toBe("");
    expect(ancestors("src/lib/a.ts")).toEqual(["src", "src/lib"]);
    expect(ancestors("a.ts")).toEqual([]);
  });

  it("sorts folders before files, by name", () => {
    const sorted = sortEntries([file("b.ts"), dir("src"), file("A.md"), dir("docs"), file("file10"), file("file2")]);
    expect(sorted.map((entry) => entry.relativePath)).toEqual(["docs", "src", "A.md", "b.ts", "file2", "file10"]);
  });
});

describe("tree rows", () => {
  it("shows loading until the root arrives", () => {
    expect(describeRows(treeRows(new Map(), new Set()))).toEqual(["[loading]"]);
  });

  it("walks expanded folders depth first", () => {
    const listings = new Map([
      ["", listing([file("README.md"), dir("src")])],
      ["src", listing([file("src/b.ts"), dir("src/lib"), file("src/a.ts")])],
      ["src/lib", listing([file("src/lib/x.ts")])],
    ]);
    expect(describeRows(treeRows(listings, new Set(["src"])))).toEqual(["v src", "  > lib", "  a.ts", "  b.ts", "README.md"]);
    expect(describeRows(treeRows(listings, new Set(["src", "src/lib"])))).toEqual([
      "v src",
      "  v lib",
      "    x.ts",
      "  a.ts",
      "  b.ts",
      "README.md",
    ]);
  });

  it("marks folders that are loading, failed, empty or have more", () => {
    const listings = new Map([
      ["", listing([dir("a"), dir("b"), dir("c"), dir("d")])],
      ["b", listing([], { error: "Nope" })],
      ["c", listing([])],
      ["d", listing([file("d/1")], { truncated: true })],
    ]);
    const rows = treeRows(listings, new Set(["a", "b", "c", "d"]));
    expect(describeRows(rows)).toEqual(["v a", "  [loading]", "v b", "  [error]", "v c", "  [empty]", "v d", "  1", "  [more]"]);
    expect(rows.at(-1)).toMatchObject({ kind: "more", path: "d", loaded: 1 });
  });

  it("appends pages without duplicates", () => {
    const first = appendPage(undefined, { items: [file("a"), file("b")], truncated: true });
    const next = appendPage(first, { items: [file("b"), file("c")], truncated: false });
    expect(next.items.map((entry) => entry.relativePath)).toEqual(["a", "b", "c"]);
    expect(next.truncated).toBe(false);
  });

  it("reveals a file's folders", () => {
    expect([...revealPath(new Set(["x"]), "src/lib/a.ts")].sort()).toEqual(["src", "src/lib", "x"]);
  });
});

describe("flat lists", () => {
  it("groups files by folder, root first", () => {
    const groups = groupByFolder([file("src/b.ts"), file("README.md"), file("docs/x.md"), file("src/a.ts"), dir("ignored")]);
    expect(groups.map((group) => [group.folder, group.files.map((entry) => basename(entry.relativePath))])).toEqual([
      ["", ["README.md"]],
      ["docs", ["x.md"]],
      ["src", ["a.ts", "b.ts"]],
    ]);
  });
});
