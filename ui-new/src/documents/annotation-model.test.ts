import { describe, expect, it } from "vitest";
import { anchorForSelection, newCommentBlock, openThreadCount, quote, rawSpanFor, visibleThreads } from "./annotation-model";

type Thread = Parameters<typeof visibleThreads>[0][number] & { id: string };

function thread(id: string, start: number, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    status: "open",
    anchorState: "active",
    normalizedStart: start,
    markdownStart: start,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  } as Thread;
}

describe("threads", () => {
  it("lists threads in document order, leaving out orphans", () => {
    const threads = [thread("b", 40), thread("a", 5), thread("lost", 1, { anchorState: "orphaned" }), thread("c", 40, { markdownStart: 50 })];
    expect(visibleThreads(threads).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by status", () => {
    const threads = [thread("open", 1), thread("done", 2, { status: "resolved" })];
    expect(visibleThreads(threads, "open").map((entry) => entry.id)).toEqual(["open"]);
    expect(visibleThreads(threads, "resolved").map((entry) => entry.id)).toEqual(["done"]);
  });

  it("counts open threads that still point at text", () => {
    expect(
      openThreadCount([
        thread("a", 1),
        thread("b", 2, { status: "resolved" }),
        thread("c", 3, { anchorState: "orphaned" }),
        thread("d", 4, { anchorState: "stale" }),
      ]),
    ).toBe(2);
  });

  it("says why a new comment can't be anchored", () => {
    expect(newCommentBlock({ editing: false, viewingHistory: false, hasRevision: true })).toBeNull();
    expect(newCommentBlock({ editing: true, viewingHistory: false, hasRevision: true })).toMatch(/edits/);
    expect(newCommentBlock({ editing: false, viewingHistory: true, hasRevision: true })).toMatch(/current revision/);
    expect(newCommentBlock({ editing: false, viewingHistory: false, hasRevision: false })).toMatch(/no saved revision/);
  });
});

describe("anchors", () => {
  const markdown = "# Plan\n\nBackfill **BTC** data.\n\n- Use the archive\n- Use the archive again\n";

  it("anchors a selection in the rendered text to the Markdown source", () => {
    const rendered = "Plan Backfill BTC data. Use the archive Use the archive again";
    const anchor = anchorForSelection({ markdown, renderedText: rendered, renderedStart: rendered.indexOf("BTC"), selectedText: "BTC data" });
    expect(anchor?.selectedText).toBe("BTC data");
    expect(anchor?.selector.quote.exact).toBe("BTC data");
    const position = anchor!.selector.position;
    expect(markdown.slice(position.markdownStart, position.markdownEnd)).toContain("BTC");
  });

  it("picks the occurrence nearest the selection", () => {
    const rendered = "Plan Backfill BTC data. Use the archive Use the archive again";
    const second = rendered.lastIndexOf("Use the archive");
    const anchor = anchorForSelection({ markdown, renderedText: rendered, renderedStart: second, selectedText: "Use the archive" });
    const first = anchorForSelection({ markdown, renderedText: rendered, renderedStart: rendered.indexOf("Use"), selectedText: "Use the archive" });
    expect(anchor!.selector.position.markdownStart).toBeGreaterThan(first!.selector.position.markdownStart);
  });

  it("gives up on text that isn't in the document", () => {
    expect(anchorForSelection({ markdown, renderedText: "x", renderedStart: 0, selectedText: "missing" })).toBeNull();
    expect(anchorForSelection({ markdown, renderedText: "x", renderedStart: 0, selectedText: "   " })).toBeNull();
  });

  it("finds a passage's raw span despite extra whitespace", () => {
    const text = "Plan\n\n  Backfill   BTC\ndata.";
    const span = rawSpanFor(text, "Backfill BTC data");
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe("Backfill   BTC\ndata");
    expect(rawSpanFor(text, "nowhere")).toBeNull();
  });

  it("shortens long quotes at a word", () => {
    expect(quote("short")).toBe("short");
    expect(quote("one two three four five six", 20)).toBe("one two three four…");
  });
});
