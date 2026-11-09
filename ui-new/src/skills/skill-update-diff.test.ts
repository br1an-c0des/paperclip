import type { SkillSourceUpdateDiff, SkillSourceUpdateDiffFile } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { diffView, fileNote, parsePatch, revisionRange } from "./skill-update-diff";

const file = (overrides: Partial<SkillSourceUpdateDiffFile>): SkillSourceUpdateDiffFile => ({
  path: "SKILL.md",
  change: "modified",
  binary: false,
  executableChanged: false,
  diff: null,
  diffUnavailable: null,
  ...overrides,
});

const result = (overrides: Partial<SkillSourceUpdateDiff>): SkillSourceUpdateDiff => ({
  supported: true,
  reason: null,
  currentRef: "a".repeat(40),
  latestRef: "b".repeat(40),
  hasUpdate: true,
  files: [],
  truncated: false,
  ...overrides,
});

describe("reading an update's unified diff", () => {
  it("numbers each side's lines from the hunk headers", () => {
    const { rows, added, removed } = parsePatch("@@ -3,4 +3,4 @@\n keep\n-old\n+new\n keep2\n@@ -20,1 +20,2 @@\n tail\n+more");
    expect(added).toBe(2);
    expect(removed).toBe(1);
    expect(rows.map((row) => [row.kind, row.text, row.oldLine, row.newLine])).toEqual([
      ["hunk", "@@ -3,4 +3,4 @@", null, null],
      ["context", "keep", 3, 3],
      ["remove", "old", 4, null],
      ["add", "new", null, 4],
      ["context", "keep2", 5, 5],
      ["hunk", "@@ -20,1 +20,2 @@", null, null],
      ["context", "tail", 20, 20],
      ["add", "more", null, 21],
    ]);
  });

  it("keeps the no-final-newline marker as a note, and an added file starts at line 1", () => {
    const { rows } = parsePatch("@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file");
    expect(rows.slice(1).map((row) => [row.kind, row.text, row.newLine])).toEqual([
      ["add", "one", 1],
      ["add", "two", 2],
      ["note", "No newline at end of file", null],
    ]);
  });

  it("keeps an empty context line, and reads nothing from an empty or missing diff", () => {
    expect(parsePatch("@@ -1,3 +1,3 @@\n a\n \n-b\n+c").rows[2]).toEqual({ kind: "context", text: "", oldLine: 2, newLine: 2 });
    expect(parsePatch("")).toEqual({ rows: [], added: 0, removed: 0 });
    expect(parsePatch(null)).toEqual({ rows: [], added: 0, removed: 0 });
  });

  it("says why a file has no lines to show", () => {
    expect(fileNote(file({ diff: "@@ -1 +1 @@\n-a\n+b" }))).toBeNull();
    expect(fileNote(file({ diff: "", executableChanged: true }))).toBe("Its executable permission changed.");
    expect(fileNote(file({ binary: true, diffUnavailable: "binary" }))).toBe("A binary file, so there's no line diff.");
    expect(fileNote(file({ diffUnavailable: "too_large", executableChanged: true }))).toBe("Too large to compare line by line. Its executable permission changed.");
    expect(fileNote(file({ change: "not_compared", diffUnavailable: "omitted" }))).toContain("can't be compared");
    expect(fileNote(file({ diffUnavailable: "budget" }))).toBe("Not shown: the comparison reached its size limit.");
  });
});

describe("what the view shows", () => {
  it("totals the files and flags a cut-short response", () => {
    const view = diffView(
      result({
        files: [file({ diff: "@@ -1 +1,2 @@\n-a\n+b\n+c" }), file({ path: "run.sh", change: "added", diff: "@@ -0,0 +1 @@\n+echo" })],
        truncated: true,
      }),
    );
    expect(view).toMatchObject({ kind: "files", summary: "2 files changed", added: 3, removed: 1 });
    expect(view.kind === "files" && view.truncated).toBeTruthy();
  });

  it("passes on the server's reason, and says when there's nothing to update", () => {
    expect(diffView(result({ supported: false, reason: "Only skills installed from a tracked GitHub source have an update diff." }))).toEqual({
      kind: "unsupported",
      text: "Only skills installed from a tracked GitHub source have an update diff.",
    });
    expect(diffView(result({ hasUpdate: false }))).toEqual({ kind: "current", text: "The installed revision is already the latest (bbbbbbb). There's nothing to update." });
    expect(diffView(result({})).kind).toBe("same");
  });

  it("shows the two revisions short", () => {
    expect(revisionRange(result({}))).toBe("aaaaaaa → bbbbbbb");
    expect(revisionRange(result({ currentRef: null }))).toBeNull();
    expect(revisionRange(undefined)).toBeNull();
  });
});
