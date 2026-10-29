import { describe, expect, it } from "vitest";
import { csvTable, HTML_PREVIEW_CSP, htmlPreviewDocument, parseCsv } from "./html-preview";
import { detectPreview } from "./preview";

const resource = (displayPath: string, contentType: string | null = null) => ({ previewKind: "text" as const, contentType, displayPath, title: displayPath });
const text = (data: string) => ({ encoding: "utf8" as const, data });

describe("HTML and CSV previews", () => {
  it("tells HTML and CSV apart from other text", () => {
    expect(detectPreview(resource("report/index.html"), text("<h1>Hi</h1>"))).toEqual({ kind: "html" });
    expect(detectPreview(resource("page", "text/html; charset=utf-8"), text(""))).toEqual({ kind: "html" });
    expect(detectPreview(resource("data/prices.csv"), text("a,b"))).toEqual({ kind: "csv" });
    expect(detectPreview(resource("notes.md"), text("# Hi"))).toEqual({ kind: "markdown" });
    expect(detectPreview(resource("app.ts"), text(""))).toEqual({ kind: "code", language: "TypeScript" });
  });

  it("puts the policy in front of the file's markup", () => {
    const page = htmlPreviewDocument("<script>alert(1)</script>");
    expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<script>"));
    expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'");
    expect(HTML_PREVIEW_CSP).toContain("default-src 'none'");
  });

  it("parses quoted fields with commas, newlines and doubled quotes", () => {
    expect(parseCsv('name,note\r\n"Smith, J","said ""hi""\nthen left"\n')).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthen left'],
    ]);
    expect(() => parseCsv('a,"open')).toThrow(/isn't closed/);
  });

  it("makes a table with the first record as the header", () => {
    expect(csvTable("symbol,price\nBTC,1\nETH\n")).toEqual({
      header: ["symbol", "price"],
      rows: [
        ["BTC", "1"],
        ["ETH", ""],
      ],
      rowCount: 2,
      columnCount: 2,
      clipped: false,
    });
    expect(csvTable(",x\n1,2")).toMatchObject({ header: ["Column 1", "x"] });
    expect(csvTable('"')).toEqual({ error: expect.any(String) });
  });
});
