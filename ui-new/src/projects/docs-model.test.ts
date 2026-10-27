import type { CompanyArtifact, CompanyArtifactGroup } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { docGroups, docKind, documentKey, docSummary, fileTag, fileType, incompleteGroups, type TaskFacts } from "./docs-model";

function artifact(id: string, issueId: string, fields: Partial<CompanyArtifact> = {}): CompanyArtifact {
  return {
    id,
    source: "document",
    mediaKind: "document",
    title: id,
    previewText: null,
    contentType: "text/markdown",
    contentPath: null,
    openPath: null,
    downloadPath: null,
    issue: { id: issueId, identifier: issueId.toUpperCase(), title: `Task ${issueId}` },
    project: null,
    createdByAgent: null,
    updatedAt: "2026-10-20T10:00:00Z",
    href: `/TES/issues/${issueId.toUpperCase()}#document-${id}`,
    ...fields,
  };
}

function group(issueId: string, previews: CompanyArtifact[], count = previews.length): CompanyArtifactGroup {
  return {
    id: `task:${issueId}`,
    groupBy: "task",
    issue: { id: issueId, identifier: issueId.toUpperCase(), title: `Task ${issueId}` },
    title: `Task ${issueId}`,
    count,
    mediaKinds: [],
    previewArtifacts: previews,
    updatedAt: "2026-10-20T10:00:00Z",
    href: "",
  };
}

const facts = (entries: [string, TaskFacts["status"]][]) =>
  new Map(entries.map(([id, status]) => [id, { status, assigneeAgentId: null, assigneeUserId: null } as TaskFacts]));

describe("artifact helpers", () => {
  it("maps sources onto the type filter", () => {
    expect(docKind({ source: "document" })).toBe("doc");
    expect(docKind({ source: "attachment" })).toBe("att");
    expect(docKind({ source: "work_product" })).toBe("out");
  });

  it("reads a document's key from its link", () => {
    expect(documentKey(artifact("plan", "t1"))).toBe("plan");
    expect(documentKey(artifact("x", "t1", { href: "/TES/issues/T1#document-data%20notes" }))).toBe("data notes");
    expect(documentKey(artifact("f", "t1", { source: "attachment", href: "/TES/issues/T1#attachment-9" }))).toBeNull();
  });

  it("tags files by extension, then media type", () => {
    expect(fileTag(artifact("d", "t1"))).toBe("MD");
    expect(fileTag(artifact("a", "t1", { source: "attachment", title: "chart.png", contentType: "image/png", mediaKind: "image" }))).toBe("PNG");
    expect(fileTag(artifact("a", "t1", { source: "attachment", title: "report", contentType: "application/pdf", mediaKind: "file" }))).toBe("PDF");
    expect(fileTag(artifact("w", "t1", { source: "work_product", title: "Preview", contentType: null, mediaKind: "empty" }))).toBe("LINK");
    expect(fileType(artifact("a", "t1", { source: "attachment", title: "rows.csv", contentType: "text/csv", mediaKind: "text" }))).toBe("Spreadsheet");
    expect(fileType(artifact("w", "t1", { source: "work_product", title: "x.html" }))).toBe("Output");
  });
});

describe("docGroups", () => {
  const groups = [
    group("t1", [artifact("plan", "t1"), artifact("shot.png", "t1", { source: "attachment", mediaKind: "image" }), artifact("pr", "t1", { source: "work_product" })], 5),
    group("t2", [artifact("notes", "t2")]),
    group("t3", [artifact("runbook", "t3")]),
  ];
  const tasks = facts([
    ["t1", "in_progress"],
    ["t2", "todo"],
    ["t3", "done"],
  ]);

  it("groups each task's artifacts, using the full list once it's loaded", () => {
    const before = docGroups({ groups, full: new Map(), tasks, showClosed: true, filter: "all" });
    expect(before.groups.map((entry) => [entry.issueId, entry.items.length, entry.count, entry.complete, entry.closed])).toEqual([
      ["t1", 3, 5, false, false],
      ["t2", 1, 1, true, false],
      ["t3", 1, 1, true, true],
    ]);
    expect(docSummary(before)).toBe("7 items in 3 tasks");

    const full = new Map([["t1", [...groups[0]!.previewArtifacts, artifact("data", "t1"), artifact("log.txt", "t1", { source: "attachment" })]]]);
    const after = docGroups({ groups, full, tasks, showClosed: true, filter: "all" });
    expect(after.groups[0]).toMatchObject({ complete: true, count: 5, status: "in_progress" });
    expect(after.counts).toEqual({ all: 7, doc: 4, att: 2, out: 1 });
  });

  it("hides closed tasks when asked, and tasks the filter empties", () => {
    const docs = docGroups({ groups, full: new Map(), tasks, showClosed: false, filter: "att" });
    expect(docs.groups.map((entry) => [entry.issueId, entry.count])).toEqual([["t1", 1]]);
    expect(docs.counts).toEqual({ all: 4, doc: 2, att: 1, out: 1 });
  });

  it("searches titles and task names", () => {
    const found = docGroups({ groups, full: new Map(), tasks, showClosed: true, filter: "all", search: "NOTES" });
    expect(found.groups.map((entry) => entry.issueId)).toEqual(["t2"]);
    expect(docGroups({ groups, full: new Map(), tasks, showClosed: true, filter: "all", search: "task t3" }).groups.map((entry) => entry.issueId)).toEqual(["t3"]);
  });

  it("treats a task missing from the list as open", () => {
    const view = docGroups({ groups: [group("gone", [artifact("x", "gone")])], full: new Map(), tasks: new Map(), showClosed: false, filter: "all" });
    expect(view.groups[0]).toMatchObject({ issueId: "gone", status: null, closed: false });
  });

  it("names the groups that need loading in full", () => {
    expect(incompleteGroups(groups)).toEqual(["t1"]);
  });
});
