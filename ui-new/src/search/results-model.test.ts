import type { CompanySearchResult } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  documentTitle,
  enterTarget,
  groupResults,
  highlightSegments,
  chatWhere,
  resultIssueId,
  resultKind,
  resultTask,
  rowSnippet,
  scopeTabs,
  shownResults,
  titleSegments,
} from "./results-model";

const issue = (identifier: string, patch: Partial<CompanySearchResult> = {}): CompanySearchResult => ({
  id: `id-${identifier}`,
  type: "issue",
  score: 1,
  title: `${identifier} Title`,
  href: `/TES/issues/${identifier}`,
  matchedFields: ["title"],
  sourceLabel: "Title",
  snippet: null,
  snippets: [],
  issue: {
    id: `id-${identifier}`,
    identifier,
    title: "Fix the flaky login test",
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    projectId: null,
    updatedAt: "2026-10-27T00:00:00.000Z",
  },
  updatedAt: "2026-10-27T00:00:00.000Z",
  previewImageUrl: null,
  ...patch,
});

const other = (type: "agent" | "project" | "artifact", id: string): CompanySearchResult => ({
  id,
  type,
  score: 1,
  title: id,
  href: `/TES/${type}s/${id}`,
  matchedFields: [type],
  sourceLabel: null,
  snippet: null,
  snippets: [],
  updatedAt: null,
  previewImageUrl: null,
  ...(type === "artifact"
    ? {
        artifact: {
          id,
          source: "attachment" as const,
          mediaKind: "image" as const,
          issueId: "id-TES-9",
          issueIdentifier: "TES-9",
          issueTitle: "Chart",
          projectId: "p1",
          projectName: "Web",
          updatedAt: "2026-10-27T00:00:00.000Z",
        },
      }
    : {}),
});

describe("resultKind", () => {
  it("tells comment and document matches apart by the evidence their link points at", () => {
    expect(resultKind(issue("TES-1"))).toBe("task");
    expect(resultKind(issue("TES-2", { href: "/TES/issues/TES-2#comment-c1" }))).toBe("comment");
    expect(resultKind(issue("TES-3", { href: "/TES/issues/TES-3#document-plan" }))).toBe("document");
    expect(resultKind(other("artifact", "f1"))).toBe("file");
    expect(resultKind(other("agent", "ada"))).toBe("agent");
  });
});

describe("groupResults", () => {
  const results = [
    issue("TES-1"),
    other("agent", "ada"),
    issue("TES-2"),
    issue("TES-3", { href: "/TES/issues/TES-3#comment-c1" }),
    issue("TES-4"),
    issue("TES-5"),
    issue("TES-6"),
    other("project", "web"),
  ];
  const counts = { issue: 6, comment: 2, document: 1, artifact: 0, agent: 1, project: 1 };

  it("groups All by kind in the board's order, capped, with the counts", () => {
    const sections = groupResults(results, counts, "all");
    expect(sections.map((section) => [section.label, section.count, section.results.length, section.more])).toEqual([
      ["Tasks", 6, 4, true],
      ["Comments", 2, 1, true],
      ["Docs", 1, 0, true],
      ["Agents", 1, 1, false],
      ["Projects", 1, 1, false],
    ]);
    expect(sections[0]!.results.map((result) => result.issue?.identifier)).toEqual(["TES-1", "TES-2", "TES-4", "TES-5"]);
    expect(sections[0]!.scope).toBe("issues");
    expect(shownResults(sections)).toHaveLength(7);
  });

  it("draws a kind's view as that kind, uncapped", () => {
    const sections = groupResults([issue("TES-1"), issue("TES-2")], { comment: 2 }, "comments");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ kind: "comment", label: "Comments", count: 2, more: false });
    expect(groupResults([], {}, "issues")).toEqual([]);
  });
});

describe("scopeTabs", () => {
  it("adds All's counts up and blanks agents and projects while filtering", () => {
    const tabs = scopeTabs({ issue: 3, comment: 1, document: 1, artifact: 0, agent: 1, project: 1 }, undefined, true);
    expect(tabs.map((tab) => [tab.label, tab.count])).toEqual([
      ["All", 7],
      ["Tasks", 3],
      ["Comments", 1],
      ["Docs", 1],
      ["Files", 0],
      ["Agents", null],
      ["Projects", null],
    ]);
  });

  it("knows only the open kind's count when All wasn't searched", () => {
    const tabs = scopeTabs(null, { scope: "issues", counts: { issue: 4 } });
    expect(tabs.find((tab) => tab.scope === "issues")?.count).toBe(4);
    expect(tabs.find((tab) => tab.scope === "all")?.count).toBeNull();
  });
});

describe("highlightSegments", () => {
  it("marks the ranges, clamped and merged", () => {
    expect(highlightSegments("the flaky login test", [{ start: 4, end: 9 }, { start: 8, end: 15 }, { start: 30, end: 40 }])).toEqual([
      { text: "the ", hit: false },
      { text: "flaky login", hit: true },
      { text: " test", hit: false },
    ]);
    expect(highlightSegments("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });
});

describe("rows", () => {
  const found = issue("TES-5", {
    href: "/TES/issues/TES-5#document-summary",
    snippets: [
      { field: "title", label: "Title", text: "Fix the flaky login test", highlights: [{ start: 20, end: 24 }] },
      { field: "description", label: "Description", text: "Intermittent failure", highlights: [] },
      { field: "document", label: "Continuation Summary", text: "Summary: test is flaky", highlights: [{ start: 9, end: 13 }] },
    ],
  });

  it("marks the title where the API did", () => {
    expect(titleSegments(found).filter((segment) => segment.hit).map((segment) => segment.text)).toEqual(["test"]);
  });

  it("shows the evidence for comment and document rows, otherwise the best body snippet", () => {
    expect(rowSnippet(found, "document")?.field).toBe("document");
    expect(rowSnippet(found, "task")?.field).toBe("description");
    expect(rowSnippet(found, "comment")?.field).toBe("description");
    expect(documentTitle(found)).toBe("Continuation Summary");
  });

  it("opens the task behind a task, comment, document or file", () => {
    expect(resultTask(found)).toEqual({ id: "id-TES-5", identifier: "TES-5", title: "Fix the flaky login test", projectId: null });
    expect(resultTask(other("artifact", "f1"))).toMatchObject({ id: "id-TES-9", identifier: "TES-9" });
    expect(resultTask(other("agent", "ada"))).toBeNull();
  });

  it("opens the task whose ID was typed, else the first result", () => {
    const list = [issue("TES-1"), issue("TES-12"), issue("TES-5")];
    expect(enterTarget(list, "tes-5")?.issue?.identifier).toBe("TES-5");
    expect(enterTarget(list, "login")?.issue?.identifier).toBe("TES-1");
    expect(enterTarget([], "login")).toBeUndefined();
  });
});

describe("chat results", () => {
  it("finds the task a result belongs to and says where a chat result lives", () => {
    expect(resultIssueId(issue("TES-13"))).toBe("id-TES-13");
    expect(resultIssueId({ ...issue("TES-13"), issue: undefined, artifact: { issueId: "chat-1" } } as unknown as CompanySearchResult)).toBe("chat-1");
    expect(chatWhere("comment", "Bob")).toBe("Message in your chat with Bob");
    expect(chatWhere("task", "Bob")).toBe("Your chat with Bob");
  });
});
